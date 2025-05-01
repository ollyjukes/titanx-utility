import { NextResponse } from 'next/server';
import { parseAbiItem, formatUnits, getAddress } from 'viem';
import pLimit from 'p-limit';
import config from '@/config.js';
import { client, retry, logger, getCache, setCache, saveCacheState, loadCacheState, batchMulticall, getOwnersForContract } from '@/app/api/utils';
import { HoldersResponseSchema } from '@/lib/schemas';

const limit = pLimit(5);

// Utility to sanitize BigInt values
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

// Get cache state for a contract
async function getCacheState(contractKey) {
  const cacheState = {
    isPopulating: false,
    totalOwners: 0,
    totalLiveHolders: 0,
    progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
    lastUpdated: null,
    lastProcessedBlock: null,
    globalMetrics: {},
  };
  try {
    const savedState = await loadCacheState(contractKey, contractKey.toLowerCase());
    if (savedState && typeof savedState === 'object') {
      Object.assign(cacheState, {
        isPopulating: savedState.isPopulating ?? false,
        totalOwners: savedState.totalOwners ?? 0,
        totalLiveHolders: savedState.totalLiveHolders ?? 0,
        progressState: {
          step: savedState.progressState?.step ?? 'idle',
          processedNfts: savedState.progressState?.processedNfts ?? 0,
          totalNfts: savedState.progressState?.totalNfts ?? 0,
          processedTiers: savedState.progressState?.processedTiers ?? 0,
          totalTiers: savedState.progressState?.totalTiers ?? 0,
          error: savedState.progressState?.error ?? null,
          errorLog: savedState.progressState?.errorLog ?? [],
        },
        lastUpdated: savedState.lastUpdated ?? null,
        lastProcessedBlock: savedState.lastProcessedBlock ?? null,
        globalMetrics: savedState.globalMetrics ?? {},
      });
      logger.debug(contractKey, `Loaded cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`);
    }
  } catch (error) {
    logger.error(contractKey, `Failed to load cache state: ${error.message}`, { stack: error.stack });
  }
  return cacheState;
}

// Save cache state for a contract
async function saveCacheStateContract(contractKey, cacheState) {
  try {
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());
    logger.debug(contractKey, `Saved cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`);
  } catch (error) {
    logger.error(contractKey, `Failed to save cache state: ${error.message}`, { stack: error.stack });
  }
}

// Fetch new Transfer events (burns and transfers)
async function getNewEvents(contractKey, contractAddress, fromBlock, errorLog) {
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const cacheKey = `${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}`;
  let cachedEvents = await getCache(cacheKey, contractKey.toLowerCase());

  if (cachedEvents) {
    logger.info(contractKey, `Events cache hit: ${cacheKey}, count: ${cachedEvents.burnedTokenIds.length + (cachedEvents.transferTokenIds?.length || 0)}`);
    return cachedEvents;
  }

  let burnedTokenIds = [];
  let transferTokenIds = [];
  let endBlock;
  try {
    endBlock = await client.getBlockNumber();
  } catch (error) {
    logger.error(contractKey, `Failed to fetch block number: ${error.message}`, { stack: error.stack });
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    throw error;
  }

  if (fromBlock >= endBlock) {
    logger.info(contractKey, `No new blocks: fromBlock ${fromBlock} >= endBlock ${endBlock}`);
    return { burnedTokenIds, transferTokenIds, lastBlock: Number(endBlock) };
  }

  try {
    const logs = await client.getLogs({
      address: contractAddress,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
      fromBlock: BigInt(fromBlock),
      toBlock: endBlock,
    });
    burnedTokenIds = logs
      .filter(log => log.args.to.toLowerCase() === burnAddress.toLowerCase())
      .map(log => Number(log.args.tokenId));
    transferTokenIds = logs
      .filter(log => log.args.to.toLowerCase() !== burnAddress.toLowerCase())
      .map(log => ({ tokenId: Number(log.args.tokenId), from: log.args.from.toLowerCase(), to: log.args.to.toLowerCase() }));
    const cacheData = { burnedTokenIds, transferTokenIds, lastBlock: Number(endBlock), timestamp: Date.now() };
    await setCache(cacheKey, cacheData, config.cache.nodeCache.stdTTL, contractKey.toLowerCase());
    logger.info(contractKey, `Cached events: ${cacheKey}, burns: ${burnedTokenIds.length}, transfers: ${transferTokenIds.length}`);
    return cacheData;
  } catch (error) {
    logger.error(contractKey, `Failed to fetch events: ${error.message}`, { stack: error.stack });
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_events', error: error.message });
    throw error;
  }
}

