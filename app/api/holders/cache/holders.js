// app/api/holders/cache/holders.js
import { parseAbiItem, formatUnits, getAddress } from 'viem';
import pLimit from 'p-limit';
import config from '@/contracts/config.js';
import { logger } from '@/app/lib/logger';
import { getCacheState, saveCacheStateContract } from '@/app/api/holders/cache/state';
import { getNewEvents } from '@/app/api/holders/blockchain/events';
import { getOwnersForContract } from '@/app/api/holders/blockchain/owners';
import { client } from '@/app/api/utils/client';
import { batchMulticall } from '@/app/api/holders/blockchain/multicall';
import { retry } from '@/app/api/utils/retry';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { getCache, setCache, validateContract } from '@/app/api/utils/cache';

const limit = pLimit(5);
const ownershipChunkLimit = pLimit(2); // Reduced for Alchemy Free Tier

// Ensure cache directory exists
async function ensureCacheDirectory() {
  const cacheDir = join(process.cwd(), 'cache');
  const chain = 'eth';
  const collection = 'general';
  try {
    logger.debug('holders', `Ensuring cache directory at: ${cacheDir}`, chain, collection);
    await mkdir(cacheDir, { recursive: true });
    logger.info('holders', `Cache directory created or exists: ${cacheDir}`, chain, collection);
  } catch (error) {
    logger.error('holders', `Failed to create cache directory: ${error.message}`, { stack: error.stack }, chain, collection);
    throw new Error(`Cache directory creation failed: ${error.message}`);
  }
}

// Utility to safely stringify objects for logging
function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj);
  }
}

function sanitizeBigInt(obj) {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(item => sanitizeBigInt(item));
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBigInt(value);
    }
    return sanitized;
  }
  return obj;
}

