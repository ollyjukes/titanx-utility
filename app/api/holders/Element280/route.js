
// /app/api/holders/Element280/route.js
import { NextResponse } from "next/server";
import { alchemy, client, CACHE_TTL, log, getCache, setCache } from "@/app/api/utils";
import { contractAddresses, contractTiers, vaultAddresses, element280MainAbi, element280VaultAbi } from "@/app/nft-contracts";
import pLimit from "p-limit";
import { parseAbiItem } from "viem";

// Cache state keys
const CACHE_STATE_KEY = "element280_cache_state";
const HOLDERS_CACHE_KEY = "element280_holders_map";
const TOKEN_CACHE_KEY = "element280_token_cache";
const BURNED_EVENTS_CACHE_KEY = "element280_burned_events";
const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === "true";

// Hardcoded constants
const TOTAL_MINTED = 16883;
const DEPLOYMENT_BLOCK = 17435629;
const MAX_BLOCK_RANGE = 5000;
const EVENT_CACHE_TTL = 24 * 60 * 60;

// In-memory storage, keyed by contract address
const inMemoryStorage = new Map(); // Map<contractAddress, {holdersMap, cacheState, burnedEventsCache}>

// Initialize storage for a contract
function initStorage(contractAddress) {
  if (!inMemoryStorage.has(contractAddress)) {
    inMemoryStorage.set(contractAddress, {
      inMemoryHoldersMap: null,
      inMemoryCacheState: {
        isCachePopulating: false,
        holdersMapCache: null,
        totalOwners: 0,
        progressState: { step: "idle", processedNfts: 0, totalNfts: 0 },
        debugId: "state-" + Math.random().toString(36).slice(2),
      },
      burnedEventsCache: null,
    });
    log(`[element280] [INIT] Initialized inMemoryStorage for ${contractAddress}, debugId=${inMemoryStorage.get(contractAddress).inMemoryCacheState.debugId}`);
  }
  return inMemoryStorage.get(contractAddress);
}

