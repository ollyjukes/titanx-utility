// app/api/holders/Element280/route.js
import { NextResponse } from 'next/server';
import { log, saveCacheState, getCache, setCache, loadCacheState, batchMulticall, safeSerialize, getOwnersForContract, getNftsForOwner } from '@/app/api/utils';
import config from '@/config';
import { client } from '@/app/api/utils';
import pLimit from 'p-limit';
import { parseAbiItem } from 'viem';
import element280 from '@/abi/element280.json';

const CACHE_TTL = config.cache.nodeCache.stdTTL;
const HOLDERS_CACHE_KEY = 'element280_holders_map';
const TOKEN_CACHE_KEY = 'element280_token_cache';
const BURNED_EVENTS_CACHE_KEY = 'element280_burned_events';

export async function getCacheState(contractAddress) {
  try {
    const state = await loadCacheState(`state_${contractAddress}`);
    return state || {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 },
    };
  } catch (error) {
    log(`[element280] [ERROR] Error fetching cache state for ${contractAddress}: ${error.message}`);
    return {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: 'error', processedNfts: 0, totalNfts: 0 },
    };
  }
}

async function getBurnedCountFromEvents(contractAddress, errorLog) {
  const burnAddress = '0x0000000000000000000000000000000000000000';
  let cachedBurned = await getCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`);

  if (cachedBurned) {
    return cachedBurned.count;
  }

  let burnedCount = 0;
  const endBlock = await client.getBlockNumber();
  const limit = pLimit(2);
  const ranges = [];
  for (let fromBlock = BigInt(config.deploymentBlocks.element280.block); fromBlock <= endBlock; fromBlock += BigInt(config.nftContracts.element280.maxTokensPerOwnerQuery)) {
    const toBlock = BigInt(Math.min(Number(fromBlock) + config.nftContracts.element280.maxTokensPerOwnerQuery - 1, Number(endBlock)));
    ranges.push({ fromBlock, toBlock });
  }

  try {
    await Promise.all(
      ranges.map(({ fromBlock, toBlock }) =>
        limit(async () => {
          const logs = await client.getLogs({
            address: contractAddress,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
            fromBlock,
            toBlock,
          });
          const burns = logs.filter(log => log.args.to.toLowerCase() === burnAddress);
          burnedCount += burns.length;
        })
      )
    );

    const cacheData = { count: burnedCount, timestamp: Date.now() };
    await setCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`, cacheData, CACHE_TTL);
    return burnedCount;
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch burned events for ${contractAddress}: ${error.message}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned_events', error: error.message });
    throw error;
  }
}

async function getTotalSupply(contractAddress, errorLog) {
  const cacheKey = `element280_total_supply_${contractAddress}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return { totalSupply: cached.totalSupply, totalBurned: cached.totalBurned };
  }

  try {
    const results = await batchMulticall([
      { address: contractAddress, abi: config.abis.element280.main, functionName: 'totalSupply' },
    ]);
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

    await setCache(cacheKey, { totalSupply, totalBurned }, CACHE_TTL);
    return { totalSupply, totalBurned };
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch total supply for ${contractAddress}: ${error.message}`);
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
  const owners = await getOwnersForContract(contractAddress, element280.abi);
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
  const ownerResults = await batchMulticall(ownerCalls);
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

  const { totalSupply } = await getTotalSupply(contractAddress, errorLog);
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

  return { ownershipByToken, ownershipByWallet, totalSupply };
}

async function populateHoldersMapCache(contractAddress) {
  let state = await getCacheState(contractAddress);
  if (state.isCachePopulating) {
    return;
  }

  state.isCachePopulating = true;
  state.progressState = { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 };
  await saveCacheState(`state_${contractAddress}`, state);

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
  let holdersMap = new Map(); // Declare holdersMap outside try block

  try {
    const supplyStart = Date.now();
    const { ownershipByToken, ownershipByWallet, totalSupply } = await fetchAllNftOwnership(contractAddress, errorLog, timings);
    timings.totalSupply = Date.now() - supplyStart;
    state.progressState = { step: 'fetching_ownership', processedNfts: 0, totalNfts: totalSupply };
    await saveCacheState(`state_${contractAddress}`, state);

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
      holdersMap.set(wallet, holder);
      setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${wallet}-nfts`, tokenIds.map(id => ({ tokenId: id, tier: 0 })), CACHE_TTL);
    });
    timings.holderInit = Date.now() - holderInitStart;
    state.totalOwners = holdersMap.size;
    state.progressState = { step: 'fetching_tiers', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    await saveCacheState(`state_${contractAddress}`, state);

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
        const results = await limit(() => batchMulticall(chunk));
        tierResults.push(...results);
        state.progressState = {
          step: 'fetching_tiers',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        await saveCacheState(`state_${contractAddress}`, state);
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
              setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${tokenId}-tier`, tier, CACHE_TTL);
            }
          }
        } else {
          log(`[element280] [ERROR] Failed to fetch tier for token ${tokenId}: ${result.error || 'unknown error'}`);
        }
      });
    }
    timings.tierFetch = Date.now() - tierFetchStart;
    state.progressState = { step: 'fetching_rewards', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    await saveCacheState(`state_${contractAddress}`, state);

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
        const results = await limit(() => batchMulticall(chunk));
        rewardResults.push(...results);
        state.progressState = {
          step: 'fetching_rewards',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        await saveCacheState(`state_${contractAddress}`, state);
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
          setCache(`${TOKEN_CACHE_KEY}_element280-${wallet}-reward`, holder.claimableRewards, CACHE_TTL);
        }
      });
    }
    timings.rewardFetch = Date.now() - rewardFetchStart;
    state.progressState = { step: 'calculating_metrics', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    await saveCacheState(`state_${contractAddress}`, state);

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
    await setCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`, Array.from(holdersMap.entries()), CACHE_TTL);
    timings.metricsCalc = Date.now() - metricsStart;

    timings.total = Date.now() - totalStart;
    state.progressState = { step: 'completed', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
  } catch (error) {
    log(`[element280] [ERROR] Failed to populate holdersMapCache for ${contractAddress}: ${error.message}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'populate_cache', error: error.message });
    state.holdersMapCache = null;
    state.progressState = { step: 'error', processedNfts: 0, totalNfts: 0 };
  } finally {
    state.isCachePopulating = false;
    state.totalOwners = holdersMap.size; // Safe to access holdersMap
    await saveCacheState(`state_${contractAddress}`, state);
  }
}

