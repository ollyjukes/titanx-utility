import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, alchemy, log, batchMulticall, getCache, setCache } from '../../utils.js'; // Removed CACHE_TTL
import NodeCache from 'node-cache';

// Use config.cache.nodeCache.stdTTL instead of CACHE_TTL
const CACHE_TTL = config.cache.nodeCache.stdTTL;

// Redis toggle
const DISABLE_REDIS = process.env.DISABLE_STAX_REDIS === 'true';

// In-memory cache when Redis is disabled
const inMemoryCache = new NodeCache({ stdTTL: CACHE_TTL });

const contractAddress = config.contractAddresses.stax.address;
const vaultAddress = config.vaultAddresses.stax.address;
const tiersConfig = config.contractTiers.stax;
const defaultPageSize = config.contractDetails.stax.pageSize || 1000;

async function retryAlchemy(fn, attempts = config.alchemy.maxRetries, delayMs = config.alchemy.batchDelayMs) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[Stax] Alchemy retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || defaultPageSize);
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[Stax] Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  try {
    if (!contractAddress || !vaultAddress || !tiersConfig) {
      log(`[Stax] Config error: contractAddress=${contractAddress}, vaultAddress=${vaultAddress}, tiersConfig=${JSON.stringify(tiersConfig)}`);
      throw new Error('Stax contract or vault address missing');
    }

    const cacheKey = `stax_holders_${page}_${pageSize}_${wallet || 'all'}`;
    let cachedData;
    if (!wallet) {
      try {
        if (DISABLE_REDIS) {
          cachedData = inMemoryCache.get(cacheKey);
        } else {
          cachedData = await getCache(cacheKey);
        }
        if (cachedData) {
          log(`[Stax] Returning cached data for ${cacheKey} (Redis=${!DISABLE_REDIS})`);
          return NextResponse.json(cachedData);
        }
      } catch (cacheError) {
        log(`[Stax] Cache read error: ${cacheError.message}`);
      }
    }
    log(`[Stax] Cache miss for ${cacheKey}`);

    // Clear cache for wallet-specific queries
    if (wallet) {
      try {
        if (DISABLE_REDIS) {
          inMemoryCache.del(cacheKey);
        } else {
          await setCache(cacheKey, null);
        }
        log(`[Stax] Cleared cache for ${cacheKey}`);
      } catch (cacheError) {
        log(`[Stax] Cache clear error: ${cacheError.message}`);
      }
    }

    // Fetch totalBurned
    let totalBurned = 0;
    try {
      const burnedResult = await client.readContract({
        address: contractAddress,
        abi: config.abis.stax.main,
        functionName: 'totalBurned',
      });
      totalBurned = Number(burnedResult || 0);
      log(`[Stax] Fetched totalBurned: ${totalBurned}`);
    } catch (error) {
      log(`[Stax] Error fetching totalBurned: ${error.message}`);
      totalBurned = 0;
    }

    // Fetch owners
    const ownersResponse = await retryAlchemy(() =>
      alchemy.nft.getOwnersForContract(contractAddress, {
        block: 'latest',
        withTokenBalances: true,
      })
    );
    log(`[Stax] Owners fetched: ${ownersResponse.owners.length}`);

    const burnAddresses = [
      '0x0000000000000000000000000000000000000000',
      '0x000000000000000000000000000000000000dead',
    ];
    const filteredOwners = wallet
      ? ownersResponse.owners.filter(
          owner => owner.ownerAddress.toLowerCase() === wallet && !burnAddresses.includes(owner.ownerAddress.toLowerCase()) && owner.tokenBalances.length > 0
        )
      : ownersResponse.owners.filter(
          owner => !burnAddresses.includes(owner.ownerAddress.toLowerCase()) && owner.tokenBalances.length > 0
        );
    log(`[Stax] Live owners after filter: ${filteredOwners.length}`);

    // Build token-to-owner map
    const tokenOwnerMap = new Map();
    const ownerTokens = new Map();
    let totalTokens = 0;
    filteredOwners.forEach(owner => {
      const walletAddr = owner.ownerAddress.toLowerCase();
      const tokenIds = owner.tokenBalances.map(tb => BigInt(tb.tokenId));
      tokenIds.forEach(tokenId => {
        tokenOwnerMap.set(tokenId, walletAddr);
        totalTokens++;
      });
      ownerTokens.set(walletAddr, tokenIds);
    });
    log(`[Stax] Total tokens: ${totalTokens}`);

    // Paginate
    let paginatedTokenIds = Array.from(tokenOwnerMap.keys());
    if (!wallet) {
      const start = page * pageSize;
      const end = Math.min(start + pageSize, paginatedTokenIds.length);
      paginatedTokenIds = paginatedTokenIds.slice(start, end);
    }
    log(`[Stax] Paginated tokens: ${paginatedTokenIds.length}`);

    // Fetch tiers
    const tierCalls = paginatedTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: config.abis.stax.main,
      functionName: 'getNftTier',
      args: [tokenId],
    }));
    const tierResults = await batchMulticall(tierCalls);
    const failedTiers = tierResults.filter(r => r.status === 'failure');
    if (failedTiers.length) {
      log(`[Stax] Failed tier calls: ${failedTiers.map(r => r.error).join(', ')}`);
    }
    log(`[Stax] Tiers fetched for ${tierResults.length} tokens`);

    // Log tier results
    tierResults.forEach((result, i) => {
      const tokenId = paginatedTokenIds[i];
      if (result?.status === 'success') {
        log(`[Stax] Token ${tokenId}: Tier ${result.result}`);
      } else {
        log(`[Stax] Tier fetch failed for token ${tokenId}: ${result?.error || 'Unknown'}`);
      }
    });

    // Build holders
    const maxTier = Math.max(...Object.keys(tiersConfig).map(Number));
    const holdersMap = new Map();

    tierResults.forEach((result, i) => {
      if (result?.status === 'success') {
        const tokenId = paginatedTokenIds[i];
        const walletAddr = tokenOwnerMap.get(tokenId);
        const tier = Number(result.result);

        if (tier >= 1 && tier <= maxTier && walletAddr) {
          if (!holdersMap.has(walletAddr)) {
            holdersMap.set(walletAddr, {
              wallet: walletAddr,
              total: 0,
              multiplierSum: 0,
              tiers: Array(maxTier).fill(0),
              claimableRewards: 0,
            });
          }
          const holder = holdersMap.get(walletAddr);
          holder.total += 1;
          holder.multiplierSum += tiersConfig[tier]?.multiplier || 0;
          holder.tiers[tier - 1] += 1;
        } else {
          log(`[Stax] Invalid tier ${tier} for token ${tokenId}`);
        }
      } else {
        log(`[Stax] Tier fetch failed for token ${paginatedTokenIds[i]}: ${result?.error || 'Unknown'}`);
      }
    });

    // Fetch rewards
    let holders = Array.from(holdersMap.values());
    const rewardCalls = holders.map(holder => {
      const tokenIds = ownerTokens.get(holder.wallet) || [];
      return {
        address: vaultAddress,
        abi: config.abis.stax.vault,
        functionName: 'getRewards',
        args: [tokenIds, holder.wallet],
      };
    });

    const totalRewardPoolCall = {
      address: vaultAddress,
      abi: config.abis.stax.vault,
      functionName: 'totalRewardPool',
      args: [],
    };

    log(`[Stax] Fetching rewards for ${holders.length} holders`);
    const [rewardResults, totalRewardPoolResult] = await Promise.all([
      rewardCalls.length ? batchMulticall(rewardCalls) : [],
      batchMulticall([totalRewardPoolCall]),
    ]);

    const failedRewards = rewardResults.filter(r => r.status === 'failure');
    if (failedRewards.length) {
      log(`[Stax] Failed reward calls: ${failedRewards.map(r => r.error).join(', ')}`);
    }

    const totalRewardPool = totalRewardPoolResult[0]?.status === 'success'
      ? Number(totalRewardPoolResult[0].result) / 1e18
      : 0;

    holders.forEach((holder, i) => {
      if (rewardResults[i]?.status === 'success' && rewardResults[i].result) {
        const [, totalPayout] = rewardResults[i].result;
        holder.claimableRewards = Number(totalPayout) / 1e18;
        log(
          `[Stax] Rewards for ${holder.wallet.slice(0, 6)}...: ` +
          `Claimable=${holder.claimableRewards.toFixed(4)}, ` +
          `Tokens=${ownerTokens.get(holder.wallet).length}`
        );
      } else {
        holder.claimableRewards = 0;
        log(`[Stax] Reward fetch failed for ${holder.wallet.slice(0, 6)}...: ${rewardResults[i]?.error || 'Unknown'}`);
      }
      holder.percentage = totalRewardPool ? (holder.claimableRewards / totalRewardPool) * 100 : 0;
      holder.rank = 0;
      holder.displayMultiplierSum = holder.multiplierSum / 10; // Adjust for Stax display
    });

    // Calculate ranks
    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    holders.forEach((holder, index) => {
      holder.rank = index + 1;
    });

    const response = {
      holders,
      totalTokens,
      summary: {
        totalLive: totalTokens,
        totalBurned,
        totalRewardPool,
      },
      page,
      pageSize,
      totalPages: wallet ? 1 : Math.ceil(totalTokens / pageSize),
    };

    try {
      if (DISABLE_REDIS) {
        inMemoryCache.set(cacheKey, response);
      } else {
        await setCache(cacheKey, response);
      }
      log(`[Stax] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
    } catch (cacheError) {
      log(`[Stax] Cache write error: ${cacheError.message}`);
    }

    log(`[Stax] Success: ${holders.length} holders, totalBurned=${totalBurned}, totalRewardPool=${totalRewardPool}`);
    return NextResponse.json(response);
  } catch (error) {
    log(`[Stax] Error: ${error.message}`);
    console.error('[Stax] Error stack:', error.stack);
    let status = 500;
    let message = 'Failed to fetch Stax data';
    if (error.message.includes('Rate limit')) {
      status = 429;
      message = 'Alchemy rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}// app/api/holders/Element280/route.js


import { NextResponse } from 'next/server';
import { log, saveCacheState, getCache, setCache, loadCacheState, batchMulticall } from '../../utils.js';
import config from '@/config';
import { alchemy, client } from '../../utils.js';
import pLimit from 'p-limit';
import { parseAbiItem } from 'viem';
import NodeCache from 'node-cache';
import fs from 'fs/promises';

// Use config.cache.nodeCache.stdTTL instead of CACHE_TTL
const CACHE_TTL = config.cache.nodeCache.stdTTL;
const CACHE_STATE_KEY = 'element280_cache_state';
const HOLDERS_CACHE_KEY = 'element280_holders_map';
const TOKEN_CACHE_KEY = 'element280_token_cache';
const BURNED_EVENTS_CACHE_KEY = 'element280_burned_events';
const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === 'true';

// Initialize node-cache
const cache = new NodeCache({ stdTTL: CACHE_TTL });
cache.setMaxListeners(20);

// Initialize storage for a contract
function initStorage(contractAddress) {
  const cacheKey = `storage_${contractAddress}`;
  let storage = cache.get(cacheKey);
  if (!storage) {
    storage = {
      holdersMap: null,
      cacheState: {
        isCachePopulating: false,
        holdersMapCache: null,
        totalOwners: 0,
        progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 },
        debugId: 'state-' + Math.random().toString(36).slice(2),
      },
      burnedEventsCache: null,
    };
    cache.set(cacheKey, storage);
    cache.removeAllListeners('set');
    log(`[element280] [INIT] Initialized node-cache for ${contractAddress}, debugId=${storage.cacheState.debugId}`);
  }
  return storage;
}

// Cache state
export async function getCacheState(contractAddress) {
  const storage = initStorage(contractAddress);
  if (DISABLE_REDIS) {
    let state = storage.cacheState;
    if (!state || state.totalOwners === 0) {
      const persistedState = await loadCacheState(`state_${contractAddress}`);
      if (persistedState) {
        storage.cacheState = persistedState;
        state = persistedState;
        log(`[element280] [DEBUG] Loaded persisted state from file for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
      } else {
        log(`[element280] [DEBUG] No persisted state found for ${contractAddress}, using default: ${JSON.stringify(state, null, 2)}`);
      }
    }
    log(`[element280] [DEBUG] getCacheState: contract=${contractAddress}, totalOwners=${state.totalOwners}, step=${state.progressState.step}, isCachePopulating=${state.isCachePopulating}, debugId=${state.debugId}`);
    return state;
  }
  try {
    const state = await getCache(`${CACHE_STATE_KEY}_${contractAddress}`);
    log(`[element280] [DEBUG] getCacheState (Redis): contract=${contractAddress}, state=${JSON.stringify(state)}`);
    return state || {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 },
    };
  } catch (error) {
    log(`[element280] [ERROR] Error fetching cache state for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    return {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: 'error', processedNfts: 0, totalNfts: 0 },
    };
  }
}

// Serialize BigInt
function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
  );
}

// Retry utility
async function retry(fn, attempts = config.alchemy.maxRetries, delay = (retryCount) => Math.min(config.alchemy.batchDelayMs * 2 ** retryCount, config.alchemy.retryMaxDelayMs)) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[element280] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) {
        log(`[element280] [ERROR] Retry failed after ${attempts} attempts: ${error.message}, stack: ${error.stack}`);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay(i)));
    }
  }
}

// Count burned NFTs from Transfer events
async function getBurnedCountFromEvents(contractAddress, errorLog) {
  const burnAddress = '0x0000000000000000000000000000000000000000';
  const storage = initStorage(contractAddress);
  let cachedBurned = null;

  if (DISABLE_REDIS) {
    if (storage.burnedEventsCache) {
      cachedBurned = storage.burnedEventsCache;
      log(`[element280] [DEBUG] Using in-memory burned events cache for ${contractAddress}: ${cachedBurned.count} burned NFTs`);
    }
  } else {
    try {
      cachedBurned = await getCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`);
      if (cachedBurned) {
        log(`[element280] [DEBUG] Using Redis burned events cache for ${contractAddress}: ${cachedBurned.count} burned NFTs`);
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for burned events: ${cacheError.message}`);
    }
  }

  if (cachedBurned) {
    return cachedBurned.count;
  }

  log(`[element280] [STAGE] Fetching burned NFT count from Transfer events for ${contractAddress}`);
  let burnedCount = 0;
  const endBlock = await retry(() => client.getBlockNumber());
  const limit = pLimit(2);
  const ranges = [];
  for (let fromBlock = BigInt(config.deploymentBlocks.element280.block); fromBlock <= endBlock; fromBlock += BigInt(config.nftContracts.element280.maxTokensPerOwnerQuery)) {
    const toBlock = BigInt(Math.min(Number(fromBlock) + config.nftContracts.element280.maxTokensPerOwnerQuery - 1, Number(endBlock)));
    ranges.push({ fromBlock, toBlock });
  }

  try {
    await Promise.all(
      ranges.map(({ fromBlock, toBlock }, index) =>
        limit(async () => {
          try {
            log(`[element280] [PROGRESS] Processing blocks ${fromBlock}-${toBlock} for ${contractAddress} (${index + 1}/${ranges.length})`);
            const logs = await retry(() =>
              client.getLogs({
                address: contractAddress,
                event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                fromBlock,
                toBlock,
              })
            );
            const burns = logs.filter(log => log.args.to.toLowerCase() === burnAddress);
            burnedCount += burns.length;
          } catch (error) {
            log(`[element280] [ERROR] Failed to fetch Transfer events for blocks ${fromBlock}-${toBlock}: ${error.message}`);
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned_events', error: error.message });
          }
        })
      )
    );
    log(`[element280] [STAGE] Found ${burnedCount} burned NFTs from Transfer events for ${contractAddress}`);

    const cacheData = { count: burnedCount, timestamp: Date.now() };
    if (DISABLE_REDIS) {
      storage.burnedEventsCache = cacheData;
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`burned_${contractAddress}`, cacheData);
    } else {
      await setCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`, cacheData, CACHE_TTL);
    }

    return burnedCount;
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch burned events for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned_events', error: error.message });
    throw error;
  }
}