// Export cache state
export async function getCacheState(contractAddress) {
  const storage = initStorage(contractAddress);
  if (DISABLE_REDIS) {
    const state = storage.inMemoryCacheState;
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
      progressState: { step: "idle", processedNfts: 0, totalNfts: 0 },
    };
  } catch (error) {
    log(`[element280] [ERROR] Error fetching cache state for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    return {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: "error", processedNfts: 0, totalNfts: 0 },
    };
  }
}

// Serialize BigInt
function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

// Retry utility
async function retry(fn, attempts = 5, delay = (retryCount) => Math.min(1000 * 2 ** retryCount, 10000)) {
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
  const burnAddress = "0x0000000000000000000000000000000000000000";
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
  const limit = pLimit(3);
  const ranges = [];
  for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= endBlock; fromBlock += MAX_BLOCK_RANGE) {
    const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, Number(endBlock));
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
                fromBlock: BigInt(fromBlock),
                toBlock: BigInt(toBlock),
              })
            );
            const burns = logs.filter(log => log.args.to.toLowerCase() === burnAddress);
            burnedCount += burns.length;
          } catch (error) {
            log(`[element280] [ERROR] Failed to fetch Transfer events for blocks ${fromBlock}-${toBlock}: ${error.message}`);
            errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_burned_events", error: error.message });
          }
        })
      )
    );
    log(`[element280] [STAGE] Found ${burnedCount} burned NFTs from Transfer events for ${contractAddress}`);

    const cacheData = { count: burnedCount, timestamp: Date.now() };
    if (DISABLE_REDIS) {
      storage.burnedEventsCache = cacheData;
    } else {
      await setCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`, cacheData, EVENT_CACHE_TTL);
    }

    return burnedCount;
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch burned events for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_burned_events", error: error.message });
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
          { address: contractAddress, abi: element280MainAbi, functionName: "totalSupply" },
        ],
      })
    );
    const totalSupply = results[0].status === "success" ? Number(results[0].result) : 0;
    if (isNaN(totalSupply)) {
      const errorMsg = `Invalid totalSupply=${totalSupply}`;
      log(`[element280] [ERROR] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_total_supply", error: errorMsg });
      throw new Error(errorMsg);
    }

    const totalBurned = await getBurnedCountFromEvents(contractAddress, errorLog);
    if (totalBurned < 0) {
      const errorMsg = `Invalid totalBurned=${totalBurned} from events`;
      log(`[element280] [ERROR] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: "validate_burned", error: errorMsg });
      throw new Error(errorMsg);
    }

    if (totalSupply + totalBurned > TOTAL_MINTED) {
      const errorMsg = `Invalid data: totalSupply (${totalSupply}) + totalBurned (${totalBurned}) exceeds totalMinted (${TOTAL_MINTED})`;
      log(`[element280] [ERROR] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: "validate_supply", error: errorMsg });
      throw new Error(errorMsg);
    }

    const expectedBurned = 8776;
    if (Math.abs(totalBurned - expectedBurned) > 100) {
      log(`[element280] [WARN] Event-based totalBurned=${totalBurned} deviates from expected=${expectedBurned}.`);
    }

    if (!DISABLE_REDIS) await setCache(cacheKey, { totalSupply, totalBurned }, CACHE_TTL);
    return { totalSupply, totalBurned };
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch total supply for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_total_supply", error: error.message });
    throw error;
  }
}

// Fetch NFT ownership
async function fetchAllNftOwnership(contractAddress, errorLog, timings) {
  const ownershipByToken = new Map();
  const ownershipByWallet = new Map();
  const burnAddress = "0x0000000000000000000000000000000000000000";
  const failedTokens = new Set();

  if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    const errorMsg = `Invalid contract address: ${contractAddress}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "validate_contract", error: errorMsg });
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
        errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_token_ids", error: errorMsg });
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
    errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_token_ids", error: error.message });
    throw error;
  }

  if (tokenIds.length === 0) {
    const errorMsg = `No token IDs found for contract ${contractAddress}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "fetch_token_ids", error: errorMsg });
    throw new Error(errorMsg);
  }

  const ownerFetchStart = Date.now();
  const ownerCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: element280MainAbi,
    functionName: "ownerOf",
    args: [BigInt(tokenId)],
  }));
  const limit = pLimit(10);
  const chunkSize = 100;
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
    if (result.status === "success") {
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
      if (result.error?.message.includes("0xdf2d9b42")) {
        nonExistentTokens++;
        failedTokens.add(tokenId);
      } else {
        log(`[element280] [ERROR] Failed to fetch owner for token ${tokenId}: ${result.error || "unknown error"}`);
        errorLog.push({ timestamp: new Date().toISOString(), phase: "process_owners", error: `Failed to fetch owner for token ${tokenId}: ${result.error || "unknown error"}` });
        failedTokens.add(tokenId);
      }
    }
  });
  timings.ownerProcess = Date.now() - ownerProcessStart;

  if (failedTokens.size > 0) {
    log(`[element280] [WARN] Failed to fetch owners for ${failedTokens.size} tokens: ${[...failedTokens].join(", ")}`);
  }

  const { totalSupply, totalBurned } = await getTotalSupply(contractAddress, errorLog);
  if (ownershipByToken.size > totalSupply) {
    const errorMsg = `Found ${ownershipByToken.size} live NFTs, more than totalSupply ${totalSupply}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "validate_ownership", error: errorMsg });
    throw new Error(errorMsg);
  }
  if (ownershipByToken.size === 0 && totalSupply > 0) {
    const errorMsg = `No valid NFTs with owners found for contract ${contractAddress}, expected up to ${totalSupply}`;
    log(`[element280] [ERROR] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "validate_ownership", error: errorMsg });
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
  state.progressState = { step: "fetching_supply", processedNfts: 0, totalNfts: 0 };
  if (DISABLE_REDIS) {
    storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
    log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
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
    const { ownershipByToken, ownershipByWallet, totalSupply, totalBurned } = await fetchAllNftOwnership(contractAddress, errorLog, timings);
    timings.totalSupply = Date.now() - supplyStart;
    state.progressState = { step: "fetching_ownership", processedNfts: 0, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
      log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }
    log(`[element280] [STAGE] Ownership fetched for ${contractAddress}: ${ownershipByToken.size} NFTs, ${ownershipByWallet.size} wallets, duration: ${timings.totalSupply + timings.tokenIdFetch + timings.ownerFetch + timings.ownerProcess}ms`);

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
    log(`[element280] [STAGE] Holders initialized for ${contractAddress}: ${holdersMap.size} holders, duration: ${timings.holderInit}ms`);
    state.totalOwners = holdersMap.size;
    state.progressState = { step: "fetching_tiers", processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
      log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const tierFetchStart = Date.now();
    const allTokenIds = Array.from(ownershipByToken.keys()).map(id => BigInt(id));
    const tierCalls = allTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: "getNftTier",
      args: [tokenId],
    }));
    if (tierCalls.length > 0) {
      const limit = pLimit(10);
      const chunkSize = 100;
      const tierResults = [];
      for (let i = 0; i < tierCalls.length; i += chunkSize) {
        const chunk = tierCalls.slice(i, i + chunkSize);
        const results = await limit(() => retry(() => client.multicall({ contracts: chunk })));
        tierResults.push(...results);
        state.progressState = {
          step: "fetching_tiers",
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
          log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
        } else {
          await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
        }
      }
      tierResults.forEach((result, index) => {
        const tokenId = allTokenIds[index].toString();
        if (result.status === "success") {
          const tier = Number(result.result);
          if (tier >= 1 && tier <= 6) {
            const owner = ownershipByToken.get(tokenId);
            const holder = holdersMap.get(owner);
            if (holder) {
              holder.tiers[tier - 1]++;
              if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${tokenId}-tier`, tier, CACHE_TTL);
            }
          }
        }
      });
    }
    timings.tierFetch = Date.now() - tierFetchStart;
    log(`[element280] [STAGE] Tiers fetched for ${contractAddress}: ${allTokenIds.length} tokens processed, duration: ${timings.tierFetch}ms`);
    state.progressState = { step: "fetching_rewards", processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
      log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const rewardFetchStart = Date.now();
    const rewardCalls = [];
    ownershipByWallet.forEach((tokenIds, wallet) => {
      tokenIds.forEach(tokenId => {
        rewardCalls.push({
          address: vaultAddresses.element280.address,
          abi: element280VaultAbi,
          functionName: "getRewards",
          args: [[BigInt(tokenId)], wallet],
        });
      });
    });
    if (rewardCalls.length > 0) {
      const limit = pLimit(10);
      const chunkSize = 100;
      const rewardResults = [];
      for (let i = 0; i < rewardCalls.length; i += chunkSize) {
        const chunk = rewardCalls.slice(i, i + chunkSize);
        const results = await limit(() => retry(() => client.multicall({ contracts: chunk })));
        rewardResults.push(...results);
        state.progressState = {
          step: "fetching_rewards",
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
          log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
        } else {
          await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
        }
      }
      let resultIndex = 0;
      ownershipByWallet.forEach((tokenIds, wallet) => {
        let totalRewards = 0n;
        tokenIds.forEach(() => {
          const result = rewardResults[resultIndex++];
          if (result.status === "success") {
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
    state.progressState = { step: "calculating_metrics", processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
      log(`[element280] [DEBUG] Updated inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const metricsStart = Date.now();
    const multipliers = Object.values(tiers).map(t => t.multiplier);
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
    if (DISABLE_REDIS) storage.inMemoryHoldersMap = holdersMap;
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
    state.progressState = { step: "completed", processedNfts: ownershipByToken.size, totalNfts: totalSupply };
  } catch (error) {
    log(`[element280] [ERROR] Failed to populate holdersMapCache for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: "populate_cache", error: error.message });
    state.holdersMapCache = null;
    state.progressState = { step: "error", processedNfts: 0, totalNfts: 0 };
    if (DISABLE_REDIS) {
      storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
      log(`[element280] [DEBUG] Updated inMemoryCacheState (error) for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }
    throw error;
  } finally {
    state.isCachePopulating = false;
    state.totalOwners = storage.inMemoryHoldersMap ? storage.inMemoryHoldersMap.size : 0;
    if (DISABLE_REDIS) {
      storage.inMemoryCacheState = { ...state, debugId: storage.inMemoryCacheState.debugId };
      log(`[element280] [DEBUG] Finalized inMemoryCacheState for ${contractAddress}: ${JSON.stringify(storage.inMemoryCacheState)}`);
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
    await new Promise(resolve => setTimeout(resolve, 1000));
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
    holdersMap = storage.inMemoryHoldersMap || new Map();
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
      abi: element280MainAbi,
      functionName: "tokenIdsOf",
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
      abi: element280MainAbi,
      functionName: "getNftTier",
      args: [tokenId],
    });
    calls.push({
      address: vaultAddresses.element280.address,
      abi: element280VaultAbi,
      functionName: "getRewards",
      args: [[tokenId], walletLower],
    });
  });

  const results = await retry(() => client.multicall({ contracts: calls }));
  const finalTokenIds = [];
  let totalRewards = 0n;
  nfts.forEach((nft, index) => {
    const tierResult = results[index * 2];
    const rewardResult = results[index * 2 + 1];
    if (tierResult.status === "success") {
      const tier = Number(tierResult.result);
      if (tier >= 1 && tier <= 6) {
        nft.tier = tier;
        holder.tiers[tier - 1]++;
        finalTokenIds.push(BigInt(nft.tokenId));
        if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${nft.tokenId}-tier`, tier, CACHE_TTL);
      }
    }
    if (rewardResult.status === "success") {
      const rewardValue = BigInt(rewardResult.result[1] || 0);
      totalRewards += rewardValue;
      if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${nft.tokenId}-single-reward`, rewardValue, CACHE_TTL);
    }
  });
  holder.tokenIds = finalTokenIds;
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

  const allHolders = await getAllHolders(contractAddress, tiers, 0, 100);
  const totalMultiplierSum = allHolders.holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
  const existingHolder = allHolders.holders.find(h => h.wallet === walletLower);
  holder.rank = existingHolder ? existingHolder.rank : allHolders.holders.length + 1;

  if (holder.total > 0) {
    holdersMap.set(walletLower, holder);
    if (!DISABLE_REDIS) await setCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`, Array.from(holdersMap.entries()), CACHE_TTL);
    if (DISABLE_REDIS) storage.inMemoryHoldersMap = holdersMap;
    return serializeBigInt(holder);
  }
  return null;
}

// Fetch all holders
async function getAllHolders(contractAddress, tiers, page = 0, pageSize = 100, refresh = false) {
  const cacheKey = `element280_all_${contractAddress}-${page}-${pageSize}`;
  const storage = initStorage(contractAddress);
  if (!DISABLE_REDIS && !refresh) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for all holders: ${cacheError.message}, stack: ${cacheError.stack}`);
    }
  }

  let state = await getCacheState(contractAddress);
  let holdersMap;
  if (refresh || !state.holdersMapCache || state.isCachePopulating) {
    while (state.isCachePopulating) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      state = await getCacheState(contractAddress);
    }
    if (refresh || !state.holdersMapCache) {
      await populateHoldersMapCache(contractAddress, tiers);
      holdersMap = DISABLE_REDIS ? storage.inMemoryHoldersMap || new Map() : new Map(await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`) || []);
    } else {
      holdersMap = DISABLE_REDIS ? storage.inMemoryHoldersMap || new Map() : new Map(await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`) || []);
    }
  } else {
    holdersMap = DISABLE_REDIS ? storage.inMemoryHoldersMap || new Map() : new Map(await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`) || []);
  }

  const { totalSupply, totalBurned } = await getTotalSupply(contractAddress, []);
  const holders = Array.from(holdersMap.values());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, holders.length);
  const paginatedHolders = holders.slice(start, end);

  let tierDistribution = Array(6).fill(0);
  let multiplierPool = 0;
  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: element280MainAbi, functionName: "getTotalNftsPerTiers" },
          { address: contractAddress, abi: element280MainAbi, functionName: "multiplierPool" },
        ],
      })
    );
    if (results[0].status === "success") {
      tierDistribution = results[0].result.map(Number);
      log(`[element280] [DEBUG] Fetched tierDistribution for ${contractAddress}: ${tierDistribution}`);
    } else {
      log(`[element280] [WARN] Failed to fetch getTotalNftsPerTiers for ${contractAddress}: ${results[0].error || "unknown error"}`);
    }
    if (results[1].status === "success") {
      multiplierPool = Number(results[1].result);
      log(`[element280] [DEBUG] Fetched multiplierPool for ${contractAddress}: ${multiplierPool}`);
    } else {
      log(`[element280] [WARN] Failed to fetch multiplierPool for ${contractAddress}: ${results[1].error || "unknown error"}`);
    }
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch tierDistribution or multiplierPool for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
  }

  const result = {
    holders: paginatedHolders,
    totalLiveTokens: holdersMap.size > 0 ? holders.reduce((sum, h) => sum + h.total, 0) : totalSupply,
    totalLiveHolders: holders.length,
    page,
    pageSize,
    totalPages: Math.ceil(holders.length / pageSize),
    summary: {
      totalLive: totalSupply,
      totalBurned,
      totalMinted: TOTAL_MINTED,
      tierDistribution,
      multiplierPool,
      totalRewardPool: holders.reduce((sum, h) => sum + h.claimableRewards, 0),
    },
  };

  if (!DISABLE_REDIS) await setCache(cacheKey, serializeBigInt(result), CACHE_TTL);
  return serializeBigInt(result);
}

