import { formatUnits, parseUnits } from 'viem';
import { getCache, setCache } from '@/lib/cache.js';
import { logger } from '@/lib/logger.js';
import config from '@/contracts/config.js';
import { retry } from '@/lib/utils.js';
import { batchMulticall } from '@/lib/multicall.js';
import { saveCacheStateContract, getCacheState } from '@/lib/cacheState.js';
import { getLatestBlock } from '@/lib/provider.js';
import { getAlchemyProvider } from '@/lib/alchemy.js';

function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

async function getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState, forceUpdate = false) {
  const provider = getAlchemyProvider(config.alchemy.apiKey, config.alchemy.network);
  const errorLog = [];
  const contractTiers = config.nftContracts[contractKey]?.tiers || {};
  const maxTier = Math.max(...Object.keys(contractTiers).map(Number), 0); // 8 for ascendant
  let rarityDistribution = contractKey === 'ascendant' ? Array(3).fill(0) : [];
  let tierDistribution = Array(maxTier + 1).fill(0); // 9 elements (0 to 8) for ascendant
  let totalLockedAscendant = 0;
  let totalShares = 0;
  let toDistributeDay8 = 0;
  let toDistributeDay28 = 0;
  let toDistributeDay90 = 0;

  cacheState.progressState = {
    isPopulating: true,
    totalLiveHolders: 0,
    totalOwners: 0,
    phase: 'initializing',
    progressPercentage: '0%',
    lastProcessedBlock: null,
    lastUpdated: Date.now(),
    error: null,
    errorLog
  };
  await saveCacheStateContract(contractKey, cacheState);

  let totalBurned = 0;
  const burnAddress = config.burnAddress;
  const currentBlock = await getLatestBlock(provider);
  const deploymentBlock = config.nftContracts[contractKey]?.deploymentBlock || '0';

  if (!forceUpdate && cacheState.lastBlock && Math.abs(Number(currentBlock) - cacheState.lastBlock) < config.cache.blockThreshold) {
    const cachedData = await getCache(`${contractKey}_holders`, contractKey);
    if (cachedData && cachedData.holders) {
      cacheState.progressState.isPopulating = false;
      cacheState.progressState.phase = 'cached';
      await saveCacheStateContract(contractKey, cacheState);
      logger.info('utils', `Using cached holders for ${contractKey}, lastBlock=${cacheState.lastBlock}`, 'eth', contractKey);
      return {
        holdersMap: new Map(cachedData.holders.map(h => [h.wallet, h])),
        totalBurned: cachedData.totalBurned || 0,
        lastBlock: cacheState.lastBlock,
        errorLog: [],
        rarityDistribution: cachedData.rarityDistribution || rarityDistribution
      };
    }
  }

  cacheState.progressState.phase = 'fetching_ownership';
  cacheState.progressState.progressPercentage = '10%';
  await saveCacheStateContract(contractKey, cacheState);

  const tokenOwnerMap = new Map();
  const holdersMap = new Map();
  let totalTokens = 0;
  const isBurnContract = ['stax', 'element280', 'element369'].includes(contractKey);

  const totalSupplyCall = {
    address: contractAddress,
    abi,
    functionName: isBurnContract ? 'totalSupply' : 'tokenId',
    args: []
  };

  const totalBurnedCall = isBurnContract ? {
    address: contractAddress,
    abi,
    functionName: 'totalBurned',
    args: []
  } : null;

  const [supplyResult, burnedResult] = await retry(
    () => Promise.all([
      batchMulticall([totalSupplyCall], config.alchemy.batchSize),
      totalBurnedCall ? batchMulticall([totalBurnedCall], config.alchemy.batchSize) : Promise.resolve([{ status: 'success', result: 0 }])
    ]),
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  );

  if (supplyResult[0].status !== 'success') {
    logger.error('utils', `Failed to fetch totalSupply for ${contractKey}: ${supplyResult[0].error || 'unknown error'}`, 'eth', contractKey);
    cacheState.progressState.error = 'Failed to fetch totalSupply';
    await saveCacheStateContract(contractKey, cacheState);
    throw new Error('Failed to fetch totalSupply');
  }

  totalTokens = Number(supplyResult[0].result);
  totalBurned = burnedResult[0].status === 'success' ? Number(burnedResult[0].result) : 0;

  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Total tokens: ${totalTokens}, totalBurned: ${totalBurned}`, 'eth', contractKey);
  }

  cacheState.progressState.totalLiveHolders = totalTokens;
  cacheState.progressState.progressPercentage = '20%';
  await saveCacheStateContract(contractKey, cacheState);

  const tokenIds = Array.from({ length: totalTokens }, (_, i) => isBurnContract ? i + 1 : i + 541);
  const ownerCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)]
  }));

  const ownerResults = [];
  for (let i = 0; i < ownerCalls.length; i += config.alchemy.batchSize) {
    const chunk = ownerCalls.slice(i, i + config.alchemy.batchSize);
    const results = await retry(
      () => batchMulticall(chunk, config.alchemy.batchSize),
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    ownerResults.push(...results);
    cacheState.progressState.progressPercentage = `${Math.round(20 + (i / ownerCalls.length) * 20)}%`;
    await saveCacheStateContract(contractKey, cacheState);
  }

  tokenIds.forEach((tokenId, i) => {
    const result = ownerResults[i];
    if (result.status === 'success' && result.result !== burnAddress) {
      tokenOwnerMap.set(tokenId, result.result.toLowerCase());
    } else if (result.status !== 'success') {
      logger.warn('utils', `Failed to fetch owner for token ${tokenId}: ${result.error || 'unknown error'}`, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owner', tokenId, error: result.error || 'unknown error' });
    }
  });

  cacheState.progressState.phase = 'fetching_records';
  cacheState.progressState.progressPercentage = '40%';
  await saveCacheStateContract(contractKey, cacheState);

  const recordCalls = contractKey === 'ascendant' ? tokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: 'userRecords',
    args: [BigInt(tokenId)]
  })) : [];

  const recordResults = contractKey === 'ascendant' ? [] : tokenIds.map(() => ({ status: 'success', result: [] }));
  if (contractKey === 'ascendant') {
    for (let i = 0; i < recordCalls.length; i += config.alchemy.batchSize) {
      const chunk = recordCalls.slice(i, i + config.alchemy.batchSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      recordResults.push(...results);
      cacheState.progressState.progressPercentage = `${Math.round(40 + (i / recordCalls.length) * 10)}%`;
      await saveCacheStateContract(contractKey, cacheState);
    }
  }

  cacheState.progressState.phase = 'fetching_tiers';
  cacheState.progressState.processedTiers = 0;
  await saveCacheStateContract(contractKey, cacheState);

  const tierCalls = tokenIds.map((tokenId) => ({
    address: contractAddress,
    abi,
    functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
    args: [BigInt(tokenId)],
  }));

  const tierResults = [];
  const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 1000;
  for (let i = 0; i < tierCalls.length; i += chunkSize) {
    const chunk = tierCalls.slice(i, i + chunkSize);
    const results = await retry(
      () => batchMulticall(chunk, config.alchemy.batchSize),
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    tierResults.push(...results);
    cacheState.progressState.processedTiers = Math.min(i + chunkSize, tokenIds.length);
    await saveCacheStateContract(contractKey, cacheState);
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Processed tiers for ${cacheState.progressState.processedTiers}/${tokenIds.length} tokens`, 'eth', contractKey);
    }
  }

  cacheState.progressState.phase = 'fetching_rewards';
  cacheState.progressState.progressPercentage = '60%';
  await saveCacheStateContract(contractKey, cacheState);

  const rewardCalls = contractKey === 'ascendant' ? [{
    address: contractAddress,
    abi,
    functionName: 'batchClaimableAmount',
    args: [tokenIds.map(id => BigInt(id))]
  }, {
    address: contractAddress,
    abi,
    functionName: 'toDistribute',
    args: [0]
  }, {
    address: contractAddress,
    abi,
    functionName: 'toDistribute',
    args: [1]
  }, {
    address: contractAddress,
    abi,
    functionName: 'toDistribute',
    args: [2]
  }, {
    address: contractAddress,
    abi,
    functionName: 'totalShares',
    args: []
  }] : [];

  const rewardResults = contractKey === 'ascendant' ? await retry(
    () => batchMulticall(rewardCalls, config.alchemy.batchSize),
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  ) : [];

  if (contractKey === 'ascendant') {
    if (rewardResults[0].status === 'success') {
      const claimable = parseFloat(formatUnits(rewardResults[0].result || 0, 18));
      holdersMap.forEach(holder => {
        holder.claimableRewards = claimable / totalTokens * holder.total;
      });
    }
    toDistributeDay8 = rewardResults[1].status === 'success' ? parseFloat(formatUnits(rewardResults[1].result || 0, 18)) : 0;
    toDistributeDay28 = rewardResults[2].status === 'success' ? parseFloat(formatUnits(rewardResults[2].result || 0, 18)) : 0;
    toDistributeDay90 = rewardResults[3].status === 'success' ? parseFloat(formatUnits(rewardResults[3].result || 0, 18)) : 0;
    totalShares = rewardResults[4].status === 'success' ? parseFloat(formatUnits(rewardResults[4].result || 0, 18)) : 0;
  }

  cacheState.progressState.phase = 'building_holders';
  cacheState.progressState.progressPercentage = '80%';
  await saveCacheStateContract(contractKey, cacheState);

  tokenIds.forEach((tokenId, i) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) {
      logger.warn('utils', `No owner found for token ${tokenId}`, 'eth', contractKey);
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
        logger.error('utils', `Failed to fetch userRecords for token ${tokenId}: ${recordResult.error || 'unknown error'}`, 'eth', contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId, wallet, error: recordResult.error || 'unknown error' });
        return;
      }
    }

    let tier = 0; // Allow tier 0
    let rarityNumber = 0;
    let rarity = 0;
    const tierResult = tierResults[i];
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Raw tierResult for token ${tokenId}: status=${tierResult.status}, result=${safeStringify(tierResult.result)}`, 'eth', contractKey);
    }

    if (tierResult.status === 'success') {
      if (contractKey === 'ascendant') {
        const result = tierResult.result;
        if (Array.isArray(result) && result.length >= 3) {
          rarityNumber = Number(result[0]) || 0;
          tier = Number(result[1]) || 0; // Allow tier 0
          rarity = Number(result[2]) || 0;
          if (!config.debug.suppressDebug) {
            logger.debug('utils', `Parsed attributes for token ${tokenId} (ascendant): tier=${tier}, rarityNumber=${rarityNumber}, rarity=${rarity}, result=${safeStringify(result)}`, 'eth', contractKey);
          }
        } else {
          logger.warn('utils', `Invalid getNFTAttribute result for token ${tokenId}: result=${safeStringify(result)}`, 'eth', contractKey);
          errorLog.push({
            timestamp: new Date().toISOString(),
            phase: 'fetch_tier',
            tokenId,
            wallet,
            error: `Invalid getNFTAttribute result: ${safeStringify(result)}`
          });
          return;
        }
      } else {
        tier = typeof tierResult.result === 'bigint' ? Number(tierResult.result) : Number(tierResult.result) || 1;
      }

      if (isNaN(tier) || tier < 0 || tier > maxTier) { // Allow tier 0, maxTier = 8
        logger.warn('utils', `Invalid tier for token ${tokenId} in ${contractKey}: tier=${tier}, maxTier=${maxTier}, defaulting to 0`, 'eth', contractKey);
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId,
          wallet,
          error: `Invalid tier ${tier}`,
          details: { rawResult: safeStringify(tierResult.result), maxTier, parsedTier: tier }
        });
        tier = 0;
      }
    } else {
      logger.error('utils', `Failed to fetch tier for token ${tokenId}: ${tierResult.error || 'unknown error'}`, 'eth', contractKey);
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_tier',
        tokenId,
        wallet,
        error: tierResult.error || 'unknown error',
        details: { rawResult: safeStringify(tierResult.result) }
      });
      return;
    }

    if (contractKey === 'ascendant' && rarity >= 0 && rarity < rarityDistribution.length) {
      rarityDistribution[rarity] += 1;
    } else if (contractKey === 'ascendant') {
      logger.warn('utils', `Invalid rarity for token ${tokenId}: rarity=${rarity}, maxRarity=${rarityDistribution.length - 1}`, 'eth', contractKey);
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_rarity',
        tokenId,
        wallet,
        error: `Invalid rarity ${rarity}`
      });
    }

    const holder = holdersMap.get(wallet) || {
      wallet,
      tokenIds: [],
      tiers: Array(maxTier + 1).fill(0), // 9 elements (0 to 8)
      total: 0,
      multiplierSum: 0,
      ...(contractKey === 'ascendant' ? {
        shares: 0,
        lockedAscendant: 0,
        pendingDay8: toDistributeDay8 / totalTokens * 8 / 100,
        pendingDay28: toDistributeDay28 / totalTokens * 28 / 100,
        pendingDay90: toDistributeDay90 / totalTokens * 90 / 100,
        claimableRewards: 0,
        tokens: []
      } : {})
    };

    if (holder.tokenIds.includes(tokenId)) {
      logger.warn('utils', `Duplicate tokenId ${tokenId} for wallet ${wallet} in holdersMap`, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'build_holders', tokenId, wallet, error: 'Duplicate tokenId in holdersMap' });
      return;
    }

    holder.tokenIds.push(tokenId);
    holder.total += 1;
    holder.tiers[tier] += 1; // Use raw tier index (0 to 8)
    holder.multiplierSum += contractTiers[tier + 1]?.multiplier || (tier + 1); // Map tier 0 to Tier 1 multiplier
    if (contractKey === 'ascendant') {
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      holder.tokens.push({
        tokenId: Number(tokenId),
        tier: tier + 1, // Display as 1-based
        rawTier: tier, // Include raw tier for debugging
        rarityNumber,
        rarity
      });
    }
    holdersMap.set(wallet, holder);
    tierDistribution[tier] += 1;
  });

  cacheState.progressState.phase = 'finalizing';
  cacheState.progressState.progressPercentage = '90%';
  await saveCacheStateContract(contractKey, cacheState);

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
    ...(contractKey === 'element280' || contractKey === 'stax' || contractKey === 'ascendant' ? { totalMinted: totalTokens + totalBurned } : {}),
    totalLive: totalTokens,
    totalBurned,
    tierDistribution,
    ...(contractKey === 'ascendant' ? {
      totalLockedAscendant,
      totalShares,
      toDistributeDay8,
      toDistributeDay28,
      toDistributeDay90,
      pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
      rarityDistribution
    } : {})
  };
  cacheState.progressState.isPopulating = false;
  cacheState.progressState.phase = 'complete';
  cacheState.progressState.progressPercentage = '100%';
  cacheState.progressState.lastProcessedBlock = Number(currentBlock);
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);

  await setCache(`${contractKey}_holders`, { holders: holderList, totalBurned, timestamp: Date.now(), rarityDistribution }, 0, contractKey);
  logger.info('utils', `Completed holders map with ${holderList.length} holders, totalBurned=${totalBurned}`, 'eth', contractKey);
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Tier distribution for ${contractKey}: ${tierDistribution}`, 'eth', contractKey);
    if (contractKey === 'ascendant') {
      logger.debug('utils', `Rarity distribution for ${contractKey}: ${rarityDistribution}`, 'eth', contractKey);
    }
  }

  return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog, rarityDistribution };
}