// Fetch total supply and burned count
async function getTotalSupply(contractAddress, errorLog) {
  const cacheKey = `element280_total_supply_${contractAddress}`;
  if (!DISABLE_REDIS) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        return { totalSupply: cached.totalSupply, totalBurned: cached.totalBurned };
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for total supply: ${cacheError.message}, stack: ${cacheError.stack}`);
    }
  }

  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'totalSupply' },
        ],
      })
    );
    const totalSupply = results[0].status === 'success' ? Number(results[0].result) : 0;
    if (isNaN(totalSupply)) {
      const errorMsg = `Invalid totalSupply=${totalSupply}`;
      log(`[element280] [ERROR] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_total_supply', error: errorMsg });
      throw new Error(errorMsg);
    }

    const totalBurned = await getBurnedCountFromEvents(contractAddress, errorLog);
    if (totalBurned < 0) {
      const errorMsg = `Invalid totalBurned=${totalBurned} from events`;
      log(`[element280] [ERROR] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_burned', error: errorMsg });
      throw new Error(errorMsg);
    }

    if (totalSupply + totalBurned > config.nftContracts.element280.expectedTotalSupply + config.nftContracts.element280.expectedBurned) {
      const errorMsg = `Invalid data: totalSupply (${totalSupply}) + totalBurned (${totalBurned}) exceeds totalMinted (${config.nftContracts.element280.expectedTotalSupply + config.nftContracts.element280.expectedBurned})`;
      log(`[element280] [ERROR] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_supply', error: errorMsg });
      throw new Error(errorMsg);
    }

    const expectedBurned = config.nftContracts.element280.expectedBurned;
    if (Math.abs(totalBurned - expectedBurned) > 100) {
      log(`[element280] [WARN] Event-based totalBurned=${totalBurned} deviates from expected=${expectedBurned}.`);
    }

    if (!DISABLE_REDIS) await setCache(cacheKey, { totalSupply, totalBurned }, CACHE_TTL);
    return { totalSupply, totalBurned };
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch total supply for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_total_supply', error: error.message });
    throw error;
  }
}

