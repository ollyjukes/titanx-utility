// app/api/holders/cache/getHoldersMap.js
import pLimit from 'p-limit';
import config from '@/app/contracts_nft';
import { logger } from '@/app/lib/logger';
import { getCacheState, saveCacheStateContract } from '@/app/api/holders/cache/state';
import { getNewEvents } from '@/app/api/holders/blockchain/events';
import { client } from '@/app/api/utils/client';
import { batchMulticall } from '@/app/api/holders/blockchain/multicall';
import { retry } from '@/app/api/utils/retry';
import { getCache, setCache } from '@/app/api/utils/cache';
import { fetchOwnersAlchemy } from '@/app/api/holders/blockchain/owners';
import { sanitizeBigInt } from './utils';
import { getAddress } from 'viem';

const limit = pLimit(5);
const ownershipChunkLimit = pLimit(2);
const ALCHEMY_CONTRACTS = ['element280', 'element369', 'stax'];

export async function getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState, forceUpdate = false) {
  if (!contractAddress) throw new Error('Contract address missing');
  if (!abi) throw new Error(`${contractKey} ABI missing`);

  contractKey = contractKey.toLowerCase();
  const chain = config.nftContracts[contractKey]?.chain || 'eth';
  logger.info('holders', `Starting getHoldersMap: contractKey=${contractKey}, forceUpdate=${forceUpdate}`, chain, contractKey);

  let lastBlock = BigInt(cacheState.lastProcessedBlock || config.nftContracts[contractKey]?.deploymentBlock || 0);
  let currentBlock;
  let totalBurned = Number(cacheState.totalBurned) || 0;
  let totalTokens = 0;
  let tokenOwnerMap = new Map();
  let holdersMap = new Map();
  let errorLog = cacheState.progressState?.errorLog || [];
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const contractTiers = config.nftContracts[contractKey]?.tiers || {};
  const maxTier = Math.max(...Object.keys(contractTiers).map(Number), 0);
  let tierDistribution = Array(maxTier + 1).fill(0);
  let rarityDistribution = contractKey === 'ascendant' ? Array(3).fill(0) : [];
  const cachedTokenTiers = new Map();

  if (!cacheState.progressState) {
    cacheState.progressState = {
      step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [],
      progressPercentage: '0%', totalLiveHolders: 0, totalOwners: 0, lastProcessedBlock: cacheState.lastProcessedBlock || null,
      lastUpdated: Date.now(), isPopulating: false, status: 'idle',
    };
  }

  const requiredFunctions = contractKey === 'ascendant' ? ['getNFTAttribute', 'userRecords', 'totalShares', 'toDistribute', 'batchClaimableAmount'] : ['totalSupply', 'totalBurned', 'ownerOf', 'getNftTier'];
  const missingFunctions = requiredFunctions.filter(fn => !abi.some(item => item.name === fn && item.type === 'function'));
  if (missingFunctions.length > 0) throw new Error(`Missing ABI functions: ${missingFunctions.join(', ')}`);

  try {
    currentBlock = await retry(() => client.getBlockNumber(), { retries: 3, delay: 1000, backoff: true });
    logger.debug('holders', `Current block: ${currentBlock}`, chain, contractKey);
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    throw error;
  }

  if (!cacheState.lastProcessedBlock) {
    cacheState.lastProcessedBlock = config.nftContracts[contractKey]?.deploymentBlock || 0;
    cacheState.progressState.lastProcessedBlock = cacheState.lastProcessedBlock;
    cacheState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey, cacheState);
    await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');
  }

  cacheState.progressState.step = 'checking_cache';
  cacheState.progressState.progressPercentage = '0%';
  cacheState.lastUpdated = Date.now();
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);
  await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');

  if (config.nftContracts[contractKey] && !forceUpdate) {
    let fromBlock = BigInt(cacheState.lastProcessedBlock);
    let cachedHolders, cachedTiers;
    let updatedTokenIds = new Set();
    let burnedTokenIds = [];
    let transferTokenIds = [];

    try {
      cachedHolders = await getCache(`${contractKey}_holders`, contractKey);
      cachedTiers = await getCache(`${contractKey}_tiers`, contractKey) || {};
      if (cachedHolders?.holders && Array.isArray(cachedHolders.holders) && Number.isInteger(cachedHolders.totalBurned)) {
        holdersMap = new Map(cachedHolders.holders.map(h => [h.wallet, h]));
        totalBurned = Number(cachedHolders.totalBurned) || totalBurned;
        totalTokens = Number(cacheState.progressState.totalNfts) || 0;
        holdersMap.forEach(holder => holder.tokenIds.forEach(tokenId => tokenOwnerMap.set(Number(tokenId), holder.wallet)));
        Object.entries(cachedTiers).forEach(([tokenId, tierData]) => {
          if (tierData && typeof tierData.tier === 'number') {
            cachedTokenTiers.set(Number(tokenId), tierData);
            tierDistribution[tierData.tier] += 1;
          }
        });
        logger.info('holders', `Cache hit: holders=${holdersMap.size}, tiers=${cachedTokenTiers.size}, lastBlock=${cacheState.lastProcessedBlock}`, chain, contractKey);
      }
    } catch (error) {
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'load_cache', error: error.message });
      cachedHolders = null;
    }

    const blockRanges = [];
    for (let block = Number(fromBlock); block <= Number(currentBlock); block += config.MAX_BLOCK_RANGE) {
      blockRanges.push({ fromBlock: block, toBlock: Math.min(block + config.MAX_BLOCK_RANGE - 1, Number(currentBlock)) });
    }

    const concurrencyLimit = 8;
    for (let i = 0; i < blockRanges.length; i += concurrencyLimit) {
      const batch = blockRanges.slice(i, i + concurrencyLimit);
      await Promise.all(batch.map(async ({ fromBlock, toBlock }) => {
        let currentMaxBlockRange = config.MAX_BLOCK_RANGE;
        let currentFromBlock = fromBlock;
        while (currentFromBlock <= toBlock) {
          const currentToBlock = Math.min(currentFromBlock + currentMaxBlockRange - 1, toBlock);
          try {
            const events = await getNewEvents(contractKey, contractAddress, currentFromBlock, currentToBlock, config, chain, forceUpdate);
            if (!events || typeof events.lastBlock !== 'number') throw new Error(`Invalid events response: ${JSON.stringify(events)}`);
            burnedTokenIds.push(...(Array.isArray(events.burns) ? events.burns.map(event => event.tokenId) : []));
            transferTokenIds.push(...[
              ...(Array.isArray(events.buys) ? events.buys : []),
              ...(Array.isArray(events.sells) ? events.sells : []),
            ].map(event => ({ tokenId: event.tokenId, from: event.from, to: event.to })));
            lastBlock = BigInt(events.lastBlock);
            errorLog.push(...(events.errorLog || []));
          } catch (error) {
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_events', fromBlock: currentFromBlock, toBlock: currentToBlock, error: error.message });
            lastBlock = BigInt(currentToBlock);
          }
          currentFromBlock = currentToBlock + 1;
        }
      }));
    }

    if (cachedHolders) {
      burnedTokenIds.forEach(tokenId => {
        const wallet = tokenOwnerMap.get(tokenId);
        if (wallet) {
          const holder = holdersMap.get(wallet);
          if (holder) {
            holder.tokenIds = holder.tokenIds.filter(id => id !== tokenId);
            holder.total -= 1;
            const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
            holder.tiers[tier] -= 1;
            holder.multiplierSum -= contractTiers[tier + 1]?.multiplier || tier + 1;
            if (holder.total === 0) holdersMap.delete(wallet);
            tokenOwnerMap.delete(tokenId);
            cachedTokenTiers.delete(tokenId);
            totalTokens -= 1;
            totalBurned += 1;
            tierDistribution[tier] -= 1;
          }
        }
      });

      transferTokenIds.forEach(({ tokenId, from, to }) => {
        updatedTokenIds.add(tokenId);
        const oldHolder = holdersMap.get(from);
        if (oldHolder) {
          oldHolder.tokenIds = oldHolder.tokenIds.filter(id => id !== tokenId);
          oldHolder.total -= 1;
          const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
          oldHolder.tiers[tier] -= 1;
          oldHolder.multiplierSum -= contractTiers[tier + 1]?.multiplier || tier + 1;
          if (oldHolder.total === 0) holdersMap.delete(from);
        }
        let newHolder = holdersMap.get(to) || {
          wallet: to, tokenIds: [], tiers: Array(maxTier + 1).fill(0), total: 0, multiplierSum: 0, claimableRewards: 0,
        };
        newHolder.tokenIds.push(tokenId);
        newHolder.total += 1;
        const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
        newHolder.tiers[tier] += 1;
        newHolder.multiplierSum += contractTiers[tier + 1]?.multiplier || tier + 1;
        holdersMap.set(to, newHolder);
        tokenOwnerMap.set(tokenId, to);
      });

      cacheState.lastProcessedBlock = Number(lastBlock);
      cacheState.progressState.lastProcessedBlock = Number(lastBlock);
      cacheState.lastUpdated = Date.now();
      cacheState.progressState.lastUpdated = Date.now();
      await saveCacheStateContract(contractKey, cacheState);
      await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');
    }
  }

  cacheState.progressState.step = 'fetching_holders';
  cacheState.progressState.isPopulating = true;
  cacheState.progressState.progressPercentage = '20%';
  cacheState.lastUpdated = Date.now();
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);
  await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');

  if (ALCHEMY_CONTRACTS.includes(contractKey)) {
    try {
      const owners = await fetchOwnersAlchemy(contractAddress, contractKey, chain);
      const filteredOwners = owners.filter(owner => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() && owner.tokenBalances?.length > 0);
      tokenOwnerMap.clear();
      totalTokens = 0;
      const seenTokenIds = new Set();
      filteredOwners.forEach(owner => {
        if (!owner.ownerAddress) return;
        let wallet = getAddress(owner.ownerAddress).toLowerCase();
        owner.tokenBalances.forEach(tb => {
          if (!tb.tokenId) return;
          const tokenId = Number(tb.tokenId);
          if (seenTokenIds.has(tokenId)) {
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_token', tokenId, wallet, error: 'Duplicate tokenId' });
            return;
          }
          seenTokenIds.add(tokenId);
          tokenOwnerMap.set(tokenId, wallet);
          totalTokens++;
        });
      });
      lastBlock = currentBlock;
    } catch (error) {
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owners_alchemy', error: error.message, details: error.stack });
      const fromBlock = BigInt(config.nftContracts[contractKey].deploymentBlock || cacheState.lastProcessedBlock || 0);
      tokenOwnerMap.clear();
      totalTokens = 0;
      const seenTokenIds = new Set();
      try {
        const events = await getNewEvents(contractKey, contractAddress, Number(fromBlock), Number(currentBlock), config, chain, forceUpdate);
        if (!events || typeof events.lastBlock !== 'number') throw new Error(`Invalid events response: lastBlock is missing`);
        events.burns?.forEach(event => {
          seenTokenIds.delete(event.tokenId);
          tokenOwnerMap.delete(event.tokenId);
          totalBurned += 1;
        });
        [...(events.buys || []), ...(events.sells || [])].forEach(event => {
          if (event.to !== burnAddress.toLowerCase()) {
            if (event.from === '0x0000000000000000000000000000000000000000' && !seenTokenIds.has(event.tokenId)) totalTokens++;
            tokenOwnerMap.set(event.tokenId, event.to);
            seenTokenIds.add(event.tokenId);
          }
        });
        lastBlock = BigInt(events.lastBlock);
        errorLog.push(...(events.errorLog || []));
        cacheState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastProcessedBlock = Number(lastBlock);
        cacheState.lastUpdated = Date.now();
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');
      } catch (eventError) {
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_transfer_events', fromBlock: Number(fromBlock), toBlock: Number(currentBlock), error: eventError.message });
        lastBlock = currentBlock;
      }
    }
  }

  try {
    const results = await retry(() => client.multicall({
      contracts: [
        { address: contractAddress, abi, functionName: 'totalSupply' },
        { address: contractAddress, abi, functionName: 'totalBurned' },
      ],
      allowFailure: true,
    }), { retries: 3, delay: 1000, backoff: true });
    totalTokens = results[0]?.status === 'success' && results[0].result != null ? Number(results[0].result) : totalTokens;
    totalBurned = results[1]?.status === 'success' && results[1].result != null ? Number(results[1].result) : totalBurned;
    if (results[0]?.status !== 'success') errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_supply', error: `totalSupply call failed: ${results[0]?.error || 'Unknown error'}` });
    if (results[1]?.status !== 'success') errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned', error: `totalBurned call failed: ${results[1]?.error || 'Unknown error'}` });
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_supply', error: error.message });
  }

  cacheState.progressState.step = 'building_holders';
  cacheState.progressState.progressPercentage = '50%';
  cacheState.lastUpdated = Date.now();
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);
  await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');

  for (const [tokenId, wallet] of tokenOwnerMap) {
    if (!holdersMap.has(wallet)) {
      holdersMap.set(wallet, { wallet, tokenIds: [], tiers: Array(maxTier + 1).fill(0), total: 0, multiplierSum: 0, claimableRewards: 0 });
    }
    const holder = holdersMap.get(wallet);
    holder.tokenIds.push(tokenId);
    holder.total += 1;
  }

  cacheState.progressState.step = 'fetching_tiers';
  cacheState.progressState.processedTiers = 0;
  cacheState.progressState.totalTiers = tokenOwnerMap.size;
  cacheState.progressState.progressPercentage = '60%';
  cacheState.lastUpdated = Date.now();
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);
  await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state'); // Corrected line
  logger.debug('holders', `Starting tier fetching: totalTokens=${tokenOwnerMap.size}`, chain, contractKey);
  
  const tierCalls = Array.from(tokenOwnerMap.keys()).map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
    args: [BigInt(tokenId)],
  }));

  const tierResults = [];
  const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 200;
  for (let i = 0; i < tierCalls.length; i += chunkSize) {
    const chunk = tierCalls.slice(i, i + chunkSize);
    const chunkTokenIds = Array.from(tokenOwnerMap.keys()).slice(i, i + chunkSize);
    logger.debug('holders', `Fetching tiers for chunk ${i / chunkSize + 1}: tokenIds=${chunkTokenIds.join(',')}`, chain, contractKey);
    try {
      const results = await retry(() => batchMulticall(chunk, 100), { retries: 3, delay: 500, backoff: true });
      tierResults.push(...results);
      cacheState.progressState.processedTiers = Math.min(i + chunkSize, tierCalls.length);
      cacheState.progressState.progressPercentage = `${Math.round(60 + (cacheState.progressState.processedTiers / cacheState.progressState.totalTiers) * 30)}%`;
      cacheState.lastUpdated = Date.now();
      cacheState.progressState.lastUpdated = Date.now();
      await saveCacheStateContract(contractKey, cacheState);
      await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');
      logger.debug('holders', `Processed chunk ${i / chunkSize + 1}: ${results.length} tiers`, chain, contractKey);
    } catch (error) {
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', chunk: i / chunkSize + 1, error: error.message });
      chunk.forEach(() => tierResults.push({ status: 'failure', result: 0, error: error.message }));
    }
  }

  tierResults.forEach((result, i) => {
    const tokenId = Array.from(tokenOwnerMap.keys())[i];
    const tier = result.status === 'success' && typeof result.result === 'number' ? Number(result.result) : (contractKey === 'ascendant' && result.status === 'success' ? Number(result.result[1]) : 0);
    cachedTokenTiers.set(tokenId, { tier, timestamp: Date.now() });
    tierDistribution[tier] += 1;
    const wallet = tokenOwnerMap.get(tokenId);
    const holder = holdersMap.get(wallet);
    if (holder) {
      holder.tiers[tier] += 1;
      holder.multiplierSum += contractTiers[tier + 1]?.multiplier || tier + 1;
      logger.debug('holders', `Assigned tier=${tier} to tokenId=${tokenId}, wallet=${wallet}`, chain, contractKey);
    }
  });
  logger.debug('holders', `Completed tier fetching: totalTiers=${tierResults.length}, distribution=${JSON.stringify(tierDistribution)}`, chain, contractKey);

  cacheState.progressState.step = 'completed';
  cacheState.progressState.isPopulating = false;
  cacheState.isPopulating = false;
  cacheState.progressState.progressPercentage = '100%';
  cacheState.progressState.totalNfts = totalTokens;
  cacheState.progressState.processedNfts = totalTokens;
  cacheState.progressState.totalOwners = holdersMap.size;
  cacheState.progressState.totalLiveHolders = totalTokens;
  cacheState.globalMetrics = { totalMinted: totalTokens + totalBurned, totalLive: totalTokens, totalBurned, tierDistribution };
  cacheState.lastProcessedBlock = Number(lastBlock);
  cacheState.progressState.lastProcessedBlock = Number(lastBlock);
  cacheState.lastUpdated = Date.now();
  cacheState.progressState.lastUpdated = Date.now();

  await saveCacheStateContract(contractKey, cacheState);
  await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');

  const holderList = Array.from(holdersMap.values());
  holderList.sort((a, b) => b.total - a.total || b.multiplierSum - a.multiplierSum);
  holderList.forEach((holder, index) => {
    holder.rank = index + 1;
    holder.percentage = totalTokens ? (holder.total / totalTokens * 100) : 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  await setCache(`${contractKey}_holders`, { holders: holderList, totalBurned, timestamp: Date.now(), rarityDistribution }, 0, contractKey);
  await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey);

  const summary = {
    totalLive: totalTokens,
    totalBurned,
    totalMinted: totalTokens + totalBurned,
    tierDistribution,
    multiplierPool: holderList.reduce((sum, h) => sum + h.multiplierSum, 0),
  };
  await setCache(`${contractKey}_summary`, { holders: holderList, summary, totalBurned, timestamp: Date.now() }, config.cache.nodeCache.stdTTL, contractKey, 'summary');

  return sanitizeBigInt({ holders: holderList, totalBurned, lastBlock: Number(lastBlock), errorLog, rarityDistribution });
}