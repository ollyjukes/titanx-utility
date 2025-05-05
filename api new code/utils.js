// app/api/utils.js
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Redis } from '@upstash/redis';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy } from 'alchemy-sdk';
import config from '@/contracts/config';
import pLimit from 'p-limit';
import { logger } from '@/app/lib/logger';
import chalk from 'chalk';

console.log(chalk.cyan('[Utils] Initializing utils...'));
logger.info('utils', 'Utils module loaded', 'eth', 'general').catch(error => {
  console.error(chalk.red('[Utils] Logger error:'), error.message);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDebug = process.env.DEBUG === 'true';
const isProduction = process.env.NODE_ENV === 'production';

const cache = new NodeCache({
  stdTTL: 0,
  checkperiod: 120,
});

// Resolve cacheDir relative to project root
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
    logger.info('utils', 'Upstash Redis initialized', 'eth', 'general');
  } catch (error) {
    logger.error('utils', `Failed to initialize Upstash Redis: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    redis = null;
  }
}

const alchemyApiKey = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('utils', 'Alchemy API key is missing', {}, 'eth', 'general');
  throw new Error('Alchemy API key is missing');
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
});

const alchemy = new Alchemy({
  apiKey: config.alchemy.apiKey,
  network: 'eth-mainnet',
});

async function ensureCacheDir() {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.chmod(cacheDir, 0o755);
    logger.info('utils', `Created/chmod cache directory: ${cacheDir}`, 'eth', 'general');
  } catch (error) {
    logger.error('utils', `Failed to create/chmod cache directory ${cacheDir}: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    throw error;
  }
}

async function initializeCache() {
  try {
    logger.info('utils', 'Starting cache initialization', 'eth', 'general');
    await ensureCacheDir();

    const testKey = 'test_node_cache';
    const testValue = { ready: true };
    const nodeCacheSuccess = cache.set(testKey, testValue);
    if (nodeCacheSuccess) {
      logger.info('utils', 'Node-cache is ready', 'eth', 'general');
      cache.del(testKey);
    } else {
      logger.error('utils', 'Node-cache failed to set test key', {}, 'eth', 'general');
    }

    if (redisEnabled && redis) {
      try {
        await redis.set('test_redis', JSON.stringify(testValue));
        const redisData = await redis.get('test_redis');
        if (redisData && JSON.parse(redisData).ready) {
          logger.info('utils', 'Redis cache is ready', 'eth', 'general');
          await redis.del('test_redis');
        } else {
          logger.error('utils', 'Redis cache test failed: invalid data', {}, 'eth', 'general');
        }
      } catch (error) {
        logger.error('utils', `Redis cache test failed: ${error.message}`, { stack: error.stack }, 'eth', 'general');
      }
    }

    const collections = Object.keys(config.nftContracts).filter(key => !config.nftContracts[key].disabled).map(key => key.toLowerCase());
    for (const collection of collections) {
      const cacheFile = path.join(cacheDir, `${collection}_holders.json`);
      try {
        await fs.access(cacheFile);
        logger.info('utils', `Cache file exists: ${cacheFile}`, 'eth', collection);
      } catch (error) {
        if (error.code === 'ENOENT') {
          await fs.writeFile(cacheFile, JSON.stringify({ holders: [], totalBurned: 0, timestamp: Date.now() }));
          await fs.chmod(cacheFile, 0o644);
          logger.info('utils', `Created empty cache file: ${cacheFile}`, 'eth', collection);
        } else {
          logger.error('utils', `Failed to access cache file ${cacheFile}: ${error.message}`, { stack: error.stack }, 'eth', collection);
        }
      }
    }

    logger.info('utils', 'Cache initialization completed', 'eth', 'general');
    return true;
  } catch (error) {
    logger.error('utils', `Cache initialization error: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    return false;
  }
}

async function retry(operation, { retries, delay = 1000 }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt === retries) {
        logger.error('utils', `Circuit breaker: Rate limit exceeded after ${retries} attempts`, {}, 'eth', 'general');
        throw new Error('Rate limit exceeded');
      }
      logger.warn('utils', `Retry attempt ${attempt}/${retries} failed: ${error.message}`, 'eth', 'general');
      await new Promise(resolve => setTimeout(resolve, delay * Math.min(attempt, 3)));
    }
  }
  throw lastError;
}

async function batchMulticall(calls, batchSize = config.alchemy.batchSize || 10) {
  const results = [];
  const delay = async () => new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs || 500));

  const concurrencyLimit = pLimit(3);
  const batchPromises = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    batchPromises.push(
      concurrencyLimit(async () => {
        try {
          await delay();
          const batchResults = await client.multicall({
            contracts: batch.map(call => ({
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args || [],
            })),
            allowFailure: true,
          });

          const batchResult = batchResults.map((result, index) => ({
            status: result.status === 'success' ? 'success' : 'failure',
            result: result.status === 'success' ? result.result : null,
            error: result.status === 'failure' ? result.error?.message || 'Unknown error' : null,
          }));
          return batchResult;
        } catch (error) {
          logger.error('utils', `Batch multicall failed: ${error.message}`, { stack: error.stack }, 'eth', 'general');
          return batch.map(() => ({
            status: 'failure',
            result: null,
            error: error.message,
          }));
        }
      })
    );
  }

  const batchResults = (await Promise.all(batchPromises)).flat();
  results.push(...batchResults);
  return results;
}

async function getOwnersForContract(contractAddress, abi, options = {}) {
  let owners = [];
  let pageKey = options.pageKey || null;
  const maxPages = options.maxPages || 10;

  let pageCount = 0;

  do {
    try {
      const response = await alchemy.nft.getOwnersForContract(contractAddress, {
        withTokenBalances: options.withTokenBalances || false,
        pageKey,
      });

      if (!response.owners || !Array.isArray(response.owners)) {
        logger.error('utils', `Invalid Alchemy response for ${contractAddress}: ${JSON.stringify(response)}`, {}, 'eth', 'general');
        throw new Error('Invalid owners response from Alchemy API');
      }

      for (const owner of response.owners) {
        const tokenBalances = owner.tokenBalances || [];
        if (tokenBalances.length > 0) {
          const validBalances = tokenBalances.filter(
            tb => tb.tokenId && Number(tb.balance) > 0
          );
          if (validBalances.length > 0) {
            owners.push({
              ownerAddress: owner.ownerAddress.toLowerCase(),
              tokenBalances: validBalances.map(tb => ({
                tokenId: Number(tb.tokenId),
                balance: Number(tb.balance),
              })),
            });
          }
        }
      }

      pageKey = response.pageKey || null;
      pageCount++;
      if (pageCount >= maxPages) {
        logger.warn('utils', `Reached max pages (${maxPages}) for owner fetching`, 'eth', 'general');
        break;
      }
    } catch (error) {
      logger.error('utils', `Failed to fetch owners for ${contractAddress}: ${error.message}`, { stack: error.stack }, 'eth', 'general');
      throw error;
    }
  } while (pageKey);

  logger.info('utils', `Fetched ${owners.length} owners for contract: ${contractAddress}`, 'eth', 'general');
  return owners;
}

async function setCache(key, value, ttl, prefix) {
  try {
    const cacheKey = `${prefix}_${key}`;
    const success = cache.set(cacheKey, value);
    logger.info('utils', `Set in-memory cache: ${cacheKey}, success: ${success}, holders: ${value.holders?.length || 'unknown'}`, 'eth', prefix.toLowerCase());

    if (key === `${prefix.toLowerCase()}_holders` && Object.keys(config.nftContracts).map(k => k.toLowerCase()).includes(prefix.toLowerCase())) {
      if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
        try {
          await redis.set(cacheKey, JSON.stringify(value));
          logger.info('utils', `Persisted ${cacheKey} to Redis, holders: ${value.holders.length}`, 'eth', prefix.toLowerCase());
        } catch (error) {
          logger.error('utils', `Failed to persist ${cacheKey} to Redis: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
        }
      } else {
        const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_holders.json`);
        logger.info('utils', `Writing to cache file: ${cacheFile}`, 'eth', prefix.toLowerCase());
        await ensureCacheDir();
        try {
          await fs.writeFile(cacheFile, JSON.stringify(value));
          await fs.chmod(cacheFile, 0o644);
          logger.info('utils', `Persisted ${cacheKey} to ${cacheFile}, holders: ${value.holders.length}`, 'eth', prefix.toLowerCase());
        } catch (error) {
          logger.error('utils', `Failed to write cache file ${cacheFile}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
          throw error;
        }
      }
    }
    return success;
  } catch (error) {
    logger.error('utils', `Failed to set cache ${prefix}_${key}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
    return false;
  }
}

async function getCache(key, prefix) {
  try {
    const cacheKey = `${prefix}_${key}`;
    let data = cache.get(cacheKey);
    if (data !== undefined) {
      logger.debug('utils', `Cache hit: ${cacheKey}, holders: ${data.holders?.length || 'unknown'}`, 'eth', prefix.toLowerCase());
      return data;
    }

    if (key === `${prefix.toLowerCase()}_holders` && Object.keys(config.nftContracts).map(k => k.toLowerCase()).includes(prefix.toLowerCase())) {
      if (redisEnabled && redis && process.env[`DISABLE_${prefix.toUpperCase()}_REDIS`] !== 'true') {
        try {
          const redisData = await redis.get(cacheKey);
          if (redisData) {
            const parsed = typeof redisData === 'string' ? JSON.parse(redisData) : redisData;
            if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
              const success = cache.set(cacheKey, parsed);
              logger.info('utils', `Loaded ${cacheKey} from Redis, cached: ${success}, holders: ${parsed.holders.length}`, 'eth', prefix.toLowerCase());
              return parsed;
            } else {
              logger.warn('utils', `Invalid data in Redis for ${cacheKey}`, 'eth', prefix.toLowerCase());
            }
          }
        } catch (error) {
          logger.error('utils', `Failed to load cache from Redis for ${cacheKey}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
        }
      }

      const cacheFile = path.join(cacheDir, `${prefix.toLowerCase()}_holders.json`);
      try {
        const fileData = await fs.readFile(cacheFile, 'utf8');
        const parsed = JSON.parse(fileData);
        if (parsed && Array.isArray(parsed.holders) && Number.isInteger(parsed.totalBurned)) {
          const success = cache.set(cacheKey, parsed);
          logger.info('utils', `Loaded ${cacheKey} from ${cacheFile}, cached: ${success}, holders: ${parsed.holders.length}`, 'eth', prefix.toLowerCase());
          return parsed;
        } else {
          logger.warn('utils', `Invalid data in ${cacheFile}`, 'eth', prefix.toLowerCase());
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          logger.error('utils', `Failed to load cache from ${cacheFile}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
        } else {
          logger.debug('utils', `No cache file at ${cacheFile}`, 'eth', prefix.toLowerCase());
        }
      }
    }

    logger.info('utils', `Cache miss: ${cacheKey}`, 'eth', prefix.toLowerCase());
    return null;
  } catch (error) {
    logger.error('utils', `Failed to get cache ${prefix}_${key}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
    return null;
  }
}

async function saveCacheState(collection, state, prefix) {
  try {
    const cacheFile = path.join(cacheDir, `cache_state_${prefix.toLowerCase()}.json`);
    await ensureCacheDir();
    await fs.writeFile(cacheFile, JSON.stringify(state, null, 2));
    await fs.chmod(cacheFile, 0o644);
    logger.debug('utils', `Saved cache state for ${prefix}: ${cacheFile}`, 'eth', prefix.toLowerCase());
  } catch (error) {
    logger.error('utils', `Failed to save cache state for ${prefix}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
  }
}

async function loadCacheState(collection, prefix) {
  try {
    const cacheFile = path.join(cacheDir, `cache_state_${prefix.toLowerCase()}.json`);
    const data = await fs.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(data);
    logger.debug('utils', `Loaded cache state for ${prefix}: ${cacheFile}`, 'eth', prefix.toLowerCase());
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.debug('utils', `No cache state found for ${prefix}, initializing new state`, 'eth', prefix.toLowerCase());
      // Initialize a default cache state
      const defaultState = {
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
      await saveCacheState(collection, defaultState, prefix); // Create the file
      return defaultState;
    }
    logger.error('utils', `Failed to load cache state for ${prefix}: ${error.message}`, { stack: error.stack }, 'eth', prefix.toLowerCase());
    return null;
  }
}

async function getTransactionReceipt(transactionHash) {
  try {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    logger.debug('utils', `Fetched transaction receipt for ${transactionHash}`, 'eth', 'general');
    return receipt;
  } catch (error) {
    logger.error('utils', `Failed to fetch transaction receipt for ${transactionHash}: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    throw error;
  }
}

async function validateContract(contractKey) {
  const normalizedKey = contractKey.toLowerCase();
  if (!config.contractDetails[normalizedKey]) {
    throw new Error(`Invalid contract: ${normalizedKey}`);
  }
  if (config.contractDetails[normalizedKey].disabled) {
    throw new Error(`${normalizedKey} contract not deployed`);
  }
  return {
    contractAddress: config.contractAddresses[normalizedKey]?.address,
    abi: config.abis[normalizedKey]?.main,
  };
}

export {
  client,
  retry,
  logger,
  getCache,
  setCache,
  saveCacheState,
  loadCacheState,
  batchMulticall,
  getOwnersForContract,
  getTransactionReceipt,
  initializeCache,
  validateContract
};