// Fetch NFT ownership
async function fetchAllNftOwnership(contractAddress, errorLog, timings) {
  const ownershipByToken = new Map();
  const ownershipByWallet = new Map();
  const burnAddress = '0x0000000000000000000000000000000000000000';
  const failedTokens = new Set();

  if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    const errorMsg = `Invalid contract address: ${contractAddress}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_contract', error: errorMsg });
    throw new Error(errorMsg);
  }

  const tokenIdStart = Date.now();
  let pageKey = null;
  let tokenIds = [];
  try {
    do {
      const response = await retry(() =>
        alchemy.nft.getNftsForContract(contractAddress, { pageKey })
      );
      if (!response.nfts || !Array.isArray(response.nfts)) {
        const errorMsg = `Invalid NFT response: nfts array missing`;
        log(`[element280] [ERROR] ${errorMsg}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_token_ids', error: errorMsg });
        throw new Error(errorMsg);
      }
      response.nfts.forEach(nft => {
        const tokenId = nft.tokenId || nft.id || nft.token_id;
        if (tokenId) tokenIds.push(tokenId);
      });
      pageKey = response.pageKey;
    } while (pageKey);
    timings.tokenIdFetch = Date.now() - tokenIdStart;
  } catch (error) {
    log(`[element280] [ERROR] Alchemy error fetching NFTs for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_token_ids', error: error.message });
    throw error;
  }

  if (tokenIds.length === 0) {
    const errorMsg = `No token IDs found for contract ${contractAddress}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_token_ids', error: errorMsg });
    throw new Error(errorMsg);
  }

  const ownerFetchStart = Date.now();
  const ownerCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.element280.main,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)],
  }));
  const limit = pLimit(config.alchemy.batchSize);
  const chunkSize = config.nftContracts.element280.maxTokensPerOwnerQuery;
  const ownerResults = [];
  for (let i = 0; i < ownerCalls.length; i += chunkSize) {
    const chunk = ownerCalls.slice(i, i + chunkSize);
    const results = await limit(() => retry(() => client.multicall({ contracts: chunk })));
    ownerResults.push(...results);
  }
  timings.ownerFetch = Date.now() - ownerFetchStart;

  const ownerProcessStart = Date.now();
  let invalidTokens = 0;
  let nonExistentTokens = 0;
  tokenIds.forEach((tokenId, index) => {
    const result = ownerResults[index];
    if (result.status === 'success') {
      const owner = result.result.toLowerCase();
      if (owner && owner !== burnAddress) {
        ownershipByToken.set(tokenId, owner);
        const walletTokens = ownershipByWallet.get(owner) || [];
        walletTokens.push(tokenId);
        ownershipByWallet.set(owner, walletTokens);
      } else {
        invalidTokens++;
      }
    } else {
      if (result.error?.message.includes('0xdf2d9b42')) {
        nonExistentTokens++;
        failedTokens.add(tokenId);
      } else {
        log(`[element280] [ERROR] Failed to fetch owner for token ${tokenId}: ${result.error || 'unknown error'}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_owners', error: `Failed to fetch owner for token ${tokenId}: ${result.error || 'unknown error'}` });
        failedTokens.add(tokenId);
      }
    }
  });
  timings.ownerProcess = Date.now() - ownerProcessStart;

  if (failedTokens.size > 0) {
    log(`[element280] [WARN] Failed to fetch owners for ${failedTokens.size} tokens: ${[...failedTokens].join(', ')}`);
  }

  const { totalSupply, totalBurned } = await getTotalSupply(contractAddress, errorLog);
  if (ownershipByToken.size > totalSupply) {
    const errorMsg = `Found ${ownershipByToken.size} live NFTs, more than totalSupply ${totalSupply}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_ownership', error: errorMsg });
    throw new Error(errorMsg);
  }
  if (ownershipByToken.size === 0 && totalSupply > 0) {
    const errorMsg = `No valid NFTs with owners found for contract ${contractAddress}, expected up to ${totalSupply}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_ownership', error: errorMsg });
    throw new Error(errorMsg);
  }

  return { ownershipByToken, ownershipByWallet, totalSupply, totalBurned };
}

// Populate holders cache
async function populateHoldersMapCache(contractAddress, tiers) {
  log(`[element280] [STAGE] Starting populateHoldersMapCache for contract: ${contractAddress}`);
  const storage = initStorage(contractAddress);
  let state = await getCacheState(contractAddress);
  if (state.isCachePopulating) {
    log(`[element280] [ERROR] Cache population already in progress for ${contractAddress}`);
    return;
  }

  state.isCachePopulating = true;
  state.progressState = { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 };
  if (DISABLE_REDIS) {
    storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
    cache.set(`storage_${contractAddress}`, storage);
    log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
    await saveCacheState(`state_${contractAddress}`, storage.cacheState);
  } else {
    await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
  }
  log(`[element280] [STAGE] Initialized state for ${contractAddress}, isCachePopulating: ${state.isCachePopulating}`);

  const timings = {
    totalSupply: 0,
    tokenIdFetch: 0,
    ownerFetch: 0,
    ownerProcess: 0,
    holderInit: 0,
    tierFetch: 0,
    rewardFetch: 0,
    metricsCalc: 0,
    total: 0,
  };
  const errorLog = [];
  const totalStart = Date.now();

  try {
    const supplyStart = Date.now();
    log(`[element280] [DEBUG] Fetching total supply and ownership for ${contractAddress}`);
    const { ownershipByToken, ownershipByWallet, totalSupply, totalBurned } = await fetchAllNftOwnership(contractAddress, errorLog, timings);
    timings.totalSupply = Date.now() - supplyStart;
    state.progressState = { step: 'fetching_ownership', processedNfts: 0, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }
    log(`[element280] [STAGE] Ownership fetched for ${contractAddress}: ${ownershipByToken.size} NFTs, ${ownershipByWallet.size} wallets, totalSupply=${totalSupply}, totalBurned=${totalBurned}, duration: ${timings.totalSupply + timings.tokenIdFetch + timings.ownerFetch + timings.ownerProcess}ms`);

    const holderInitStart = Date.now();
    log(`[element280] [DEBUG] Initializing holders for ${contractAddress}`);
    const holdersMap = new Map();
    ownershipByWallet.forEach((tokenIds, wallet) => {
      const holder = {
        wallet,
        total: tokenIds.length,
        totalLive: tokenIds.length,
        multiplierSum: 0,
        displayMultiplierSum: 0,
        tiers: Array(6).fill(0),
        tokenIds: tokenIds.map(id => BigInt(id)),
        claimableRewards: 0,
        percentage: 0,
        rank: 0,
      };
      holdersMap.set(wallet, holder);
      if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${wallet}-nfts`, tokenIds.map(id => ({ tokenId: id, tier: 0 })), CACHE_TTL);
    });
    timings.holderInit = Date.now() - holderInitStart;
    log(`[element280] [STAGE] Holders initialized for ${contractAddress}: ${holdersMap.size} holders, duration: ${timings.holderInit}ms`);
    state.totalOwners = holdersMap.size;
    state.progressState = { step: 'fetching_tiers', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const tierFetchStart = Date.now();
    log(`[element280] [DEBUG] Fetching tiers for ${contractAddress}`);
    const allTokenIds = Array.from(ownershipByToken.keys()).map(id => BigInt(id));
    const tierCalls = allTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: config.abis.element280.main,
      functionName: 'getNftTier',
      args: [tokenId],
    }));
    if (tierCalls.length > 0) {
      const limit = pLimit(config.alchemy.batchSize);
      const chunkSize = config.nftContracts.element280.maxTokensPerOwnerQuery;
      const tierResults = [];
      for (let i = 0; i < tierCalls.length; i += chunkSize) {
        const chunk = tierCalls.slice(i, i + chunkSize);
        log(`[element280] [DEBUG] Processing tier batch ${i}-${i + chunkSize - 1} of ${tierCalls.length}`);
        const results = await limit(() => retry(() => client.multicall({ contracts: chunk })));
        tierResults.push(...results);
        state.progressState = {
          step: 'fetching_tiers',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
          cache.set(`storage_${contractAddress}`, storage);
          log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
          await saveCacheState(`state_${contractAddress}`, storage.cacheState);
        } else {
          await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
        }
      }
      tierResults.forEach((result, index) => {
        const tokenId = allTokenIds[index].toString();
        if (result.status === 'success') {
          const tier = Number(result.result);
          if (tier >= 1 && tier <= 6) {
            const owner = ownershipByToken.get(tokenId);
            const holder = holdersMap.get(owner);
            if (holder) {
              holder.tiers[tier - 1]++;
              if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${tokenId}-tier`, tier, CACHE_TTL);
            }
          }
        } else {
          log(`[element280] [ERROR] Failed to fetch tier for token ${tokenId}: ${result.error || 'unknown error'}`);
        }
      });
    }
    timings.tierFetch = Date.now() - tierFetchStart;
    log(`[element280] [STAGE] Tiers fetched for ${contractAddress}: ${allTokenIds.length} tokens processed, duration: ${timings.tierFetch}ms`);
    state.progressState = { step: 'fetching_rewards', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const rewardFetchStart = Date.now();
    log(`[element280] [DEBUG] Fetching rewards for ${contractAddress}`);
    const rewardCalls = [];
    ownershipByWallet.forEach((tokenIds, wallet) => {
      tokenIds.forEach(tokenId => {
        rewardCalls.push({
          address: config.vaultAddresses.element280.address,
          abi: config.abis.element280.vault,
          functionName: 'getRewards',
          args: [[BigInt(tokenId)], wallet],
        });
      });
    });
    if (rewardCalls.length > 0) {
      const limit = pLimit(config.alchemy.batchSize);
      const chunkSize = config.nftContracts.element280.maxTokensPerOwnerQuery;
      const rewardResults = [];
      for (let i = 0; i < rewardCalls.length; i += chunkSize) {
        const chunk = rewardCalls.slice(i, i + chunkSize);
        log(`[element280] [DEBUG] Processing reward batch ${i}-${i + chunkSize - 1} of ${rewardCalls.length}`);
        const results = await limit(() => retry(() => client.multicall({ contracts: chunk })));
        rewardResults.push(...results);
        state.progressState = {
          step: 'fetching_rewards',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
          cache.set(`storage_${contractAddress}`, storage);
          log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
          await saveCacheState(`state_${contractAddress}`, storage.cacheState);
        } else {
          await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
        }
      }
      let resultIndex = 0;
      ownershipByWallet.forEach((tokenIds, wallet) => {
        let totalRewards = 0n;
        tokenIds.forEach(() => {
          const result = rewardResults[resultIndex++];
          if (result.status === 'success') {
            const rewardValue = BigInt(result.result[1] || 0);
            totalRewards += rewardValue;
          }
        });
        const holder = holdersMap.get(wallet);
        if (holder) {
          holder.claimableRewards = Number(totalRewards) / 1e18;
          if (isNaN(holder.claimableRewards)) {
            holder.claimableRewards = 0;
          }
          if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_element280-${wallet}-reward`, holder.claimableRewards, CACHE_TTL);
        }
      });
    }
    timings.rewardFetch = Date.now() - rewardFetchStart;
    log(`[element280] [STAGE] Rewards fetched for ${contractAddress}: ${rewardCalls.length} NFTs processed, duration: ${timings.rewardFetch}ms`);
    state.progressState = { step: 'calculating_metrics', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const metricsStart = Date.now();
    log(`[element280] [DEBUG] Calculating metrics for ${contractAddress}`);
    const multipliers = Object.values(config.contractTiers.element280).map(t => t.multiplier);
    const totalMultiplierSum = Array.from(holdersMap.values()).reduce((sum, holder) => {
      holder.multiplierSum = holder.tiers.reduce(
        (sum, count, index) => sum + count * (multipliers[index] || 0),
        0
      );
      holder.displayMultiplierSum = holder.multiplierSum / 10;
      return sum + holder.multiplierSum;
    }, 0);
    const holders = Array.from(holdersMap.values());
    holders.forEach(holder => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    });
    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    holders.forEach((holder, index) => {
      holder.rank = index + 1;
      holdersMap.set(holder.wallet, holder);
    });
    if (!DISABLE_REDIS) await setCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`, Array.from(holdersMap.entries()), CACHE_TTL);
    if (DISABLE_REDIS) {
      storage.holdersMap = holdersMap;
      cache.set(`storage_${contractAddress}`, storage);
      // Save holdersMap to file
      await saveCacheState(`holders_${contractAddress}`, Array.from(holdersMap.entries()));
      log(`[element280] [DEBUG] Saved holdersMap to file for ${contractAddress}: ${holdersMap.size} holders`);
    }
    timings.metricsCalc = Date.now() - metricsStart;
    log(`[element280] [STAGE] Metrics calculated for ${contractAddress}: ${holders.length} holders, duration: ${timings.metricsCalc}ms`);

    timings.total = Date.now() - totalStart;
    const summary = {
      totalDurationMs: timings.total,
      phases: {
        fetchTotalSupply: { durationMs: timings.totalSupply },
        fetchTokenIds: { durationMs: timings.tokenIdFetch },
        fetchOwners: { durationMs: timings.ownerFetch },
        processOwners: { durationMs: timings.ownerProcess },
        initializeHolders: { durationMs: timings.holderInit },
        fetchTiers: { durationMs: timings.tierFetch },
        fetchRewards: { durationMs: timings.rewardFetch },
        calculateMetrics: { durationMs: timings.metricsCalc },
      },
      nftsProcessed: ownershipByToken.size,
      walletsProcessed: ownershipByWallet.size,
      errors: errorLog,
    };
    log(`[element280] [STAGE] Cache population completed for ${contractAddress}: ${summary.nftsProcessed} NFTs, ${summary.walletsProcessed} wallets, ${summary.totalDurationMs}ms`);
    state.progressState = { step: 'completed', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
  } catch (error) {
    log(`[element280] [ERROR] Failed to populate holdersMapCache for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'populate_cache', error: error.message });
    state.holdersMapCache = null;
    state.progressState = { step: 'error', processedNfts: 0, totalNfts: 0 };
  } finally {
    state.isCachePopulating = false;
    state.totalOwners = storage.holdersMap ? storage.holdersMap.size : 0;
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      log(`[element280] [DEBUG] Saving cache state for ${contractAddress}: ${JSON.stringify(state, null, 2)}`);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }
    log(`[element280] [STAGE] Finalized for ${contractAddress}: isCachePopulating=false, totalOwners=${state.totalOwners}, debugId=${state.debugId}`);
  }
}

