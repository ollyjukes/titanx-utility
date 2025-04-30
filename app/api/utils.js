// app/api/utils.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';
import config from '@/config.js';
import { logger } from '@/lib/logger.js';

const cache = new NodeCache({
  stdTTL: config.cache.nodeCache.stdTTL,
  checkperiod: config.cache.nodeCache.checkperiod,
});

const alchemySettings = {
  apiKey: config.alchemy.apiKey,
  network: Network.ETH_MAINNET,
};

const alchemy = new Alchemy(alchemySettings);

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`, {
    timeout: config.alchemy.timeoutMs,
    retryCount: config.alchemy.maxRetries,
  }),
});

async function retry(fn, options = {}) {
  const { retries = config.alchemy.maxRetries, delayMs = config.alchemy.batchDelayMs } = options;
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : `Non-error thrown: ${JSON.stringify(error)}`;
      logger.error('utils', `Retry ${i + 1}/${retries} failed: ${errorMessage}`, { stack: error.stack });
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  const finalErrorMessage = lastError instanceof Error ? lastError.message : `Non-error thrown: ${JSON.stringify(lastError)}`;
  throw new Error(`Failed after ${retries} retries: ${finalErrorMessage}`);
}

async function getCache(key, collection) {
  if (config.cache.redis[`disable${collection}`]) {
    return cache.get(key);
  }
  // Add Redis logic if enabled
  return cache.get(key);
}

async function setCache(key, value, ttl, collection) {
  if (config.cache.redis[`disable${collection}`]) {
    return cache.set(key, value, ttl);
  }
  // Add Redis logic if enabled
  return cache.set(key, value, ttl);
}

async function saveCacheState(collection, state, prefix) {
  if (config.cache.redis[`disable${collection}`]) {
    const cachePath = path.join(process.cwd(), 'cache', `cache_state_${prefix}.json`);
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(state, null, 2));
      logger.info('utils', `Saved cache state for ${prefix}:${prefix}`);
    } catch (error) {
      logger.error('utils', `Failed to save cache state for ${prefix}: ${error.message}`);
    }
  }
  // Add Redis logic if enabled
}

async function loadCacheState(collection, prefix) {
  if (config.cache.redis[`disable${collection}`]) {
    const cachePath = path.join(process.cwd(), 'cache', `cache_state_${prefix}.json`);
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      const state = JSON.parse(data);
      logger.info('utils', `Loaded cache state for ${prefix}:${prefix}: ${JSON.stringify(state)}`);
      return state;
    } catch (error) {
      logger.error('utils', `Failed to load cache state for ${prefix}: ${error.message}`);
      return null;
    }
  }
  // Add Redis logic if enabled
  return null;
}

export { client, alchemy, retry, getCache, setCache, saveCacheState, loadCacheState, logger };