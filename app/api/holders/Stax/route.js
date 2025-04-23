import { NextResponse } from 'next/server';
import { contractDetails, nftContracts } from '../../../nft-contracts';
import { client, alchemy, CACHE_TTL, log, batchMulticall, staxNFTAbi, staxVaultAbi, getCache, setCache } from '../../utils';

const contractAddress = nftContracts.stax?.address;
const vaultAddress = nftContracts.stax?.vaultAddress;
const tiersConfig = nftContracts.stax?.tiers;

async function retryAlchemy(fn, attempts = 3, delay = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[Stax] Alchemy retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || '1000');
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[Stax] Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  try {
    if (!contractAddress || !vaultAddress || !tiersConfig) {
      log(`[Stax] Config error: contractAddress=${contractAddress}, vaultAddress=${vaultAddress}, tiersConfig=${JSON.stringify(tiersConfig)}`);
      throw new Error('Stax contract or vault address missing');
    }

    const cacheKey = `stax_holders_${page}_${pageSize}_${wallet || 'all'}`;
    if (!wallet) {
      let cachedData;
      try {
        cachedData = await getCache(cacheKey);
        if (cachedData) {
          log(`[Stax] Returning cached data for ${cacheKey}`);
          return NextResponse.json(cachedData);
        }
      } catch (cacheError) {
        log(`[Stax] Cache read error: ${cacheError.message}`);
      }
    }
    log(`[Stax] No cache hit for ${cacheKey}`);

    // Clear cache for wallet-specific queries
    if (wallet) {
      try {
        await setCache(cacheKey, null);
      } catch (cacheError) {
        log(`[Stax] Cache clear error: ${cacheError.message}`);
      }
    }

    // Fetch totalBurned
    let totalBurned = 0;
    try {
      const burnedResult = await client.readContract({
        address: contractAddress,
        abi: staxNFTAbi,
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

    // Paginate (only if no wallet filter)
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
      abi: staxNFTAbi,
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
        abi: staxVaultAbi,
        functionName: 'getRewards',
        args: [tokenIds, holder.wallet],
      };
    });

    const totalRewardPoolCall = {
      address: vaultAddress,
      abi: staxVaultAbi,
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
      await setCache(cacheKey, response);
      log(`[Stax] Cached response: ${cacheKey}`);
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
}