// Fetch holder data
async function getHolderData(contractAddress, wallet, tiers) {
  const cacheKey = `element280_holder_${contractAddress}-${wallet.toLowerCase()}`;
  const storage = initStorage(contractAddress);
  if (!DISABLE_REDIS) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for holder: ${cacheError.message}, stack: ${cacheError.stack}`);
    }
  }

  let state = await getCacheState(contractAddress);
  while (state.isCachePopulating) {
    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    state = await getCacheState(contractAddress);
  }

  let holdersMap;
  if (!DISABLE_REDIS) {
    try {
      const holdersEntries = await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`);
      holdersMap = holdersEntries ? new Map(holdersEntries) : new Map();
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}, stack: ${cacheError.stack}`);
      holdersMap = new Map();
    }
  } else {
    holdersMap = storage.holdersMap || new Map();
  }

  const walletLower = wallet.toLowerCase();
  if (holdersMap.has(walletLower)) {
    const holder = holdersMap.get(walletLower);
    if (!DISABLE_REDIS) await setCache(cacheKey, serializeBigInt(holder), CACHE_TTL);
    return serializeBigInt(holder);
  }

  const holder = {
    wallet: walletLower,
    total: 0,
    totalLive: 0,
    multiplierSum: 0,
    displayMultiplierSum: 0,
    tiers: Array(6).fill(0),
    tokenIds: [],
    claimableRewards: 0,
    percentage: 0,
    rank: 0,
  };

  const tokenIdsResponse = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.element280.main,
      functionName: 'tokenIdsOf',
      args: [walletLower],
    })
  );
  const tokenIds = tokenIdsResponse.map(id => id.toString());
  const nfts = tokenIds.map(tokenId => ({ tokenId, tier: 0 }));
  holder.total = nfts.length;
  holder.totalLive = nfts.length;
  if (!DISABLE_REDIS) await setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${walletLower}-nfts`, nfts, CACHE_TTL);

  if (nfts.length === 0) {
    return null;
  }

  const bigIntTokenIds = nfts.map(nft => BigInt(nft.tokenId));
  const calls = [];
  bigIntTokenIds.forEach(tokenId => {
    calls.push({
      address: contractAddress,
      abi: config.abis.element280.main,
      functionName: 'getNftTier',
      args: [tokenId],
    });
    calls.push({
      address: config.vaultAddresses.element280.address,
      abi: config.abis.element280.vault,
      functionName: 'getRewards',
      args: [[tokenId], walletLower],
    });
  });

  const results = await retry(() => client.multicall({ contracts: calls }));
  const finalTokenIds = [];
  let totalRewards = 0n;
  nfts.forEach((nft, index) => {
    const tierResult = results[index * 2];
    const rewardResult = results[index * 2 + 1];
    if (tierResult.status === 'success') {
      const tier = Number(tierResult.result);
      if (tier >= 1 && tier <= 6) {
        holder.tiers[tier - 1]++;
        finalTokenIds.push(BigInt(nft.tokenId));
        if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${nft.tokenId}-tier`, tier, CACHE_TTL);
      }
    }
    if (rewardResult.status === 'success') {
      const rewardValue = BigInt(rewardResult.result[1] || 0);
      totalRewards += rewardValue;
    }
  });

  holder.tokenIds = finalTokenIds;
  holder.total = finalTokenIds.length;
  holder.totalLive = finalTokenIds.length;
  holder.claimableRewards = Number(totalRewards) / 1e18;
  if (isNaN(holder.claimableRewards)) {
    holder.claimableRewards = 0;
  }
  if (!DISABLE_REDIS) await setCache(`${TOKEN_CACHE_KEY}_element280-${walletLower}-reward`, holder.claimableRewards, CACHE_TTL);

  const multipliers = Object.values(tiers).map(t => t.multiplier);
  holder.multiplierSum = holder.tiers.reduce(
    (sum, count, index) => sum + count * (multipliers[index] || 0),
    0
  );
  holder.displayMultiplierSum = holder.multiplierSum / 10;

  if (!DISABLE_REDIS) await setCache(cacheKey, serializeBigInt(holder), CACHE_TTL);
  return serializeBigInt(holder);
}

// Fetch all holders
async function getAllHolders(contractAddress, page = 0, pageSize = 100) {
  log(`[element280] [DEBUG] getAllHolders: contract=${contractAddress}, page=${page}, pageSize=${pageSize}`);
  const storage = initStorage(contractAddress);
  let state = await getCacheState(contractAddress);
  log(`[element280] [DEBUG] Cache state: totalOwners=${state.totalOwners}, step=${state.progressState.step}, isCachePopulating=${state.isCachePopulating}`);

  // Reload holdersMap if completed but empty
  if (state.progressState.step === 'completed' && (!storage.holdersMap || storage.holdersMap.size === 0)) {
    log(`[element280] [DEBUG] Completed state but empty holdersMap, reloading cache`);
    const persistedHolders = await loadCacheState(`holders_${contractAddress}`);
    if (persistedHolders) {
      storage.holdersMap = new Map(persistedHolders);
      log(`[element280] [DEBUG] Reloaded holdersMap size: ${storage.holdersMap.size}`);
    } else {
      log(`[element280] [DEBUG] No persisted holdersMap found, triggering population`);
      await populateHoldersMapCache(contractAddress, config.contractTiers.element280).catch(err => {
        log(`[element280] [ERROR] Cache population failed: ${err.message}, stack: ${err.stack}`);
      });
      state = await getCacheState(contractAddress);
    }
  }

  while (state.isCachePopulating) {
    log(`[element280] [DEBUG] Waiting for cache population to complete`);
    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    state = await getCacheState(contractAddress);
  }

  let holdersMap;
  if (!DISABLE_REDIS) {
    try {
      const holdersEntries = await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`);
      holdersMap = holdersEntries ? new Map(holdersEntries) : new Map();
      log(`[element280] [DEBUG] Redis holdersMap size: ${holdersMap.size}`);
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}, stack: ${cacheError.stack}`);
      holdersMap = new Map();
    }
  } else {
    holdersMap = storage.holdersMap || new Map();
    log(`[element280] [DEBUG] node-cache holdersMap size: ${holdersMap.size}`);
  }

  // Trigger population if cache is empty and not completed
  if (holdersMap.size === 0 && state.progressState.step !== 'completed') {
    log(`[element280] [DEBUG] Empty holdersMap and cache not completed, triggering population`);
    await populateHoldersMapCache(contractAddress, config.contractTiers.element280).catch(err => {
      log(`[element280] [ERROR] Cache population failed: ${err.message}, stack: ${err.stack}`);
    });
    state = await getCacheState(contractAddress);
    holdersMap = storage.holdersMap || new Map();
    log(`[element280] [DEBUG] Post-population holdersMap size: ${holdersMap.size}`);
  }

  let tierDistribution = [0, 0, 0, 0, 0, 0];
  let multiplierPool = 0;
  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'getTotalNftsPerTiers' },
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'multiplierPool' },
        ],
      })
    );
    log(`[element280] [DEBUG] multicall results for tiers and multiplier: ${JSON.stringify(results, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}`);
    if (results[0].status === 'success' && results[0].result) {
      tierDistribution = results[0].result.map(Number);
      log(`[element280] [DEBUG] Fetched tierDistribution: ${tierDistribution}`);
    } else {
      log(`[element280] [WARN] getTotalNftsPerTiers returned no data, using default: ${tierDistribution}`);
    }
    if (results[1].status === 'success' && results[1].result) {
      multiplierPool = Number(results[1].result);
      log(`[element280] [DEBUG] Fetched multiplierPool: ${multiplierPool}`);
    } else {
      log(`[element280] [WARN] multiplierPool returned no data, using default: ${multiplierPool}`);
    }
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch tierDistribution or multiplierPool: ${error.message}, stack: ${error.stack}`);
    const allTokenIds = Array.from(holdersMap.values()).flatMap(h => h.tokenIds);
    if (allTokenIds.length > 0) {
      try {
        const tierCalls = allTokenIds.map(tokenId => ({
          address: contractAddress,
          abi: config.abis.element280.main,
          functionName: 'getNftTier',
          args: [tokenId],
        }));
        const tierResults = await batchMulticall(tierCalls, config.alchemy.batchSize);
        tierResults.forEach(result => {
          if (result.status === 'success') {
            const tier = Number(result.result);
            if (tier >= 1 && tier <= 6) {
              tierDistribution[tier - 1]++;
            }
          }
        });
        const multipliers = Object.values(config.contractTiers.element280).map(t => t.multiplier);
        multiplierPool = tierDistribution.reduce(
          (sum, count, index) => sum + count * (multipliers[index] || 0),
          0
        );
        log(`[element280] [DEBUG] Computed tierDistribution: ${tierDistribution}`);
        log(`[element280] [DEBUG] Computed multiplierPool: ${multiplierPool}`);
        cache.set(`element280_tier_distribution_${contractAddress}`, { tierDistribution, multiplierPool }, CACHE_TTL);
      } catch (computeError) {
        log(`[element280] [ERROR] Failed to compute tierDistribution: ${computeError.message}, stack: ${computeError.stack}`);
      }
    }
  }

  const totalTokens = Array.from(holdersMap.values()).reduce((sum, h) => sum + h.totalLive, 0);
  const holders = Array.from(holdersMap.values());
  const totalPages = Math.ceil(holders.length / pageSize);
  const startIndex = page * pageSize;
  const paginatedHolders = holders.slice(startIndex, startIndex + pageSize);
  const response = {
    holders: serializeBigInt(paginatedHolders),
    totalPages,
    totalTokens,
    totalShares: multiplierPool,
    totalClaimableRewards: paginatedHolders.reduce((sum, h) => sum + h.claimableRewards, 0),
    summary: {
      totalLive: totalTokens,
      totalBurned: await getBurnedCountFromEvents(contractAddress, []),
      totalMinted: config.nftContracts.element280.expectedTotalSupply + config.nftContracts.element280.expectedBurned,
      tierDistribution,
      multiplierPool,
      totalRewardPool: 0,
    },
  };
  log(`[element280] [DEBUG] getAllHolders response: holdersCount=${paginatedHolders.length}, totalPages=${totalPages}, totalTokens=${totalTokens}`);
  return response;
}

