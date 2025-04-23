import { NextResponse } from 'next/server';
import { alchemy, client, CACHE_TTL, log } from '@/app/api/utils';
import { contractAddresses, contractTiers, vaultAddresses, element280MainAbi, element280VaultAbi } from '@/app/nft-contracts';
import pLimit from 'p-limit';

// In-memory cache
let cache = {};
let tokenCache = new Map();
let holdersMapCache = null;
let isCachePopulating = false;
let totalOwners = 0;
let totalSupplyCache = null;
let totalBurnedCache = null;
let progressState = { step: 'idle', processedNfts: 0, totalNfts: 0 };

// Export cache state for /progress route
export function getCacheState() {
  return { isCachePopulating, holdersMapCache, totalOwners, progressState };
}

// Utility to serialize BigInt values
function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
}

// Retry utility with minimal logging
async function retry(fn, attempts = 5, delay = (retryCount, error) => (error?.details?.code === 429 ? 4000 * 2 ** retryCount : 2000), strict = true) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) {
        log(`[element280] Retry failed after ${attempts} attempts: ${error.message}`);
        if (strict) throw error;
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, delay(i, error)));
    }
  }
}

// Fetch and cache total supply and burned tokens
async function getTotalSupply(contractAddress, errorLog) {
  const contractName = 'element280';
  if (totalSupplyCache !== null && totalBurnedCache !== null) {
    return totalSupplyCache;
  }
  const startTime = Date.now();
  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          {
            address: contractAddress,
            abi: element280MainAbi,
            functionName: 'totalSupply',
          },
          {
            address: contractAddress,
            abi: element280MainAbi,
            functionName: 'totalBurned',
          },
        ],
      })
    );
    const totalSupply = results[0].status === 'success' ? Number(results[0].result) : 0;
    const totalBurned = results[1].status === 'success' && results[1].result != null ? Number(results[1].result) : 0;
    if (isNaN(totalSupply) || isNaN(totalBurned)) {
      const errorMsg = `Invalid totalSupply=${totalSupply} or totalBurned=${totalBurned}`;
      log(`[element280] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_total_supply', error: errorMsg });
      throw new Error(errorMsg);
    }
    totalSupplyCache = totalSupply;
    totalBurnedCache = totalBurned;
    log(`[element280] Fetched total supply: ${totalSupplyCache}, total burned: ${totalBurnedCache} in ${Date.now() - startTime}ms`);
    return totalSupplyCache;
  } catch (error) {
    log(`[element280] Failed to fetch total supply or burned: ${error.message}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_total_supply', error: error.message });
    throw error;
  }
}

// Fetch all NFT ownership data using contract calls
async function fetchAllNftOwnership(contractAddress, errorLog, timings) {
  const contractName = 'element280';
  const ownershipByToken = new Map();
  const ownershipByWallet = new Map();
  const burnAddress = '0x0000000000000000000000000000000000000000';

  if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    const errorMsg = `Invalid contract address: ${contractAddress}`;
    log(`[element280] ${errorMsg}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_contract', error: errorMsg });
    throw new Error(errorMsg);
  }
  log(`[element280] Starting NFT ownership fetch for contract: ${contractAddress}`);

  try {
    // Step 1: Get token IDs from Alchemy
    const tokenIdStart = Date.now();
    let pageKey = null;
    let pageCount = 0;
    let tokenIds = [];
    do {
      pageCount++;
      const response = await retry(() =>
        alchemy.nft.getNftsForContract(contractAddress, { pageKey })
      );
      if (!response.nfts || !Array.isArray(response.nfts)) {
        const errorMsg = `Invalid NFT response: nfts array missing`;
        log(`[element280] ${errorMsg}`);
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
    log(`[element280] Collected ${tokenIds.length} token IDs in ${timings.tokenIdFetch}ms`);

    if (tokenIds.length === 0) {
      const errorMsg = `No token IDs found for contract ${contractAddress}`;
      log(`[element280] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_token_ids', error: errorMsg });
      throw new Error(errorMsg);
    }

    // Step 2: Fetch owners via contract ownerOf calls
    const ownerFetchStart = Date.now();
    const ownerCalls = tokenIds.map(tokenId => ({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: 'ownerOf',
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
    log(`[element280] Fetched owners for ${ownerResults.length} tokens in ${timings.ownerFetch}ms`);

    // Step 3: Process owners
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
        } else {
          log(`[element280] Failed to fetch owner for token ${tokenId}: ${result.error || 'unknown error'}`);
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_owners', error: `Failed to fetch owner for token ${tokenId}: ${result.error || 'unknown error'}` });
        }
        invalidTokens++;
      }
    });
    timings.ownerProcess = Date.now() - ownerProcessStart;
    log(`[element280] Processed owners: ${ownershipByToken.size} valid NFTs, skipped ${invalidTokens} invalid tokens (including ${nonExistentTokens} non-existent) in ${timings.ownerProcess}ms`);

    // Step 4: Validate against totalSupply
    const totalSupply = await getTotalSupply(contractAddress, errorLog);
    const expectedLiveTokens = totalSupply - (totalBurnedCache || 0);
    if (ownershipByToken.size === 0) {
      const errorMsg = `No valid NFTs with owners found for contract ${contractAddress}`;
      log(`[element280] ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_ownership', error: errorMsg });
      throw new Error(errorMsg);
    }
    if (ownershipByToken.size > expectedLiveTokens) {
      const errorMsg = `Found ${ownershipByToken.size} NFTs, more than expected ${expectedLiveTokens}`;
      log(`[element280] Warning: ${errorMsg}`);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'validate_ownership', error: errorMsg });
    }

    log(`[element280] Completed ownership fetch: ${ownershipByToken.size} NFTs across ${ownershipByWallet.size} wallets`);
    return { ownershipByToken, ownershipByWallet };
  } catch (error) {
    log(`[element280] Failed to fetch NFT ownership: ${error.message}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_ownership', error: error.message });
    throw error;
  }
}

