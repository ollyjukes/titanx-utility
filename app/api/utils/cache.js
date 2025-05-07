import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';
import { Redis } from '@upstash/redis';
import config from '@/contracts/config';
import { getAddress } from 'viem';
import { logger } from '@/app/lib/logger';
import { client } from '@/app/api/utils/client.js';

// Log config.nftContracts at startup
logger.info(
  'cache',
  `Loaded config.nftContracts: keys=${Object.keys(config.nftContracts).join(', ')}`,
  'general',
  'general'
);

const cache = new NodeCache({
  stdTTL: 0,
  checkperiod: 120,
});

const cacheDir = path.join(process.cwd(), 'cache');
const redisEnabled = Object.keys(config.nftContracts).some(
  contract => process.env[`DISABLE_${contract.toUpperCase()}_REDIS`] !== 'true' && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);
let redis = null;

if (redisEnabled) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    logger.info('cache', 'Upstash Redis initialized', 'general', 'general');
  } catch (error) {
    logger.error('cache', `Failed to initialize Upstash Redis: ${error.message}`, { stack: error.stack }, 'general', 'general');
    redis = null;
  }
}

// Log Redis status
logger.info(
  'cache',
  `Redis enabled: ${redisEnabled}, contracts with disabled Redis: ${Object.keys(config.nftContracts).filter(c => process.env[`DISABLE_${c.toUpperCase()}_REDIS`] === 'true').join(', ')}`,
  'general',
  'general'
);

async function ensureCacheDir(collectionKey = 'general') {
  const chain = config.nftContracts[collectionKey.toLowerCase()]?.chain || 'eth';
  const collection = collectionKey.toLowerCase();
  try {
    logger.debug('cache', `Ensuring cache directory at: ${cacheDir}`, chain, collection);
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.chmod(cacheDir, 0o755);
    logger.info('cache', `Created/chmod cache directory: ${cacheDir}`, chain, collection);
  } catch (error) {
    logger.error('cache', `Failed to create/chmod cache directory ${cacheDir}: ${error.message}`, { stack: error.stack }, chain, collection);
    throw error;
  }
}

export async function initializeCache() {
  const collection = 'general';
  const chain = 'general'; // General context for initialization
  try {
    logger.info('cache', `Starting cache initialization, contracts=${Object.keys(config.nftContracts).join(', ')}`, chain, collection);
    await ensureCacheDir();

    const testKey = 'test_node_cache';
    const testValue = { ready: true };
    const nodeCacheSuccess = cache.set(testKey, testValue);
    if (nodeCacheSuccess) {
      logger.info('cache', 'Node-cache is ready', chain, collection);
      cache.del(testKey);
    } else {
      logger.error('cache', 'Node-cache failed to set test key', {}, chain, collection);
    }

    if (redisEnabled && redis) {
      try {
        await redis.set('test_redis', JSON.stringify(testValue));
        const redisData = await redis.get('test_redis');
        if (redisData && JSON.parse(redisData).ready) {
          logger.info('cache', 'Redis cache is ready', chain, collection);
          await redis.del('test_redis');
        } else {
          logger.error('cache', 'Redis cache test failed: invalid data', {}, chain, collection);
        }
      } catch (error) {
        logger.error('cache', `Redis cache test failed: ${error.message}`, { stack: error.stack }, chain, collection);
      }
    }

    const collections = Object.keys(config.nftContracts)
      .filter(key => !config.nftContracts[key].disabled)
      .map(key => key.toLowerCase());
    for (const collectionKey of collections) {
      const chainKey = config.nftContracts[collectionKey]?.chain || 'eth';
      const cacheFile = path.join(cacheDir, `${collectionKey}_holders.json`);
      logger.debug('cache', `Checking cache file for ${collectionKey}: ${cacheFile}`, chainKey, collectionKey);
      try {
        await fs.access(cacheFile);
        logger.info('cache', `Cache file exists: ${cacheFile}`, chainKey, collectionKey);
      } catch (error) {
        if (error.code === 'ENOENT') {
          await ensureCacheDir(collectionKey);
          await fs.writeFile(cacheFile, JSON.stringify({ holders: [], totalBurned: 0, timestamp: Date.now() }));
          await fs.chmod(cacheFile, 0o644);
          logger.info('cache', `Created empty cache file: ${cacheFile}`, chainKey, collectionKey);
        } else {
          logger.error('cache', `Failed to access cache file ${cacheFile}: ${error.message}`, { stack: error.stack }, chainKey, collectionKey);
        }
      }
    }

    logger.info('cache', 'Cache initialization completed', chain, collection);
    return true;
  } catch (error) {
    logger.error('cache', `Cache initialization error: ${error.message}`, { stack: error.stack }, chain, collection);
    return false;
  }
}

