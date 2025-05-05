// app/api/holders/utils/cache.js
import { logger, loadCacheState, saveCacheState } from '@/app/api new code/utils';

export async function getCacheState(contractKey) {
  const cacheState = {
    isPopulating: false,
    totalOwners: 0,
    totalLiveHolders: 0,
    phase: 'Idle',
    progressPercentage: '0.0',
    lastProcessedBlock: null,
    lastUpdated: null,
    error: null,
    errorLog: [],
    globalMetrics: {},
    progressState: {
      step: 'idle',
      processedNfts: 0,
      totalNfts: 0,
      processedTiers: 0,
      totalTiers: 0,
      error: null,
      errorLog: [],
    },
  };
  try {
    const savedState = await loadCacheState(contractKey, contractKey.toLowerCase());
    if (savedState && typeof savedState === 'object') {
      Object.assign(cacheState, {
        isPopulating: savedState.isPopulating ?? false,
        totalOwners: savedState.totalOwners ?? 0,
        totalLiveHolders: savedState.totalLiveHolders ?? 0,
        phase: savedState.progressState?.step.charAt(0).toUpperCase() + savedState.progressState?.step.slice(1) ?? 'Idle',
        progressPercentage: savedState.progressState?.processedNfts && savedState.progressState?.totalNfts
          ? ((savedState.progressState.processedNfts / savedState.progressState.totalNfts) * 100).toFixed(1)
          : '0.0',
        lastProcessedBlock: savedState.lastProcessedBlock ?? null,
        lastUpdated: savedState.lastUpdated ?? null,
        error: savedState.progressState?.error ?? null,
        errorLog: savedState.progressState?.errorLog ?? [],
        globalMetrics: savedState.globalMetrics ?? {},
        progressState: {
          step: savedState.progressState?.step ?? 'idle',
          processedNfts: savedState.progressState?.processedNfts ?? 0,
          totalNfts: savedState.progressState?.totalNfts ?? 0,
          processedTiers: savedState.progressState?.processedTiers ?? 0,
          totalTiers: savedState.progressState?.totalTiers ?? 0,
          error: savedState.progressState?.error ?? null,
          errorLog: savedState.progressState?.errorLog ?? [],
        },
      });
      logger.debug('utils', `Loaded cache state: totalOwners=${cacheState.totalOwners}, phase=${cacheState.phase}`, 'eth', contractKey);
    }
  } catch (error) {
    logger.error('utils', `Failed to load cache state: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
  }
  return cacheState;
}

export async function saveCacheStateContract(contractKey, cacheState) {
  try {
    const savedState = {
      isPopulating: cacheState.isPopulating,
      totalOwners: cacheState.totalOwners,
      totalLiveHolders: cacheState.totalLiveHolders,
      progressState: {
        step: cacheState.progressState.step,
        processedNfts: cacheState.progressState.processedNfts,
        totalNfts: cacheState.progressState.totalNfts,
        processedTiers: cacheState.progressState.processedTiers,
        totalTiers: cacheState.progressState.totalTiers,
        error: cacheState.progressState.error,
        errorLog: cacheState.progressState.errorLog,
      },
      lastUpdated: cacheState.lastUpdated || Date.now(),
      lastProcessedBlock: cacheState.lastProcessedBlock,
      globalMetrics: cacheState.globalMetrics,
    };
    await saveCacheState(contractKey, savedState, contractKey.toLowerCase());
    logger.debug('utils', `Saved cache state: totalOwners=${cacheState.totalOwners}, phase=${cacheState.progressState.step}`, 'eth', contractKey);
  } catch (error) {
    logger.error('utils', `Failed to save cache state: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
  }
}