// Build holders map from contract data
async function getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState) {
  if (!contractAddress) throw new Error('Contract address missing');
  if (!abi) throw new Error(`${contractKey} ABI missing`);

  const requiredFunctions = contractKey === 'ascendant' ? ['getNFTAttribute', 'userRecords', 'totalShares', 'toDistribute', 'batchClaimableAmount'] : ['totalSupply', 'totalBurned', 'ownerOf', 'getNftTier'];
  const missingFunctions = requiredFunctions.filter(fn => !abi.some(item => item.name === fn));
  if (missingFunctions.length > 0) throw new Error(`Missing ABI functions: ${missingFunctions.join(', ')}`);

  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const holdersMap = new Map();
  let totalBurned = 0;
  const errorLog = [];

  cacheState.progressState.step = 'fetching_supply';
  await saveCacheStateContract(contractKey, cacheState);

  let currentBlock;
  try {
    currentBlock = await client.getBlockNumber();
    logger.debug(contractKey, `Fetched current block: ${currentBlock}`);
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    logger.error(contractKey, `Failed to fetch block number: ${error.message}`, { stack: error.stack });
    throw error;
  }

  if (contractKey === 'ascendant') {
    // Fetch totalShares
    const totalSharesRaw = await retry(
      async () => {
        const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalShares' });
        if (result === null || result === undefined) throw new Error('totalShares returned null');
        return result;
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));
    logger.debug(contractKey, `Total shares: ${totalShares}`);

    // Fetch toDistribute for day8, day28, day90
    const toDistributeDay8Raw = await retry(
      async () => {
        const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] });
        if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
        return result;
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));

    const toDistributeDay28Raw = await retry(
      async () => {
        const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] });
        if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
        return result;
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));

    const toDistributeDay90Raw = await retry(
      async () => {
        const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] });
        if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
        return result;
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));

    cacheState.progressState.step = 'fetching_holders';
    await saveCacheStateContract(contractKey, cacheState);

    // Fetch owners and tokenIds using Alchemy
    let owners = [];
    let pageKey = null;
    do {
      const response = await retry(
        () => alchemy.nft.getOwnersForContract(contractAddress, {
          block: 'latest',
          withTokenBalances: true,
          pageKey,
        }),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      owners = owners.concat(response.owners);
      pageKey = response.pageKey;
      logger.debug(contractKey, `Fetched ${response.owners.length} owners, pageKey: ${pageKey}`);
    } while (pageKey);

    // Filter out burn address and invalid owners
    const filteredOwners = owners.filter(
      (owner) => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() && owner.tokenBalances?.length > 0
    );
    logger.debug(contractKey, `Filtered owners: ${filteredOwners.length}`);

    // Build tokenOwnerMap
    const tokenOwnerMap = new Map();
    let totalTokens = 0;
    filteredOwners.forEach((owner) => {
      if (!owner.ownerAddress) return;
      let wallet;
      try {
        wallet = getAddress(owner.ownerAddress).toLowerCase();
      } catch (e) {
        logger.warn(contractKey, `Invalid wallet address: ${owner.ownerAddress}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_owner', ownerAddress: owner.ownerAddress, error: 'Invalid wallet address' });
        return;
      }
      owner.tokenBalances.forEach((tb) => {
        if (!tb.tokenId) return;
        const tokenId = Number(tb.tokenId);
        tokenOwnerMap.set(tokenId, wallet);
        totalTokens++;
      });
    });
    logger.debug(contractKey, `Total tokens: ${totalTokens}`);

    cacheState.progressState.totalNfts = totalTokens;
    cacheState.progressState.totalTiers = totalTokens;
    cacheState.lastProcessedBlock = Number(currentBlock);
    await saveCacheStateContract(contractKey, cacheState);

    if (totalTokens === 0) {
      cacheState.progressState.step = 'completed';
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug(contractKey, `No tokens found, returning empty holdersMap`);
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    cacheState.progressState.step = 'fetching_records';
    cacheState.progressState.processedNfts = 0;
    await saveCacheStateContract(contractKey, cacheState);

    // Fetch userRecords and getNFTAttribute for all tokenIds
    const tokenIds = Array.from(tokenOwnerMap.keys());
    const recordCalls = tokenIds.map((tokenId) => ({
      address: contractAddress,
      abi,
      functionName: 'userRecords',
      args: [BigInt(tokenId)],
    }));
    const tierCalls = tokenIds.map((tokenId) => ({
      address: contractAddress,
      abi,
      functionName: 'getNFTAttribute',
      args: [BigInt(tokenId)],
    }));

    const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 1000;
    const concurrencyLimit = pLimit(4);
    logger.debug(contractKey, `Fetching userRecords and tiers for ${tokenIds.length} tokens in chunks of ${chunkSize}`);

    // Batch userRecords calls
    const recordResults = [];
    for (let i = 0; i < recordCalls.length; i += chunkSize) {
      const chunk = recordCalls.slice(i, i + chunkSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      recordResults.push(...results);
      cacheState.progressState.processedNfts = Math.min(i + chunkSize, tokenIds.length);
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug(contractKey, `Processed userRecords for ${cacheState.progressState.processedNfts}/${tokenIds.length} tokens`);
    }

    // Batch getNFTAttribute calls
    cacheState.progressState.step = 'fetching_tiers';
    cacheState.progressState.processedTiers = 0;
    await saveCacheStateContract(contractKey, cacheState);

    const tierResults = [];
    for (let i = 0; i < tierCalls.length; i += chunkSize) {
      const chunk = tierCalls.slice(i, i + chunkSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      tierResults.push(...results);
      cacheState.progressState.processedTiers = Math.min(i + chunkSize, tokenIds.length);
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug(contractKey, `Processed tiers for ${cacheState.progressState.processedTiers}/${tokenIds.length} tokens`);
    }

    // Group tokenIds by wallet for batchClaimableAmount
    const walletTokenIds = new Map();
    tokenIds.forEach((tokenId) => {
      const wallet = tokenOwnerMap.get(tokenId);
      if (!wallet) return;
      if (!walletTokenIds.has(wallet)) {
        walletTokenIds.set(wallet, []);
      }
      walletTokenIds.get(wallet).push(tokenId);
    });

    // Fetch batchClaimableAmount
    cacheState.progressState.step = 'fetching_claimable';
    await saveCacheStateContract(contractKey, cacheState);

    const claimableCalls = Array.from(walletTokenIds.entries()).map(([wallet, tokenIds]) => ({
      address: contractAddress,
      abi,
      functionName: 'batchClaimableAmount',
      args: [tokenIds.map((id) => BigInt(id))],
    }));

    const claimableResults = [];
    for (let i = 0; i < claimableCalls.length; i += chunkSize) {
      const chunk = claimableCalls.slice(i, i + chunkSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      claimableResults.push(...results);
      logger.debug(contractKey, `Processed claimable amounts for ${i + chunk.length}/${claimableCalls.length} wallets`);
    }

    // Process results and build holdersMap
    cacheState.progressState.step = 'building_holders';
    await saveCacheStateContract(contractKey, cacheState);

    let totalLockedAscendant = 0;
    const maxTier = Object.keys(config.contractTiers[contractKey]).length;

    tokenIds.forEach((tokenId, i) => {
      const wallet = tokenOwnerMap.get(tokenId);
      if (!wallet) {
        logger.warn(contractKey, `No owner found for token ${tokenId}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_token', tokenId, error: 'No owner found' });
        return;
      }

      let shares = 0;
      let lockedAscendant = 0;
      const recordResult = recordResults[i];
      if (recordResult.status === 'success' && Array.isArray(recordResult.result)) {
        shares = parseFloat(formatUnits(recordResult.result[0] || 0, 18));
        lockedAscendant = parseFloat(formatUnits(recordResult.result[1] || 0, 18));
        logger.debug(contractKey, `userRecords for token ${tokenId}: shares=${shares}, lockedAscendant=${lockedAscendant}`);
      } else {
        logger.error(contractKey, `Failed to fetch userRecords for token ${tokenId}: ${recordResult.error || 'unknown error'}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId, wallet, error: recordResult.error || 'unknown error' });
        return;
      }

      let tier = 0;
      const tierResult = tierResults[i];
      if (tierResult.status === 'success') {
        tier = Number(tierResult.result.tier || 0); // getNFTAttribute returns { rarityNumber, tier, rarity }
        logger.debug(contractKey, `getNFTAttribute for token ${tokenId}: tier=${tier}`);
      } else {
        logger.error(contractKey, `Failed to fetch getNFTAttribute for token ${tokenId}: ${tierResult.error || 'unknown error'}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, wallet, error: tierResult.error || 'unknown error' });
        return;
      }

      // Update holdersMap
      const holder = holdersMap.get(wallet) || {
        wallet,
        tokenIds: [],
        tiers: Array(maxTier).fill(0),
        total: 0,
        multiplierSum: 0,
        shares: 0,
        lockedAscendant: 0,
        pendingDay8: 0,
        pendingDay28: 0,
        pendingDay90: 0,
        claimableRewards: 0,
      };

      if (!holder.tokenIds.includes(tokenId)) {
        holder.tokenIds.push(tokenId);
        holder.total += 1;
        if (tier >= 1 && tier <= maxTier) {
          holder.tiers[tier - 1] += 1;
          holder.multiplierSum += config.contractTiers[contractKey][tier]?.multiplier || 0;
          logger.debug(contractKey, `Assigned tier ${tier} to token ${tokenId}, wallet ${wallet}`);
        } else {
          logger.warn(contractKey, `Invalid tier ${tier} for token ${tokenId}, wallet ${wallet}`);
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, wallet, error: `Invalid tier ${tier}` });
        }
        holder.shares += shares;
        holder.lockedAscendant += lockedAscendant;
        totalLockedAscendant += lockedAscendant;
        holdersMap.set(wallet, holder);
      }
    });

    // Assign claimableRewards
    let claimableIndex = 0;
    for (const [wallet, tokenIds] of walletTokenIds.entries()) {
      const holder = holdersMap.get(wallet);
      if (!holder) {
        claimableIndex++;
        continue;
      }
      const claimableResult = claimableResults[claimableIndex];
      if (claimableResult?.status === 'success') {
        holder.claimableRewards = parseFloat(formatUnits(claimableResult.result || 0, 18));
        logger.debug(contractKey, `Claimable rewards for wallet ${wallet}: ${holder.claimableRewards}`);
      } else {
        logger.error(contractKey, `Failed to fetch claimableRewards for wallet ${wallet}: ${claimableResult?.error || 'unknown error'}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet, error: claimableResult?.error || 'unknown error' });
      }
      claimableIndex++;
    }

    // Calculate pending rewards and final metrics
    cacheState.progressState.step = 'calculating_metrics';
    await saveCacheStateContract(contractKey, cacheState);

    const holderList = Array.from(holdersMap.values());
    const totalMultiplierSum = holderList.reduce((sum, h) => sum + h.multiplierSum, 0);
    const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
    const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
    const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

    holderList.forEach((holder) => {
      holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
      holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
      holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.displayMultiplierSum = holder.multiplierSum;
      logger.debug(contractKey, `Calculated metrics for wallet ${holder.wallet}: percentage=${holder.percentage}, shares=${holder.shares}`);
    });

    holderList.sort((a, b) => b.shares - a.shares || b.multiplierSum - a.multiplierSum || b.total - a.total);
    holderList.forEach((holder, index) => (holder.rank = index + 1));
    logger.debug(contractKey, `Sorted holders: count=${holderList.length}, topHolder=${JSON.stringify(holderList[0])}`);

    cacheState.totalOwners = holderList.length;
    cacheState.totalLiveHolders = holderList.length;
    cacheState.progressState.step = 'completed';
    cacheState.progressState.processedNfts = cacheState.progressState.totalNfts;
    cacheState.progressState.processedTiers = cacheState.progressState.totalTiers;
    cacheState.progressState.error = null;
    cacheState.progressState.errorLog = errorLog;
    cacheState.globalMetrics = {
      totalTokens,
      totalLockedAscendant,
      totalShares,
      toDistributeDay8,
      toDistributeDay28,
      toDistributeDay90,
      pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
    };
    await saveCacheStateContract(contractKey, cacheState);
    logger.info(contractKey, `Completed holders map with ${holderList.length} holders, totalBurned=${totalBurned}, totalShares=${totalShares}`);

    return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
  } else {
    const totalSupply = await retry(
      async () => {
        const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalSupply' });
        if (result === null || result === undefined) throw new Error('totalSupply returned null');
        return Number(result);
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    logger.debug(contractKey, `Total supply: ${totalSupply}`);

    let burnedCountContract = 0;
    try {
      burnedCountContract = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalBurned' });
          if (result === null || result === undefined) throw new Error('totalBurned returned null');
          return Number(result);
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      logger.debug(contractKey, `Burned count from contract: ${burnedCountContract}`);
    } catch (error) {
      logger.error(contractKey, `Failed to fetch totalBurned: ${error.message}`, { stack: error.stack });
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned', error: error.message });
    }
    totalBurned = burnedCountContract;

    cacheState.progressState.totalNfts = totalSupply || 0;
    cacheState.progressState.totalTiers = totalSupply || 0;
    cacheState.lastProcessedBlock = Number(currentBlock);
    await saveCacheStateContract(contractKey, cacheState);

    if (totalSupply === 0) {
      cacheState.progressState.step = 'completed';
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug(contractKey, `No NFTs (totalSupply=0), returning empty holdersMap`);
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock) };
    }

    cacheState.progressState.step = 'fetching_owners';
    await saveCacheStateContract(contractKey, cacheState);

    logger.debug(contractKey, `Fetching owners for ${totalSupply} tokens using Alchemy NFT API`);
    const owners = await retry(
      () => getOwnersForContract(contractAddress, abi, { withTokenBalances: true }),
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    logger.debug(contractKey, `Fetched owners: count=${owners.length}, sample=${JSON.stringify(owners.slice(0, 2))}`);

    let processedTokens = 0;
    for (const owner of owners) {
      const wallet = owner.ownerAddress.toLowerCase();
      logger.debug(contractKey, `Processing owner: wallet=${wallet}, tokenBalancesCount=${owner.tokenBalances.length}`);

      const tokenIds = owner.tokenBalances
        .map(tb => {
          const tokenId = Number(tb.tokenId);
          if (isNaN(tokenId) || tokenId < 0) {
            logger.warn(contractKey, `Invalid tokenId ${tb.tokenId} for wallet ${wallet}`);
            return null;
          }
          return tokenId;
        })
        .filter(id => id !== null);

      if (tokenIds.length === 0) {
        logger.warn(contractKey, `No valid token IDs for wallet ${wallet}`);
        continue;
      }

      if (wallet === burnAddress.toLowerCase()) {
        totalBurned += owner.tokenBalances.reduce((sum, tb) => sum + Number(tb.balance), 0);
        logger.debug(contractKey, `Incremented totalBurned by ${owner.tokenBalances.reduce((sum, tb) => sum + Number(tb.balance), 0)} for burn address`);
        continue;
      }

      processedTokens += tokenIds.length;

      const holder = holdersMap.get(wallet) || {
        wallet,
        tokenIds: [],
        tiers: Array(Object.keys(config.contractTiers[contractKey]).length).fill(0),
        total: 0,
        multiplierSum: 0,
        ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
        ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
      };
      holder.tokenIds.push(...tokenIds);
      holder.total += tokenIds.length;
      holdersMap.set(wallet, holder);
      logger.debug(contractKey, `Added to holdersMap: wallet=${wallet}, totalTokens=${holder.total}`);

      cacheState.progressState.processedNfts = processedTokens;
      if (processedTokens % 1000 === 0) await saveCacheStateContract(contractKey, cacheState);
    }

    logger.debug(contractKey, `Holders map size: ${holdersMap.size}, totalBurned: ${totalBurned}, processedTokens: ${processedTokens}`);
    await saveCacheStateContract(contractKey, cacheState);
    await setCache(`${contractKey.toLowerCase()}_holders_partial`, { holders: Array.from(holdersMap.values()), totalBurned, timestamp: Date.now() }, 0, contractKey.toLowerCase());
    logger.info(contractKey, `Fetched ${processedTokens} owners, ${holdersMap.size} unique holders`);

    cacheState.progressState.step = 'fetching_tiers';
    cacheState.progressState.processedTiers = 0;
    await saveCacheStateContract(contractKey, cacheState);

    const tokenIdToOwner = new Map();
    for (const holder of holdersMap.values()) {
      for (const tokenId of holder.tokenIds) {
        tokenIdToOwner.set(tokenId, holder.wallet);
      }
    }

    const validTokenIds = Array.from(tokenIdToOwner.keys());
    logger.debug(contractKey, `Valid token IDs for tier fetching: count=${validTokenIds.length}, sample=${JSON.stringify(validTokenIds.slice(0, 5))}`);
    const tierCalls = validTokenIds.map(tokenId => ({
      address: contractAddress,
      abi,
      functionName: 'getNftTier',
      args: [BigInt(tokenId)],
    }));

    if (tierCalls.length > 0) {
      const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 1000;
      const concurrencyLimit = pLimit(4);
      logger.debug(contractKey, `Fetching tiers for ${tierCalls.length} tokens in chunks of ${chunkSize}`);
      const tierPromises = [];
      for (let i = 0; i < tierCalls.length; i += chunkSize) {
        const chunk = tierCalls.slice(i, i + chunkSize);
        tierPromises.push(
          concurrencyLimit(async () => {
            logger.debug(contractKey, `Processing tier batch ${i / chunkSize + 1} with ${chunk.length} calls`);
            try {
              const tierResults = await retry(() => batchMulticall(chunk, config.alchemy.batchSize), {
                retries: config.alchemy.maxRetries,
                delay: config.alchemy.batchDelayMs,
              });

              tierResults.forEach((result, index) => {
                const tokenId = validTokenIds[i + index];
                const owner = tokenIdToOwner.get(tokenId);
                if (!owner) {
                  logger.debug(contractKey, `Skipped tier for tokenId ${tokenId}: no owner found`);
                  return;
                }

                const holder = holdersMap.get(owner);
                if (result.status === 'success') {
                  const tier = Number(result.result);
                  const maxTier = Object.keys(config.contractTiers[contractKey]).length;
                  if (tier >= 1 && tier <= maxTier) {
                    holder.tiers[tier - 1]++;
                    holder.multiplierSum += config.contractTiers[contractKey][tier]?.multiplier || 0;
                    logger.debug(contractKey, `Tier ${tier} for token ${tokenId} assigned to wallet ${owner}`);
                  } else {
                    logger.warn(contractKey, `Invalid tier ${tier} for token ${tokenId}, wallet ${owner}`);
                    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, error: `Invalid tier ${tier}` });
                  }
                } else {
                  logger.warn(contractKey, `Failed to fetch tier for token ${tokenId}: ${result.error || 'unknown error'}`);
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, error: result.error || 'unknown error' });
                }
              });

              cacheState.progressState.processedTiers += chunk.length;
              await saveCacheStateContract(contractKey, cacheState);
              logger.debug(contractKey, `Processed ${cacheState.progressState.processedTiers}/${cacheState.progressState.totalTiers} tiers`);
            } catch (error) {
              logger.error(contractKey, `Tier batch ${i / chunkSize + 1} failed: ${error.message}`, { stack: error.stack });
              errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier_batch', batch: i / chunkSize + 1, error: error.message });
            }
          })
        );
      }
      await Promise.all(tierPromises);
    } else {
      logger.warn(contractKey, `No valid token IDs found for tier fetching`);
    }

    cacheState.progressState.step = 'calculating_metrics';
    await saveCacheStateContract(contractKey, cacheState);

    const holderList = Array.from(holdersMap.values());
    const totalMultiplierSum = holderList.reduce((sum, h) => sum + h.multiplierSum, 0);
    holderList.forEach(holder => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.displayMultiplierSum = holder.multiplierSum / (contractKey === 'element280' ? 10 : 1);
      logger.debug(contractKey, `Calculated metrics for wallet ${holder.wallet}: percentage=${holder.percentage}, displayMultiplierSum=${holder.displayMultiplierSum}`);
    });

    holderList.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    holderList.forEach((holder, index) => (holder.rank = index + 1));
    logger.debug(contractKey, `Sorted holders: count=${holderList.length}, topHolder=${JSON.stringify(holderList[0])}`);

    cacheState.totalOwners = holderList.length;
    cacheState.totalLiveHolders = holderList.length;
    cacheState.progressState.step = 'completed';
    cacheState.progressState.processedNfts = cacheState.progressState.totalNfts;
    cacheState.progressState.processedTiers = cacheState.progressState.totalTiers;
    cacheState.progressState.error = null;
    cacheState.progressState.errorLog = errorLog;
    await saveCacheStateContract(contractKey, cacheState);
    logger.info(contractKey, `Completed holders map with ${holderList.length} holders, totalBurned=${totalBurned}`);
    return { holdersMap, totalBurned, lastBlock: Number(currentBlock) };
  }
}

// Populate holders map cache
async function populateHoldersMapCache(contractKey, contractAddress, abi, vaultAddress, vaultAbi, forceUpdate = false) {
  let cacheState = await getCacheState(contractKey);
  if (cacheState.isPopulating && !forceUpdate) {
    logger.info(contractKey, 'Cache population already in progress');
    return { status: 'in_progress', holders: null };
  }

  cacheState.isPopulating = true;
  cacheState.progressState.step = 'starting';
  cacheState.progressState.error = null;
  cacheState.progressState.errorLog = [];
  await saveCacheStateContract(contractKey, cacheState);

  const errorLog = [];

  try {
    const cachedData = await getCache(`${contractKey.toLowerCase()}_holders`, contractKey.toLowerCase());
    const isCacheValid = cachedData && Array.isArray(cachedData.holders) && Number.isInteger(cachedData.totalBurned) && !forceUpdate;

    if (isCacheValid) {
      const fromBlock = cacheState.lastProcessedBlock || config.deploymentBlocks[contractKey].block;
      const { burnedTokenIds, transferTokenIds, lastBlock } = await getNewEvents(contractKey, contractAddress, fromBlock, errorLog);

      let currentBlock;
      try {
        currentBlock = await client.getBlockNumber();
      } catch (error) {
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
        throw error;
      }

      if (burnedTokenIds.length > 0 || transferTokenIds.length > 0) {
        const holdersMap = new Map();
        let totalBurned = cachedData.totalBurned || 0;
        logger.debug(contractKey, `Initial totalBurned from cache: ${totalBurned}`);

        for (const holder of cachedData.holders) {
          const updatedTokenIds = holder.tokenIds.filter(id => !burnedTokenIds.includes(id));
          if (updatedTokenIds.length > 0) {
            const updatedHolder = {
              ...holder,
              tokenIds: updatedTokenIds,
              total: updatedTokenIds.length,
              tiers: Array(Object.keys(config.contractTiers[contractKey]).length).fill(0),
              multiplierSum: 0,
              ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
              ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
              ...(contractKey === 'ascendant' ? {
                shares: 0,
                lockedAscendant: 0,
                pendingDay8: 0,
                pendingDay28: 0,
                pendingDay90: 0,
                claimableRewards: 0,
              } : {}),
            };
            const tierCalls = updatedTokenIds.map(tokenId => ({
              address: contractAddress,
              abi,
              functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
              args: [BigInt(tokenId)],
            }));
            const tierResults = await retry(() => batchMulticall(tierCalls, config.alchemy.batchSize), {
              retries: config.alchemy.maxRetries,
              delay: config.alchemy.batchDelayMs,
            });
            tierResults.forEach((result, index) => {
              if (result.status === 'success' && result.result) {
                const tier = contractKey === 'ascendant'
                  ? (Array.isArray(result.result) ? Number(result.result[1] || 0) : Number(result.result.tier || 0))
                  : Number(result.result);
                const maxTier = Object.keys(config.contractTiers[contractKey]).length;
                if (tier >= 1 && tier <= maxTier) {
                  updatedHolder.tiers[tier - 1]++;
                  updatedHolder.multiplierSum += config.contractTiers[contractKey][tier]?.multiplier || 0;
                  logger.debug(contractKey, `Tier ${tier} for token ${updatedTokenIds[index]} assigned to wallet ${holder.wallet}`);
                } else {
                  logger.warn(contractKey, `Invalid tier ${tier} for token ${updatedTokenIds[index]}, wallet ${holder.wallet}`);
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId: updatedTokenIds[index], error: `Invalid tier ${tier}` });
                }
              } else {
                logger.warn(contractKey, `Failed to fetch tier for token ${updatedTokenIds[index]}: ${result.error || 'unknown error'}`);
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId: updatedTokenIds[index], error: result.error || 'unknown error' });
              }
            });

            if (contractKey === 'ascendant') {
              const recordCalls = updatedTokenIds.map(tokenId => ({
                address: contractAddress,
                abi,
                functionName: 'userRecords',
                args: [BigInt(tokenId)],
              }));
              const recordResults = await retry(() => batchMulticall(recordCalls, config.alchemy.batchSize), {
                retries: config.alchemy.maxRetries,
                delay: config.alchemy.batchDelayMs,
              });
              recordResults.forEach((result, index) => {
                if (result.status === 'success' && Array.isArray(result.result)) {
                  updatedHolder.shares += parseFloat(formatUnits(result.result[0] || 0, 18));
                  updatedHolder.lockedAscendant += parseFloat(formatUnits(result.result[1] || 0, 18));
                  logger.debug(contractKey, `userRecords for token ${updatedTokenIds[index]}: shares=${updatedHolder.shares}, lockedAscendant=${updatedHolder.lockedAscendant}`);
                } else {
                  logger.error(contractKey, `Failed to fetch userRecords for token ${updatedTokenIds[index]}: ${result.error || 'unknown error'}`);
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId: updatedTokenIds[index], error: result.error || 'unknown error' });
                }
              });

              const claimableCall = [{
                address: contractAddress,
                abi,
                functionName: 'batchClaimableAmount',
                args: [updatedTokenIds.map(id => BigInt(id))],
              }];
              const claimableResults = await retry(() => batchMulticall(claimableCall, config.alchemy.batchSize), {
                retries: config.alchemy.maxRetries,
                delay: config.alchemy.batchDelayMs,
              });
              if (claimableResults[0]?.status === 'success') {
                updatedHolder.claimableRewards = parseFloat(formatUnits(claimableResults[0].result || 0, 18));
                logger.debug(contractKey, `Claimable rewards for wallet ${holder.wallet}: ${updatedHolder.claimableRewards}`);
              } else {
                logger.error(contractKey, `Failed to fetch claimableRewards for wallet ${holder.wallet}: ${claimableResults[0]?.error || 'unknown error'}`);
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet: holder.wallet, error: claimableResults[0]?.error || 'unknown error' });
              }

              const totalSharesRaw = await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalShares' });
                  if (result === null || result === undefined) throw new Error('totalShares returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

              const toDistributeDay8Raw = await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] });
                  if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));

              const toDistributeDay28Raw = await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] });
                  if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));

              const toDistributeDay90Raw = await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] });
                  if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));

              const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
              const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
              const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

              updatedHolder.pendingDay8 = updatedHolder.shares * pendingRewardPerShareDay8;
              updatedHolder.pendingDay28 = updatedHolder.shares * pendingRewardPerShareDay28;
              updatedHolder.pendingDay90 = updatedHolder.shares * pendingRewardPerShareDay90;
            }

            holdersMap.set(holder.wallet, updatedHolder);
          } else {
            totalBurned += holder.total;
            logger.debug(contractKey, `Incremented totalBurned by ${holder.total} for wallet ${holder.wallet}`);
          }
        }

        for (const transfer of transferTokenIds) {
          const fromHolder = holdersMap.get(transfer.from);
          if (fromHolder) {
            fromHolder.tokenIds = fromHolder.tokenIds.filter(id => id !== transfer.tokenId);
            fromHolder.total = fromHolder.tokenIds.length;
            if (fromHolder.total === 0) {
              holdersMap.delete(transfer.from);
              logger.debug(contractKey, `Removed empty holder: ${transfer.from}`);
            } else {
              fromHolder.tiers = Array(Object.keys(config.contractTiers[contractKey]).length).fill(0);
              fromHolder.multiplierSum = 0;
              const tierResult = await retry(
                () => client.readContract({
                  address: contractAddress,
                  abi,
                  functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
                  args: [BigInt(transfer.tokenId)],
                }),
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              const tier = contractKey === 'ascendant'
                ? (Array.isArray(tierResult) ? Number(tierResult[1] || 0) : Number(tierResult.tier || 0))
                : Number(tierResult);
              if (tier >= 1 && tier <= Object.keys(config.contractTiers[contractKey]).length) {
                fromHolder.tiers[tier - 1]++;
                fromHolder.multiplierSum += config.contractTiers[contractKey][tier]?.multiplier || 0;
                logger.debug(contractKey, `Tier ${tier} for token ${transfer.tokenId} updated for wallet ${transfer.from}`);
              }
              if (contractKey === 'ascendant') {
                fromHolder.shares = 0;
                fromHolder.lockedAscendant = 0;
                fromHolder.pendingDay8 = 0;
                fromHolder.pendingDay28 = 0;
                fromHolder.pendingDay90 = 0;
                fromHolder.claimableRewards = 0;

                const recordResult = await retry(
                  () => client.readContract({
                    address: contractAddress,
                    abi,
                    functionName: 'userRecords',
                    args: [BigInt(transfer.tokenId)],
                  }),
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                if (Array.isArray(recordResult)) {
                  fromHolder.shares += parseFloat(formatUnits(recordResult[0] || 0, 18));
                  fromHolder.lockedAscendant += parseFloat(formatUnits(recordResult[1] || 0, 18));
                  logger.debug(contractKey, `userRecords for token ${transfer.tokenId}: shares=${fromHolder.shares}, lockedAscendant=${fromHolder.lockedAscendant}`);
                }

                const claimableCall = [{
                  address: contractAddress,
                  abi,
                  functionName: 'batchClaimableAmount',
                  args: [fromHolder.tokenIds.map(id => BigInt(id))],
                }];
                const claimableResults = await retry(() => batchMulticall(claimableCall, config.alchemy.batchSize), {
                  retries: config.alchemy.maxRetries,
                  delay: config.alchemy.batchDelayMs,
                });
                if (claimableResults[0]?.status === 'success') {
                  fromHolder.claimableRewards = parseFloat(formatUnits(claimableResults[0].result || 0, 18));
                  logger.debug(contractKey, `Claimable rewards for wallet ${transfer.from}: ${fromHolder.claimableRewards}`);
                }

                const totalSharesRaw = await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalShares' });
                    if (result === null || result === undefined) throw new Error('totalShares returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

                const toDistributeDay8Raw = await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] });
                    if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));

                const toDistributeDay28Raw = await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] });
                    if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));

                const toDistributeDay90Raw = await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] });
                    if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));

                const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
                const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
                const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

                fromHolder.pendingDay8 = fromHolder.shares * pendingRewardPerShareDay8;
                fromHolder.pendingDay28 = fromHolder.shares * pendingRewardPerShareDay28;
                fromHolder.pendingDay90 = fromHolder.shares * pendingRewardPerShareDay90;
              }
              holdersMap.set(transfer.from, fromHolder);
            }
          }

          const toHolder = holdersMap.get(transfer.to) || {
            wallet: transfer.to,
            tokenIds: [],
            tiers: Array(Object.keys(config.contractTiers[contractKey]).length).fill(0),
            total: 0,
            multiplierSum: 0,
            ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
            ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
            ...(contractKey === 'ascendant' ? {
              shares: 0,
              lockedAscendant: 0,
              pendingDay8: 0,
              pendingDay28: 0,
              pendingDay90: 0,
              claimableRewards: 0,
            } : {}),
          };
          toHolder.tokenIds.push(transfer.tokenId);
          toHolder.total = toHolder.tokenIds.length;
          const tierResult = await retry(
            () => client.readContract({
              address: contractAddress,
              abi,
              functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
              args: [BigInt(transfer.tokenId)],
            }),
            { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
          );
          const tier = contractKey === 'ascendant'
            ? (Array.isArray(tierResult) ? Number(tierResult[1] || 0) : Number(tierResult.tier || 0))
            : Number(tierResult);
          if (tier >= 1 && tier <= Object.keys(config.contractTiers[contractKey]).length) {
            toHolder.tiers[tier - 1]++;
            toHolder.multiplierSum += config.contractTiers[contractKey][tier]?.multiplier || 0;
            logger.debug(contractKey, `Tier ${tier} for token ${transfer.tokenId} assigned to wallet ${transfer.to}`);
          }
          if (contractKey === 'ascendant') {
            const recordResult = await retry(
              () => client.readContract({
                address: contractAddress,
                abi,
                functionName: 'userRecords',
                args: [BigInt(transfer.tokenId)],
              }),
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            if (Array.isArray(recordResult)) {
              toHolder.shares += parseFloat(formatUnits(recordResult[0] || 0, 18));
              toHolder.lockedAscendant += parseFloat(formatUnits(recordResult[1] || 0, 18));
              logger.debug(contractKey, `userRecords for token ${transfer.tokenId}: shares=${toHolder.shares}, lockedAscendant=${toHolder.lockedAscendant}`);
            }

            const claimableCall = [{
              address: contractAddress,
              abi,
              functionName: 'batchClaimableAmount',
              args: [toHolder.tokenIds.map(id => BigInt(id))],
            }];
            const claimableResults = await retry(() => batchMulticall(claimableCall, config.alchemy.batchSize), {
              retries: config.alchemy.maxRetries,
              delay: config.alchemy.batchDelayMs,
            });
            if (claimableResults[0]?.status === 'success') {
              toHolder.claimableRewards = parseFloat(formatUnits(claimableResults[0].result || 0, 18));
              logger.debug(contractKey, `Claimable rewards for wallet ${transfer.to}: ${toHolder.claimableRewards}`);
            }

            const totalSharesRaw = await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalShares' });
                if (result === null || result === undefined) throw new Error('totalShares returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

            const toDistributeDay8Raw = await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] });
                if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));

            const toDistributeDay28Raw = await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] });
                if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));

            const toDistributeDay90Raw = await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] });
                if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));

            const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
            const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
            const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

            toHolder.pendingDay8 = toHolder.shares * pendingRewardPerShareDay8;
            toHolder.pendingDay28 = toHolder.shares * pendingRewardPerShareDay28;
            toHolder.pendingDay90 = toHolder.shares * pendingRewardPerShareDay90;
          }
          holdersMap.set(transfer.to, toHolder);
        }

        const holderList = Array.from(holdersMap.values());
        const totalMultiplierSum = holderList.reduce((sum, h) => sum + h.multiplierSum, 0);
        holderList.forEach(holder => {
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
          holder.displayMultiplierSum = holder.multiplierSum / (contractKey === 'element280' ? 10 : 1);
          logger.debug(contractKey, `Calculated metrics for wallet ${holder.wallet}: percentage=${holder.percentage}, displayMultiplierSum=${holder.displayMultiplierSum}`);
        });

        holderList.sort((a, b) => contractKey === 'ascendant' ? b.shares - a.shares || b.multiplierSum - a.multiplierSum || b.total - a.total : b.multiplierSum - a.multiplierSum || b.total - a.total);
        holderList.forEach((holder, index) => (holder.rank = index + 1));

        let burnedCountContract;
        try {
          burnedCountContract = await retry(
            async () => {
              const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalBurned' });
              return Number(result);
            },
            { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
          );
          logger.debug(contractKey, `Fetched burnedCountContract: ${burnedCountContract}`);
        } catch (error) {
          logger.error(contractKey, `Failed to fetch totalBurned: ${error.message}`, { stack: error.stack });
          burnedCountContract = 0;
        }
        totalBurned = burnedCountContract || totalBurned;
        logger.debug(contractKey, `Final totalBurned: ${totalBurned}`);

        const cacheData = { holders: holderList, totalBurned, timestamp: Date.now() };
        await setCache(`${contractKey.toLowerCase()}_holders`, cacheData, 0, contractKey.toLowerCase());
        cacheState.lastUpdated = Date.now();
        cacheState.totalOwners = holderList.length;
        cacheState.totalLiveHolders = holderList.length;
        cacheState.lastProcessedBlock = lastBlock;
        cacheState.progressState = {
          step: 'completed',
          processedNfts: cacheState.progressState.totalNfts,
          totalNfts: cacheState.progressState.totalNfts,
          processedTiers: cacheState.progressState.totalTiers,
          totalTiers: cacheState.progressState.totalTiers,
          error: null,
          errorLog,
        };
        if (contractKey === 'ascendant') {
          cacheState.globalMetrics = {
            totalTokens: holderList.reduce((sum, h) => sum + h.total, 0),
            totalLockedAscendant: holderList.reduce((sum, h) => sum + h.lockedAscendant, 0),
            totalShares,
            toDistributeDay8,
            toDistributeDay28,
            toDistributeDay90,
            pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
          };
        }
        await saveCacheStateContract(contractKey, cacheState);
        logger.info(contractKey, `Cache updated: ${holderList.length} holders, totalBurned: ${totalBurned}`);
        return { status: 'updated', holders: holderList };
      } else {
        cacheState.isPopulating = false;
        cacheState.progressState.step = 'completed';
        cacheState.lastProcessedBlock = Number(currentBlock);
        await saveCacheStateContract(contractKey, cacheState);
        logger.info(contractKey, 'Cache is up to date');
        return { status: 'up_to_date', holders: cachedData.holders };
      }
    }

    const result = await getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState);
    const holderList = Array.from(result.holdersMap.values());
    const totalBurned = result.totalBurned || 0;
    logger.debug(contractKey, `getHoldersMap returned totalBurned: ${totalBurned}`);
    const cacheData = { holders: holderList, totalBurned, timestamp: Date.now() };
    await setCache(`${contractKey.toLowerCase()}_holders`, cacheData, 0, contractKey.toLowerCase());
    cacheState.lastUpdated = Date.now();
    cacheState.totalOwners = holderList.length;
    cacheState.totalLiveHolders = holderList.length;
    cacheState.lastProcessedBlock = result.lastBlock;
    cacheState.progressState = {
      step: 'completed',
      processedNfts: cacheState.progressState.totalNfts,
      totalNfts: cacheState.progressState.totalNfts,
      processedTiers: cacheState.progressState.totalTiers,
      totalTiers: cacheState.progressState.totalTiers,
      error: null,
      errorLog,
    };
    if (contractKey === 'ascendant') {
      cacheState.globalMetrics = result.globalMetrics || {};
    }
    await saveCacheStateContract(contractKey, cacheState);
    logger.info(contractKey, `Cache populated: ${holderList.length} holders, totalBurned: ${totalBurned}`);
    return { status: 'completed', holders: holderList };
  } catch (error) {
    cacheState.progressState.step = 'error';
    cacheState.progressState.error = error.message;
    cacheState.progressState.errorLog = errorLog;
    await saveCacheStateContract(contractKey, cacheState);
    logger.error(contractKey, `Cache population failed: ${error.message}`, { stack: error.stack });
    return { status: 'error', holders: null, error: error.message };
  } finally {
    cacheState.isPopulating = false;
    await saveCacheStateContract(contractKey, cacheState);
  }
}

// GET handler
export async function GET(request, { params }) {
  const { contract } = await params;
  const contractKey = contract.toLowerCase();
  if (!config.contractDetails[contractKey]) {
    return NextResponse.json({ error: `Invalid contract: ${contractKey}` }, { status: 400 });
  }

  if (config.contractDetails[contractKey].disabled) {
    return NextResponse.json({ error: `${contractKey} contract not deployed` }, { status: 400 });
  }

  const contractAddress = config.contractAddresses[contractKey]?.address;
  const abi = config.abis[contractKey]?.main;

  try {
    const cacheState = await getCacheState(contractKey);
    if (cacheState.isPopulating) {
      return NextResponse.json({
        message: 'Cache is populating',
        isCachePopulating: true,
        totalOwners: cacheState.totalOwners,
        totalLiveHolders: cacheState.totalLiveHolders,
        progressState: cacheState.progressState,
        lastProcessedBlock: cacheState.lastProcessedBlock,
        globalMetrics: cacheState.globalMetrics,
        debugId: `state-${Math.random().toString(36).slice(2)}`,
      }, { status: 202 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails[contractKey].pageSize, 10);

    const cachedData = await getCache(`${contractKey.toLowerCase()}_holders`, contractKey.toLowerCase());
    if (cachedData) {
      const holders = cachedData.holders.slice(page * pageSize, (page + 1) * pageSize);
      const totalPages = Math.ceil(cachedData.holders.length / pageSize);
      const response = {
        holders: sanitizeBigInt(holders),
        totalPages,
        totalTokens: cachedData.holders.reduce((sum, h) => sum + h.total, 0),
        totalBurned: cachedData.totalBurned,
        summary: {
          totalLive: cachedData.holders.reduce((sum, h) => sum + h.total, 0),
          totalBurned: cachedData.totalBurned,
          totalMinted: config.nftContracts[contractKey].expectedTotalSupply + config.nftContracts[contractKey].expectedBurned,
          tierDistribution: cachedData.holders.reduce((acc, h) => {
            h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
            return acc;
          }, []),
          multiplierPool: cachedData.holders.reduce((sum, h) => sum + h.multiplierSum, 0),
        },
        globalMetrics: cacheState.globalMetrics,
      };
      return NextResponse.json(response);
    }

    const { status, holders } = await populateHoldersMapCache(contractKey, contractAddress, abi, null, null);
    if (status === 'error') throw new Error('Cache population failed');

    const paginatedHolders = holders.slice(page * pageSize, (page + 1) * pageSize);
    const totalPages = Math.ceil(holders.length / pageSize);
    const response = {
      holders: sanitizeBigInt(paginatedHolders),
      totalPages,
      totalTokens: holders.reduce((sum, h) => sum + h.total, 0),
      totalBurned: (await getCache(`${contractKey.toLowerCase()}_holders`, contractKey.toLowerCase()))?.totalBurned || 0,
      summary: {
        totalLive: holders.reduce((sum, h) => sum + h.total, 0),
        totalBurned: (await getCache(`${contractKey.toLowerCase()}_holders`, contractKey.toLowerCase()))?.totalBurned || 0,
        totalMinted: config.nftContracts[contractKey].expectedTotalSupply + config.nftContracts[contractKey].expectedBurned,
        tierDistribution: holders.reduce((acc, h) => {
          h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
          return acc;
        }, []),
        multiplierPool: holders.reduce((sum, h) => sum + h.multiplierSum, 0),
      },
      globalMetrics: cacheState.globalMetrics,
    };
    return NextResponse.json(response);
  } catch (error) {
    logger.error(contractKey, `GET error: ${error.message}`, { stack: error.stack });
    return NextResponse.json({ error: `Failed to fetch ${contractKey} holders`, details: error.message }, { status: 500 });
  }
}

// POST handler
export async function POST(request, { params }) {
  const { contract } = await params;
  const contractKey = contract.toLowerCase();
  if (!config.contractDetails[contractKey]) {
    return NextResponse.json({ error: `Invalid contract: ${contractKey}` }, { status: 400 });
  }

  if (config.contractDetails[contractKey].disabled) {
    return NextResponse.json({ error: `${contractKey} contract not deployed` }, { status: 400 });
  }

  const contractAddress = config.contractAddresses[contractKey]?.address;
  const abi = config.abis[contractKey]?.main;

  try {
    const { forceUpdate } = await request.json().catch(() => ({}));
    const cacheState = await getCacheState(contractKey);
    if (cacheState.isPopulating && !forceUpdate) {
      return NextResponse.json({ message: 'Cache population already in progress', status: 'in_progress' }, { status: 202 });
    }
    const { status, error } = await populateHoldersMapCache(contractKey, contractAddress, abi, null, null, forceUpdate === true);
    if (status === 'error') throw new Error(error || 'Cache population failed');
    return NextResponse.json({ 
      message: status === 'up_to_date' ? 'Cache is up to date' : `${contractKey} cache population triggered`, 
      status 
    });
  } catch (error) {
    logger.error(contractKey, `POST error: ${error.message}`, { stack: error.stack });
    return NextResponse.json({ error: `Failed to populate ${contractKey} cache`, details: error.message }, { status: 500 });
  }
}