export async function getCache(key, prefix) {
  const chain = config.nftContracts[prefix.toLowerCase()]?.chain || 'eth';
  try {
    const cacheKey = `${prefix}_${key}`;
    let data = cache.get(cacheKey);
    if (data !== undefined) {
      logger.debug(
        'cache',
        `Cache hit: ${cacheKey}, holders: ${data.holders?.length || 'unknown'}`,
        chain,
        prefix.toLowerCase()
      );
      return data;
    }

    if (key === `${prefix.toLowerCase()}_holders` && Object.keys(config.nftContracts).map(k => k.toLowerCase()).includes(prefix.toLowerCase())) {
      if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
        try {
          logger.debug('cache', `Attempting to load ${cacheKey} from Redis`, chain, prefix.toLowerCase());
          const redisData = await redis.get(cacheKey);
          if (redisData) {
            const parsed = typeof redisData === 'string' ? JSON.parse(redisData) : redisData;
            if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
              const success = cache.set(cacheKey, parsed);
              logger.info(
                'cache',
                `Loaded ${cacheKey} from Redis, cached: ${success}, holders: ${parsed.holders.length}`,
                chain,
                prefix.toLowerCase()
              );
              return parsed;
            } else {
              logger.warn('cache', `Invalid data in Redis for ${cacheKey}`, chain, prefix.toLowerCase());
            }
          }
        } catch (error) {
          logger.error(
            'cache',
            `Failed to load cache from Redis for ${cacheKey}: ${error.message}`,
            { stack: error.stack },
            chain,
            prefix.toLowerCase()
          );
        }
      }

      const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_holders.json`);
      logger.debug('cache', `Attempting to read cache from ${cacheFile}`, chain, prefix.toLowerCase());
      try {
        const fileData = await fs.readFile(cacheFile, 'utf8');
        const parsed = JSON.parse(fileData);
        if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
          const success = cache.set(cacheKey, parsed);
          logger.info(
            'cache',
            `Loaded ${cacheKey} from ${cacheFile}, cached: ${success}, holders: ${parsed.holders.length}`,
            chain,
            prefix.toLowerCase()
          );
          return parsed;
        } else {
          logger.warn('cache', `Invalid data in ${cacheFile}`, chain, prefix.toLowerCase());
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error(
            'cache',
            `Failed to load cache from ${cacheFile}: ${error.message}`,
            { stack: error.stack },
            chain,
            prefix.toLowerCase()
          );
        } else {
          logger.debug('cache', `No cache file at ${cacheFile}`, chain, prefix.toLowerCase());
        }
      }
    }

    logger.info('cache', `Cache miss: ${cacheKey}`, chain, prefix.toLowerCase());
    return null;
  } catch (error) {
    logger.error('cache', `Failed to get cache ${prefix}_${key}: ${error.message}`, { stack: error.stack }, chain, prefix.toLowerCase());
    return null;
  }
}

export async function setCache(key, value, ttl, prefix) {
  const chain = config.nftContracts[prefix.toLowerCase()]?.chain || 'eth';
  try {
    const cacheKey = `${prefix}_${key}`;
    const success = cache.set(cacheKey, value); // NodeCache
    logger.info(
      'cache',
      `Set in-memory cache: ${cacheKey}, success: ${success}, holders: ${value.holders?.length || 'unknown'}`,
      chain,
      prefix.toLowerCase()
    );

    if (key === `${prefix.toLowerCase()}_holders` && Object.keys(config.nftContracts).map(k => k.toLowerCase()).includes(prefix.toLowerCase())) {
      const holdersCount = value.holders ? value.holders.length : 0;
      logger.info(
        'cache',
        `Persisting ${cacheKey} with ${holdersCount} holders, data: ${JSON.stringify(value).slice(0, 1000)}...`,
        chain,
        prefix.toLowerCase()
      );

      // Write to Redis if enabled
      if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
        try {
          logger.debug('cache', `Attempting to persist ${cacheKey} to Redis`, chain, prefix.toLowerCase());
          await redis.set(cacheKey, JSON.stringify(value));
          logger.info(
            'cache',
            `Persisted ${cacheKey} to Redis, holders: ${holdersCount}`,
            chain,
            prefix.toLowerCase()
          );
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
        logger.debug('cache', `Redis disabled for ${prefix} or not enabled, using filesystem`, chain, prefix.toLowerCase());
      }

      // Always write holders to filesystem
      const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_holders.json`);
      logger.debug('cache', `Attempting to write ${cacheKey} to ${cacheFile}`, chain, prefix.toLowerCase());
      await ensureCacheDir(prefix);
      try {
        await fs.writeFile(cacheFile, JSON.stringify(value, null, 2));
        await fs.chmod(cacheFile, 0o644);
        logger.info(
          'cache',
          `Persisted ${cacheKey} to ${cacheFile}, holders: ${holdersCount}`,
          chain,
          prefix.toLowerCase()
        );
      } catch (error) {
        logger.error(
          'cache',
          `Failed to write cache file ${cacheFile}: ${error.message}`,
          { stack: error.stack },
          chain,
          prefix.toLowerCase()
        );
        throw error;
      }
    }
    // Non-holders keys are only stored in NodeCache (unless custom logic exists for events)
    return success;
  } catch (error) {
    logger.error('cache', `Failed to set cache ${prefix}_${key}: ${error.message}`, { stack: error.stack }, chain, prefix.toLowerCase());
    return false;
  }
}

