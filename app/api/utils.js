// app/api/utils.js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { Redis } from '@upstash/redis';
import NodeCache from 'node-cache';
import pino from 'pino';
import { promises as fs } from 'fs';
import config from '@/config.js';
import { Network, Alchemy } from 'alchemy-sdk';

let loggerInstance = null;

const ALCHEMY_API_KEY = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
    timeout: 60000,
  }),
});

const alchemy = new Alchemy({
  apiKey: ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

const DEBUG = process.env.DEBUG === 'true';
const isProduction = process.env.NODE_ENV === 'production';

export const logger = (() => {
  if (loggerInstance) {
    if (DEBUG) console.log('[utils] [DEBUG] Reusing existing logger instance');
    return loggerInstance;
  }
  loggerInstance = pino({
    level: DEBUG ? 'debug' : 'error',
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(!isProduction
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'yyyy-mm-dd HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
  try {
    if (DEBUG) loggerInstance.debug('[utils] Pino logger initialized');
    console.log('[utils] Pino logger initialized (console)');
  } catch (_error) {
    console.error('[utils] Failed to initialize logger:', _error.message);
  }
  return loggerInstance;
})();

export function log(message) {
  try {
    if (message.includes('[ERROR]') || message.includes('[VALIDATION]')) {
      logger.error(message);
    } else if (DEBUG) {
      logger.debug(message);
    }
  } catch (_error) {
    console.error('[utils] Logger error:', _error.message);
  }
}

const cache = new NodeCache({
  stdTTL: config.cache.nodeCache.stdTTL,
  checkperiod: config.cache.nodeCache.checkperiod,
});

const redisDisableFlags = {
  element280: process.env.DISABLE_ELEMENT280_REDIS === 'true',
  element369: process.env.DISABLE_ELEMENT369_REDIS === 'true',
  stax: process.env.DISABLE_STAX_REDIS === 'true',
  ascendant: process.env.DISABLE_ASCENDANT_REDIS === 'true',
  e280: process.env.DISABLE_E280_REDIS === 'true' || true,
};

let redis = null;
const allRedisDisabled = Object.values(redisDisableFlags).every(flag => flag);
if (!allRedisDisabled) {
  try {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL || config.redis?.url;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || config.redis?.token;
    if (redisUrl && redisToken) {
      redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });
      if (DEBUG) log('[utils] [DEBUG] Upstash Redis initialized');
    } else {
      log('[utils] [ERROR] Redis initialization skipped: missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
    }
  } catch (_error) {
    log(`[utils] [ERROR] Failed to initialize Redis: ${_error.message}`);
    redis = null;
  }
} else {
  if (DEBUG) log('[utils] [DEBUG] Redis skipped: all collections have Redis disabled');
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function batchMulticall(calls, batchSize = config.alchemy.batchSize, options = { retryCount: 0 }) {
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
        return batchMulticall(calls, batchSize, { retryCount: options.retryCount + 1 });
      }
      throw error;
    }
  }
  return results;
}

export async function getCache(key) {
  let data = cache.get(key);
  if (!data && redis && !redisDisableFlags[key.split('_')[0]]) {
    try {
      data = await redis.get(key);
      data = data ? JSON.parse(data) : null;
      if (data) cache.set(key, data);
    } catch (error) {
      log(`[utils] [ERROR] Redis get failed for key ${key}: ${error.message}`);
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Cache get for ${key}: ${data ? 'hit' : 'miss'}`);
  }
  return data;
}

export async function setCache(key, value, ttl = config.cache.nodeCache.stdTTL) {
  cache.set(key, value, ttl);
  if (redis && !redisDisableFlags[key.split('_')[0]]) {
    try {
      await redis.set(key, JSON.stringify(value), { ex: ttl });
    } catch (error) {
      log(`[utils] [ERROR] Redis set failed for key ${key}: ${error.message}`);
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Cache set for ${key}`);
  }
}

export async function loadCacheState(contractAddress) {
  const cacheKey = `state_${contractAddress}`;
  let state = cache.get(cacheKey);
  const collection = Object.keys(config.contractAddresses).find(col => config.contractAddresses[col].address === contractAddress);
  const disableRedis = collection ? redisDisableFlags[collection] : true;
  if (!state && redis && !disableRedis) {
    try {
      state = await redis.get(cacheKey);
      state = state ? JSON.parse(state) : null;
    } catch (error) {
      log(`[utils] [ERROR] Redis get failed for key ${cacheKey}: ${error.message}`);
    }
  }
  if (!state && process.env.NODE_ENV !== 'production') {
    try {
      state = JSON.parse(await fs.readFile(`./cache_state_${contractAddress}.json`, 'utf8'));
    } catch (_error) {
      log(`[utils] [ERROR] Failed to read cache state file for ${contractAddress}: ${_error.message}`);
      state = {
        isCachePopulating: false,
        holdersMapCache: null,
        totalOwners: 0,
        progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 },
      };
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Loaded cache state for ${cacheKey}: ${JSON.stringify(state)}`);
  }
  return state;
}

export async function saveCacheState(contractAddress, state) {
  const cacheKey = `state_${contractAddress}`;
  cache.set(cacheKey, state);
  const collection = Object.keys(config.contractAddresses).find(col => config.contractAddresses[col].address === contractAddress);
  const disableRedis = collection ? redisDisableFlags[collection] : true;
  if (redis && !disableRedis) {
    try {
      await redis.set(cacheKey, JSON.stringify(state));
    } catch (error) {
      log(`[utils] [ERROR] Redis set failed for key ${cacheKey}: ${error.message}`);
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    try {
      await fs.writeFile(`./cache_state_${contractAddress}.json`, JSON.stringify(state, null, 2));
    } catch (_error) {
      log(`[utils] [ERROR] Failed to write cache state to file: ${_error.message}`);
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Saved cache state for ${cacheKey}`);
  }
}

export async function getNftsForOwner(ownerAddress, contractAddress, abi) {
  try {
    const contract = {
      address: contractAddress,
      abi: parseAbi(abi),
    };
    const balance = await client.readContract({
      ...contract,
      functionName: 'balanceOf',
      args: [ownerAddress],
    });
    const tokenIds = [];
    for (let i = 0; i < Number(balance); i++) {
      const tokenId = await client.readContract({
        ...contract,
        functionName: 'tokenOfOwnerByIndex',
        args: [ownerAddress, BigInt(i)],
      });
      tokenIds.push(tokenId);
    }
    if (DEBUG) {
      log(`[utils] [DEBUG] Fetched ${tokenIds.length} NFTs for owner ${ownerAddress} at contract ${contractAddress}`);
    }
    return tokenIds.map(id => ({ tokenId: id.toString(), balance: 1 }));
  } catch (_error) {
    log(`[utils] [ERROR] Failed to fetch NFTs for owner ${ownerAddress}: ${_error.message}`);
    throw _error;
  }
}

export async function getOwnersForContract(contractAddress, _abi, _fromBlock) {
  try {
    const nfts = await alchemy.nft.getNftsForContract(contractAddress, {
      contractAddress,
      withMetadata: false,
    });
    const owners = nfts.nfts.map(nft => ({
      tokenId: nft.tokenId,
      ownerAddress: nft.owner || '0x0000000000000000000000000000000000000000',
    }));
    if (DEBUG) {
      log(`[utils] [DEBUG] Fetched ${owners.length} owners for contract ${contractAddress}`);
    }
    return owners;
  } catch (_error) {
    log(`[utils] [ERROR] Failed to fetch owners for contract ${contractAddress}: ${_error.message}`);
    throw _error;
  }
}

export async function getTransactionReceipt(transactionHash) {
  const cacheKey = `element280_receipt_${transactionHash}`;
  let receipt = await getCache(cacheKey);
  if (receipt) {
    if (DEBUG) {
      log(`[utils] [DEBUG] Cache hit for transaction receipt: ${transactionHash}`);
    }
    return receipt;
  }

  try {
    receipt = await retry(() => client.getTransactionReceipt({ hash: transactionHash }));
    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }
    await setCache(cacheKey, receipt, config.cache.nodeCache.stdTTL);
    if (DEBUG) {
      log(`[utils] [DEBUG] Fetched and cached transaction receipt: ${transactionHash}`);
    }
    return receipt;
  } catch (_error) {
    log(`[utils] [ERROR] Failed to fetch transaction receipt for ${transactionHash}: ${_error.message}`);
    throw _error;
  }
}

export async function retry(fn, retries = config.alchemy.maxRetries, delayMs = config.alchemy.retryMaxDelayMs / config.alchemy.maxRetries) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      log(`[utils] [ERROR] Retry ${i + 1}/${retries} failed: ${error.message}`);
      if (i < retries - 1) {
        await delay(delayMs);
      }
    }
  }
  throw lastError;
}

export function safeSerialize(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }));
}