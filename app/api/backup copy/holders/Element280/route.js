// ./app/api/holders/Element280/route.js
import { NextResponse } from 'next/server';
import { log, saveCacheState, getCache, setCache, loadCacheState, batchMulticall, safeSerialize, getOwnersForContract, getNftsForOwner } from '@/app/api/utils.js';
import config from '@/config';
import { client } from '@/app/api/utils.js';
import pLimit from 'p-limit';
import { parseAbiItem } from 'viem';
import NodeCache from 'node-cache';
import element280 from '@/abi/element280.json';

const CACHE_TTL = config.cache.nodeCache.stdTTL;
const CACHE_STATE_KEY = 'element280_cache_state';
const HOLDERS_CACHE_KEY = 'element280_holders_map';
const TOKEN_CACHE_KEY = 'element280_token_cache';
const BURNED_EVENTS_CACHE_KEY = 'element280_burned_events';
const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === 'true';

const cache = new NodeCache({ stdTTL: CACHE_TTL });
cache.setMaxListeners(20);

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
  }
  return storage;
}

export async function getCacheState(contractAddress) {
  const storage = initStorage(contractAddress);
  if (DISABLE_REDIS) {
    let state = storage.cacheState;
    if (!state || state.totalOwners === 0) {
      const persistedState = await loadCacheState(`state_${contractAddress}`);
      if (persistedState) {
        storage.cacheState = persistedState;
        state = persistedState;
      }
    }
    return state;
  }
  try {
    const state = await getCache(`${CACHE_STATE_KEY}_${contractAddress}`);
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

async function getBurnedCountFromEvents(contractAddress, errorLog) {
  const burnAddress = '0x0000000000000000000000000000000000000000';
  const storage = initStorage(contractAddress);
  let cachedBurned = null;

  if (DISABLE_REDIS) {
    if (storage.burnedEventsCache) {
      cachedBurned = storage.burnedEventsCache;
    }
  } else {
    try {
      cachedBurned = await getCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`);
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for burned events: ${cacheError.message}`);
    }
  }

  if (cachedBurned) {
    return cachedBurned.count;
  }

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

async function getTotalSupply(contractAddress, errorLog) {
  const cacheKey = `element280_total_supply_${contractAddress}`;
  if (!DISABLE_REDIS) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        return { totalSupply: cached.totalSupply, totalBurned: cached.totalBurned };
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for total supply: ${cacheError.message}`);
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
      log(`[element280] [VALIDATION] Event-based totalBurned=${totalBurned} deviates from expected=${expectedBurned}.`);
    }

    if (!DISABLE_REDIS) await setCache(cacheKey, { totalSupply, totalBurned }, CACHE_TTL);
    return { totalSupply, totalBurned };
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch total supply for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_total_supply', error: error.message });
    throw error;
  }
}

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
  const owners = await retry(() => getOwnersForContract(contractAddress, element280.abi));
  timings.tokenIdFetch = Date.now() - tokenIdStart;

  if (owners.length === 0) {
    const errorMsg = `No owners found for contract ${contractAddress}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_token_ids', error: errorMsg });
    throw new Error(errorMsg);
  }

  const ownerFetchStart = Date.now();
  const ownerCalls = owners.map(owner => ({
    address: contractAddress,
    abi: config.abis.element280.main,
    functionName: 'ownerOf',
    args: [BigInt(owner.tokenId)],
  }));
  const ownerResults = await retry(() => batchMulticall(ownerCalls));
  owners.forEach((owner, index) => {
    const tokenId = owner.tokenId;
    const ownerAddr = owner.ownerAddress.toLowerCase();
    const verifiedOwner = ownerResults[index]?.status === 'success' ? ownerResults[index].result.toLowerCase() : null;
    if (verifiedOwner && verifiedOwner === ownerAddr && ownerAddr !== burnAddress) {
      ownershipByToken.set(tokenId, ownerAddr);
      const walletTokens = ownershipByWallet.get(ownerAddr) || [];
      walletTokens.push(tokenId);
      ownershipByWallet.set(ownerAddr, walletTokens);
    } else {
      failedTokens.add(tokenId);
      if (!verifiedOwner) {
        log(`[element280] [VALIDATION] Failed to verify owner for token ${tokenId}`);
      } else if (verifiedOwner !== ownerAddr) {
        log(`[element280] [VALIDATION] Owner mismatch for token ${tokenId}: event=${ownerAddr}, ownerOf=${verifiedOwner}`);
      }
    }
  });
  timings.ownerFetch = Date.now() - ownerFetchStart;
  timings.ownerProcess = timings.ownerFetch;

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

async function populateHoldersMapCache(contractAddress, tiers) {
  const storage = initStorage(contractAddress);
  let state = await getCacheState(contractAddress);
  if (state.isCachePopulating) {
    return;
  }

  state.isCachePopulating = true;
  state.progressState = { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 };
  if (DISABLE_REDIS) {
    storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
    cache.set(`storage_${contractAddress}`, storage);
    await saveCacheState(`state_${contractAddress}`, storage.cacheState);
  } else {
    await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
  }

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
    const { ownershipByToken, ownershipByWallet, totalSupply, totalBurned } = await fetchAllNftOwnership(contractAddress, errorLog, timings);
    timings.totalSupply = Date.now() - supplyStart;
    state.progressState = { step: 'fetching_ownership', processedNfts: 0, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const holderInitStart = Date.now();
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
    state.totalOwners = holdersMap.size;
    state.progressState = { step: 'fetching_tiers', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const tierFetchStart = Date.now();
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
        const results = await limit(() => retry(() => batchMulticall(chunk)));
        tierResults.push(...results);
        state.progressState = {
          step: 'fetching_tiers',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
          cache.set(`storage_${contractAddress}`, storage);
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
    state.progressState = { step: 'fetching_rewards', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const rewardFetchStart = Date.now();
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
        const results = await limit(() => retry(() => batchMulticall(chunk)));
        rewardResults.push(...results);
        state.progressState = {
          step: 'fetching_rewards',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
          cache.set(`storage_${contractAddress}`, storage);
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
    state.progressState = { step: 'calculating_metrics', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const metricsStart = Date.now();
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
      await saveCacheState(`holders_${contractAddress}`, Array.from(holdersMap.entries()));
    }
    timings.metricsCalc = Date.now() - metricsStart;

    timings.total = Date.now() - totalStart;
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
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }
  }
}

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
      log(`[element280] [ERROR] Cache read error for holder: ${cacheError.message}`);
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
      log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}`);
      holdersMap = new Map();
    }
  } else {
    holdersMap = storage.holdersMap || new Map();
  }

  const walletLower = wallet.toLowerCase();
  if (holdersMap.has(walletLower)) {
    const holder = holdersMap.get(walletLower);
    if (!DISABLE_REDIS) await setCache(cacheKey, safeSerialize(holder), CACHE_TTL);
    return safeSerialize(holder);
  }

  const nfts = await retry(() => getNftsForOwner(walletLower, contractAddress, element280.abi));
  const holder = {
    wallet: walletLower,
    total: nfts.length,
    totalLive: nfts.length,
    multiplierSum: 0,
    displayMultiplierSum: 0,
    tiers: Array(6).fill(0),
    tokenIds: nfts.map(nft => BigInt(nft.tokenId)),
    claimableRewards: 0,
    percentage: 0,
    rank: 0,
  };

  if (nfts.length === 0) {
    return null;
  }

  const calls = [];
  holder.tokenIds.forEach(tokenId => {
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

  const results = await retry(() => batchMulticall(calls));
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
  if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_element280-${walletLower}-reward`, holder.claimableRewards, CACHE_TTL);

  const multipliers = Object.values(tiers).map(t => t.multiplier);
  holder.multiplierSum = holder.tiers.reduce(
    (sum, count, index) => sum + count * (multipliers[index] || 0),
    0
  );
  holder.displayMultiplierSum = holder.multiplierSum / 10;

  if (!DISABLE_REDIS) await setCache(cacheKey, safeSerialize(holder), CACHE_TTL);
  return safeSerialize(holder);
}

async function getAllHolders(contractAddress, page = 0, pageSize = 100) {
  const storage = initStorage(contractAddress);
  let state = await getCacheState(contractAddress);

  if (state.progressState.step === 'completed' && (!storage.holdersMap || storage.holdersMap.size === 0)) {
    const persistedHolders = await loadCacheState(`holders_${contractAddress}`);
    if (persistedHolders) {
      storage.holdersMap = new Map(persistedHolders);
    } else {
      await populateHoldersMapCache(contractAddress, config.contractTiers.element280).catch(err => {
        log(`[element280] [ERROR] Cache population failed: ${err.message}, stack: ${err.stack}`);
      });
      state = await getCacheState(contractAddress);
    }
  }

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
      log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}`);
      holdersMap = new Map();
    }
  } else {
    holdersMap = storage.holdersMap || new Map();
  }

  if (holdersMap.size === 0 && state.progressState.step !== 'completed') {
    await populateHoldersMapCache(contractAddress, config.contractTiers.element280).catch(err => {
      log(`[element280] [ERROR] Cache population failed: ${err.message}, stack: ${err.stack}`);
    });
    state = await getCacheState(contractAddress);
    holdersMap = storage.holdersMap || new Map();
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
    if (results[0].status === 'success' && results[0].result) {
      tierDistribution = results[0].result.map(Number);
    }
    if (results[1].status === 'success' && results[1].result) {
      multiplierPool = Number(results[1].result);
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
    holders: safeSerialize(paginatedHolders),
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
  return response;
}

export async function GET(request) {
  const address = config.contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [VALIDATION] Element280 contract address not found`);
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
      return NextResponse.json(safeSerialize(holder));
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
    log(`[element280] [VALIDATION] Element280 contract address not found`);
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