export async function saveCacheState(key, state, prefix) {
  const chain = config.nftContracts[prefix.toLowerCase()]?.chain || 'eth';
  try {
    const cacheKey = `state_${key}`;
    cache.set(cacheKey, state, 0);
    if (redisEnabled && redis) {
      await redis.set(`state:${key}`, JSON.stringify(state), 'EX', 0);
    }
    logger.debug('cache', `Saved cache state for key: ${key}`, chain, prefix.toLowerCase());
    return true;
  } catch (error) {
    logger.error('cache', `Failed to save cache state for ${key}: ${error.message}`, { stack: error.stack }, chain, prefix.toLowerCase());
    throw error;
  }
}

export async function loadCacheState(key, prefix) {
  const chain = config.nftContracts[prefix.toLowerCase()]?.chain || 'eth';
  try {
    const cacheKey = `state_${key}`;
    let state = cache.get(cacheKey);
    if (state === undefined && redisEnabled && redis) {
      const redisData = await redis.get(`state:${key}`);
      state = redisData ? JSON.parse(redisData) : null;
      if (state) cache.set(cacheKey, state, 0);
    }
    logger.debug('cache', `Loaded cache state for key: ${key}`, chain, prefix.toLowerCase());
    return state;
  } catch (error) {
    logger.error('cache', `Failed to load cache state for ${key}: ${error.message}`, { stack: error.stack }, chain, prefix.toLowerCase());
    return null;
  }
}

export async function getTransactionReceipt(transactionHash) {
  try {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    logger.debug('utils', `Fetched transaction receipt for ${transactionHash}`, 'eth', 'general');
    return receipt;
  } catch (error) {
    logger.error('utils', `Failed to fetch transaction receipt for ${transactionHash}: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    throw error;
  }
}

export async function validateContract(contractKey) {
  const chain = config.nftContracts[contractKey.toLowerCase()]?.chain || 'eth';
  const collection = contractKey.toLowerCase();
  try {
    // Log available contract keys for debugging
    const availableContracts = Object.keys(config.nftContracts);
    logger.debug(
      'cache',
      `Validating contract: received contractKey=${contractKey}, available contracts=${availableContracts.join(', ')}`,
      chain,
      collection
    );

    // Try exact match first
    let contractConfig = config.nftContracts[contractKey.toLowerCase()];
    let contractName = contractConfig?.name || contractKey;

    // If not found, try case-insensitive match
    if (!contractConfig) {
      const lowerKey = contractKey.toLowerCase();
      const matchingKey = availableContracts.find(key => key.toLowerCase() === lowerKey);
      if (matchingKey) {
        contractConfig = config.nftContracts[matchingKey];
        contractName = contractConfig.name || matchingKey;
        logger.warn(
          'cache',
          `Case mismatch for contractKey=${contractKey}, using matching key=${matchingKey}`,
          chain,
          collection
        );
      }
    }

    if (!contractConfig || !contractConfig.contractAddress) {
      logger.error(
        'cache',
        `No configuration found for contract key: ${contractKey}. Available contracts: ${JSON.stringify(Object.keys(config.nftContracts))}`,
        { configKeys: Object.keys(config.nftContracts), config: config.nftContracts },
        chain,
        collection
      );
      return false;
    }

    const address = contractConfig.contractAddress;
    logger.debug(
      'cache',
      `Validating contract: key=${contractKey}, name=${contractName}, address=${address}`,
      chain,
      collection
    );

    try {
      // Validate address format
      const formattedAddress = getAddress(address);
      if (!formattedAddress) {
        logger.error(
          'cache',
          `Invalid contract address format for ${contractName} (${contractKey}): ${address}`,
          {},
          chain,
          collection
        );
        return false;
      }

      const code = await client.getBytecode({ address: formattedAddress });
      const isValid = !!code && code !== '0x';
      logger.info(
        'cache',
        `Contract validation for ${contractName} (${address}): ${isValid ? 'valid' : 'invalid'}`,
        chain,
        collection
      );
      return isValid;
    } catch (error) {
      logger.error(
        'cache',
        `Failed to validate contract ${contractName} (${address}): ${error.message}`,
        { stack: error.stack },
        chain,
        collection
      );
      return false;
    }
  } catch (error) {
    logger.error(
      'cache',
      `Unexpected error validating contract ${contractKey}: ${error.message}`,
      { stack: error.stack },
      chain,
      collection
    );
    return false;
  }
}