// GET handler
export async function GET(request) {
  let url = request.url || (request.nextUrl && request.nextUrl.toString());
  if (!url) {
    log(`[element280] [ERROR] Both request.url and request.nextUrl are undefined`);
    return NextResponse.json({ error: "Invalid request: URL is undefined" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(url);
    const wallet = searchParams.get("wallet");
    const page = parseInt(searchParams.get("page") || "0", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "100", 10);
    const refresh = searchParams.get("refresh") === "true";

    const address = contractAddresses.element280.address;
    if (!address) {
      log(`[element280] [ERROR] Element280 contract address not found`);
      return NextResponse.json({ error: "Element280 contract address not found" }, { status: 400 });
    }

    if (wallet) {
      const holderData = await getHolderData(address, wallet, contractTiers.element280);
      return NextResponse.json(serializeBigInt({ holders: holderData ? [holderData] : [] }));
    } else {
      const result = await getAllHolders(address, contractTiers.element280, page, pageSize, refresh);
      return NextResponse.json(serializeBigInt(result));
    }
  } catch (error) {
    log(`[element280] [ERROR] Error in GET /api/holders/Element280: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

// POST handler
export async function POST() {
  const address = contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: "Element280 contract address not found" }, { status: 400 });
  }

  try {
    await populateHoldersMapCache(address, contractTiers.element280);
    const storage = initStorage(address);
    const holdersEntries = DISABLE_REDIS ? (storage.inMemoryHoldersMap ? Array.from(storage.inMemoryHoldersMap.entries()) : []) : await getCache(`${HOLDERS_CACHE_KEY}_${address}`);
    const totalLiveHolders = holdersEntries ? holdersEntries.length : 0;
    log(`[element280] [DEBUG] POST completed for ${address}: totalLiveHolders=${totalLiveHolders}, inMemoryCacheState=${JSON.stringify(storage.inMemoryCacheState)}`);
    return NextResponse.json({ message: "Cache preload completed", totalLiveHolders });
  } catch (error) {
    log(`[element280] [ERROR] Error in POST /api/holders/Element280: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Cache preload failed: ${error.message}` }, { status: 500 });
  }
}