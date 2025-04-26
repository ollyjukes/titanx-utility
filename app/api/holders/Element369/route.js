import { NextResponse } from 'next/server';
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
}