// app/api/utils.js
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { Redis } from '@upstash/redis';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config from '@/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDebug = process.env.DEBUG === 'true';
const isProduction = process.env.NODE_ENV === 'production';

// Configure pino logger
const logger = pino({
  level: isDebug ? 'debug' : 'error',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

const cache = new NodeCache({
  stdTTL: 0,
  checkperiod: 120,
});

const cacheDir = path.join(__dirname, '../../cache');
const redisEnabled = process.env.DISABLE_STAX_REDIS !== 'true' && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
let redis = null;

if (redisEnabled) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    logger.info('utils', 'Upstash Redis initialized');
  } catch (error) {
    logger.error('utils', `Failed to initialize Upstash Redis: ${error.message}`, { stack: error.stack });
    redis = null;
  }
}

// Initialize viem client
const alchemyApiKey = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('utils', 'Alchemy API key is missing');
  throw new Error('Alchemy API key is missing');
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
});

// Retry function for blockchain calls
async function retry(operation, { retries, delay = 1000 }) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === retries) {
        logger.error('utils', `Retry failed after ${retries} attempts: ${error.message}`, { stack: error.stack });
        throw error;
      }
      logger.warn('utils', `Retry attempt ${attempt}/${retries} failed: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
}

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.chmod(cacheDir, 0o755);
    logger.debug('utils', `Ensured cache directory: ${cacheDir}`);
  } catch (error) {
    logger.error('utils', `Failed to create/chmod cache directory ${cacheDir}: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

// Initialize cache from disk or Redis
async function initializeCache() {
  try {
    if (redisEnabled && redis) {
      try {
        const data = await redis.get('stax_stax_holders');
        if (data) {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
            const success = cache.set('stax_stax_holders', parsed);
            logger.info('utils', `Initialized cache from Redis: stax_holders, success: ${success}, holders: ${parsed.holders.length}`);
            return true;
          } else {
            logger.warn('utils', 'Invalid cache data in Redis for stax_holders');
          }
        }
      } catch (error) {
        logger.error('utils', `Failed to initialize cache from Redis: ${error.message}`, { stack: error.stack });
      }
    }
    
    await ensureCacheDir();
    const cacheFile = path.join(cacheDir, 'stax_holders.json');
    try {
      const data = await fs.readFile(cacheFile, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
        const success = cache.set('stax_stax_holders', parsed);
        logger.info('utils', `Initialized cache from disk: stax_holders, success: ${success}, holders: ${parsed.holders.length}`);
        return true;
      } else {
        logger.warn('utils', `Invalid cache data in ${cacheFile}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error('utils', `Failed to read cache from ${cacheFile}: ${error.message}`, { stack: error.stack });
      } else {
        logger.debug('utils', `No cache file at ${cacheFile}`);
      }
    }
    return false;
  } catch (error) {
    logger.error('utils', `Cache initialization error: ${error.message}`, { stack: error.stack });
    return false;
  }
}

// Initialize cache on module load
initializeCache().catch(error => {
  logger.error('utils', `Cache initialization failed: ${error.message}`, { stack: error.stack });
});

async function setCache(key, value, ttl, prefix) {
  try {
    const cacheKey = `${prefix}_${key}`;
    const success = cache.set(cacheKey, value);
    logger.debug('utils', `Set cache: ${cacheKey}, success: ${success}, holders: ${value.holders?.length || 'unknown'}`);
    
    if (key === 'stax_holders' && prefix === 'stax') {
      if (redisEnabled && redis) {
        try {
          await redis.set('stax_stax_holders', JSON.stringify(value));
          logger.info('utils', `Persisted stax_holders to Redis, holders: ${value.holders.length}`);
        } catch (error) {
          logger.error('utils', `Failed to persist stax_holders to Redis: ${error.message}`, { stack: error.stack });
        }
      } else {
        const cacheFile = path.join(cacheDir, 'stax_holders.json');
        await ensureCacheDir();
        await fs.writeFile(cacheFile, JSON.stringify(value));
        await fs.chmod(cacheFile, 0o644);
        logger.info('utils', `Persisted stax_holders to ${cacheFile}, holders: ${value.holders.length}`);
      }
    }
    
    return success;
  } catch (error) {
    logger.error('utils', `Failed to set cache ${prefix}_${key}: ${error.message}`, { stack: error.stack });
    return false;
  }
}

async function getCache(key, prefix) {
  try {
    const cacheKey = `${prefix}_${key}`;
    let data = cache.get(cacheKey);
    if (data !== undefined) {
      logger.debug('utils', `Cache hit: ${cacheKey}, holders: ${data.holders?.length || 'unknown'}`);
      return data;
    }

    if (key === 'stax_holders' && prefix === 'stax') {
      if (redisEnabled && redis) {
        try {
          const redisData = await redis.get('stax_stax_holders');
          if (redisData) {
            const parsed = typeof redisData === 'string' ? JSON.parse(redisData) : redisData;
            if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
              const success = cache.set(cacheKey, parsed);
              logger.info('utils', `Loaded stax_holders from Redis, cached: ${success}, holders: ${parsed.holders.length}`);
              return parsed;
            } else {
              logger.warn('utils', `Invalid data in Redis for ${cacheKey}`);
            }
          }
        } catch (error) {
          logger.error('utils', `Failed to load cache from Redis: ${error.message}`, { stack: error.stack });
        }
      }
      
      const cacheFile = path.join(cacheDir, 'stax_holders.json');
      try {
        const fileData = await fs.readFile(cacheFile, 'utf8');
        const parsed = JSON.parse(fileData);
        if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
          const success = cache.set(cacheKey, parsed);
          logger.info('utils', `Loaded stax_holders from ${cacheFile}, cached: ${success}, holders: ${parsed.holders.length}`);
          return parsed;
        } else {
          logger.warn('utils', `Invalid data in ${cacheFile}`);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error('utils', `Failed to load cache from ${cacheFile}: ${error.message}`, { stack: error.stack });
        } else {
          logger.debug('utils', `No cache file at ${cacheFile}`);
        }
      }
    }

    logger.info('utils', `Cache miss: ${cacheKey}`);
    return null;
  } catch (error) {
    logger.error('utils', `Failed to get cache ${prefix}_${key}: ${error.message}`, { stack: error.stack });
    return null;
  }
}

async function saveCacheState(collection, state, prefix) {
  try {
    const cacheFile = path.join(cacheDir, `cache_state_${prefix.toLowerCase()}.json`);
    await ensureCacheDir();
    await fs.writeFile(cacheFile, JSON.stringify(state));
    await fs.chmod(cacheFile, 0o644);
    logger.debug('utils', `Saved cache state for ${prefix}: ${cacheFile}`);
  } catch (error) {
    logger.error('utils', `Failed to save cache state for ${prefix}: ${error.message}`, { stack: error.stack });
  }
}

async function loadCacheState(collection, prefix) {
  try {
    const cacheFile = path.join(cacheDir, `cache_state_${prefix.toLowerCase()}.json`);
    const data = await fs.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(data);
    logger.debug('utils', `Loaded cache state for ${prefix}: ${cacheFile}`);
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.debug('utils', `No cache state found for ${prefix}`);
      return null;
    }
    logger.error('utils', `Failed to load cache state for ${prefix}: ${error.message}`, { stack: error.stack });
    return null;
  }
}

export { client, retry, logger, getCache, setCache, saveCacheState, loadCacheState };