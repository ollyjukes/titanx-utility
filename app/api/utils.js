import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';
import { Redis } from '@upstash/redis';
import NodeCache from 'node-cache';
import pino from 'pino';
import { promises as fs } from 'fs';
import config from '@/config.js';

const ALCHEMY_API_KEY = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
    timeout: 60000, // Default timeout (60 seconds)
  }),
});

export const alchemy = new Alchemy({
  apiKey: ALCHEMY_API_KEY,
  network: config.alchemy.network || Network.ETH_MAINNET,
});

export const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
});

export function log(message) {
  logger.info(message);
}

const cache = new NodeCache({
  stdTTL: config.cache.nodeCache.stdTTL,
  checkperiod: config.cache.nodeCache.checkperiod,
});

const redis = config.cache.redis.disableElement280
  ? null
  : new Redis({
      url: process.env.REDIS_URL || config.redis.url,
      token: process.env.REDIS_TOKEN || config.redis.token,
    });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function batchMulticall(calls, batchSize = config.alchemy.batchSize) {
  const batches = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    batches.push(calls.slice(i, i + batchSize));
  }
  const results = [];
  for (const batch of batches) {
    try {
      const batchResults = await client.multicall({ contracts: batch });
      results.push(...batchResults);
      await delay(config.alchemy.batchDelayMs);
    } catch (error) {
      log(`[utils] [ERROR] batchMulticall failed: ${error.message}`);
      if (options.retryCount < config.alchemy.maxRetries) {
        await delay(config.alchemy.retryMaxDelayMs / config.alchemy.maxRetries);
        return batchMulticall(calls, { ...options, retryCount: (options.retryCount || 0) + 1 });
      }
      throw error;
    }
  }
  return results;
}

export async function getCache(key) {
  let data = cache.get(key);
  if (!data && !config.cache.redis.disableElement280) {
    try {
      data = await redis?.get(key);
      data = data ? JSON.parse(data) : null;
    } catch (error) {
      log(`[utils] [ERROR] Redis get failed for key ${key}: ${error.message}`);
    }
  }
  if (config.debug.enabled) {
    log(`[utils] [DEBUG] Cache get for ${key}: ${data ? 'hit' : 'miss'}`);
  }
  return data;
}

export async function setCache(key, value) {
  cache.set(key, value);
  if (!config.cache.redis.disableElement280) {
    try {
      await redis?.set(key, JSON.stringify(value), 'EX', config.cache.nodeCache.stdTTL); // Fixed: config.cache.ttl -> config.cache.nodeCache.stdTTL
    } catch (error) {
      log(`[utils] [ERROR] Redis set failed for key ${key}: ${error.message}`);
    }
  }
  if (config.debug.enabled) {
    log(`[utils] [DEBUG] Cache set for ${key}`);
  }
}

export async function loadCacheState(contractAddress) {
  const cacheKey = `state_${contractAddress}`;
  let state = cache.get(cacheKey);
  if (!state && !config.cache.redis.disableElement280) {
    state = await redis?.get(cacheKey);
    state = state ? JSON.parse(state) : null;
  }
  if (!state) {
    try {
      state = JSON.parse(await fs.readFile(`./cache_state_${contractAddress}.json`, 'utf8'));
    } catch (error) {
      state = {
        isCachePopulating: false,
        holdersMapCache: null,
        totalOwners: 0,
        progressState: { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 },
      };
    }
  }
  if (config.debug.enabled) {
    log(`[utils] [DEBUG] Loaded cache state for ${cacheKey}: ${JSON.stringify(state)}`);
  }
  return state;
}

export async function saveCacheState(contractAddress, state) {
  const cacheKey = `state_${contractAddress}`;
  cache.set(cacheKey, state);
  if (!config.cache.redis.disableElement280) {
    try {
      await redis?.set(cacheKey, JSON.stringify(state));
    } catch (error) {
      log(`[utils] [ERROR] Redis set failed for key ${cacheKey}: ${error.message}`);
    }
  }
  try {
    await fs.writeFile(`./cache_state_${contractAddress}.json`, JSON.stringify(state, null, 2));
  } catch (error) {
    log(`[utils] [ERROR] Failed to write cache state to file: ${error.message}`);
  }
  if (config.debug.enabled) {
    log(`[utils] [DEBUG] Saved cache state for ${cacheKey}`);
  }
}