// app/api/holders/Element280/route.js


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
}