// API handlers
export async function GET(request) {
  const address = config.contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails.element280.pageSize, 10);
  const wallet = searchParams.get('wallet');

  try {
    if (wallet) {
      const holder = await getHolderData(address, wallet, config.contractTiers.element280);
      if (!holder) {
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      return NextResponse.json(serializeBigInt(holder));
    }

    const data = await getAllHolders(address, page, pageSize);
    return NextResponse.json(data);
  } catch (error) {
    log(`[element280] [ERROR] GET error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

export async function POST() {
  const address = config.contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    populateHoldersMapCache(address, config.contractTiers.element280).catch((error) => {
      log(`[element280] [ERROR] Async cache population failed: ${error.message}, stack: ${error.stack}`);
    });
    return NextResponse.json({ message: 'Cache population started' });
  } catch (error) {
    log(`[element280] [ERROR] POST error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}import { NextResponse } from 'next/server';
import { log } from '../../utils';
import NodeCache from 'node-cache';

// Redis toggle
const DISABLE_REDIS = process.env.DISABLE_E280_REDIS === 'true';

// In-memory cache (for future use when contract is deployed)
const inMemoryCache = new NodeCache({ stdTTL: 3600 });

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || '1000');
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[E280] GET Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}, Redis=${!DISABLE_REDIS}`);

  // Placeholder for future cache check when contract is deployed
  /*
  const cacheKey = `e280_holders_${page}_${pageSize}_${wallet || 'all'}`;
  let cachedData;
  try {
    if (DISABLE_REDIS) {
      cachedData = inMemoryCache.get(cacheKey);
    } else {
      cachedData = await getCache(cacheKey);
    }
    if (cachedData) {
      log(`[E280] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return NextResponse.json(cachedData);
    }
    log(`[E280] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[E280] Cache read error: ${cacheError.message}`);
  }
  */

  log('[E280] GET: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}

export async function POST(request) {
  log(`[E280] POST Request: Redis=${!DISABLE_REDIS}`);
  log('[E280] POST: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, alchemy, getCache, setCache, log, batchMulticall } from '@/app/api/utils.js';
import NodeCache from 'node-cache';

// Redis toggle
const DISABLE_REDIS = process.env.DISABLE_ELEMENT369_REDIS === 'true';

// In-memory cache when Redis is disabled
const inMemoryCache = new NodeCache({ stdTTL: config.cache.nodeCache.stdTTL }); // Fixed: config.cache.ttl -> config.cache.nodeCache.stdTTL

const contractAddress = config.contractAddresses.element369.address;
const vaultAddress = config.vaultAddresses.element369.address;
const tiersConfig = config.contractTiers.element369;
const defaultPageSize = config.contractDetails.element369.pageSize;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || defaultPageSize);
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[Element369] Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  try {
    if (!contractAddress || !vaultAddress || !tiersConfig) {
      log(`[Element369] Config error: contractAddress=${contractAddress}, vaultAddress=${vaultAddress}`);
      throw new Error('Element369 contract or vault address missing');
    }

    const cacheKey = `element369_holders_${page}_${pageSize}_${wallet || 'all'}`;
    let cachedData;
    try {
      if (DISABLE_REDIS) {
        cachedData = inMemoryCache.get(cacheKey);
      } else {
        cachedData = await getCache(cacheKey);
      }
      if (cachedData) {
        log(`[Element369] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
        return NextResponse.json(cachedData);
      }
      log(`[Element369] Cache miss: ${cacheKey}`);
    } catch (cacheError) {
      log(`[Element369] Cache read error: ${cacheError.message}`);
    }

    // Fetch owners
    const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, {
      block: 'latest',
      withTokenBalances: true,
    });
    log(`[Element369] Owners fetched: ${ownersResponse.owners.length}`);

    const burnAddress = '0x0000000000000000000000000000000000000000';
    const filteredOwners = wallet
      ? ownersResponse.owners.filter(owner => owner.ownerAddress.toLowerCase() === wallet && owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances.length > 0)
      : ownersResponse.owners.filter(owner => owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances.length > 0);
    log(`[Element369] Live owners: ${filteredOwners.length}`);

    // Build token-to-owner map
    const tokenOwnerMap = new Map();
    const ownerTokens = new Map();
    let totalTokens = 0;
    filteredOwners.forEach(owner => {
      const walletAddr = owner.ownerAddress.toLowerCase();
      const tokenIds = owner.tokenBalances.map(tb => BigInt(tb.tokenId));
      tokenIds.forEach(tokenId => {
        tokenOwnerMap.set(tokenId, walletAddr);
        totalTokens++;
      });
      ownerTokens.set(walletAddr, tokenIds);
    });
    log(`[Element369] Total tokens: ${totalTokens}`);

    // Paginate
    const allTokenIds = Array.from(tokenOwnerMap.keys());
    const start = page * pageSize;
    const end = Math.min(start + pageSize, allTokenIds.length);
    const paginatedTokenIds = allTokenIds.slice(start, end);
    log(`[Element369] Paginated tokens: ${paginatedTokenIds.length}`);

    // Fetch tiers
    const tierCalls = paginatedTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: config.abis.element369.main,
      functionName: 'getNftTier',
      args: [tokenId],
    }));
    const tierResults = await batchMulticall(tierCalls);
    log(`[Element369] Tiers fetched for ${tierResults.length} tokens`);

    // Build holders
    const maxTier = Math.max(...Object.keys(tiersConfig).map(Number)); // maxTier = 3
    const holdersMap = new Map();

    tierResults.forEach((result, i) => {
      if (result?.status === 'success') {
        const tokenId = paginatedTokenIds[i];
        const walletAddr = tokenOwnerMap.get(tokenId);
        const tier = Number(result.result);

        if (tier >= 1 && tier <= maxTier && walletAddr) {
          if (!holdersMap.has(walletAddr)) {
            holdersMap.set(walletAddr, {
              wallet: walletAddr,
              total: 0,
              multiplierSum: 0,
              tiers: Array(maxTier).fill(0), // [Common, Rare, Legendary]
              infernoRewards: 0,
              fluxRewards: 0,
              e280Rewards: 0,
            });
          }
          const holder = holdersMap.get(walletAddr);
          holder.total += 1;
          holder.multiplierSum += tiersConfig[tier]?.multiplier || 0;
          holder.tiers[tier - 1] += 1; // Zero-based: tiers[0] = Common
        } else {
          log(`[Element369] Invalid tier ${tier} for token ${tokenId}`);
        }
      } else {
        log(`[Element369] Tier fetch failed for token ${paginatedTokenIds[i]}: ${result?.error || 'Unknown'}`);
      }
    });

    // Fetch current cycle for debugging
    let currentCycle = 0;
    try {
      currentCycle = await client.readContract({
        address: vaultAddress,
        abi: config.abis.element369.vault,
        functionName: 'getCurrentE369Cycle',
      });
      log(`[Element369] Current cycle: ${currentCycle}`);
    } catch (error) {
      log(`[Element369] Error fetching cycle: ${error.message}`);
    }

    // Fetch rewards
    let holders = Array.from(holdersMap.values());
    const rewardCalls = holders.map(holder => {
      const tokenIds = ownerTokens.get(holder.wallet) || [];
      return {
        address: vaultAddress,
        abi: config.abis.element369.vault,
        functionName: 'getRewards',
        args: [tokenIds, holder.wallet, false], // isBacking: false for claimable rewards
      };
    });

    log(`[Element369] Fetching rewards for ${holders.length} holders`);
    const rewardsResults = await batchMulticall(rewardCalls);

    holders.forEach((holder, i) => {
      if (rewardsResults[i]?.status === 'success' && rewardsResults[i].result) {
        const [availability, burned, infernoPool, fluxPool, e280Pool] = rewardsResults[i].result;
        holder.infernoRewards = Number(infernoPool) / 1e18;
        holder.fluxRewards = Number(fluxPool) / 1e18;
        holder.e280Rewards = Number(e280Pool) / 1e18;
        log(
          `[Element369] Rewards for ${holder.wallet.slice(0, 6)}...: ` +
          `Inferno=${holder.infernoRewards.toFixed(4)}, ` +
          `Flux=${holder.fluxRewards.toFixed(4)}, ` +
          `E280=${holder.e280Rewards.toFixed(4)}, ` +
          `Tokens=${availability.length}, Burned=${burned.filter(b => b).length}, ` +
          `Availability=${availability.join(',')}`
        );
        if (holder.infernoRewards === 0 && holder.fluxRewards === 0 && holder.e280Rewards === 0) {
          log(`[Element369] Zero rewards for ${holder.wallet}: Tokens=${ownerTokens.get(holder.wallet).join(',')}`);
        }
      } else {
        holder.infernoRewards = 0;
        holder.fluxRewards = 0;
        holder.e280Rewards = 0;
        log(`[Element369] Reward fetch failed for ${holder.wallet.slice(0, 6)}...: ${rewardsResults[i]?.error || 'Unknown'}`);
      }
      holder.displayMultiplierSum = holder.multiplierSum;
      holder.percentage = 0;
      holder.rank = 0;
    });

    // Calculate percentages and ranks
    const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
    holders.forEach((holder, index) => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.rank = index + 1;
      holder.displayMultiplierSum = holder.multiplierSum;
    });

    // Sort holders
    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);

    const response = {
      holders,
      totalTokens,
      page,
      pageSize,
      totalPages: wallet ? 1 : Math.ceil(totalTokens / pageSize),
    };

    try {
      if (DISABLE_REDIS) {
        inMemoryCache.set(cacheKey, response);
      } else {
        await setCache(cacheKey, response);
      }
      log(`[Element369] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
    } catch (cacheError) {
      log(`[Element369] Cache write error: ${cacheError.message}`);
    }

    log(`[Element369] Success: ${holders.length} holders`);
    return NextResponse.json(response);
  } catch (error) {
    log(`[Element369] Error: ${error.message}`);
    console.error('[Element369] Error stack:', error.stack);
    return NextResponse.json({ error: 'Failed to fetch Element369 data', details: error.message }, { status: 500 });
  }
}import { NextResponse } from 'next/server';
import config from '@/config.js';
import { alchemy, client, log, batchMulticall, getCache, setCache } from '@/app/api/utils.js';
import { formatUnits, getAddress } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import NodeCache from 'node-cache';

// Redis toggle
const DISABLE_REDIS = process.env.DISABLE_ASCENDANT_REDIS === 'true';

// In-memory cache when Redis is disabled
const inMemoryCache = new NodeCache({ stdTTL: config.cache.nodeCache.stdTTL }); // Fixed: config.cache.ttl -> config.cache.nodeCache.stdTTL

// Utility to serialize BigInt values
function safeSerialize(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
  );
}

// Retry utility
async function retry(
  fn,
  attempts = config.alchemy.maxRetries,
  delay = (retryCount, error) =>
    error?.details?.code === 429 ? config.alchemy.batchDelayMs * 2 ** retryCount : config.alchemy.batchDelayMs
) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[Ascendant] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay(i, error)));
    }
  }
}

