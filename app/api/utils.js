// ./app/api/utils.js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { Redis } from '@upstash/redis';
import NodeCache from 'node-cache';
import pino from 'pino';
import { promises as fs } from 'fs';
import config from '@/config.js';
import { Network, Alchemy } from 'alchemy-sdk';

// Singleton logger instance
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
    // Conditionally apply pino-pretty in development only
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
  } catch (error) {
    console.error('[utils] Failed to initialize logger:', error.message);
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
  } catch (error) {
    console.error('[utils] Logger error:', error.message);
  }
}

// ... (rest of utils.js remains unchanged)

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
  if (!data && !config.cache.redis.disableElement280) {
    try {
      data = await redis?.get(key);
      data = data ? JSON.parse(data) : null;
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
  if (!config.cache.redis.disableElement280) {
    try {
      await redis?.set(key, JSON.stringify(value), 'EX', ttl);
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
  if (!state && !config.cache.redis.disableElement280) {
    state = await redis?.get(cacheKey);
    state = state ? JSON.parse(state) : null;
  }
  if (!state && process.env.NODE_ENV !== 'production') {
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
  if (DEBUG) {
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
  if (process.env.NODE_ENV !== 'production') {
    try {
      await fs.writeFile(`./cache_state_${contractAddress}.json`, JSON.stringify(state, null, 2));
    } catch (error) {
      log(`[utils] [ERROR] Failed to write cache state to file: ${error.message}`);
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
  } catch (error) {
    log(`[utils] [ERROR] Failed to fetch NFTs for owner ${ownerAddress}: ${error.message}`);
    throw error;
  }
}

export async function getOwnersForContract(contractAddress, abi, fromBlock = 0n) {
  const useAlchemy = process.env.USE_ALCHEMY_FOR_OWNERS === 'true';
  log(`[utils] [INFO] Fetching owners for contract ${contractAddress} using ${useAlchemy ? 'Alchemy SDK' : 'viem'}`);

  if (useAlchemy) {
    try {
      const response = await alchemy.nft.getOwnersForContract(contractAddress, {
        withTokenBalances: true,
      });
      const owners = response.owners.flatMap(owner => {
        const tokenBalances = owner.tokenBalances || [];
        return tokenBalances.map(balance => ({
          ownerAddress: owner.ownerAddress.toLowerCase(),
          tokenId: balance.tokenId,
        }));
      });
      if (DEBUG) {
        log(`[utils] [DEBUG] Fetched ${owners.length} owner-token pairs via Alchemy for contract ${contractAddress}`);
      }
      return owners;
    } catch (alchemyError) {
      log(`[utils] [ERROR] Alchemy failed for contract ${contractAddress}: ${alchemyError.message}`);
      throw new Error(`Failed to fetch owners via Alchemy: ${alchemyError.message}`);
    }
  } else {
    try {
      const fromBlockValue = config.deploymentBlocks.element369?.block || 0n;
      if (DEBUG) {
        log(`[utils] [DEBUG] Fetching logs for contract ${contractAddress} from block ${fromBlockValue}`);
        log(`[utils] [DEBUG] ABI passed: ${JSON.stringify(abi.filter(item => item.type === 'event').map(item => item.name))}`);
      }
      const logs = await client.getLogs({
        address: contractAddress,
        event: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']),
        fromBlock: BigInt(fromBlockValue),
      });
      const owners = {};
      logs.forEach(log => {
        const { tokenId, to } = log.args;
        if (to !== '0x0000000000000000000000000000000000000000') {
          owners[tokenId.toString()] = { ownerAddress: to, tokenId: tokenId.toString() };
        } else {
          delete owners[tokenId.toString()];
        }
      });
      if (DEBUG) {
        log(`[utils] [DEBUG] Fetched ${Object.keys(owners).length} owners for contract ${contractAddress}`);
      }
      return Object.values(owners);
    } catch (error) {
      log(`[utils] [ERROR] Failed to fetch owners for contract ${contractAddress}: ${error.message}`);
      throw error;
    }
  }
}

export async function getTransactionReceipt(txHash) {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (DEBUG) {
      log(`[utils] [DEBUG] Fetched transaction receipt for hash ${txHash}`);
    }
    return receipt;
  } catch (error) {
    log(`[utils] [ERROR] Failed to fetch transaction receipt for hash ${txHash}: ${error.message}`);
    throw error;
  }
}

export async function safeSerialize(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
  );
}