// ./app/api/holders/Stax/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, log, batchMulticall, getCache, setCache, getOwnersForContract } from '@/app/api/utils.js';
import NodeCache from 'node-cache';
import staxNFT from '@/abi/staxNFT.json';

const CACHE_TTL = config.cache.nodeCache.stdTTL;
const DISABLE_REDIS = process.env.DISABLE_STAX_REDIS === 'true';
const inMemoryCache = new NodeCache({ stdTTL: CACHE_TTL });

const contractAddress = config.contractAddresses.stax.address;
const vaultAddress = config.vaultAddresses.stax.address;
const tiersConfig = config.contractTiers.stax;
const defaultPageSize = config.contractDetails.stax.pageSize || 1000;

let cacheState = {
  isPopulating: false,
  totalOwners: 0,
  totalNfts: 0,
  processedNfts: 0,
  step: 'idle',
  debugId: `state-${Math.random().toString(36).slice(2)}`,
};

export async function getCacheState(address) {
  return {
    isCachePopulating: cacheState.isPopulating,
    totalOwners: cacheState.totalOwners,
    progressState: {
      step: cacheState.step,
      totalNfts: cacheState.totalNfts,
      processedNfts: cacheState.processedNfts,
    },
    debugId: cacheState.debugId,
  };
}

export async function GET(request) {
  const { searchParams, pathname } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || defaultPageSize);
  const wallet = searchParams.get('wallet')?.toLowerCase();

  if (!contractAddress || !vaultAddress || !tiersConfig) {
    log(`[Stax] [VALIDATION] Config error: contractAddress=${contractAddress}, vaultAddress=${vaultAddress}, tiersConfig=${JSON.stringify(tiersConfig)}`);
    return NextResponse.json({ error: 'Stax contract or vault address missing' }, { status: 400 });
  }

  if (pathname.endsWith('/progress')) {
    const state = await getCacheState(contractAddress);
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
  }

  try {
    const cacheKey = `stax_holders_${page}_${pageSize}_${wallet || 'all'}`;
    let cachedData;
    if (!wallet) {
      try {
        if (cacheState.isPopulating) {
          return NextResponse.json({ message: 'Cache is populating', ...await getCacheState(contractAddress) });
        }
        if (DISABLE_REDIS) {
          cachedData = inMemoryCache.get(cacheKey);
        } else {
          cachedData = await getCache(cacheKey);
        }
        if (cachedData) {
          return NextResponse.json(cachedData);
        }
      } catch (cacheError) {
        log(`[Stax] [ERROR] Cache read error: ${cacheError.message}`);
      }
    }

    if (wallet) {
      try {
        if (DISABLE_REDIS) {
          inMemoryCache.del(cacheKey);
        } else {
          await setCache(cacheKey, null);
        }
      } catch (cacheError) {
        log(`[Stax] [ERROR] Cache clear error: ${cacheError.message}`);
      }
    }

    let totalBurned = 0;
    try {
      const burnedResult = await client.readContract({
        address: contractAddress,
        abi: config.abis.stax.main,
        functionName: 'totalBurned',
      });
      totalBurned = Number(burnedResult || 0);
    } catch (error) {
      log(`[Stax] [ERROR] Error fetching totalBurned: ${error.message}`);
      totalBurned = 0;
    }

    cacheState = { ...cacheState, isPopulating: true, step: 'fetching_owners', processedNfts: 0, totalNfts: 0, totalOwners: 0 };
    const owners = await getOwnersForContract(contractAddress, staxNFT.abi);
    cacheState = { ...cacheState, step: 'filtering_owners', totalNfts: owners.length, totalOwners: new Set(owners.map(o => o.ownerAddress.toLowerCase())).size };

    const burnAddresses = [
      '0x0000000000000000000000000000000000000000',
      '0x000000000000000000000000000000000000dead',
    ];
    const filteredOwners = wallet
      ? owners.filter(
          owner => owner.ownerAddress.toLowerCase() === wallet && !burnAddresses.includes(owner.ownerAddress.toLowerCase())
        )
      : owners.filter(
          owner => !burnAddresses.includes(owner.ownerAddress.toLowerCase())
        );
    cacheState = { ...cacheState, step: 'building_token_map' };

    const tokenOwnerMap = new Map();
    const ownerTokens = new Map();
    let totalTokens = 0;
    filteredOwners.forEach(owner => {
      const walletAddr = owner.ownerAddress.toLowerCase();
      const tokenId = BigInt(owner.tokenId);
      tokenOwnerMap.set(tokenId, walletAddr);
      totalTokens++;
      const tokens = ownerTokens.get(walletAddr) || [];
      tokens.push(tokenId);
      ownerTokens.set(walletAddr, tokens);
    });
    cacheState = { ...cacheState, step: 'fetching_tiers' };

    let paginatedTokenIds = Array.from(tokenOwnerMap.keys());
    if (!wallet) {
      const start = page * pageSize;
      const end = Math.min(start + pageSize, paginatedTokenIds.length);
      paginatedTokenIds = paginatedTokenIds.slice(start, end);
    }

    const tierCalls = paginatedTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: config.abis.stax.main,
      functionName: 'getNftTier',
      args: [tokenId],
    }));
    const tierResults = await batchMulticall(tierCalls);
    cacheState = { ...cacheState, step: 'processing_holders', processedNfts: tierResults.length };

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
          log(`[Stax] [ERROR] Invalid tier ${tier} for token ${tokenId}`);
        }
      } else {
        log(`[Stax] [ERROR] Tier fetch failed for token ${paginatedTokenIds[i]}: ${result?.error || 'Unknown'}`);
      }
    });

    let holders = Array.from(holdersMap.values());
    cacheState = { ...cacheState, step: 'fetching_rewards' };

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

    const [rewardResults, totalRewardPoolResult] = await Promise.all([
      rewardCalls.length ? batchMulticall(rewardCalls) : [],
      batchMulticall([totalRewardPoolCall]),
    ]);

    const totalRewardPool = totalRewardPoolResult[0]?.status === 'success'
      ? Number(totalRewardPoolResult[0].result) / 1e18
      : 0;

    holders.forEach((holder, i) => {
      if (rewardResults[i]?.status === 'success' && rewardResults[i].result) {
        const [, totalPayout] = rewardResults[i].result;
        holder.claimableRewards = Number(totalPayout) / 1e18;
      } else {
        holder.claimableRewards = 0;
        log(`[Stax] [ERROR] Reward fetch failed for ${holder.wallet.slice(0, 6)}...: ${rewardResults[i]?.error || 'Unknown'}`);
      }
      holder.percentage = totalRewardPool ? (holder.claimableRewards / totalRewardPool) * 100 : 0;
      holder.rank = 0;
      holder.displayMultiplierSum = holder.multiplierSum / 10;
    });

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
    } catch (cacheError) {
      log(`[Stax] [ERROR] Cache write error: ${cacheError.message}`);
    }

    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    return NextResponse.json(response);
  } catch (error) {
    log(`[Stax] [ERROR] Error: ${error.message}, stack: ${error.stack}`);
    cacheState = { ...cacheState, isPopulating: false, step: 'error' };
    let status = 500;
    let message = 'Failed to fetch Stax data';
    if (error.message.includes('Rate limit')) {
      status = 429;
      message = 'Rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}