// Fetch data for all holders with pagination
async function getAllHolders(page = 0, pageSize = config.contractDetails.ascendant.pageSize, requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holders_${contractAddress}-${page}-${pageSize}`;

  try {
    let cached;
    if (DISABLE_REDIS) {
      cached = inMemoryCache.get(cacheKey);
    } else {
      cached = await getCache(cacheKey);
    }
    if (cached) {
      log(`[Ascendant] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return cached;
    }
    log(`[Ascendant] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[Ascendant] Cache read error: ${cacheError.message}`);
  }

  if (!contractAddress || !tiers) {
    log(`[Ascendant] Config error: contractAddress=${contractAddress}, tiers=${JSON.stringify(tiers)}`);
    throw new Error('Missing contract address or tiers');
  }

  let owners = [];
  let pageKey = null;
  do {
    const response = await retry(() =>
      alchemy.nft.getOwnersForContract(contractAddress, {
        block: 'latest',
        withTokenBalances: true,
        pageKey,
      })
    );
    owners = owners.concat(response.owners);
    pageKey = response.pageKey;
  } while (pageKey);

  const burnAddress = '0x0000000000000000000000000000000000000000';
  const filteredOwners = owners.filter(
    owner =>
      owner?.ownerAddress &&
      owner.ownerAddress.toLowerCase() !== burnAddress &&
      owner.tokenBalances?.length > 0
  );

  const tokenOwnerMap = new Map();
  let totalTokens = 0;
  filteredOwners.forEach(owner => {
    if (!owner.ownerAddress) return;
    let wallet;
    try {
      wallet = getAddress(owner.ownerAddress);
    } catch (e) {
      log(`[Ascendant] Invalid wallet address: ${owner.ownerAddress}`);
      return;
    }
    owner.tokenBalances.forEach(tb => {
      if (!tb.tokenId) return;
      const tokenId = Number(tb.tokenId);
      tokenOwnerMap.set(tokenId, wallet);
      totalTokens++;
    });
  });

  const allTokenIds = Array.from(tokenOwnerMap.keys());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, allTokenIds.length);
  const paginatedTokenIds = allTokenIds.slice(start, end);

  if (paginatedTokenIds.length === 0) {
    const result = {
      holders: [],
      totalTokens,
      totalLockedAscendant: 0,
      totalShares: 0,
      toDistributeDay8: 0,
      toDistributeDay28: 0,
      toDistributeDay90: 0,
      pendingRewards: 0,
      page,
      pageSize,
      totalPages: Math.ceil(totalTokens / pageSize),
    };
    try {
      if (DISABLE_REDIS) {
        inMemoryCache.set(cacheKey, result);
      } else {
        await setCache(cacheKey, result);
      }
      log(`[Ascendant] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
    } catch (cacheError) {
      log(`[Ascendant] Cache write error: ${cacheError.message}`);
    }
    return result;
  }

  const tierCalls = paginatedTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'getNFTAttribute',
    args: [BigInt(tokenId)],
  }));
  const recordCalls = paginatedTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));

  const [tierResults, recordResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall(recordCalls, config.alchemy.batchSize)),
  ]);

  const failedTiers = tierResults.filter(r => r.status === 'failure');
  if (failedTiers.length) {
    log(`[Ascendant] Failed tier calls: ${failedTiers.map(r => r.error).join(', ')}`);
  }
  const failedRecords = recordResults.filter(r => r.status === 'failure');
  if (failedRecords.length) {
    log(`[Ascendant] Failed record calls: ${failedRecords.map(r => r.error).join(', ')}`);
  }

  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'totalShares',
    })
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();
  let totalLockedAscendant = 0;

  const walletTokenIds = new Map();
  paginatedTokenIds.forEach(tokenId => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!walletTokenIds.has(wallet)) {
      walletTokenIds.set(wallet, []);
    }
    walletTokenIds.get(wallet).push(tokenId);
  });

  const claimableCalls = Array.from(walletTokenIds.entries()).map(([wallet, tokenIds]) => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'batchClaimableAmount',
    args: [tokenIds.map(id => BigInt(id))],
  }));

  const claimableResults = await retry(() => batchMulticall(claimableCalls, config.alchemy.batchSize));
  const failedClaimables = claimableResults.filter(r => r.status === 'failure');
  if (failedClaimables.length) {
    log(`[Ascendant] Failed claimable calls: ${failedClaimables.map(r => r.error).join(', ')}`);
  }

  paginatedTokenIds.forEach((tokenId, i) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!holdersMap.has(wallet)) {
      holdersMap.set(wallet, {
        wallet,
        total: 0,
        multiplierSum: 0,
        tiers: Array(maxTier + 1).fill(0),
        shares: 0,
        lockedAscendant: 0,
        pendingDay8: 0,
        pendingDay28: 0,
        pendingDay90: 0,
        claimableRewards: 0,
      });
    }
    const holder = holdersMap.get(wallet);

    const tierResult = tierResults[i];
    let tier;
    if (tierResult?.status === 'success') {
      if (Array.isArray(tierResult.result) && tierResult.result.length >= 2) {
        tier = Number(tierResult.result[1]);
      } else if (typeof tierResult.result === 'object' && tierResult.result.tier !== undefined) {
        tier = Number(tierResult.result.tier);
      } else {
        log(`[Ascendant] Unexpected tier result format for token ${tokenId}: ${JSON.stringify(tierResult.result)}`);
      }
    }
    if (tier >= 1 && tier <= maxTier) {
      holder.tiers[tier] += 1;
      holder.total += 1;
      holder.multiplierSum += tiers[tier]?.multiplier || 0;
    }

    const recordResult = recordResults[i];
    if (recordResult?.status === 'success' && Array.isArray(recordResult.result)) {
      const sharesRaw = recordResult.result[0] || '0';
      const lockedAscendantRaw = recordResult.result[1] || '0';
      const shares = parseFloat(formatUnits(sharesRaw, 18));
      const lockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      totalLockedAscendant += lockedAscendant;
    }
  });

  let claimableIndex = 0;
  for (const [wallet, tokenIds] of walletTokenIds.entries()) {
    const holder = holdersMap.get(wallet);
    if (!holder) {
      claimableIndex++;
      continue;
    }
    if (claimableResults[claimableIndex]?.status === 'success') {
      const claimableRaw = claimableResults[claimableIndex].result || '0';
      holder.claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
    }
    claimableIndex++;
  }

  const holders = Array.from(holdersMap.values());
  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
  const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
  const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

  holders.forEach(holder => {
    holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
    holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
    holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  holders.sort((a, b) => b.shares - a.shares || b.multiplierSum - a.multiplierSum || b.total - a.total);
  holders.forEach((holder, index) => (holder.rank = index + 1));

  const result = {
    holders,
    totalTokens,
    totalLockedAscendant,
    totalShares,
    toDistributeDay8,
    toDistributeDay28,
    toDistributeDay90,
    pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
    page,
    pageSize,
    totalPages: Math.ceil(totalTokens / pageSize),
  };

  try {
    if (DISABLE_REDIS) {
      inMemoryCache.set(cacheKey, result);
    } else {
      await setCache(cacheKey, result);
    }
    log(`[Ascendant] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
  } catch (cacheError) {
    log(`[Ascendant] Cache write error: ${cacheError.message}`);
  }

  return result;
}

// Fetch data for a specific wallet
async function getHolderData(wallet, requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holder_${contractAddress}-${wallet.toLowerCase()}`;

  try {
    let cached;
    if (DISABLE_REDIS) {
      cached = inMemoryCache.get(cacheKey);
    } else {
      cached = await getCache(cacheKey);
    }
    if (cached) {
      log(`[Ascendant] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return cached;
    }
    log(`[Ascendant] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[Ascendant] Cache read error: ${cacheError.message}`);
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error('Invalid wallet address');
  }

  const checksummedWallet = getAddress(wallet);

  const nfts = await retry(() =>
    alchemy.nft.getNftsForOwner(checksummedWallet, { contractAddresses: [contractAddress] })
  );

  if (nfts.totalCount === 0) return null;

  const tokenIds = nfts.ownedNfts
    .filter(nft => nft.contract.address.toLowerCase() === contractAddress.toLowerCase())
    .map(nft => Number(nft.tokenId));

  if (tokenIds.length === 0) return null;

  const tierCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'getNFTAttribute',
    args: [BigInt(tokenId)],
  }));
  const recordCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));
  const claimableCall = [
    {
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'batchClaimableAmount',
      args: [tokenIds.map(id => BigInt(id))],
    },
  ];

  const [tierResults, recordResults, claimableResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall(recordCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall(claimableCall, config.alchemy.batchSize)),
  ]);

  let claimableRewards = 0;
  if (claimableResults[0]?.status === 'success') {
    const claimableRaw = claimableResults[0].result || '0';
    claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
  }

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const tiersArray = Array(maxTier + 1).fill(0);
  let total = 0;
  let multiplierSum = 0;
  let shares = 0;
  let lockedAscendant = 0;

  tokenIds.forEach((tokenId, i) => {
    const tierResult = tierResults[i];
    let tier;
    if (tierResult?.status === 'success') {
      if (Array.isArray(tierResult.result) && tierResult.result.length >= 2) {
        tier = Number(tierResult.result[1]);
      } else if (typeof tierResult.result === 'object' && tierResult.result.tier !== undefined) {
        tier = Number(tierResult.result.tier);
      } else {
        log(`[Ascendant] Unexpected tier result format for token ${tokenId}: ${JSON.stringify(tierResult.result)}`);
      }
    }
    if (tier >= 1 && tier <= maxTier) {
      tiersArray[tier] += 1;
      total += 1;
      multiplierSum += tiers[tier]?.multiplier || 0;
    }

    const recordResult = recordResults[i];
    if (recordResult?.status === 'success' && Array.isArray(recordResult.result)) {
      const sharesRaw = recordResult.result[0] || '0';
      const lockedAscendantRaw = recordResult.result[1] || '0';
      const tokenShares = parseFloat(formatUnits(sharesRaw, 18));
      const tokenLockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      shares += tokenShares;
      lockedAscendant += tokenLockedAscendant;
    }
  });

  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'totalShares',
    })
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
  const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
  const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

  const totalMultiplierSum = multiplierSum || 1;
  const percentage = (multiplierSum / totalMultiplierSum) * 100;
  const rank = 1;

  const result = {
    wallet: checksummedWallet,
    rank,
    total,
    multiplierSum,
    displayMultiplierSum: multiplierSum,
    percentage,
    tiers: tiersArray,
    shares,
    lockedAscendant,
    pendingDay8: shares * pendingRewardPerShareDay8,
    pendingDay28: shares * pendingRewardPerShareDay28,
    pendingDay90: shares * pendingRewardPerShareDay90,
    claimableRewards,
  };

  try {
    if (DISABLE_REDIS) {
      inMemoryCache.set(cacheKey, result);
    } else {
      await setCache(cacheKey, result);
    }
    log(`[Ascendant] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
  } catch (cacheError) {
    log(`[Ascendant] Cache write error: ${cacheError.message}`);
  }

  return result;
}

// API endpoint handler
export async function GET(request) {
  const requestId = uuidv4();
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails.ascendant.pageSize, 10);

  log(`[Ascendant] GET Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}, Redis=${!DISABLE_REDIS}`);

  try {
    if (wallet) {
      const holderData = await getHolderData(wallet, requestId);
      const response = { holders: holderData ? [holderData] : [] };
      log(`[Ascendant] GET /api/holders/Ascendant?wallet=${wallet} completed`);
      return NextResponse.json(safeSerialize(response));
    }

    const result = await getAllHolders(page, pageSize, requestId);
    log(`[Ascendant] GET /api/holders/Ascendant?page=${page}&pageSize=${pageSize} completed`);
    return NextResponse.json(safeSerialize(result));
  } catch (error) {
    log(`[${requestId}] [Ascendant] Error: ${error.message}`);
    console.error(`[${requestId}] [Ascendant] Error stack:`, error.stack);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '@/app/api/holders/Element280/route';
import config from '@/config'; // Use @/ alias for root config.js

export async function GET() {
  const address = config.contractAddresses.element280.address; // Updated to use config
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    const state = await getCacheState(address);
    if (!state || !state.progressState) {
      log(`[element280] [ERROR] Invalid cache state for ${address}`);
      return NextResponse.json({ error: 'Cache state not initialized' }, { status: 500 });
    }
    const progressPercentage = state.progressState.totalNfts > 0
      ? ((state.progressState.processedNfts / state.progressState.totalNfts) * 100).toFixed(1)
      : '0.0';

    return NextResponse.json({
      isPopulating: state.isCachePopulating,
      totalLiveHolders: state.totalOwners,
      totalOwners: state.totalOwners,
      phase: state.progressState.step.charAt(0).toUpperCase() + state.progressState.step.slice(1),
      progressPercentage,
    });
  } catch (error) {
    log(`[element280] [ERROR] Progress endpoint error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}// app/api/holders/Element280/validate-burned/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, log, batchMulticall, saveCacheState, loadCacheState } from '../../../utils.js';
