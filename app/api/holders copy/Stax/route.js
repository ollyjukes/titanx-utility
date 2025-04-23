import { NextResponse } from 'next/server';
import { contractDetails, nftContracts } from '../../../nft-contracts';
import { client, alchemy, cache, CACHE_TTL, log, batchMulticall, staxNFTAbi, staxVaultAbi } from '../../utils';

const contractAddress = nftContracts.stax?.address;
const vaultAddress = nftContracts.stax?.vaultAddress;
const tiersConfig = nftContracts.stax?.tiers;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || '1000');
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[Stax] Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  try {
    if (!contractAddress || !vaultAddress) {
      throw new Error('Stax contract or vault address missing');
    }

    const cacheKey = `stax_holders_${page}_${pageSize}_${wallet || 'all'}`;
    if (cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL && !wallet) {
      log(`[Stax] Cache hit: ${cacheKey}`);
      return NextResponse.json(cache[cacheKey].data);
    }
    log(`[Stax] Cache miss or wallet filter: ${cacheKey}`);

    // Clear cache for wallet-specific queries to avoid stale data
    if (wallet) {
      delete cache[cacheKey];
    }

    // Fetch owners
    const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, {
      block: 'latest',
      withTokenBalances: true,
    });
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
    log(`[Stax] Tiers fetched for ${tierResults.length} tokens`);

    // Log tier results for debugging
    tierResults.forEach((result, i) => {
      const tokenId = paginatedTokenIds[i];
      if (result?.status === 'success') {
        log(`[Stax] Token ${tokenId}: Tier ${result.result}`);
      } else {
        log(`[Stax] Tier fetch failed for token ${tokenId}: ${result?.error || 'Unknown'}`);
      }
    });

    // Build holders
    const maxTier = Math.max(...Object.keys(tiersConfig).map(Number)); // 12
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
              tiers: Array(maxTier).fill(0), // 12 elements
              claimableRewards: 0,
            });
          }
          const holder = holdersMap.get(walletAddr);
          holder.total += 1;
          holder.multiplierSum += tiersConfig[tier]?.multiplier || 0;
          holder.tiers[tier - 1] += 1; // Zero-based indexing
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
        if (holder.claimableRewards === 0) {
          log(`[Stax] Zero rewards for ${holder.wallet}: Tokens=${ownerTokens.get(holder.wallet).join(',')}`);
        }
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
      page,
      pageSize,
      totalPages: wallet ? 1 : Math.ceil(totalTokens / pageSize),
    };
    cache[cacheKey] = { data: response, timestamp: Date.now() };
    log(`[Stax] Success: ${holders.length} holders`);

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