// app/api/utils/cache.js
import NodeCache from 'node-cache';
import { Redis } from '@upstash/redis';
import fs from 'fs/promises';
import path from 'path';
import config from '@/config';
import { logger } from '@/lib/logger';
import { client } from '@/app/api/utils/blockchain';
import { parseAbiItem } from 'viem';

let cacheInstance = null;
let redisInstance = null;

const isDebug = process.env.DEBUG === 'true';

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// For test isolation
export function resetCache() {
  cacheInstance = null;
  redisInstance = null;
}

function getCacheInstance() {
  if (!cacheInstance) {
    cacheInstance = new NodeCache({
      stdTTL: config.cache.nodeCache.stdTTL || 3600,
      checkperiod: 120,
    });
  }
  return cacheInstance;
}

export async function initializeCache() {
  try {
    cacheInstance = getCacheInstance();
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      redisInstance = Redis.fromEnv();
      logger.info('cache', 'Redis initialized', 'eth', 'general');
    }
    return true;
  } catch (error) {
    logger.error('cache', `Failed to initialize cache: ${error.message}`, { error }, 'eth', 'general');
    throw error;
  }
}

export async function getCache(key, collection) {
  const cache = getCacheInstance();
  const nodeCacheData = cache.get(key);
  if (nodeCacheData) return nodeCacheData;

  if (redisInstance && !config.cache.redis[`disable${capitalize(collection)}`]) {
    try {
      const redisData = await redisInstance.get(key);
      if (redisData) {
        const parsedData = JSON.parse(redisData);
        cache.set(key, parsedData, config.cache.nodeCache.stdTTL);
        return parsedData;
      }
    } catch (error) {
      logger.error('cache', `Redis get failed for ${key}: ${error.message}`, { error }, 'eth', collection);
    }
  }
  return null;
}

export async function setCache(key, value, ttl, collection) {
  const cache = getCacheInstance();
  cache.set(key, value, ttl);
  if (redisInstance && !config.cache.redis[`disable${capitalize(collection)}`]) {
    try {
      await redisInstance.set(key, JSON.stringify(value), { ex: ttl });
    } catch (error) {
      logger.error('cache', `Redis set failed for ${key}: ${error.message}`, { error }, 'eth', collection);
    }
  }
}

export async function saveCacheState(collection, state, prefix) {
  try {
    const cacheDir = path.join(process.cwd(), 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, `${prefix}_holders.json`);
    await fs.writeFile(filePath, JSON.stringify(state, null, 2));
    logger.debug('cache', `Saved cache state to file: ${filePath}`, 'eth', collection);
  } catch (error) {
    logger.error('cache', `Failed to save cache state for ${collection}: ${error.message}`, { error }, 'eth', collection);
  }
}

export async function loadCacheState(collection, prefix) {
  try {
    const filePath = path.join(process.cwd(), 'cache', `${prefix}_holders.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    logger.error('cache', `Failed to load cache state for ${collection}: ${error.message}`, { error }, 'eth', collection);
    return null;
  }
}

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
    },
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
      logger.debug(
        'cache',
        `Loaded cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`,
        'eth',
        contractKey
      );
    }
  } catch (error) {
    logger.error(
      'cache',
      `Failed to load cache state: ${error.message}`,
      { error },
      'eth',
      contractKey
    );
  }
  return cacheState;
}

export async function saveCacheStateContract(contractKey, cacheState) {
  try {
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());
    logger.debug(
      'cache',
      `Saved cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`,
      'eth',
      contractKey
    );
  } catch (error) {
    logger.error(
      'cache',
      `Failed to save cache state: ${error.message}`,
      { error },
      'eth',
      contractKey
    );
  }
}

export async function getNewEvents(contractKey, contractAddress, fromBlock, errorLog) {
  const cache = getCacheInstance();
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const cacheKey = `${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}`;
  const cachedEvents = await getCache(cacheKey, contractKey.toLowerCase());

  if (cachedEvents) {
    logger.info(
      'cache',
      `Events cache hit: ${cacheKey}, count: ${cachedEvents.burnedTokenIds.length + (cachedEvents.transferTokenIds?.length || 0)}`,
      'eth',
      contractKey
    );
    return cachedEvents;
  }

  let burnedTokenIds = [];
  let transferTokenIds = [];
  let endBlock;
  try {
    endBlock = await client.getBlockNumber();
  } catch (error) {
    logger.error(
      'cache',
      `Failed to fetch block number: ${error.message}`,
      { error },
      'eth',
      contractKey
    );
    errorLog.push({
      timestamp: new Date().toISOString(),
      phase: 'fetch_block_number',
      error: error.message,
    });
    throw error;
  }

  if (fromBlock >= endBlock) {
    logger.info(
      'cache',
      `No new blocks: fromBlock ${fromBlock} >= endBlock ${endBlock}`,
      'eth',
      contractKey
    );
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
      .map(log => ({
        tokenId: Number(log.args.tokenId),
        from: log.args.from.toLowerCase(),
        to: log.args.toLowerCase(),
      }));
    const cacheData = {
      burnedTokenIds,
      transferTokenIds,
      lastBlock: Number(endBlock),
      timestamp: Date.now(),
    };
    await setCache(cacheKey, cacheData, config.cache.nodeCache.stdTTL, contractKey.toLowerCase());
    logger.info(
      'cache',
      `Cached events: ${cacheKey}, burns: ${burnedTokenIds.length}, transfers: ${transferTokenIds.length}`,
      'eth',
      contractKey
    );
    return cacheData;
  } catch (error) {
    logger.error(
      'cache',
      `Failed to fetch events: ${error.message}`,
      { error },
      'eth',
      contractKey
    );
    errorLog.push({
      timestamp: new Date().toISOString(),
      phase: 'fetch_events',
      error: error.message,
    });
    throw error;
  }
}