import pLimit from 'p-limit';
import { parseAbiItem } from 'viem';
import NodeCache from 'node-cache';
import fs from 'fs/promises';

// Force-dynamic: This route is dynamic and should not be cached by Next.js
export const dynamic = 'force-dynamic';

// Constants
const BURN_ADDRESS = '0x0000000000000000000000000000000000000000';
const RECENT_BLOCK_CHECK = 10000; // Check last 10,000 blocks for new burns
const EVENT_CACHE_TTL = config.cache.nodeCache.stdTTL;
const BURNED_EVENTS_CACHE_KEY = 'element280_burned_events_detailed';
const METADATA_CACHE_KEY = 'element280_burned_metadata';
const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === 'true';

// Initialize node-cache
const cache = new NodeCache({ stdTTL: EVENT_CACHE_TTL });
cache.setMaxListeners(20); // Increase limit

// Initialize storage
function initStorage(contractAddress) {
  const cacheKey = `burned_storage_${contractAddress}`;
  let storage = cache.get(cacheKey);
  if (!storage) {
    storage = { burnedEventsDetailedCache: null, lastBurnBlock: Number(config.deploymentBlocks.element280.block) };
    cache.set(cacheKey, storage);
    cache.removeAllListeners('set'); // Clean up
    log(`[element280] [INIT] Initialized node-cache for burned events: ${contractAddress}`);
  }
  return storage;
}

