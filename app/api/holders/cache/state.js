import { logger } from '@/app/lib/logger';
import { loadCacheState, saveCacheState } from '@/app/api/utils/cache';
import fs from 'fs/promises';
import path from 'path';
import Redis from 'ioredis';

// Cache directory for filesystem storage
const cacheDir = path.join(process.cwd(), 'cache');

// Redis client initialization
const redisEnabled = !!process.env.UPSTASH_REDIS_REST_URL;
let redis = null;
if (redisEnabled) {
  try {
    redis = new Redis(process.env.UPSTASH_REDIS_REST_URL);
    logger.info('cache', 'Redis client initialized successfully', 'eth', 'general');
  } catch (error) {
    logger.error('cache', `Failed to initialize Redis client: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    redis = null;
  }
}

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.chmod(cacheDir, 0o755);
    logger.debug('cache/file', `Ensured cache directory exists: ${cacheDir}`, 'eth', 'general');
  } catch (error) {
    logger.error('cache/file', `Failed to create cache directory ${cacheDir}: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    throw error;
  }
}

// Get cache state for a contract
export async function getCacheState(contractKey) {
  const cacheState = {
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
  try {
    logger.debug('cache/state', `Loading cache state for ${contractKey}`, 'eth', contractKey);
    const savedState = await loadCacheState(contractKey, contractKey.toLowerCase());
    if (savedState && typeof savedState === 'object') {
      cacheState.isPopulating = savedState.isPopulating ?? false;
      cacheState.totalOwners = savedState.totalOwners ?? 0;
      cacheState.totalLiveHolders = savedState.totalLiveHolders ?? 0;
      cacheState.progressState = {
        ...cacheState.progressState,
        ...savedState.progressState,
      };
      cacheState.lastUpdated = savedState.lastUpdated ?? null;
      cacheState.lastProcessedBlock = savedState.lastProcessedBlock ?? null;
      cacheState.globalMetrics = savedState.globalMetrics ?? {};
      logger.info(
        'cache/state',
        `Loaded cache state for ${contractKey}: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`,
        'eth',
        contractKey
      );
    } else {
      logger.warn('cache/state', `No valid cache state found for ${contractKey}, returning default`, 'eth', contractKey);
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
  }
  return cacheState;
}

// Save cache state for a contract
export async function saveCacheStateContract(contractKey, cacheState) {
  try {
    const updatedState = {
      ...cacheState,
      lastProcessedBlock: cacheState.progressState.lastProcessedBlock ?? cacheState.lastProcessedBlock,
      progressState: {
        ...cacheState.progressState,
        lastProcessedBlock: cacheState.progressState.lastProcessedBlock ?? cacheState.lastProcessedBlock,
      },
    };
    logger.debug(
      'cache/state',
      `Saving cache state for ${contractKey}: totalOwners=${updatedState.totalOwners}, step=${updatedState.progressState.step}`,
      'eth',
      contractKey
    );
    await saveCacheState(contractKey, updatedState, contractKey.toLowerCase());
    logger.info(
      'cache/state',
      `Saved cache state for ${contractKey}: totalOwners=${updatedState.totalOwners}, step=${updatedState.progressState.step}`,
      'eth',
      contractKey
    );
  } catch (error) {
    logger.error(
      'cache/state',
      `Failed to save cache state for ${contractKey}: ${error.message}`,
      { stack: error.stack },
      'eth',
      contractKey
    );
    throw error;
  }
}

// Get cache data
export async function getCache(key, prefix) {
  const chain = 'eth';
  const cacheKey = `${prefix.toLowerCase()}_${key}`;
  logger.debug('cache', `Attempting to get cache for key=${cacheKey}`, chain, prefix.toLowerCase());

  // Try Redis first if enabled
  if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
    try {
      const redisData = await redis.get(cacheKey);
      if (redisData) {
        logger.info('cache', `Retrieved ${cacheKey} from Redis`, chain, prefix.toLowerCase());
        return JSON.parse(redisData);
      }
      logger.debug('cache', `No data found in Redis for ${cacheKey}, checking filesystem`, chain, prefix.toLowerCase());
    } catch (error) {
      logger.error(
        'cache',
        `Failed to get ${cacheKey} from Redis: ${error.message}`,
        { stack: error.stack },
        chain,
        prefix.toLowerCase()
      );
    }
  }

  // Fallback to filesystem
  const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_${key}.json`);
  try {
    const data = await fs.readFile(cacheFile, 'utf-8');
    logger.info('cache/file', `Retrieved ${cacheKey} from ${cacheFile}`, chain, prefix.toLowerCase());
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.debug('cache/file', `Cache file ${cacheFile} not found`, chain, prefix.toLowerCase());
    } else {
      logger.error(
        'cache/file',
        `Failed to read cache file ${cacheFile}: ${error.message}`,
        { stack: error.stack },
        chain,
        prefix.toLowerCase()
      );
    }
    return null;
  }
}

// Set cache data
export async function setCache(key, value, ttl, prefix) {
  const chain = 'eth';
  const cacheKey = `${prefix.toLowerCase()}_${key}`;
  logger.debug('cache', `Setting cache for key=${cacheKey}, ttl=${ttl}`, chain, prefix.toLowerCase());

  // Handle holders specifically
  if (key.endsWith('_holders')) {
    const holdersCount = value.holders ? value.holders.length : 0;
    logger.info('cache', `Persisting ${cacheKey} with ${holdersCount} holders`, chain, prefix.toLowerCase());

    // Write to Redis if enabled
    if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
      try {
        await redis.set(cacheKey, JSON.stringify(value), 'EX', ttl || 86400);
        logger.info('cache', `Persisted ${cacheKey} to Redis with ${holdersCount} holders`, chain, prefix.toLowerCase());
      } catch (error) {
        logger.error(
          'cache',
          `Failed to persist ${cacheKey} to Redis: ${error.message}`,
          { stack: error.stack },
          chain,
          prefix.toLowerCase()
        );
      }
    }

    // Always write to filesystem
    const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_holders.json`);
    try {
      await ensureCacheDir();
      logger.debug('cache/file', `Writing ${cacheKey} to ${cacheFile}`, chain, prefix.toLowerCase());
      await fs.writeFile(cacheFile, JSON.stringify(value, null, 2));
      await fs.chmod(cacheFile, 0o644);
      logger.info('cache/file', `Persisted ${cacheKey} to ${cacheFile} with ${holdersCount} holders`, chain, prefix.toLowerCase());
    } catch (error) {
      logger.error(
        'cache/file',
        `Failed to write cache file ${cacheFile}: ${error.message}`,
        { stack: error.stack },
        chain,
        prefix.toLowerCase()
      );
      throw error;
    }
    return;
  }

  // Handle other cache keys
  if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
    try {
      await redis.set(cacheKey, JSON.stringify(value), 'EX', ttl || 86400);
      logger.info('cache', `Persisted ${cacheKey} to Redis`, chain, prefix.toLowerCase());
    } catch (error) {
      logger.error(
        'cache',
        `Failed to persist ${cacheKey} to Redis: ${error.message}`,
        { stack: error.stack },
        chain,
        prefix.toLowerCase()
      );
    }
  } else {
    const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_${key}.json`);
    try {
      await ensureCacheDir();
      logger.debug('cache/file', `Writing ${cacheKey} to ${cacheFile}`, chain, prefix.toLowerCase());
      await fs.writeFile(cacheFile, JSON.stringify(value, null, 2));
      await fs.chmod(cacheFile, 0o644);
      logger.info('cache/file', `Persisted ${cacheKey} to ${cacheFile}`, chain, prefix.toLowerCase());
    } catch (error) {
      logger.error(
        'cache/file',
        `Failed to write cache file ${cacheFile}: ${error.message}`,
        { stack: error.stack },
        chain,
        prefix.toLowerCase()
      );
      throw error;
    }
  }
}

// Test cache write (for debugging)
export async function testCacheWrite() {
  const testFile = path.join(cacheDir, 'test.json');
  const testData = { test: 'data', timestamp: Date.now() };
  try {
    await ensureCacheDir();
    logger.debug('cache/file', `Testing write to ${testFile}`, 'eth', 'general');
    await fs.writeFile(testFile, JSON.stringify(testData, null, 2));
    await fs.chmod(testFile, 0o644);
    logger.info('cache/file', `Test write to ${testFile} succeeded`, 'eth', 'general');
    return true;
  } catch (error) {
    logger.error(
      'cache/file',
      `Test write to ${testFile} failed: ${error.message}`,
      { stack: error.stack },
      'eth',
      'general'
    );
    return false;
  }
}