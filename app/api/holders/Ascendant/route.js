// app/api/holders/Ascendant/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, getOwnersForContract, getNftsForOwner, log, batchMulticall, getCache, setCache, safeSerialize, retry } from '@/app/api/utils';
import { formatUnits, getAddress } from 'viem';
import ascendant from '@/abi/ascendantNFT.json';

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

async function getAllHolders(page = 0, pageSize = config.contractDetails.ascendant.pageSize, _requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holders_${contractAddress}-${page}-${pageSize}`;

  try {
    let cached;
    if (cacheState.isPopulating) {
      return { message: 'Cache is populating', ...await getCacheState(contractAddress) };
    }
    cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }
  } catch (cacheError) {
    log(`[Ascendant] [ERROR] Cache read error: ${cacheError.message}`);
  }

  if (!contractAddress || !tiers) {
    log(`[Ascendant] [VALIDATION] Config error: contractAddress=${contractAddress}, tiers=${JSON.stringify(tiers)}`);
    throw new Error('Missing contract address or tiers');
  }

  cacheState = { ...cacheState, isPopulating: true, step: 'fetching_owners', processedNfts: 0, totalNfts: 0, totalOwners: 0 };
  const owners = await retry(() => getOwnersForContract(contractAddress, ascendant.abi));
  cacheState = { ...cacheState, step: 'filtering_owners', totalNfts: owners.length, totalOwners: new Set(owners.map(o => o.ownerAddress.toLowerCase())).size };

  const burnAddress = '0x0000000000000000000000000000000000000000';
  const filteredOwners = owners.filter(
    owner => owner.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress
  );

  const tokenOwnerMap = new Map();
  let totalTokens = 0;

  filteredOwners.forEach(owner => {
    if (!owner.ownerAddress) return;
    let wallet;
    try {
      wallet = getAddress(owner.ownerAddress);
    } catch (error) {
      log(`[Ascendant] [ERROR] Invalid wallet address: ${owner.ownerAddress}, Error: ${error.message}`);
      return;
    }
    const tokenId = Number(owner.tokenId);
    tokenOwnerMap.set(tokenId, wallet);
    totalTokens++;
  });
  cacheState = { ...cacheState, step: 'building_token_map' };

  const allTokenIds = Array.from(tokenOwnerMap.keys());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, allTokenIds.length);
  const paginatedTokenIds = allTokenIds.slice(start, end);

  if (paginatedTokenIds.length === 0) {
    const result = {
      holders: [],
      totalTokens,
      totalShares: 0,
      toDistributeDay8: 0,
      toDistributeDay28: 0,
      toDistributeDay90: 0,
      pendingRewards: 0,
      page,
      pageSize,
      totalPages: Math.ceil(totalTokens / pageSize),
    };
    await setCache(cacheKey, result);
    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    return result;
  }

  cacheState = { ...cacheState, step: 'fetching_tiers' };
  const tierCalls = paginatedTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'getNFTAttribute',
    args: [BigInt(tokenId)],
  }));
  const recordCalls = paginatedTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));

  const [tierResults, recordResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall(recordCalls, config.alchemy.batchSize)),
  ]);

  cacheState = { ...cacheState, step: 'fetching_shares' };
  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'totalShares',
    })
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();

  cacheState = { ...cacheState, step: 'processing_holders', processedNfts: paginatedTokenIds.length };
  const walletTokenIds = new Map();
  paginatedTokenIds.forEach(tokenId => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!walletTokenIds.has(wallet)) {
      walletTokenIds.set(wallet, []);
    }
    walletTokenIds.get(wallet).push(tokenId);
  });

  const claimableCalls = Array.from(walletTokenIds.entries()).map(([_wallet, tokenIds]) => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'batchClaimableAmount',
    args: [tokenIds.map(id => BigInt(id))],
  }));

  const claimableResults = await retry(() => batchMulticall(claimableCalls, config.alchemy.batchSize));

  paginatedTokenIds.forEach((tokenId, i) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!holdersMap.has(wallet)) {
      holdersMap.set(wallet, {
        wallet,
        total: 0,
        multiplierSum: 0,
        tiers: Array(maxTier + 1).fill(0),
        shares: 0,
        lockedAscendant: 0,
        pendingDay8: 0,
        pendingDay28: 0,
        pendingDay90: 0,
        claimableRewards: 0,
      });
    }
    const holder = holdersMap.get(wallet);

    const tierResult = tierResults[i];
    let tier;
    if (tierResult?.status === 'success') {
      if (Array.isArray(tierResult.result) && tierResult.result.length >= 2) {
        tier = Number(tierResult.result[1]);
      } else if (typeof tierResult.result === 'object' && tierResult.result.tier !== undefined) {
        tier = Number(tierResult.result.tier);
      } else {
        log(`[Ascendant] [ERROR] Unexpected tier result format for token ${tokenId}`);
      }
    }
    if (tier >= 1 && tier <= maxTier) {
      holder.tiers[tier] += 1;
      holder.total += 1;
      holder.multiplierSum += tiers[tier]?.multiplier || 0;
    }

    const recordResult = recordResults[i];
    if (recordResult?.status === 'success' && Array.isArray(recordResult.result)) {
      const sharesRaw = recordResult.result[0] || '0';
      const lockedAscendantRaw = recordResult.result[1] || '0';
      const shares = parseFloat(formatUnits(sharesRaw, 18));
      const lockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
    }
  });

  let claimableIndex = 0;
  for (const [_wallet, _tokenIds] of walletTokenIds.entries()) {
    const holder = holdersMap.get(_wallet);
    if (!holder) {
      claimableIndex++;
      continue;
    }
    if (claimableResults[claimableIndex]?.status === 'success') {
      const claimableRaw = claimableResults[claimableIndex].result || '0';
      holder.claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
    }
    claimableIndex++;
  }

  const holders = Array.from(holdersMap.values());
  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
  const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
  const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

  holders.forEach(holder => {
    holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
    holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
    holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  holders.sort((a, b) => b.shares - a.shares || b.multiplierSum - a.shares || b.total - a.total);
  holders.forEach((holder, index) => (holder.rank = index + 1));

  const result = {
    holders,
    totalTokens,
    totalShares,
    toDistributeDay8,
    toDistributeDay28,
    toDistributeDay90,
    pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
    page,
    pageSize,
    totalPages: Math.ceil(totalTokens / pageSize),
  };

  await setCache(cacheKey, result);
  cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
  return result;
}

// ... (getHolderData and GET handler remain unchanged)

async function getHolderData(_wallet, _requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holder_${contractAddress}-${_wallet.toLowerCase()}`;

  try {
    let cached;
    if (cacheState.isPopulating) {
      return { message: 'Cache is populating', ...await getCacheState(contractAddress) };
    }
    cached = await getCache(cacheKey);
    if (cached) {
      return cached;
    }
  } catch (cacheError) {
    log(`[Ascendant] [ERROR] Cache read error: ${cacheError.message}`);
  }

  if (!contractAddress || !tiers) {
    log(`[Ascendant] [VALIDATION] Config error: contractAddress=${contractAddress}, tiers=${JSON.stringify(tiers)}`);
    throw new Error('Missing contract address or tiers');
  }

  cacheState = { ...cacheState, isPopulating: true, step: 'fetching_nfts', processedNfts: 0, totalNfts: 0, totalOwners: 0 };
  const nfts = await retry(() => getNftsForOwner(_wallet.toLowerCase(), contractAddress, ascendant.abi));
  if (nfts.length === 0) {
    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    return null;
  }
  cacheState = { ...cacheState, step: 'processing_nfts', totalNfts: nfts.length, totalOwners: 1 };

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holder = {
    wallet: _wallet.toLowerCase(),
    total: 0,
    multiplierSum: 0,
    tiers: Array(maxTier + 1).fill(0),
    shares: 0,
    lockedAscendant: 0,
    pendingDay8: 0,
    pendingDay28: 0,
    pendingDay90: 0,
    claimableRewards: 0,
    percentage: 0,
    rank: 0,
    displayMultiplierSum: 0,
  };

  const tokenIds = nfts.map(nft => BigInt(nft.tokenId));
  const tierCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'getNFTAttribute',
    args: [tokenId],
  }));
  const recordCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'userRecords',
    args: [tokenId],
  }));
  const claimableCall = {
    address: contractAddress,
    abi: config.abis.ascendant.main,
    functionName: 'batchClaimableAmount',
    args: [tokenIds],
  };

  cacheState = { ...cacheState, step: 'fetching_attributes' };
  const [tierResults, recordResults, claimableResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall(recordCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall([claimableCall], config.alchemy.batchSize)),
  ]);

  tierResults.forEach((result, i) => {
    if (result?.status === 'success') {
      let tier;
      if (Array.isArray(result.result) && result.result.length >= 2) {
        tier = Number(result.result[1]);
      } else if (typeof result.result === 'object' && result.result.tier !== undefined) {
        tier = Number(result.result.tier);
      } else {
        log(`[Ascendant] [ERROR] Unexpected tier result format for token ${tokenIds[i]}`);
        return;
      }
      if (tier >= 1 && tier <= maxTier) {
        holder.tiers[tier] += 1;
        holder.total += 1;
        holder.multiplierSum += tiers[tier]?.multiplier || 0;
      }
    } else {
      log(`[Ascendant] [ERROR] Tier fetch failed for token ${tokenIds[i]}: ${result?.error || 'Unknown'}`);
    }
  });

  let totalShares = 0;
  recordResults.forEach((result, i) => {
    if (result?.status === 'success' && Array.isArray(result.result)) {
      const sharesRaw = result.result[0] || '0';
      const lockedAscendantRaw = result.result[1] || '0';
      const shares = parseFloat(formatUnits(sharesRaw, 18));
      const lockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      totalShares += shares;
    } else {
      log(`[Ascendant] [ERROR] Record fetch failed for token ${tokenIds[i]}: ${result?.error || 'Unknown'}`);
    }
  });

  if (claimableResults[0]?.status === 'success') {
    const claimableRaw = claimableResults[0].result || '0';
    holder.claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
  } else {
    log(`[Ascendant] [ERROR] Claimable fetch failed for wallet ${_wallet}: ${claimableResults[0]?.error || 'Unknown'}`);
  }

  cacheState = { ...cacheState, step: 'fetching_shares' };
  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'totalShares',
    })
  );
  const totalMultiplierSum = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
  const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
  const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

  holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
  holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
  holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;
  holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
  holder.displayMultiplierSum = holder.multiplierSum;

  await setCache(cacheKey, holder);
  cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
  return holder;
}

export async function GET(request) {
  const _requestId = crypto.randomUUID();
  const { searchParams, pathname } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails.ascendant.pageSize, 10);
  const wallet = searchParams.get('wallet');

  if (pathname.endsWith('/progress')) {
    const state = await getCacheState(config.contractAddresses.ascendant.address);
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
    if (wallet) {
      const holder = await getHolderData(wallet);
      if (!holder) {
        log(`[Ascendant] [ERROR] No holder data found for wallet ${wallet}`);
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      return NextResponse.json(safeSerialize(holder));
    }

    const data = await getAllHolders(page, pageSize);
    return NextResponse.json(safeSerialize(data));
  } catch (error) {
    log(`[Ascendant] [ERROR] Error: ${error.message}`);
    let status = 500;
    let message = 'Failed to fetch Ascendant data';
    if (error.message.includes('Rate limit')) {
      status = 429;
      message = 'Rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}