// Load metadata (last burn block)
async function loadMetadata(contractAddress) {
  const metadata = await loadCacheState(`burned_metadata_${contractAddress}`);
  return metadata ? metadata.lastBurnBlock : Number(config.deploymentBlocks.element280.block);
}

// Save metadata
async function saveMetadata(contractAddress, lastBurnBlock) {
  await saveCacheState(`burned_metadata_${contractAddress}`, { lastBurnBlock });
}

// Retry utility
async function retry(fn, attempts = config.alchemy.maxRetries, delay = (retryCount) => Math.min(config.alchemy.batchDelayMs * 2 ** retryCount, config.alchemy.retryMaxDelayMs)) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[element280] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) {
        log(`[element280] [ERROR] Retry failed after ${attempts} attempts: ${error.message}, stack: ${error.stack}`);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay(i)));
    }
  }
}

// Update last burn block by checking recent blocks
async function updateLastBurnBlock(contractAddress, currentLastBurnBlock, endBlock) {
  const fromBlock = Math.max(currentLastBurnBlock + 1, Number(config.deploymentBlocks.element280.block));
  const toBlock = Math.min(fromBlock + RECENT_BLOCK_CHECK, Number(endBlock));
  if (fromBlock > toBlock) return currentLastBurnBlock;

  log(`[element280] [DEBUG] Checking recent blocks ${fromBlock}-${toBlock} for new burns`);
  const logs = await retry(() =>
    client.getLogs({
      address: contractAddress,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    })
  );
  const burnLogs = logs.filter(log => log.args.to.toLowerCase() === BURN_ADDRESS);
  if (burnLogs.length > 0) {
    const latestBurnBlock = Math.max(...burnLogs.map(log => Number(log.blockNumber)));
    log(`[element280] [DEBUG] Found new burns, updating lastBurnBlock to ${latestBurnBlock}`);
    return latestBurnBlock;
  }
  return currentLastBurnBlock;
}

// Validate burned events
async function validateBurnedEvents(contractAddress) {
  const storage = initStorage(contractAddress);
  if (DISABLE_REDIS) {
    if (storage.burnedEventsDetailedCache) {
      log(`[element280] [DEBUG] Cache hit for burned events: ${storage.burnedEventsDetailedCache.burnedCount} events`);
      return storage.burnedEventsDetailedCache;
    }
    const persistedCache = await loadCacheState(`burned_${contractAddress}`);
    if (persistedCache) {
      storage.burnedEventsDetailedCache = persistedCache;
      log(`[element280] [DEBUG] Loaded persisted burned events: ${persistedCache.burnedCount} events`);
      return persistedCache;
    }
  }

  log(`[element280] [STAGE] Fetching burned events for ${contractAddress}`);
  const burnedEvents = [];
  let burnedCount = 0;
  const endBlock = await retry(() => client.getBlockNumber());
  let lastBurnBlock = await loadMetadata(contractAddress);
  lastBurnBlock = await updateLastBurnBlock(contractAddress, lastBurnBlock, endBlock);
  const ranges = [];
  for (let fromBlock = Number(config.deploymentBlocks.element280.block); fromBlock <= lastBurnBlock; fromBlock += config.nftContracts.element280.maxTokensPerOwnerQuery) {
    const toBlock = Math.min(fromBlock + config.nftContracts.element280.maxTokensPerOwnerQuery - 1, lastBurnBlock);
    ranges.push({ fromBlock, toBlock });
  }

  const limit = pLimit(2); // Reduced concurrency
  for (const [index, { fromBlock, toBlock }] of ranges.entries()) {
    try {
      log(`[element280] [PROGRESS] Processing blocks ${fromBlock}-${toBlock} for ${contractAddress} (${index + 1}/${ranges.length})`);
      const logs = await retry(() =>
        client.getLogs({
          address: contractAddress,
          event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock),
        })
      );
      const burnLogs = logs.filter(log => log.args.to.toLowerCase() === BURN_ADDRESS);
      if (burnLogs.length === 0) continue;

      const tokenIds = burnLogs.map(log => log.args.tokenId);
      const tierCalls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi: config.abis.element280.main,
        functionName: 'getNftTier',
        args: [tokenId],
      }));
      const tierResults = await batchMulticall(tierCalls, config.alchemy.batchSize);
      const block = await retry(() => client.getBlock({ blockNumber: burnLogs[0]?.blockNumber }));

      burnLogs.forEach((log, i) => {
        const tier = tierResults[i].status === 'success' ? Number(tierResults[i].result) : 0;
        burnedEvents.push({
          tokenId: log.args.tokenId.toString(),
          tier,
          from: log.args.from.toLowerCase(),
          transactionHash: log.transactionHash.toLowerCase(),
          blockNumber: Number(log.blockNumber),
          blockTimestamp: Number(block.timestamp),
        });
        burnedCount++;
      });
    } catch (error) {
      log(`[element280] [ERROR] Failed to process blocks ${fromBlock}-${toBlock}: ${error.message}, stack: ${error.stack}`);
    }
  }

  const result = { burnedCount, events: burnedEvents, timestamp: Date.now() };
  if (DISABLE_REDIS) {
    storage.burnedEventsDetailedCache = result;
    storage.lastBurnBlock = lastBurnBlock;
    cache.set(`burned_storage_${contractAddress}`, storage);
    await saveCacheState(`burned_${contractAddress}`, result);
    await saveMetadata(contractAddress, lastBurnBlock);
  }
  log(`[element280] [STAGE] Completed burned events fetch: ${burnedCount} events, lastBurnBlock=${lastBurnBlock}`);
  return result;
}

// Stream burned events
export async function GET() {
  const address = config.contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          const storage = initStorage(address);
          if (DISABLE_REDIS && storage.burnedEventsDetailedCache) {
            controller.enqueue(JSON.stringify({
              complete: true,
              result: storage.burnedEventsDetailedCache,
            }) + '\n');
            controller.close();
            return;
          }

          const burnedEvents = [];
          let burnedCount = 0;
          const endBlock = await retry(() => client.getBlockNumber());
          let lastBurnBlock = await loadMetadata(address);
          lastBurnBlock = await updateLastBurnBlock(address, lastBurnBlock, endBlock);
          const ranges = [];
          for (let fromBlock = Number(config.deploymentBlocks.element280.block); fromBlock <= lastBurnBlock; fromBlock += config.nftContracts.element280.maxTokensPerOwnerQuery) {
            const toBlock = Math.min(fromBlock + config.nftContracts.element280.maxTokensPerOwnerQuery - 1, lastBurnBlock);
            ranges.push({ fromBlock, toBlock });
          }

          const limit = pLimit(2);
          for (const [index, { fromBlock, toBlock }] of ranges.entries()) {
            log(`[element280] [PROGRESS] Processing blocks ${fromBlock}-${toBlock} for ${address} (${index + 1}/${ranges.length})`);
            const logs = await retry(() =>
              client.getLogs({
                address,
                event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                fromBlock: BigInt(fromBlock),
                toBlock: BigInt(toBlock),
              })
            );
            const burnLogs = logs.filter(log => log.args.to.toLowerCase() === BURN_ADDRESS);
            if (burnLogs.length === 0) continue;

            const tokenIds = burnLogs.map(log => log.args.tokenId);
            const tierCalls = tokenIds.map(tokenId => ({
              address,
              abi: config.abis.element280.main,
              functionName: 'getNftTier',
              args: [tokenId],
            }));
            const tierResults = await batchMulticall(tierCalls, config.alchemy.batchSize);
            const block = await retry(() => client.getBlock({ blockNumber: burnLogs[0]?.blockNumber }));

            burnLogs.forEach((log, i) => {
              const tier = tierResults[i].status === 'success' ? Number(tierResults[i].result) : 0;
              const event = {
                tokenId: log.args.tokenId.toString(),
                tier,
                from: log.args.from.toLowerCase(),
                transactionHash: log.transactionHash.toLowerCase(),
                blockNumber: Number(log.blockNumber),
                blockTimestamp: Number(block.timestamp),
              };
              burnedEvents.push(event);
              burnedCount++;
              controller.enqueue(JSON.stringify({ event, progress: { index: index + 1, total: ranges.length } }) + '\n');
            });
          }

          const result = { burnedCount, events: burnedEvents, timestamp: Date.now() };
          if (DISABLE_REDIS) {
            storage.burnedEventsDetailedCache = result;
            storage.lastBurnBlock = lastBurnBlock;
            cache.set(`burned_storage_${address}`, storage);
            await saveCacheState(`burned_${address}`, result);
            await saveMetadata(address, lastBurnBlock);
          }
          controller.enqueue(JSON.stringify({ complete: true, result }) + '\n');
          controller.close();
        } catch (error) {
          log(`[element280] [ERROR] Streaming error: ${error.message}, stack: ${error.stack}`);
          controller.enqueue(JSON.stringify({ error: `Server error: ${error.message}` }) + '\n');
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}