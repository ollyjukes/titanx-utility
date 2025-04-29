// app/api/holders/Element369/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { getOwnersForContract, log, batchMulticall, getCache, setCache } from '@/app/api/utils';

const contractAddress = config.contractAddresses.element369.address;
const vaultAddress = config.vaultAddresses.element369.address;
const tiersConfig = config.contractDetails.element369.tiers;
const defaultPageSize = config.contractDetails.element369.pageSize;
const element369MinimalAbi = config.abis.element369.main;
const element369VaultMinimalAbi = config.abis.element369.vault;

let cacheState = {
  isPopulating: false,
  totalOwners: 0,
  totalNfts: 0,
  processedNfts: 0,
  step: 'idle',
  debugId: `state-${Math.random().toString(36).slice(2)}`,
};

export async function getCacheState(_address) {
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

  if (!contractAddress || !vaultAddress || !tiersConfig || !defaultPageSize) {
    log(`[Element369] [VALIDATION] Config error: contractAddress=${contractAddress}, vaultAddress=${vaultAddress}, tiersConfig=${tiersConfig}, pageSize=${defaultPageSize}`);
    return NextResponse.json({ error: 'Element369 contract, vault address, tiers config, or page size missing' }, { status: 400 });
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

  log(`[Element369] Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}, contract=${contractAddress}`);

  try {
    const cacheKey = `element369_holders_${page}_${pageSize}_${wallet || 'all'}`;
    let cachedData;
    try {
      if (cacheState.isPopulating) {
        log(`[Element369] [INFO] Waiting for cache population to complete`);
        return NextResponse.json({ message: 'Cache is populating', ...await getCacheState(contractAddress) });
      }
      cachedData = await getCache(cacheKey);
      if (cachedData) {
        log(`[Element369] [INFO] Cache hit: ${cacheKey}`);
        return NextResponse.json(cachedData);
      }
      log(`[Element369] [INFO] Cache miss: ${cacheKey}`);
    } catch (cacheError) {
      log(`[Element369] [ERROR] Cache read error: ${cacheError.message}`);
    }

    cacheState = { ...cacheState, isPopulating: true, step: 'fetching_owners', processedNfts: 0, totalNfts: 0, totalOwners: 0 };
    log(`[Element369] Fetching owners...`);
    const owners = await getOwnersForContract(contractAddress, element369MinimalAbi);
    cacheState = { ...cacheState, step: 'filtering_owners', totalNfts: owners.length, totalOwners: new Set(owners.map(o => o.ownerAddress.toLowerCase())).size };

    const burnAddress = '0x0000000000000000000000000000000000000000';
    const filteredOwners = wallet
      ? owners.filter(owner => owner.ownerAddress.toLowerCase() === wallet && owner.ownerAddress.toLowerCase() !== burnAddress)
      : owners.filter(owner => owner.ownerAddress.toLowerCase() !== burnAddress);
    log(`[Element369] Live owners: ${filteredOwners.length}`);
    cacheState = { ...cacheState, step: 'building_token_map' };

    const tokenOwnerMap = new Map();
    const ownerTokens = new Map();
    let totalTokens = 0;
    filteredOwners.forEach(owner => {
      const walletAddr = owner.ownerAddress.toLowerCase();
      const tokenId = owner.tokenId;
      tokenOwnerMap.set(tokenId, walletAddr);
      totalTokens++;
      const tokens = ownerTokens.get(walletAddr) || [];
      tokens.push(tokenId);
      ownerTokens.set(walletAddr, tokens);
    });
    log(`[Element369] Total tokens: ${totalTokens}, tokenOwnerMap size: ${tokenOwnerMap.size}`);
    cacheState = { ...cacheState, step: 'fetching_tiers' };

    const allTokenIds = Array.from(tokenOwnerMap.keys());
    const start = page * pageSize;
    const end = Math.min(start + pageSize, allTokenIds.length);
    const paginatedTokenIds = allTokenIds.slice(start, end);
    log(`[Element369] Paginated tokens: ${paginatedTokenIds.length}`);

    const tierCalls = paginatedTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: element369MinimalAbi,
      functionName: 'getNftTier',
      args: [BigInt(tokenId)],
    }));
    const tierResults = await batchMulticall(tierCalls);
    log(`[Element369] Tiers fetched for ${tierResults.length} tokens`);
    cacheState = { ...cacheState, step: 'processing_holders', processedNfts: tierResults.length };

    const maxTier = Math.max(...Object.keys(tiersConfig).filter(key => !isNaN(key)).map(Number));
    const holdersMap = new Map();

    tierResults.forEach((result, i) => {
      if (result?.status === 'success') {
        const tokenId = paginatedTokenIds[i];
        const walletAddr = tokenOwnerMap.get(tokenId);
        const tier = Number(result.result);

        if (walletAddr && walletAddr !== burnAddress) {
          if (!holdersMap.has(walletAddr)) {
            holdersMap.set(walletAddr, {
              wallet: walletAddr,
              total: 0,
              multiplierSum: 0,
              tiers: Array(maxTier).fill(0),
              infernoRewards: 0,
              fluxRewards: 0,
              e280Rewards: 0,
            });
          }
          const holder = holdersMap.get(walletAddr);
          holder.total += 1;
          if (tier >= 1 && tier <= maxTier) {
            holder.multiplierSum += tiersConfig[tier]?.multiplier || 0;
            holder.tiers[tier - 1] += 1;
          } else {
            log(`[Element369] [ERROR] Invalid tier ${tier} for token ${tokenId}`);
            holder.multiplierSum += tiersConfig[1]?.multiplier || 0;
          }
        }
      } else {
        log(`[Element369] [ERROR] Tier fetch failed for token ${paginatedTokenIds[i]}: ${result?.error || 'Unknown'}`);
      }
    });

    let holders = Array.from(holdersMap.values());
    cacheState = { ...cacheState, step: 'fetching_rewards' };

    const rewardCalls = holders.map(holder => {
      const tokenIds = ownerTokens.get(holder.wallet) || [];
      return {
        address: vaultAddress,
        abi: element369VaultMinimalAbi,
        functionName: 'getRewards',
        args: [tokenIds.map(id => BigInt(id)), holder.wallet, false],
      };
    });

    log(`[Element369] Fetching rewards for ${holders.length} holders`);
    const rewardsResults = await batchMulticall(rewardCalls);

    holders.forEach((holder, i) => {
      if (rewardsResults[i]?.status === 'success' && rewardsResults[i].result) {
        const [, , infernoPool, fluxPool, e280Pool] = rewardsResults[i].result;
        holder.infernoRewards = Number(infernoPool) / 1e18;
        holder.fluxRewards = Number(fluxPool) / 1e18;
        holder.e280Rewards = Number(e280Pool) / 1e18;
      } else {
        holder.infernoRewards = 0;
        holder.fluxRewards = 0;
        holder.e280Rewards = 0;
        log(`[Element369] [ERROR] Reward fetch failed for ${holder.wallet.slice(0, 6)}...: ${rewardsResults[i]?.error || 'Unknown'}`);
      }
      holder.displayMultiplierSum = holder.multiplierSum;
      holder.percentage = 0;
      holder.rank = 0;
    });

    const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
    holders.forEach((holder, index) => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.rank = index + 1;
      holder.displayMultiplierSum = holder.multiplierSum;
    });

    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);

    const response = {
      holders,
      totalTokens,
      page,
      pageSize,
      totalPages: wallet ? 1 : Math.ceil(totalTokens / pageSize),
    };

    await setCache(cacheKey, response);
    log(`[Element369] [INFO] Cached response: ${cacheKey}`);

    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    log(`[Element369] Success: ${holders.length} holders`);
    return NextResponse.json(response);
  } catch (error) {
    log(`[Element369] [ERROR] Error: ${error.message}`);
    cacheState = { ...cacheState, isPopulating: false, step: 'error' };
    return NextResponse.json({ error: 'Failed to fetch Element369 data', details: error.message }, { status: 500 });
  }
}