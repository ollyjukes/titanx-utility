// app/api/holders/cache/populateHoldersMapCache.js
import config from '@/app/contracts_nft';
import { logger } from '@/app/lib/logger';
import { getCacheState, saveCacheStateContract } from '@/app/api/holders/cache/state';
import { getCache, setCache, validateContract } from '@/app/api/utils/cache';
import { ensureCacheDirectory, sanitizeBigInt } from './utils';
import { getHoldersMap } from './getHoldersMap';

export async function populateHoldersMapCache(contractKey, contractAddress, abi, vaultAddress, vaultAbi, forceUpdate = false) {
  let cacheState;
  const chain = config.nftContracts[contractKey.toLowerCase()]?.chain || 'eth';
  try {
    await ensureCacheDirectory();
    cacheState = await getCacheState(contractKey.toLowerCase());

    if (!forceUpdate && cacheState.isPopulating) {
      logger.info('holders', `Cache population already in progress for ${contractKey}`, chain, contractKey);
      return { status: 'pending', holders: [], totalPages: 1, totalTokens: 0, summary: {}, globalMetrics: {}, contractKey };
    }

    cacheState.isPopulating = true;
    cacheState.progressState.step = 'initializing';
    cacheState.progressState.progressPercentage = '0%';
    cacheState.lastUpdated = Date.now();
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');

    const isValid = await validateContract(contractKey);
    if (!isValid) throw new Error(`Invalid contract configuration for ${contractKey}`);

    const { holders, totalBurned, lastBlock, errorLog, rarityDistribution } = await getHoldersMap(
      contractKey,
      contractAddress,
      abi,
      vaultAddress,
      vaultAbi,
      cacheState,
      forceUpdate
    );

    const holderList = holders.map(data => ({
      wallet: data.wallet,
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
      percentage: data.percentage || 0,
      displayMultiplierSum: data.displayMultiplierSum || data.multiplierSum,
      rank: data.rank || 0,
      ...(contractKey === 'ascendant' ? { tokens: data.tokens || [] } : {}),
    }));

    cacheState.isPopulating = false;
    cacheState.progressState.step = 'completed';
    cacheState.progressState.status = 'success';
    cacheState.progressState.progressPercentage = '100%';
    cacheState.totalOwners = holderList.length;
    cacheState.totalLiveHolders = holderList.reduce((sum, h) => sum + h.total, 0);
    cacheState.lastUpdated = Date.now();
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');

    const totalTokens = cacheState.globalMetrics.totalLive || 0;
    const summary = {
      totalLive: totalTokens,
      totalBurned: totalBurned || 0,
      totalMinted: (totalTokens + totalBurned) || 0,
      tierDistribution: cacheState.globalMetrics.tierDistribution || Array(Math.max(...Object.keys(config.nftContracts[contractKey]?.tiers || {}).map(Number), 0) + 1).fill(0),
      multiplierPool: holderList.reduce((sum, h) => sum + h.multiplierSum, 0),
      ...(contractKey === 'ascendant' ? { rarityDistribution } : {}),
    };
    await setCache(`${contractKey}_summary`, { holders: holderList, summary, totalBurned, timestamp: Date.now() }, config.cache.nodeCache.stdTTL, contractKey, 'summary');

    return {
      status: 'success',
      holders: holderList,
      totalBurned: totalBurned || 0,
      lastBlock,
      errorLog,
      totalPages: 1,
      totalTokens,
      summary,
      globalMetrics: cacheState.globalMetrics,
      contractKey,
    };
  } catch (error) {
    cacheState = cacheState || (await getCacheState(contractKey.toLowerCase()));
    cacheState.isPopulating = false;
    cacheState.progressState.step = 'failed';
    cacheState.progressState.status = 'error';
    cacheState.progressState.error = error.message;
    cacheState.progressState.errorLog = cacheState.progressState.errorLog || [];
    cacheState.progressState.errorLog.push({ timestamp: new Date().toISOString(), phase: cacheState.progressState.step || 'unknown', error: error.message });
    cacheState.lastUpdated = Date.now();
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    await setCache(`${contractKey}_state`, cacheState, config.cache.nodeCache.stdTTL, contractKey, 'state');
    throw error;
  }
}