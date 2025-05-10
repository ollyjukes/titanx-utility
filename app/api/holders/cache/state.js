// app/api/holders/cache/state.js
import { logger } from '@/app/lib/logger';
import { getCache, setCache } from '@/app/api/utils/cache';

const DEFAULT_STATE = {
  isPopulating: false,
  totalOwners: 0,
  totalLiveHolders: 0,
  progressState: {
    step: 'idle',
    processedNfts: 0,
    totalNfts: 0,
    processedTiers: 0,
    totalTiers: 0,
    error: null,
    errorLog: [],
    progressPercentage: '0%',
    totalLiveHolders: 0,
    totalOwners: 0,
    lastProcessedBlock: null,
    lastUpdated: null,
  },
  lastUpdated: null,
  lastProcessedBlock: null,
  globalMetrics: {},
};

export async function loadCacheState(contractKey, chain = 'eth') {
  try {
    const data = await getCache(`${contractKey}_state`, contractKey, 'state');
    return data || null;
  } catch (error) {
    logger.error('cache/state', `Failed to load cache state for ${contractKey}: ${error.message}`, { stack: error.stack }, chain, contractKey);
    throw error;
  }
}

export async function saveCacheStateContract(contractKey, state, chain = 'eth') {
  try {
    await setCache(`${contractKey}_state`, state, 0, contractKey, 'state');
    logger.debug('cache/state', `Saved cache state for ${contractKey}`, chain, contractKey);
  } catch (error) {
    logger.error('cache/state', `Failed to save cache state for ${contractKey}: ${error.message}`, { stack: error.stack }, chain, contractKey);
    throw error;
  }
}

export async function getCacheState(contractKey) {
  const cacheState = { ...DEFAULT_STATE };
  try {
    logger.debug('cache/state', `Loading cache state for ${contractKey}`, 'eth', contractKey);
    const savedState = await loadCacheState(contractKey, contractKey.toLowerCase());
    if (savedState && typeof savedState === 'object' && savedState.progressState) {
      cacheState.isPopulating = savedState.isPopulating ?? false;
      cacheState.totalOwners = savedState.totalOwners ?? 0;
      cacheState.totalLiveHolders = savedState.totalLiveHolders ?? 0;
      cacheState.progressState = {
        ...cacheState.progressState,
        ...savedState.progressState,
        error: savedState.progressState.error || null,
        errorLog: Array.isArray(savedState.progressState.errorLog) ? savedState.progressState.errorLog : [],
      };
      cacheState.lastUpdated = savedState.lastUpdated ?? null;
      cacheState.lastProcessedBlock = savedState.lastProcessedBlock ?? null;
      cacheState.globalMetrics = savedState.globalMetrics ?? {};
      logger.info(
        'cache/state',
        `Loaded cache state for ${contractKey}: step=${cacheState.progressState.step}, progress=${cacheState.progressState.progressPercentage}`,
        'eth',
        contractKey
      );
    } else {
      await saveCacheStateContract(contractKey, cacheState);
      logger.warn('cache/state', `No valid cache state found for ${contractKey}, initialized and saved default`, 'eth', contractKey);
    }
  } catch (error) {
    logger.error(
      'cache/state',
      `Failed to load cache state for ${contractKey}: ${error.message}`,
      { stack: error.stack },
      'eth',
      contractKey
    );
    cacheState.progressState.error = `Failed to load cache state: ${error.message}`;
    cacheState.progressState.errorLog.push({
      timestamp: new Date().toISOString(),
      phase: 'load_cache_state',
      error: error.message,
    });
    await saveCacheStateContract(contractKey, cacheState);
  }
  return cacheState;
}