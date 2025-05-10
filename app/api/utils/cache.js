// app/api/utils/cache.js
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';
import { Redis } from '@upstash/redis';
import config from '@/app/contracts_nft';
import { logger } from '@/app/lib/logger';
import { getAddress } from 'viem';
import { client } from '@/app/api/utils/client';
import { sanitizeBigInt } from '@/app/api/holders/cache/utils'; // Add this import

// Initialize NodeCache
const cache = new NodeCache({
  stdTTL: config.cache.nodeCache.stdTTL,
  checkperiod: config.cache.nodeCache.checkperiod,
});

// Cache directory for file-based caching
const cacheDir = path.join(process.cwd(), 'cache');

// Determine environment and cache strategy
const isProduction = process.env.NODE_ENV === 'production';
const redisEnabled = isProduction && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
let redis = null;

if (redisEnabled) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    logger.info('cache', 'Redis initialized for production', 'ETH', 'general');
  } catch (error) {
    logger.error('cache', `Redis initialization failed: ${error.message}`, { stack: error.stack }, 'ETH', 'general');
    throw new Error('Redis initialization failed in production');
  }
}

async function ensureCacheDir(collectionKey = 'general') {
  const chain = config.nftContracts[collectionKey.toLowerCase()]?.chain || 'ETH';
  if (!isProduction) {
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.chmod(cacheDir, 0o755);
      logger.info('cache', `Cache directory ensured: ${cacheDir}`, chain, collectionKey);
    } catch (error) {
      logger.error('cache', `Cache directory creation failed: ${error.message}`, { stack: error.stack }, chain, collectionKey);
      throw error;
    }
  }
}

export async function initializeCache() {
  const chain = 'ETH';
  const collectionKey = 'general';
  try {
    if (!isProduction) {
      await ensureCacheDir();
      const collections = Object.keys(config.nftContracts)
        .filter(key => !config.nftContracts[key].disabled)
        .map(key => key.toLowerCase());
      for (const collection of collections) {
        const files = ['summary', 'holders', 'transfers', 'state'].map(type => path.join(cacheDir, `${collection}_${type}.json`));
        for (const file of files) {
          try {
            await fs.access(file);
          } catch {
            await fs.writeFile(file, JSON.stringify({ data: {}, timestamp: Date.now() }));
            await fs.chmod(file, 0o644);
          }
        }
      }
      logger.info('cache', 'File-based cache initialized for development', chain, collectionKey);
    } else if (redisEnabled) {
      await redis.ping();
      logger.info('cache', 'Redis cache initialized for production', chain, collectionKey);
    } else {
      throw new Error('Redis not configured in production');
    }
    return true;
  } catch (error) {
    logger.error('cache', `Cache initialization failed: ${error.message}`, { stack: error.stack }, chain, collectionKey);
    throw error;
  }
}

export async function getCache(key, prefix, type = 'holders') {
  const chain = config.nftContracts[prefix.toLowerCase()]?.chain || 'ETH';
  const cacheKey = `${prefix}_${type}_${key}`;
  try {
    // Check NodeCache first
    let data = cache.get(cacheKey);
    if (data) {
      logger.debug('cache', `Node-cache hit: ${cacheKey}`, chain, prefix);
      return data;
    }

    if (isProduction) {
      // Production: Check Redis
      if (redis && !config.cache.redis[`disable${prefix.charAt(0).toUpperCase() + prefix.slice(1)}`]) {
        const redisData = await redis.get(cacheKey);
        if (redisData) {
          data = JSON.parse(redisData);
          cache.set(cacheKey, data); // Sync to NodeCache
          logger.info('cache', `Redis hit: ${cacheKey}`, chain, prefix);
          return data;
        }
      }
      logger.debug('cache', `Redis cache miss: ${cacheKey}`, chain, prefix);
      return null;
    } else {
      // Development: Check file system
      const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_${type}.json`);
      try {
        const fileData = await fs.readFile(cacheFile, 'utf8');
        data = JSON.parse(fileData);
        cache.set(cacheKey, data); // Sync to NodeCache
        logger.info('cache', `File cache hit: ${cacheFile}`, chain, prefix);
        return data;
      } catch (error) {
        logger.debug('cache', `File cache miss: ${cacheFile}`, chain, prefix);
        return null;
      }
    }
  } catch (error) {
    logger.error('cache', `Get cache failed: ${cacheKey}, ${error.message}`, { stack: error.stack }, chain, prefix);
    return null;
  }
}

export async function setCache(key, value, ttl, prefix, type = 'holders') {
  const chain = config.nftContracts[prefix.toLowerCase()]?.chain || 'ETH';
  const cacheKey = `${prefix}_${type}_${key}`;
  try {
    // Sanitize the value to handle BigInt
    const sanitizedValue = sanitizeBigInt(value);

    // Always set in NodeCache
    cache.set(cacheKey, sanitizedValue, ttl);

    if (isProduction) {
      // Production: Set in Redis
      if (redis && !config.cache.redis[`disable${prefix.charAt(0).toUpperCase() + prefix.slice(1)}`]) {
        await redis.set(cacheKey, JSON.stringify(sanitizedValue), { EX: ttl });
        logger.info('cache', `Set Redis: ${cacheKey}`, chain, prefix);
      }
    } else {
      // Development: Set in file system
      const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_${type}.json`);
      await ensureCacheDir(prefix);
      await fs.writeFile(cacheFile, JSON.stringify(sanitizedValue, null, 2));
      await fs.chmod(cacheFile, 0o644);
      logger.info('cache', `Set file cache: ${cacheFile}`, chain, prefix);
    }
    return true;
  } catch (error) {
    logger.error('cache', `Set cache failed: ${cacheKey}, ${error.message}`, { stack: error.stack }, chain, prefix);
    return false;
  }
}

export async function saveCacheState(key, state, prefix) {
  return setCache(key, state, 0, prefix, 'state');
}

export async function loadCacheState(key, prefix) {
  return getCache(key, prefix, 'state');
}

export async function getTransactionReceipt(transactionHash) {
  try {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    logger.debug('cache', `Fetched transaction receipt: ${transactionHash}`, 'ETH', 'general');
    return receipt;
  } catch (error) {
    logger.error('cache', `Failed to fetch receipt: ${transactionHash}, ${error.message}`, { stack: error.stack }, 'ETH', 'general');
    throw error;
  }
}

export async function validateContract(contractKey) {
  const chain = config.nftContracts[contractKey.toLowerCase()]?.chain || 'ETH';
  try {
    const contractConfig = config.nftContracts[contractKey.toLowerCase()];
    if (!contractConfig || !contractConfig.contractAddress) {
      logger.error('cache', `No config for ${contractKey}`, {}, chain, contractKey);
      return false;
    }
    const address = getAddress(contractConfig.contractAddress);
    const code = await client.getBytecode({ address });
    const isValid = !!code && code !== '0x';
    logger.info('cache', `Contract ${contractKey} (${address}): ${isValid ? 'valid' : 'invalid'}`, chain, contractKey);
    return isValid;
  } catch (error) {
    logger.error('cache', `Validate ${contractKey} failed: ${error.message}`, { stack: error.stack }, chain, contractKey);
    return false;
  }
}