async function getHolderData(contractAddress, wallet) {
  const cacheKey = `element280_holder_${contractAddress}-${wallet.toLowerCase()}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  let state = await getCacheState(contractAddress);
  while (state.isCachePopulating) {
    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    state = await getCacheState(contractAddress);
  }

  let holdersMap;
  try {
    const holdersEntries = await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`);
    holdersMap = holdersEntries ? new Map(holdersEntries) : new Map();
  } catch (cacheError) {
    log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}`);
    holdersMap = new Map();
  }

  const walletLower = wallet.toLowerCase();
  if (holdersMap.has(walletLower)) {
    const holder = holdersMap.get(walletLower);
    await setCache(cacheKey, safeSerialize(holder), CACHE_TTL);
    return safeSerialize(holder);
  }

  const nfts = await getNftsForOwner(walletLower, contractAddress, element280.abi);
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

  const results = await batchMulticall(calls);
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
        setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${nft.tokenId}-tier`, tier, CACHE_TTL);
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
  setCache(`${TOKEN_CACHE_KEY}_element280-${walletLower}-reward`, holder.claimableRewards, CACHE_TTL);

  const multipliers = Object.values(config.contractTiers.element280).map(t => t.multiplier);
  holder.multiplierSum = holder.tiers.reduce(
    (sum, count, index) => sum + count * (multipliers[index] || 0),
    0
  );
  holder.displayMultiplierSum = holder.multiplierSum / 10;

  await setCache(cacheKey, safeSerialize(holder), CACHE_TTL);
  return safeSerialize(holder);
}

async function getAllHolders(contractAddress, page = 0, pageSize = 100) {
  let state = await getCacheState(contractAddress);

  if (state.progressState.step === 'completed') {
    const persistedHolders = await loadCacheState(`holders_${contractAddress}`);
    if (persistedHolders) {
      await setCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`, persistedHolders);
    } else {
      await populateHoldersMapCache(contractAddress);
      state = await getCacheState(contractAddress);
    }
  }

  while (state.isCachePopulating) {
    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    state = await getCacheState(contractAddress);
  }

  let holdersMap;
  try {
    const holdersEntries = await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`);
    holdersMap = holdersEntries ? new Map(holdersEntries) : new Map();
  } catch (cacheError) {
    log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}`);
    holdersMap = new Map();
  }

  if (holdersMap.size === 0 && state.progressState.step !== 'completed') {
    await populateHoldersMapCache(contractAddress);
    state = await getCacheState(contractAddress);
    holdersMap = new Map(await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`) || []);
  }

  let tierDistribution = [0, 0, 0, 0, 0, 0];
  let multiplierPool = 0;
  try {
    const results = await batchMulticall([
      { address: contractAddress, abi: config.abis.element280.main, functionName: 'getTotalNftsPerTiers' },
      { address: contractAddress, abi: config.abis.element280.main, functionName: 'multiplierPool' },
    ]);
    if (results[0].status === 'success' && results[0].result) {
      tierDistribution = results[0].result.map(Number);
    }
    if (results[1].status === 'success' && results[1].result) {
      multiplierPool = Number(results[1].result);
    }
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch tierDistribution or multiplierPool: ${error.message}`);
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
        await setCache(`element280_tier_distribution_${contractAddress}`, { tierDistribution, multiplierPool }, CACHE_TTL);
      } catch (computeError) {
        log(`[element280] [ERROR] Failed to compute tierDistribution: ${computeError.message}`);
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
      const holder = await getHolderData(address, wallet);
      if (!holder) {
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      return NextResponse.json(safeSerialize(holder));
    }

    const data = await getAllHolders(address, page, pageSize);
    return NextResponse.json(data);
  } catch (error) {
    log(`[element280] [ERROR] GET error: ${error.message}`);
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
    populateHoldersMapCache(address).catch((error) => {
      log(`[element280] [ERROR] Async cache population failed: ${error.message}`);
    });
    return NextResponse.json({ message: 'Cache population started' });
  } catch (error) {
    log(`[element280] [ERROR] POST error: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}