export async function getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState, forceUpdate = false) {
  if (!contractAddress) throw new Error('Contract address missing');
  if (!abi) throw new Error(`${contractKey} ABI missing`);

  contractKey = contractKey.toLowerCase();
  const chain = config.nftContracts[contractKey]?.chain || 'eth';
  logger.info('holders', `Starting getHoldersMap: contractKey=${contractKey}, forceUpdate=${forceUpdate}, contractAddress=${contractAddress}`, chain, contractKey);

  const requiredFunctions = contractKey === 'ascendant' ? ['getNFTAttribute', 'userRecords', 'totalShares', 'toDistribute', 'batchClaimableAmount'] : ['totalSupply', 'totalBurned', 'ownerOf', 'getNftTier'];
  const missingFunctions = requiredFunctions.filter(fn => !abi.some(item => item.name === fn && item.type === 'function'));
  if (missingFunctions.length > 0) throw new Error(`Missing ABI functions: ${missingFunctions.join(', ')}`);

  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  let holdersMap = new Map();
  let totalBurned = cacheState.totalBurned || 0;
  let errorLog = cacheState.progressState.errorLog || [];
  let totalLockedAscendant = 0;
  let totalShares = 0;
  let toDistributeDay8 = 0;
  let toDistributeDay28 = 0;
  let toDistributeDay90 = 0;
  let totalTokens = 0;
  let tokenOwnerMap = new Map();
  const cachedTokenTiers = new Map();

  const contractTiers = config.nftContracts[contractKey]?.tiers || {};
  const maxTier = Math.max(...Object.keys(contractTiers).map(Number), 0);
  let rarityDistribution = contractKey === 'ascendant' ? Array(3).fill(0) : [];
  let tierDistribution = Array(maxTier + 1).fill(0);

  cacheState.progressState.step = 'checking_cache';
  cacheState.progressState.progressPercentage = '0%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to checking_cache for ${contractKey}`, chain, contractKey);

  let currentBlock;
  try {
    logger.debug('holders', `Fetching current block number for ${contractKey}`, chain, contractKey);
    currentBlock = await retry(
      () => client.getBlockNumber(),
      { retries: 3, delay: 1000, backoff: true }
    );
    logger.debug('holders', `Fetched current block: ${currentBlock}`, chain, contractKey);
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    logger.error('holders', `Failed to fetch block number: ${error.message}`, { stack: error.stack }, chain, contractKey);
    throw error;
  }

  // Initialize lastProcessedBlock if not set
  if (!cacheState.lastProcessedBlock) {
    cacheState.lastProcessedBlock = config.nftContracts[contractKey]?.deploymentBlock || 0;
    cacheState.progressState.lastProcessedBlock = cacheState.lastProcessedBlock;
    await saveCacheStateContract(contractKey, cacheState);
    logger.debug('holders', `Initialized lastProcessedBlock to ${cacheState.lastProcessedBlock} for ${contractKey}`, chain, contractKey);
  }

  // Apply event-based updates for all configured contracts
  if (config.nftContracts[contractKey]) {
    let fromBlock = BigInt(cacheState.lastProcessedBlock);
    logger.debug('holders', `Initial fromBlock: ${fromBlock}, deploymentBlock: ${config.nftContracts[contractKey].deploymentBlock}`, chain, contractKey);
    const maxBlockRange = 200; // Match events.js for Alchemy Free Tier
    let burnedTokenIds = [];
    let transferTokenIds = [];
    let cachedHolders, cachedTiers;
    let updatedTokenIds = new Set();
    let lastBlock = fromBlock;

    // Load cached data if available and not forceUpdate
    if (!forceUpdate) {
      try {
        logger.debug('holders', `Attempting to load cache for ${contractKey}_holders`, chain, contractKey);
        cachedHolders = await getCache(`${contractKey}_holders`, contractKey);
        cachedTiers = await getCache(`${contractKey}_tiers`, contractKey) || {};
        if (cachedHolders?.holders && Array.isArray(cachedHolders.holders) && Number.isInteger(cachedHolders.totalBurned)) {
          holdersMap = new Map(cachedHolders.holders.map(h => [h.wallet, h]));
          totalBurned = cachedHolders.totalBurned || totalBurned;
          totalTokens = cacheState.progressState.totalNfts || 0;
          holdersMap.forEach(holder => {
            holder.tokenIds.forEach(tokenId => tokenOwnerMap.set(Number(tokenId), holder.wallet));
          });
          Object.entries(cachedTiers).forEach(([tokenId, tierData]) => {
            if (tierData && typeof tierData.tier === 'number') {
              cachedTokenTiers.set(Number(tokenId), tierData);
              tierDistribution[tierData.tier] += 1;
            }
          });
          logger.info(
            'holders',
            `Cache hit: holders=${holdersMap.size}, tiers=${cachedTokenTiers.size}, lastBlock=${cacheState.lastProcessedBlock}`,
            chain,
            contractKey
          );
        } else {
          logger.warn('holders', `Invalid holders cache data for ${contractKey}: ${safeStringify(cachedHolders)}`, chain, contractKey);
          cachedHolders = null;
        }
      } catch (error) {
        logger.error('holders', `Failed to load cache for ${contractKey}: ${error.message}`, { stack: error.stack }, chain, contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'load_cache', error: error.message });
        cachedHolders = null;
      }
    }

    // Fetch new events sequentially
    logger.debug('holders', `Checking event-based update for ${contractKey}, lastProcessedBlock=${cacheState.lastProcessedBlock}`, chain, contractKey);
    while (fromBlock < currentBlock) {
      const toBlock = BigInt(Math.min(Number(fromBlock) + maxBlockRange, Number(currentBlock)));
      try {
        logger.debug('holders', `Fetching events from ${fromBlock} to ${toBlock}`, chain, contractKey);
        const events = await getNewEvents(contractKey, contractAddress, Number(fromBlock), errorLog);
        burnedTokenIds.push(...events.burnedTokenIds);
        transferTokenIds.push(...events.transferTokenIds);
        lastBlock = BigInt(events.lastBlock);
        fromBlock = toBlock + 1n;

        // Update lastProcessedBlock
        cacheState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        logger.debug('holders', `Processed events and updated lastProcessedBlock to ${lastBlock} for blocks ${fromBlock} to ${toBlock}`, chain, contractKey);
      } catch (error) {
        logger.error(
          'holders',
          `Failed to fetch events for blocks ${fromBlock} to ${toBlock}: ${error.message}`,
          { stack: error.stack },
          chain,
          contractKey
        );
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_events',
          fromBlock: Number(fromBlock),
          toBlock: Number(toBlock),
          error: error.message,
        });
        fromBlock = toBlock + 1n;
        lastBlock = toBlock;
        cacheState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        logger.debug('holders', `Updated lastProcessedBlock to ${lastBlock} after error`, chain, contractKey);
        continue;
      }
    }

    // Final state update
    cacheState.progressState.lastProcessedBlock = Number(lastBlock);
    cacheState.lastProcessedBlock = Number(lastBlock);
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey, cacheState);
    logger.debug('holders', `Final lastProcessedBlock update to ${lastBlock} for ${contractKey}`, chain, contractKey);

    logger.debug(
      'holders',
      `New events: burns=${burnedTokenIds.length}, transfers=${transferTokenIds.length}, fromBlock=${cacheState.lastProcessedBlock}, toBlock=${lastBlock}`,
      chain,
      contractKey
    );

    if (cachedHolders && !forceUpdate) {
      // Process burns
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

      // Process transfers
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
        let newHolder =
          holdersMap.get(to) ||
          {
            wallet: to,
            tokenIds: [],
            tiers: Array(maxTier + 1).fill(0),
            total: 0,
            multiplierSum: 0,
            claimableRewards: 0,
          };
        newHolder.tokenIds.push(tokenId);
        newHolder.total += 1;
        const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
        newHolder.tiers[tier] += 1;
        newHolder.multiplierSum += contractTiers[tier + 1]?.multiplier || tier + 1;
        holdersMap.set(to, newHolder);
        tokenOwnerMap.set(tokenId, to);
      });

      // Verify token ownership
      cacheState.progressState.step = 'verifying_ownership';
      cacheState.progressState.progressPercentage = '45%';
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug('holders', `Verifying ownership for ${contractKey}`, chain, contractKey);

      const tokenIds = Array.from(tokenOwnerMap.keys());
      const ownershipCalls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi,
        functionName: 'ownerOf',
        args: [BigInt(tokenId)],
      }));

      const ownershipResults = [];
      const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 200;
      const totalChunks = Math.ceil(ownershipCalls.length / chunkSize);
      for (let i = 0; i < ownershipCalls.length; i += chunkSize) {
        const chunk = ownershipCalls.slice(i, i + chunkSize);
        try {
          const results = await retry(
            () => batchMulticall(chunk, config.alchemy.batchSize || 50),
            { retries: 3, delay: 1000, backoff: true }
          );
          ownershipResults.push(...results);
          cacheState.progressState.progressPercentage = `${Math.round(45 + (i / ownershipCalls.length) * 5)}%`;
          await saveCacheStateContract(contractKey, cacheState);
          logger.debug(
            'holders',
            `Processed ownership chunk ${Math.floor(i / chunkSize) + 1}/${totalChunks} for ${chunk.length} tokens`,
            chain,
            contractKey
          );
        } catch (error) {
          logger.error(
            'holders',
            `Failed to process ownership chunk ${i / chunkSize + 1}: ${error.message}`,
            { stack: error.stack },
            chain,
            contractKey
          );
          errorLog.push({
            timestamp: new Date().toISOString(),
            phase: 'verify_ownership',
            chunk: i / chunkSize + 1,
            error: error.message,
          });
          ownershipResults.push(...chunk.map(() => ({ status: 'failure', error: error.message })));
        }
      }

      const validTokenIds = tokenIds.filter((tokenId, i) => {
        const result = ownershipResults[i];
        if (result.status === 'success' && result.result.toLowerCase() !== burnAddress.toLowerCase()) {
          return true;
        }
        logger.warn(
          'holders',
          `Skipping burned or invalid token ${tokenId} for ${contractKey}: owner=${result.result || 'unknown'}`,
          chain,
          contractKey
        );
        tokenOwnerMap.delete(tokenId);
        totalTokens -= 1;
        totalBurned += 1;
        return false;
      });

      logger.info(
        'holders',
        `Verified ownership for ${validTokenIds.length} tokens, excluded ${tokenIds.length - validTokenIds.length} burned/invalid tokens`,
        chain,
        contractKey
      );

      if (totalTokens === 0) {
        logger.info('holders', `No live tokens found for ${contractKey}, writing empty holders`, chain, contractKey);
        cacheState.progressState.step = 'completed';
        cacheState.progressState.progressPercentage = '100%';
        cacheState.globalMetrics = {
          totalMinted: totalTokens + totalBurned,
          totalLive: totalTokens,
          totalBurned,
          tierDistribution,
        };
        await saveCacheStateContract(contractKey, cacheState);
        await setCache(`${contractKey}_holders`, { holders: [], totalBurned, timestamp: Date.now() }, 0, contractKey);
        await setCache(`${contractKey}_tiers`, {}, config.cache.nodeCache.stdTTL || 86400, contractKey);
        logger.info('holders', `Wrote empty holders to cache for ${contractKey}`, chain, contractKey);
        return { holdersMap, totalBurned, lastBlock: Number(lastBlock), errorLog, rarityDistribution };
      }

      // Fetch tiers for updated or missing tokens
      const missingTierTokenIds = validTokenIds.filter(tokenId => !cachedTokenTiers.has(tokenId) || updatedTokenIds.has(tokenId));
      if (missingTierTokenIds.length > 0) {
        cacheState.progressState.step = 'fetching_updated_tiers';
        cacheState.progressState.processedTiers = 0;
        cacheState.progressState.totalTiers = missingTierTokenIds.length;
        cacheState.progressState.progressPercentage = '50%';
        await saveCacheStateContract(contractKey, cacheState);
        logger.debug('holders', `Fetching tiers for ${missingTierTokenIds.length} updated or missing tokens`, chain, contractKey);

        const tierCalls = missingTierTokenIds.map(tokenId => ({
          address: contractAddress,
          abi,
          functionName: 'getNftTier',
          args: [BigInt(tokenId)],
        }));

        const tierResults = [];
        for (let i = 0; i < tierCalls.length; i += chunkSize) {
          const chunk = tierCalls.slice(i, i + chunkSize);
          try {
            const results = await retry(
              () => batchMulticall(chunk, config.alchemy.batchSize || 50),
              { retries: 3, delay: 1000, backoff: true }
            );
            tierResults.push(...results);
            cacheState.progressState.processedTiers = Math.min(i + chunkSize, tierCalls.length);
            cacheState.progressState.progressPercentage = `${Math.round(50 + (i / tierCalls.length) * 20)}%`;
            await saveCacheStateContract(contractKey, cacheState);
            logger.debug(
              'holders',
              `Processed updated tiers for ${cacheState.progressState.processedTiers}/${tierCalls.length} tokens`,
              chain,
              contractKey
            );
          } catch (error) {
            logger.error(
              'holders',
              `Failed to process tier chunk ${i / chunkSize + 1}: ${error.message}`,
              { stack: error.stack },
              chain,
              contractKey
            );
            errorLog.push({
              timestamp: new Date().toISOString(),
              phase: 'fetch_updated_tier',
              chunk: i / chunkSize + 1,
              error: error.message,
            });
            tierResults.push(...chunk.map(() => ({ status: 'failure', error: error.message })));
          }
        }

        tierResults.forEach((result, i) => {
          const tokenId = missingTierTokenIds[i];
          if (result.status === 'success') {
            const tier = Number(result.result) || 0;
            cachedTokenTiers.set(tokenId, { tier, timestamp: Date.now() });
            tierDistribution[tier] += 1;
          } else {
            errorLog.push({
              timestamp: new Date().toISOString(),
              phase: 'fetch_updated_tier',
              tokenId,
              error: result.error || 'unknown error',
            });
          }
        });
        await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey);
        logger.debug('holders', `Saved ${cachedTokenTiers.size} tiers to cache for ${contractKey}`, chain, contractKey);
      }

      cacheState.progressState.totalNfts = totalTokens;
      cacheState.progressState.totalTiers = totalTokens;
      cacheState.progressState.totalLiveHolders = totalTokens;
      cacheState.globalMetrics = {
        totalMinted: totalTokens + totalBurned,
        totalLive: totalTokens,
        totalBurned,
        tierDistribution,
      };
      cacheState.progressState.isPopulating = false;
      cacheState.progressState.step = 'completed';
      cacheState.progressState.processedNfts = totalTokens;
      cacheState.progressState.processedTiers = missingTierTokenIds.length;
      cacheState.progressState.progressPercentage = '100%';
      cacheState.progressState.lastUpdated = Date.now();
      cacheState.progressState.lastBlockSynced = Number(lastBlock);
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug('holders', `Progress state updated to completed for ${contractKey}`, chain, contractKey);

      const holderList = Array.from(holdersMap.values());
      holderList.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
      holderList.forEach((holder, index) => {
        holder.rank = index + 1;
        holder.percentage = (holder.total / totalTokens * 100) || 0;
        holder.displayMultiplierSum = holder.multiplierSum;
      });

      logger.debug('holders', `Writing cache for ${contractKey}_holders, holders=${holderList.length}`, chain, contractKey);
      await setCache(`${contractKey}_holders`, { holders: holderList, totalBurned, timestamp: Date.now() }, 0, contractKey);
      logger.info(
        'holders',
        `Updated cached holders for ${contractKey}, lastBlock=${cacheState.lastProcessedBlock}, updatedTokens=${missingTierTokenIds.length}`,
        chain,
        contractKey
      );
      logger.info(
        'holders',
        `Completed getHoldersMap: holdersMap.size=${holdersMap.size}, totalTokens=${totalTokens}, totalBurned=${totalBurned}`,
        chain,
        contractKey
      );
      return { holdersMap, totalBurned, lastBlock: Number(lastBlock), errorLog, rarityDistribution };
    }
  }

  // Full rebuild for cache miss or forceUpdate
  cacheState.progressState.step = 'fetching_supply';
  cacheState.progressState.isPopulating = true;
  cacheState.progressState.progressPercentage = '10%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to fetching_supply for ${contractKey}`, chain, contractKey);

  const isBurnContract = ['stax', 'element280', 'element369'].includes(contractKey);
  if (contractKey === 'ascendant') {
    try {
      logger.debug('holders', `Fetching ascendant metrics for ${contractKey}`, chain, contractKey);
      const [totalSharesRaw, toDistributeDay8Raw, toDistributeDay28Raw, toDistributeDay90Raw] = await retry(
        () =>
          Promise.all([
            client.readContract({ address: contractAddress, abi, functionName: 'totalShares' }),
            client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] }),
            client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] }),
            client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] }),
          ]),
        { retries: 3, delay: 1000, backoff: true }
      );
      totalShares = parseFloat(formatUnits(totalSharesRaw, 18));
      toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));
      toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));
      toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));
      logger.debug('holders', `Ascendant metrics: totalShares=${totalShares}, toDistributeDay8=${toDistributeDay8}`, chain, contractKey);
    } catch (error) {
      logger.error('holders', `Failed to fetch ascendant metrics: ${error.message}`, { stack: error.stack }, chain, contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_ascendant_metrics', error: error.message });
      throw error;
    }
  } else {
    try {
      logger.debug('holders', `Fetching totalSupply and totalBurned for ${contractKey}`, chain, contractKey);
      const [totalSupply, burnedCount] = await retry(
        () =>
          Promise.all([
            client.readContract({ address: contractAddress, abi, functionName: 'totalSupply' }),
            client.readContract({ address: contractAddress, abi, functionName: 'totalBurned' }).catch(() => 0),
          ]),
        { retries: 3, delay: 1000, backoff: true }
      );
      totalTokens = Number(totalSupply);
      totalBurned = Number(burnedCount);
      logger.info('holders', `Contract state: totalSupply=${totalSupply}, totalBurned=${totalBurned}, totalLive=${totalTokens}`, chain, contractKey);
    } catch (error) {
      logger.error('holders', `Supply fetch error: ${error.message}`, { stack: error.stack }, chain, contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_supply', error: error.message });
      throw error;
    }
  }

  cacheState.progressState.step = 'fetching_holders';
  cacheState.progressState.progressPercentage = '20%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to fetching_holders for ${contractKey}`, chain, contractKey);

  try {
    logger.debug('holders', `Fetching owners for ${contractKey} via getOwnersForContract`, chain, contractKey);
    const owners = await retry(
      () => getOwnersForContract(contractAddress, abi, { withTokenBalances: true, maxPages: 100 }),
      { retries: 3, delay: 1000, backoff: true }
    );
    logger.info('holders', `Fetched ${owners.length} owners, filtering burn address`, chain, contractKey);

    const filteredOwners = owners.filter(
      owner => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() && owner.tokenBalances?.length > 0
    );
    logger.info('holders', `Filtered ${filteredOwners.length} valid owners`, chain, contractKey);

    tokenOwnerMap.clear();
    totalTokens = 0;
    const seenTokenIds = new Set();

    filteredOwners.forEach(owner => {
      if (!owner.ownerAddress) return;
      let wallet;
      try {
        wallet = getAddress(owner.ownerAddress).toLowerCase();
      } catch (e) {
        logger.warn('holders', `Invalid wallet address: ${owner.ownerAddress}`, chain, contractKey);
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'process_owner',
          ownerAddress: owner.ownerAddress,
          error: 'Invalid wallet address',
        });
        return;
      }
      owner.tokenBalances.forEach(tb => {
        if (!tb.tokenId) return;
        const tokenId = Number(tb.tokenId);
        if (seenTokenIds.has(tokenId)) {
          logger.warn('holders', `Duplicate tokenId ${tokenId} for wallet ${wallet}`, chain, contractKey);
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_token', tokenId, wallet, error: 'Duplicate tokenId' });
          return;
        }
        seenTokenIds.add(tokenId);
        tokenOwnerMap.set(tokenId, wallet);
        totalTokens++;
      });
    });
    logger.debug('holders', `Total tokens (Alchemy): ${totalTokens}, unique tokenIds: ${seenTokenIds.size}`, chain, contractKey);
  } catch (error) {
    logger.warn(
      'holders',
      `Failed to fetch owners via getOwnersForContract: ${error.message}, falling back to Transfer events`,
      chain,
      contractKey
    );
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owners_alchemy', error: error.message });

    const fromBlock = BigInt(config.nftContracts[contractKey].deploymentBlock || 0);
    tokenOwnerMap.clear();
    totalTokens = 0;
    const seenTokenIds = new Set();

    let currentFromBlock = fromBlock;
    const maxBlockRange = 200;
    while (currentFromBlock <= currentBlock) {
      const toBlock = BigInt(Math.min(Number(currentFromBlock) + maxBlockRange, Number(currentBlock)));
      try {
        const transferLogs = await retry(
          async () => {
            const logs = await client.getLogs({
              address: contractAddress,
              event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
              fromBlock: currentFromBlock,
              toBlock,
            });
            return logs;
          },
          { retries: 3, delay: 1000, backoff: true }
        );
        for (const log of transferLogs) {
          const from = log.args.from.toLowerCase();
          const to = log.args.to.toLowerCase();
          const tokenId = Number(log.args.tokenId);
          if (to === burnAddress.toLowerCase()) {
            totalBurned += 1;
            tokenOwnerMap.delete(tokenId);
            seenTokenIds.delete(tokenId);
            continue;
          }
          if (from === '0x0000000000000000000000000000000000000000') {
            if (!seenTokenIds.has(tokenId)) {
              tokenOwnerMap.set(tokenId, to);
              seenTokenIds.add(tokenId);
              totalTokens++;
            }
          } else {
            tokenOwnerMap.set(tokenId, to);
            seenTokenIds.add(tokenId);
          }
        }
        currentFromBlock = toBlock + 1n;
        lastBlock = toBlock;
        cacheState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        logger.debug('holders', `Processed transfer logs and updated lastProcessedBlock to ${lastBlock} for blocks ${currentFromBlock} to ${toBlock}`, chain, contractKey);
      } catch (error) {
        logger.error(
          'holders',
          `Failed to fetch transfer logs for blocks ${currentFromBlock} to ${toBlock}: ${error.message}`,
          { stack: error.stack },
          chain,
          contractKey
        );
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_transfer_logs',
          fromBlock: Number(currentFromBlock),
          toBlock: Number(toBlock),
          error: error.message,
        });
        currentFromBlock = toBlock + 1n;
        lastBlock = toBlock;
        cacheState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastProcessedBlock = Number(lastBlock);
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        logger.debug('holders', `Updated lastProcessedBlock to ${lastBlock} after error in transfer logs`, chain, contractKey);
        continue;
      }
    }
  }

  cacheState.progressState.totalNfts = totalTokens;
  cacheState.progressState.totalTiers = totalTokens;
  cacheState.progressState.totalLiveHolders = totalTokens;
  cacheState.progressState.progressPercentage = '30%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to totalNfts=${totalTokens} for ${contractKey}`, chain, contractKey);

  if (totalTokens === 0) {
    logger.info('holders', `No live tokens found for ${contractKey}, writing empty holders`, chain, contractKey);
    cacheState.progressState.step = 'completed';
    cacheState.progressState.progressPercentage = '100%';
    cacheState.globalMetrics = {
      totalMinted: totalTokens + totalBurned,
      totalLive: totalTokens,
      totalBurned,
      tierDistribution,
      ...(contractKey === 'ascendant'
        ? {
            totalLockedAscendant: 0,
            totalShares: 0,
            toDistributeDay8: 0,
            toDistributeDay28: 0,
            toDistributeDay90: 0,
            pendingRewards: 0,
            rarityDistribution: Array(3).fill(0),
          }
        : {}),
    };
    await saveCacheStateContract(contractKey, cacheState);
    await setCache(`${contractKey}_holders`, { holders: [], totalBurned, timestamp: Date.now() }, 0, contractKey);
    await setCache(`${contractKey}_tiers`, {}, config.cache.nodeCache.stdTTL || 86400, contractKey);
    logger.info('holders', `Wrote empty holders to cache for ${contractKey}`, chain, contractKey);
    return { holdersMap, totalBurned, lastBlock: Number(lastBlock), errorLog, rarityDistribution };
  }

  cacheState.progressState.step = 'verifying_ownership';
  cacheState.progressState.progressPercentage = '40%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to verifying_ownership for ${contractKey}`, chain, contractKey);

  const tokenIds = Array.from(tokenOwnerMap.keys());
  const ownershipCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)],
  }));

  const ownershipResults = [];
  const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 200;
  const totalChunks = Math.ceil(ownershipCalls.length / chunkSize);
  for (let i = 0; i < ownershipCalls.length; i += chunkSize) {
    const chunk = ownershipCalls.slice(i, i + chunkSize);
    try {
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize || 50),
        { retries: 3, delay: 1000, backoff: true }
      );
      ownershipResults.push(...results);
      cacheState.progressState.progressPercentage = `${Math.round(40 + (i / ownershipCalls.length) * 10)}%`;
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug(
        'holders',
        `Processed ownership chunk ${Math.floor(i / chunkSize) + 1}/${totalChunks} for ${chunk.length} tokens`,
        chain,
        contractKey
      );
    } catch (error) {
      logger.error(
        'holders',
        `Failed to process ownership chunk ${i / chunkSize + 1}: ${error.message}`,
        { stack: error.stack },
        chain,
        contractKey
      );
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'verify_ownership',
        chunk: i / chunkSize + 1,
        error: error.message,
      });
      ownershipResults.push(...chunk.map(() => ({ status: 'failure', error: error.message })));
    }
  }

  const validTokenIds = tokenIds.filter((tokenId, i) => {
    const result = ownershipResults[i];
    if (result.status === 'success' && result.result.toLowerCase() !== burnAddress.toLowerCase()) {
      return true;
    }
    logger.warn(
      'holders',
      `Skipping burned or invalid token ${tokenId} for ${contractKey}: owner=${result.result || 'unknown'}`,
      chain,
      contractKey
    );
    tokenOwnerMap.delete(tokenId);
    totalTokens -= 1;
    totalBurned += 1;
    return false;
  });

  logger.info(
    'holders',
    `Verified ownership for ${validTokenIds.length} tokens, excluded ${tokenIds.length - validTokenIds.length} burned/invalid tokens`,
    chain,
    contractKey
  );

  if (totalTokens === 0) {
    logger.info('holders', `No live tokens found for ${contractKey}, writing empty holders`, chain, contractKey);
    cacheState.progressState.step = 'completed';
    cacheState.progressState.progressPercentage = '100%';
    cacheState.globalMetrics = {
      totalMinted: totalTokens + totalBurned,
      totalLive: totalTokens,
      totalBurned,
      tierDistribution,
      ...(contractKey === 'ascendant'
        ? {
            totalLockedAscendant: 0,
            totalShares: 0,
            toDistributeDay8: 0,
            toDistributeDay28: 0,
            toDistributeDay90: 0,
            pendingRewards: 0,
            rarityDistribution: Array(3).fill(0),
          }
        : {}),
    };
    await saveCacheStateContract(contractKey, cacheState);
    await setCache(`${contractKey}_holders`, { holders: [], totalBurned, timestamp: Date.now() }, 0, contractKey);
    await setCache(`${contractKey}_tiers`, {}, config.cache.nodeCache.stdTTL || 86400, contractKey);
    logger.info('holders', `Wrote empty holders to cache for ${contractKey}`, chain, contractKey);
    return { holdersMap, totalBurned, lastBlock: Number(lastBlock), errorLog, rarityDistribution };
  }

  cacheState.progressState.step = 'fetching_records';
  cacheState.progressState.progressPercentage = '50%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to fetching_records for ${contractKey}`, chain, contractKey);

  const recordCalls = contractKey === 'ascendant' ? validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  })) : [];
  const recordResults = contractKey === 'ascendant' ? [] : validTokenIds.map(() => ({ status: 'success', result: [] }));
  if (contractKey === 'ascendant') {
    for (let i = 0; i < recordCalls.length; i += chunkSize) {
      const chunk = recordCalls.slice(i, i + chunkSize);
      try {
        const results = await retry(
          () => batchMulticall(chunk, config.alchemy.batchSize || 50),
          { retries: 3, delay: 1000, backoff: true }
        );
        recordResults.push(...results);
        cacheState.progressState.progressPercentage = `${Math.round(50 + (i / recordCalls.length) * 10)}%`;
        await saveCacheStateContract(contractKey, cacheState);
      } catch (error) {
        logger.error(
          'holders',
          `Failed to process record chunk ${i / chunkSize + 1}: ${error.message}`,
          { stack: error.stack },
          chain,
          contractKey
        );
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_records',
          chunk: i / chunkSize + 1,
          error: error.message,
        });
        recordResults.push(...chunk.map(() => ({ status: 'failure', error: error.message })));
      }
    }
  }

  cacheState.progressState.step = 'fetching_tiers';
  cacheState.progressState.processedTiers = 0;
  cacheState.progressState.totalTiers = validTokenIds.length;
  cacheState.progressState.progressPercentage = '60%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to fetching_tiers for ${contractKey}`, chain, contractKey);

  if (['element280', 'stax', 'element369'].includes(contractKey)) {
    const cachedTiers = await getCache(`${contractKey}_tiers`, contractKey) || {};
    Object.entries(cachedTiers).forEach(([tokenId, tierData]) => {
      if (tierData && typeof tierData.tier === 'number') {
        cachedTokenTiers.set(Number(tokenId), tierData);
      }
    });
    logger.debug(
      'holders',
      `Cached tiers loaded: ${cachedTokenTiers.size}, missing tiers for ${validTokenIds.length - cachedTokenTiers.size} tokens`,
      chain,
      contractKey
    );
  }

  const missingTierTokenIds = ['element280', 'stax', 'element369'].includes(contractKey) ? validTokenIds.filter(tokenId => !cachedTokenTiers.has(tokenId)) : validTokenIds;
  const tierCalls = missingTierTokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
    args: [BigInt(tokenId)],
  }));

  const tierResults = [];
  for (let i = 0; i < tierCalls.length; i += chunkSize) {
    const chunk = tierCalls.slice(i, i + chunkSize);
    try {
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize || 50),
        { retries: 3, delay: 1000, backoff: true }
      );
      tierResults.push(...results);
      cacheState.progressState.processedTiers = Math.min(i + chunkSize, missingTierTokenIds.length);
      cacheState.progressState.progressPercentage = `${Math.round(60 + (i / tierCalls.length) * 20)}%`;
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug(
        'holders',
        `Processed tiers for ${cacheState.progressState.processedTiers}/${missingTierTokenIds.length} tokens`,
        chain,
        contractKey
      );
    } catch (error) {
      logger.error(
        'holders',
        `Failed to process tier chunk ${i / chunkSize + 1}: ${error.message}`,
        { stack: error.stack },
        chain,
        contractKey
      );
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_tier',
        chunk: i / chunkSize + 1,
        error: error.message,
      });
      tierResults.push(...chunk.map(() => ({ status: 'failure', error: error.message })));
    }
  }

  if (['element280', 'stax', 'element369'].includes(contractKey)) {
    tierResults.forEach((result, i) => {
      const tokenId = missingTierTokenIds[i];
      if (result.status === 'success') {
        const tier = Number(result.result) || 0;
        cachedTokenTiers.set(tokenId, { tier, timestamp: Date.now() });
      } else {
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId,
          error: result.error || 'unknown error',
        });
      }
    });
    await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey);
    logger.debug('holders', `Saved ${cachedTokenTiers.size} tiers to cache for ${contractKey}`, chain, contractKey);
  }

  const allTierResults = ['element280', 'stax', 'element369'].includes(contractKey) ? validTokenIds.map(tokenId => {
    if (cachedTokenTiers.has(tokenId)) {
      const tierData = cachedTokenTiers.get(tokenId);
      return { status: 'success', result: tierData.tier };
    }
    const index = missingTierTokenIds.indexOf(tokenId);
    return index >= 0 ? tierResults[index] : { status: 'failure', error: 'Missing tier data' };
  }) : tierResults;

  cacheState.progressState.step = 'fetching_rewards';
  cacheState.progressState.progressPercentage = '80%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to fetching_rewards for ${contractKey}`, chain, contractKey);

  const rewardCalls = contractKey === 'ascendant' ? [
    {
      address: contractAddress,
      abi,
      functionName: 'batchClaimableAmount',
      args: [validTokenIds.map(id => BigInt(id))],
    },
    {
      address: contractAddress,
      abi,
      functionName: 'toDistribute',
      args: [0],
    },
    {
      address: contractAddress,
      abi,
      functionName: 'toDistribute',
      args: [1],
    },
    {
      address: contractAddress,
      abi,
      functionName: 'toDistribute',
      args: [2],
    },
    {
      address: contractAddress,
      abi,
      functionName: 'totalShares',
      args: [],
    },
  ] : [];

  const rewardResults = contractKey === 'ascendant' ? await retry(
    () => batchMulticall(rewardCalls, config.alchemy.batchSize || 50),
    { retries: 3, delay: 1000, backoff: true }
  ) : [];

  if (contractKey === 'ascendant') {
    if (rewardResults[0].status === 'success') {
      const claimable = parseFloat(formatUnits(rewardResults[0].result || 0, 18));
      holdersMap.forEach(holder => {
        holder.claimableRewards = claimable / totalTokens * holder.total;
      });
    }
    toDistributeDay8 = rewardResults[1].status === 'success' ? parseFloat(formatUnits(rewardResults[1].result || 0, 18)) : toDistributeDay8;
    toDistributeDay28 = rewardResults[2].status === 'success' ? parseFloat(formatUnits(rewardResults[2].result || 0, 18)) : toDistributeDay28;
    toDistributeDay90 = rewardResults[3].status === 'success' ? parseFloat(formatUnits(rewardResults[3].result || 0, 18)) : toDistributeDay90;
    totalShares = rewardResults[4].status === 'success' ? parseFloat(formatUnits(rewardResults[4].result || 0, 18)) : totalShares;
  }

  cacheState.progressState.step = 'building_holders';
  cacheState.progressState.progressPercentage = '90%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to building_holders for ${contractKey}`, chain, contractKey);

  validTokenIds.forEach((tokenId, i) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) {
      logger.warn('holders', `No owner found for token ${tokenId}`, chain, contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_token', tokenId, error: 'No owner found' });
      return;
    }

    let shares = 0;
    let lockedAscendant = 0;
    if (contractKey === 'ascendant') {
      const recordResult = recordResults[i];
      if (recordResult.status === 'success' && Array.isArray(recordResult.result)) {
        shares = parseFloat(formatUnits(recordResult.result[0] || 0, 18));
        lockedAscendant = parseFloat(formatUnits(recordResult.result[1] || 0, 18));
        totalLockedAscendant += lockedAscendant;
      } else {
        logger.error(
          'holders',
          `Failed to fetch userRecords for token ${tokenId}: ${recordResult.error || 'unknown error'}`,
          chain,
          contractKey
        );
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_records',
          tokenId,
          wallet,
          error: recordResult.error || 'unknown error',
        });
        return;
      }
    }

    let tier = 0;
    let rarityNumber = 0;
    let rarity = 0;
    const tierResult = allTierResults[i];
    logger.debug('holders', `Raw tierResult for token ${tokenId}: status=${tierResult.status}, result=${safeStringify(tierResult.result)}`, chain, contractKey);

    if (tierResult.status === 'success') {
      if (contractKey === 'ascendant') {
        const result = tierResult.result;
        let parsedResult;
        if (Array.isArray(result) && result.length >= 3) {
          parsedResult = {
            rarityNumber: Number(result[0]) || 0,
            tier: Number(result[1]) || 0,
            rarity: Number(result[2]) || 0,
          };
        } else if (typeof result === 'object' && result !== null && 'rarityNumber' in result) {
          parsedResult = {
            rarityNumber: Number(result.rarityNumber) || 0,
            tier: Number(result.tier) || 0,
            rarity: Number(result.rarity) || 0,
          };
        } else {
          logger.warn(
            'holders',
            `Invalid getNFTAttribute result for token ${tokenId}: result=${safeStringify(result)}`,
            chain,
            contractKey
          );
          errorLog.push({
            timestamp: new Date().toISOString(),
            phase: 'fetch_tier',
            tokenId,
            wallet,
            error: `Invalid getNFTAttribute result: ${safeStringify(result)}`,
          });
          return;
        }
        rarityNumber = parsedResult.rarityNumber;
        tier = parsedResult.tier;
        rarity = parsedResult.rarity;
        logger.debug(
          'holders',
          `Parsed attributes for token ${tokenId} (ascendant): tier=${tier}, rarityNumber=${rarityNumber}, rarity=${rarity}`,
          chain,
          contractKey
        );
      } else {
        tier = typeof tierResult.result === 'bigint' ? Number(tierResult.result) : Number(tierResult.result) || 0;
      }

      if (isNaN(tier) || tier < 0 || tier > maxTier) {
        logger.warn(
          'holders',
          `Invalid tier for token ${tokenId} in ${contractKey}: tier=${tier}, maxTier=${maxTier}, defaulting to 0`,
          chain,
          contractKey
        );
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId,
          wallet,
          error: `Invalid tier ${tier}`,
          details: { rawResult: safeStringify(tierResult.result), maxTier, parsedTier: tier },
        });
        tier = 0;
      }
    } else {
      logger.error(
        'holders',
        `Failed to fetch tier for token ${tokenId}: ${tierResult.error || 'unknown error'}`,
        chain,
        contractKey
      );
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_tier',
        tokenId,
        wallet,
        error: tierResult.error || 'unknown error',
        details: { rawResult: safeStringify(tierResult.result) },
      });
      return;
    }

    if (contractKey === 'ascendant' && rarity >= 0 && rarity < rarityDistribution.length) {
      rarityDistribution[rarity] += 1;
    } else if (contractKey === 'ascendant') {
      logger.warn(
        'holders',
        `Invalid rarity for token ${tokenId}: rarity=${rarity}, maxRarity=${rarityDistribution.length - 1}`,
        chain,
        contractKey
      );
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_rarity',
        tokenId,
        wallet,
        error: `Invalid rarity ${rarity}`,
      });
    }

    const holder =
      holdersMap.get(wallet) ||
      {
        wallet,
        tokenIds: [],
        tiers: Array(maxTier + 1).fill(0),
        total: 0,
        multiplierSum: 0,
        ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
        ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
        ...(contractKey === 'ascendant'
          ? {
              shares: 0,
              lockedAscendant: 0,
              pendingDay8: toDistributeDay8 / totalTokens * 8 / 100,
              pendingDay28: toDistributeDay28 / totalTokens * 28 / 100,
              pendingDay90: toDistributeDay90 / totalTokens * 90 / 100,
              claimableRewards: 0,
              tokens: [],
            }
          : {}),
      };

    if (holder.tokenIds.includes(tokenId)) {
      logger.warn('holders', `Duplicate tokenId ${tokenId} for wallet ${wallet} in holdersMap`, chain, contractKey);
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'build_holders',
        tokenId,
        wallet,
        error: 'Duplicate tokenId in holdersMap',
      });
      return;
    }

    holder.tokenIds.push(tokenId);
    holder.total += 1;
    holder.tiers[tier] += 1;
    holder.multiplierSum += contractTiers[tier + 1]?.multiplier || tier + 1;
    if (contractKey === 'ascendant') {
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      holder.tokens.push({
        tokenId: Number(tokenId),
        tier: tier + 1,
        rawTier: tier,
        rarityNumber,
        rarity,
      });
    }
    holdersMap.set(wallet, holder);
    tierDistribution[tier] += 1;
  });

  cacheState.progressState.step = 'finalizing';
  cacheState.progressState.progressPercentage = '90%';
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to finalizing for ${contractKey}`, chain, contractKey);

  const totalLiveHolders = holdersMap.size;
  cacheState.progressState.totalOwners = totalLiveHolders;
  let holderList = Array.from(holdersMap.values());
  holderList.forEach((holder, index) => {
    holder.rank = index + 1;
    holder.percentage = (holder.total / totalTokens * 100) || 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  holderList.sort((a, b) => {
    if (contractKey === 'ascendant') {
      return b.shares - a.shares || b.total - a.total;
    }
    return b.total - a.total || b.multiplierSum - a.multiplierSum;
  });
  holderList.forEach((holder, index) => {
    holder.rank = index + 1;
  });

  cacheState.globalMetrics = {
    totalMinted: totalTokens + totalBurned,
    totalLive: totalTokens,
    totalBurned,
    tierDistribution,
    ...(contractKey === 'ascendant'
      ? {
          totalLockedAscendant,
          totalShares,
          toDistributeDay8,
          toDistributeDay28,
          toDistributeDay90,
          pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
          rarityDistribution,
        }
      : {}),
  };
  cacheState.progressState.isPopulating = false;
  cacheState.progressState.step = 'completed';
  cacheState.progressState.processedNfts = totalTokens;
  cacheState.progressState.processedTiers = validTokenIds.length;
  cacheState.progressState.progressPercentage = '100%';
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);
  logger.debug('holders', `Progress state updated to completed for ${contractKey}, totalOwners=${totalLiveHolders}`, chain, contractKey);

  logger.debug('holders', `Writing cache for ${contractKey}_holders, holders=${holderList.length}`, chain, contractKey);
  await setCache(
    `${contractKey}_holders`,
    { holders: holderList, totalBurned, timestamp: Date.now(), rarityDistribution },
    0,
    contractKey
  );
  if (['element280', 'stax', 'element369'].includes(contractKey)) {
    await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey);
  }
  logger.info(
    'holders',
    `Completed holders map with ${holderList.length} holders, totalBurned=${totalBurned}, cachedTiers=${cachedTokenTiers.size}`,
    chain,
    contractKey
  );
  logger.debug('holders', `Tier distribution for ${contractKey}: ${tierDistribution}`, chain, contractKey);
  if (contractKey === 'ascendant') {
    logger.debug('holders', `Rarity distribution for ${contractKey}: ${rarityDistribution}`, chain, contractKey);
  }

  logger.info(
    'holders',
    `Completed getHoldersMap: holdersMap.size=${holdersMap.size}, totalTokens=${totalTokens}, totalBurned=${totalBurned}`,
    chain,
    contractKey
  );
  return { holdersMap, totalBurned, lastBlock: Number(lastBlock), errorLog, rarityDistribution };
}

export async function populateHoldersMapCache(contractKey, contractAddress, abi, vaultAddress, vaultAbi, forceUpdate = false) {
  let cacheState;
  const chain = config.nftContracts[contractKey.toLowerCase()]?.chain || 'eth';
  try {
    logger.debug('holders', `Starting populateHoldersMapCache for ${contractKey}, forceUpdate=${forceUpdate}, cwd=${process.cwd()}`, chain, contractKey);
    await ensureCacheDirectory();
    cacheState = await getCacheState(contractKey.toLowerCase());
    logger.debug('holders', `Cache state loaded for ${contractKey}: ${safeStringify(cacheState)}`, chain, contractKey);

    // Check for stale isPopulating flag
    const isStale = cacheState.isPopulating && (
      !cacheState.progressState.lastUpdated ||
      (Date.now() - cacheState.progressState.lastUpdated > 10 * 60 * 1000) || // 10 minutes
      (cacheState.progressState.step === 'starting' && cacheState.progressState.progressPercentage === '0%')
    );
    if (isStale) {
      logger.warn('holders', `Detected stale isPopulating flag for ${contractKey}, resetting`, chain, contractKey);
      cacheState.isPopulating = false;
      cacheState.progressState.step = 'initializing';
      cacheState.progressState.error = 'Reset due to stale state';
      await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    }

    if (!forceUpdate && cacheState.isPopulating) {
      logger.info('holders', `Cache population already in progress for ${contractKey}`, chain, contractKey);
      return { status: 'pending', holders: [] };
    }

    cacheState.isPopulating = true;
    cacheState.progressState.step = 'initializing';
    cacheState.progressState.progressPercentage = '0%';
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    logger.debug('holders', `Progress state updated to initializing for ${contractKey}`, chain, contractKey);

    // Validate contract
    logger.debug('holders', `Calling validateContract for ${contractKey}`, chain, contractKey);
    const isValid = await validateContract(contractKey);
    if (!isValid) {
      throw new Error(`Invalid contract configuration for ${contractKey}`);
    }

    logger.debug('holders', `Calling getHoldersMap for ${contractKey}`, chain, contractKey);
    const { holdersMap, totalBurned, lastBlock, errorLog } = await getHoldersMap(
      contractKey,
      contractAddress,
      abi,
      vaultAddress,
      vaultAbi,
      cacheState,
      forceUpdate
    );
    logger.debug('holders', `getHoldersMap completed for ${contractKey}, holders=${holdersMap.size}, totalBurned=${totalBurned}`, chain, contractKey);

    const holderList = [];
    for (const [wallet, data] of holdersMap) {
      holderList.push({
        wallet,
        total: data.total,
        tokenIds: data.tokenIds,
        tiers: data.tiers,
        multiplierSum: data.multiplierSum,
        shares: data.shares || 0,
        lockedAscendant: data.lockedAscendant || 0,
        claimableRewards: data.claimableRewards || 0,
        pendingDay8: data.pendingDay8 || 0,
        pendingDay28: data.pendingDay28 || 0,
        pendingDay90: data.pendingDay90 || 0,
        infernoRewards: data.infernoRewards || 0,
        fluxRewards: data.fluxRewards || 0,
        e280Rewards: data.e280Rewards || 0,
      });
    }

    cacheState.isPopulating = false;
    cacheState.progressState.step = 'completed';
    cacheState.progressState.progressPercentage = '100%';
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    logger.info('holders', `Cache population completed for ${contractKey}, holders=${holderList.length}`, chain, contractKey);

    return { status: 'completed', holders: holderList, totalBurned, lastBlock, errorLog };
  } catch (error) {
    logger.error('holders', `Failed to populate holders map for ${contractKey}: ${error.message}`, { stack: error.stack }, chain, contractKey);
    cacheState = cacheState || (await getCacheState(contractKey.toLowerCase()));
    cacheState.isPopulating = false;
    cacheState.progressState.step = 'failed';
    cacheState.progressState.error = error.message;
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    throw error;
  }
}

export { sanitizeBigInt };