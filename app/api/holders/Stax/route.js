// app/api/holders/Stax/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, log, batchMulticall, getCache, setCache, safeSerialize } from '../../utils.js';
import NodeCache from 'node-cache';
import staxNFT from '@/abi/staxNFT.json';

const CACHE_TTL = config.cache.nodeCache.stdTTL;
const DISABLE_REDIS = process.env.DISABLE_STAX_REDIS === 'true';
const inMemoryCache = new NodeCache({ stdTTL: CACHE_TTL });

const contractAddress = config.contractAddresses.stax.address;
const vaultAddress = config.vaultAddresses.stax.address;
const tiersConfig = config.contractTiers.stax;
const defaultPageSize = config.contractDetails.stax.pageSize || 1000;

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

    const owners = await getOwnersForContract(contractAddress, staxNFT.abi);
    log(`[Stax] Owners fetched: ${owners.length}`);

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
    log(`[Stax] Live owners after filter: ${filteredOwners.length}`);

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
    log(`[Stax] Total tokens: ${totalTokens}`);

    let paginatedTokenIds = Array.from(tokenOwnerMap.keys());
    if (!wallet) {
      const start = page * pageSize;
      const end = Math.min(start + pageSize, paginatedTokenIds.length);
      paginatedTokenIds = paginatedTokenIds.slice(start, end);
    }
    log(`[Stax] Paginated tokens: ${paginatedTokenIds.length}`);

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

    tierResults.forEach((result, i) => {
      const tokenId = paginatedTokenIds[i];
      if (result?.status === 'success') {
        log(`[Stax] Token ${tokenId}: Tier ${result.result}`);
      } else {
        log(`[Stax] Tier fetch failed for token ${tokenId}: ${result?.error || 'Unknown'}`);
      }
    });

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
      message = 'Rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}