// Populate holdersMapCache with timing and error tracking
async function populateHoldersMapCache(contractAddress, tiers) {
  const contractName = 'element280';
  log(`[element280] Starting populateHoldersMapCache for contract: ${contractAddress}`);
  if (isCachePopulating) {
    log(`[element280] Cache population already in progress`);
    return;
  }
  isCachePopulating = true;
  progressState = { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 };
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
    holdersMapCache = new Map();

    // Step 1: Fetch total supply
    const supplyStart = Date.now();
    const totalTokens = await getTotalSupply(contractAddress, errorLog);
    timings.totalSupply = Date.now() - supplyStart;
    progressState = { step: 'fetching_ownership', processedNfts: 0, totalNfts: totalTokens };
    log(`[element280] Fetched total supply: ${totalTokens} in ${timings.totalSupply}ms`);

    // Step 2: Fetch all NFT ownership
    const { ownershipByToken, ownershipByWallet } = await fetchAllNftOwnership(contractAddress, errorLog, timings);
    totalOwners = ownershipByWallet.size;
    progressState = { step: 'initializing_holders', processedNfts: ownershipByToken.size, totalNfts: totalTokens };
    log(`[element280] Fetched ownership: ${ownershipByToken.size} NFTs, ${totalOwners} wallets`);

    // Step 3: Initialize holders
    const holderInitStart = Date.now();
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
      holdersMapCache.set(wallet, holder);
      tokenCache.set(`${contractAddress}-${wallet}-nfts`, tokenIds.map(id => ({ tokenId: id, tier: 0 })));
    });
    timings.holderInit = Date.now() - holderInitStart;
    log(`[element280] Initialized ${holdersMapCache.size} holders in ${timings.holderInit}ms`);
    progressState = { step: 'fetching_tiers', processedNfts: ownershipByToken.size, totalNfts: totalTokens };

    // Step 4: Batch fetch tiers
    const tierFetchStart = Date.now();
    const allTokenIds = Array.from(ownershipByToken.keys()).map(id => BigInt(id));
    const tierCalls = allTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: 'getNftTier',
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
        progressState = {
          step: 'fetching_tiers',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalTokens,
        };
      }
      tierResults.forEach((result, index) => {
        const tokenId = allTokenIds[index].toString();
        if (result.status === 'success') {
          const tier = Number(result.result);
          if (tier >= 1 && tier <= 6) {
            const owner = ownershipByToken.get(tokenId);
            const holder = holdersMapCache.get(owner);
            if (holder) {
              holder.tiers[tier - 1]++;
              tokenCache.set(`${contractAddress}-${tokenId}-tier`, tier);
            } else {
              log(`[element280] Warning: No holder found for token ${tokenId} (owner: ${owner})`);
              errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tiers', error: `No holder found for token ${tokenId} (owner: ${owner})` });
            }
          } else {
            log(`[element280] Invalid tier ${tier} for token ${tokenId}`);
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tiers', error: `Invalid tier ${tier} for token ${tokenId}` });
          }
        } else {
          log(`[element280] Failed to fetch tier for token ${tokenId}: ${result.error || 'unknown error'}`);
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tiers', error: `Failed to fetch tier for token ${tokenId}: ${result.error || 'unknown error'}` });
        }
      });
    }
    timings.tierFetch = Date.now() - tierFetchStart;
    log(`[element280] Fetched tiers for ${allTokenIds.length} NFTs in ${timings.tierFetch}ms`);
    progressState = { step: 'fetching_rewards', processedNfts: ownershipByToken.size, totalNfts: totalTokens };

    // Step 5: Batch fetch rewards
    const rewardFetchStart = Date.now();
    const rewardCalls = [];
    ownershipByWallet.forEach((tokenIds, wallet) => {
      tokenIds.forEach(tokenId => {
        rewardCalls.push({
          address: vaultAddresses.element280.address,
          abi: element280VaultAbi,
          functionName: 'getRewards',
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
        progressState = {
          step: 'fetching_rewards',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalTokens,
        };
      }
      let resultIndex = 0;
      ownershipByWallet.forEach((tokenIds, wallet) => {
        let totalRewards = 0n;
        tokenIds.forEach(() => {
          const result = rewardResults[resultIndex++];
          if (result.status === 'success') {
            const rewardValue = BigInt(result.result[1] || 0);
            totalRewards += rewardValue;
          } else {
            log(`[element280] Failed to fetch reward for wallet ${wallet}: ${result.error || 'unknown error'}`);
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_rewards', error: `Failed to fetch reward for wallet ${wallet}: ${result.error || 'unknown error'}` });
          }
        });
        const holder = holdersMapCache.get(wallet);
        if (holder) {
          holder.claimableRewards = Number(totalRewards) / 1e18;
          if (isNaN(holder.claimableRewards)) {
            holder.claimableRewards = 0;
            log(`[element280] Warning: NaN rewards for wallet ${wallet}, set to 0`);
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_rewards', error: `NaN rewards for wallet ${wallet}` });
          }
          tokenCache.set(`${contractName}-${wallet}-reward`, holder.claimableRewards);
        }
      });
    }
    timings.rewardFetch = Date.now() - rewardFetchStart;
    log(`[element280] Fetched rewards for ${rewardCalls.length} NFTs in ${timings.rewardFetch}ms`);
    progressState = { step: 'calculating_metrics', processedNfts: ownershipByToken.size, totalNfts: totalTokens };

    // Step 6: Calculate multipliers and metrics
    const metricsStart = Date.now();
    const multipliers = Object.values(tiers).map(t => t.multiplier);
    const totalMultiplierSum = Array.from(holdersMapCache.values()).reduce((sum, holder) => {
      holder.multiplierSum = holder.tiers.reduce(
        (sum, count, index) => sum + count * (multipliers[index] || 0),
        0
      );
      holder.displayMultiplierSum = holder.multiplierSum / 10;
      return sum + holder.multiplierSum;
    }, 0);
    const holders = Array.from(holdersMapCache.values());
    holders.forEach(holder => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    });
    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    holders.forEach((holder, index) => {
      holder.rank = index + 1;
      holdersMapCache.set(holder.wallet, holder);
    });
    timings.metricsCalc = Date.now() - metricsStart;
    log(`[element280] Calculated metrics for ${holders.length} holders in ${timings.metricsCalc}ms`);
    progressState = { step: 'idle', processedNfts: ownershipByToken.size, totalNfts: totalTokens };

    // Log summary
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
    log(`[element280] ===== Cache Population Summary Start =====\n${JSON.stringify(summary, null, 2)}\n===== Cache Population Summary End =====`);

  } catch (error) {
    log(`[element280] Failed to populate holdersMapCache: ${error.message}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'populate_cache', error: error.message });
    holdersMapCache = null;
    cache = {};
    progressState = { step: 'error', processedNfts: 0, totalNfts: 0 };

    // Log summary on error
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
      nftsProcessed: 0,
      walletsProcessed: 0,
      errors: errorLog,
    };
    log(`[element280] ===== Cache Population Summary Start (Failed) =====\n${JSON.stringify(summary, null, 2)}\n===== Cache Population Summary End =====`);
    throw error;
  } finally {
    isCachePopulating = false;
    totalOwners = 0;
    log(`[element280] Cache population complete, isCachePopulating=false, totalOwners=0`);
  }
}

// Fetch holder data for a specific wallet
async function getHolderData(contractAddress, wallet, tiers) {
  const contractName = 'element280';
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();
  const walletLower = wallet.toLowerCase();

  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  while (isCachePopulating) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (holdersMapCache?.has(walletLower)) {
    const holder = holdersMapCache.get(walletLower);
    cache[cacheKey] = { timestamp: now, data: holder };
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
      functionName: 'tokenIdsOf',
      args: [walletLower],
    })
  );
  const tokenIds = tokenIdsResponse.map(id => id.toString());
  const nfts = tokenIds.map(tokenId => ({ tokenId, tier: 0 }));
  holder.total = nfts.length;
  holder.totalLive = nfts.length;
  tokenCache.set(`${contractAddress}-${walletLower}-nfts`, nfts);

  if (nfts.length === 0) {
    return null;
  }

  const bigIntTokenIds = nfts.map(nft => BigInt(nft.tokenId));
  const calls = [];
  bigIntTokenIds.forEach(tokenId => {
    calls.push({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: 'getNftTier',
      args: [tokenId],
    });
    calls.push({
      address: vaultAddresses.element280.address,
      abi: element280VaultAbi,
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
        nft.tier = tier;
        holder.tiers[tier - 1]++;
        finalTokenIds.push(BigInt(nft.tokenId));
        tokenCache.set(`${contractAddress}-${nft.tokenId}-tier`, tier);
      }
    }
    if (rewardResult.status === 'success') {
      const rewardValue = BigInt(rewardResult.result[1] || 0);
      totalRewards += rewardValue;
      tokenCache.set(`${contractAddress}-${nft.tokenId}-single-reward`, rewardValue);
    }
  });
  holder.tokenIds = finalTokenIds;
  holder.claimableRewards = Number(totalRewards) / 1e18;
  if (isNaN(holder.claimableRewards)) {
    holder.claimableRewards = 0;
  }
  tokenCache.set(`${contractName}-${walletLower}-reward`, holder.claimableRewards);

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
    holdersMapCache?.set(walletLower, holder);
    cache[cacheKey] = { timestamp: now, data: holder };
    return serializeBigInt(holder);
  }
  return null;
}

// Fetch all holders (paginated)
async function getAllHolders(contractAddress, tiers, page = 0, pageSize = 100, refresh = false) {
  const contractName = 'element280';
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();

  if (!refresh && cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  let holdersMap = holdersMapCache;
  if (refresh || !holdersMap || isCachePopulating) {
    while (isCachePopulating) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (refresh || !holdersMap) {
      await populateHoldersMapCache(contractAddress, tiers);
      holdersMap = holdersMapCache;
      if (!holdersMap) {
        log(`[element280] Error: holdersMapCache is null after population`);
        throw new Error('Failed to populate holdersMapCache');
      }
    }
  }

  const totalTokens = await getTotalSupply(contractAddress, []);
  const holders = Array.from(holdersMap.values());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, holders.length);
  const paginatedHolders = holders.slice(start, end);

  const result = {
    holders: paginatedHolders,
    totalTokens: holdersMap.size > 0 ? holders.reduce((sum, h) => sum + h.total, 0) : totalTokens,
    totalHolders: holders.length,
    page,
    pageSize,
    totalPages: Math.ceil(holders.length / pageSize),
    summary: {
      totalLive: totalTokens,
      totalBurned: totalBurnedCache || 0,
      multiplierPool: holders.reduce((sum, h) => sum + h.multiplierSum, 0),
      totalRewardPool: holders.reduce((sum, h) => sum + h.claimableRewards, 0),
    },
  };

  cache[cacheKey] = { timestamp: now, data: result };
  log(`[element280] Paginated ${paginatedHolders.length} holders: totalHolders=${holders.length}, totalBurned=${result.summary.totalBurned}, multiplierPool=${result.summary.multiplierPool}`);
  return serializeBigInt(result);
}

// GET handler
export async function GET(request) {
  const contractName = 'element280';
  let url = request.url || (request.nextUrl && request.nextUrl.toString());
  if (!url) {
    log(`[element280] Error: Both request.url and request.nextUrl are undefined`);
    return NextResponse.json({ error: 'Invalid request: URL is undefined' }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(url);
    const wallet = searchParams.get('wallet');
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
    const refresh = searchParams.get('refresh') === 'true';

    const address = contractAddresses.element280.address;
    if (!address) {
      log(`[element280] Error: Element280 contract address not found`);
      return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
    }

    const startTime = Date.now();
    if (wallet) {
      const holderData = await getHolderData(address, wallet, contractTiers.element280);
      log(`[element280] GET /api/holders/Element280?wallet=${wallet} completed in ${Date.now() - startTime}ms`);
      return NextResponse.json(serializeBigInt({ holders: holderData ? [holderData] : [] }));
    } else {
      const result = await getAllHolders(address, contractTiers.element280, page, pageSize, refresh);
      log(`[element280] GET /api/holders/Element280?page=${page}&pageSize=${pageSize} completed in ${Date.now() - startTime}ms`);
      return NextResponse.json(serializeBigInt(result));
    }
  } catch (error) {
    log(`[element280] Error in GET /api/holders/Element280: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

// POST handler
export async function POST() {
  const contractName = 'element280';
  const address = contractAddresses.element280.address;
  if (!address) {
    log(`[element280] Error: Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    await populateHoldersMapCache(address, contractTiers.element280);
    log(`[element280] Cache preload completed, total holders: ${holdersMapCache?.size || 0}`);
    return NextResponse.json({ message: 'Cache preload completed', totalHolders: holdersMapCache?.size || 0 });
  } catch (error) {
    log(`[element280] Error in POST /api/holders/Element280: ${error.message}`);
    return NextResponse.json({ error: `Cache preload failed: ${error.message}` }, { status: 500 });
  }
}