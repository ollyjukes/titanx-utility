// app/api/holders/Ascendant/route.js
import { NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import config from '@/config.js';
import { getCache, setCache, loadCacheState, saveCacheState, getOwnersForContract, getNftsForOwner, log, batchMulticall, retry, safeSerialize } from '@/app/api/utils';
import ascendant from '@/abi/ascendantNFT.json';

const CONTRACT_ADDRESS = config.contractAddresses.ascendant.address;
const CACHE_TTL = config.cache.nodeCache.stdTTL;
const PAGE_SIZE = config.contractDetails.ascendant.pageSize;
const TIERS = config.contractTiers.ascendant;
const COLLECTION = 'ascendant';

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

async function getAllHolders(page = 0, pageSize = PAGE_SIZE, _requestId = '') {
  const cacheKey = `ascendant_holders_${CONTRACT_ADDRESS}-${page}-${pageSize}`;

  try {
    let cached;
    if (cacheState.isPopulating) {
      log(`[Ascendant] [INFO] Cache is populating for ${cacheKey}`);
      return { message: 'Cache is populating', ...await getCacheState(CONTRACT_ADDRESS) };
    }
    cached = await getCache(cacheKey, COLLECTION);
    if (cached) {
      log(`[Ascendant] [INFO] Cache hit: ${cacheKey}`);
      return cached;
    }
    log(`[Ascendant] [INFO] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[Ascendant] [ERROR] Cache read error for ${cacheKey}: ${cacheError.message}`);
  }

  if (!CONTRACT_ADDRESS || !TIERS) {
    log(`[Ascendant] [VALIDATION] Config error: contractAddress=${CONTRACT_ADDRESS}, tiers=${JSON.stringify(TIERS)}`);
    throw new Error('Missing contract address or tiers');
  }

  cacheState = { ...cacheState, isPopulating: true, step: 'fetching_owners', processedNfts: 0, totalNfts: 0, totalOwners: 0 };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const owners = await retry(() => getOwnersForContract(CONTRACT_ADDRESS, ascendant.abi));
  if (!Array.isArray(owners)) {
    log(`[Ascendant] [ERROR] getOwnersForContract returned non-array: ${JSON.stringify(owners)}`);
    cacheState = { ...cacheState, isPopulating: false, step: 'error' };
    await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);
    throw new Error('Invalid owners data');
  }

  cacheState = { ...cacheState, step: 'filtering_owners', totalNfts: owners.length, totalOwners: new Set(owners.map(o => o.ownerAddress.toLowerCase())).size };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

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

  cacheState = { ...cacheState, step: 'building_token_map', totalNfts: totalTokens };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

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
    await setCache(cacheKey, result, CACHE_TTL, COLLECTION);
    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);
    return result;
  }

  cacheState = { ...cacheState, step: 'fetching_tiers' };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const tierCalls = paginatedTokenIds.map(tokenId => ({
    address: CONTRACT_ADDRESS,
    abi: config.abis.ascendant.main,
    functionName: 'getNFTAttribute',
    args: [BigInt(tokenId)],
  }));
  const recordCalls = paginatedTokenIds.map(tokenId => ({
    address: CONTRACT_ADDRESS,
    abi: config.abis.ascendant.main,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));

  const [tierResults, recordResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls, config.alchemy.batchSize)),
    retry(() => batchMulticall(recordCalls, config.alchemy.batchSize)),
  ]);

  cacheState = { ...cacheState, step: 'fetching_shares' };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'totalShares',
    })
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const maxTier = Math.max(...Object.keys(TIERS).map(Number));
  const holdersMap = new Map();

  cacheState = { ...cacheState, step: 'processing_holders', processedNfts: paginatedTokenIds.length };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const walletTokenIds = new Map();
  paginatedTokenIds.forEach(tokenId => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!walletTokenIds.has(wallet)) {
      walletTokenIds.set(wallet, []);
    }
    walletTokenIds.get(wallet).push(tokenId);
  });

  const claimableCalls = Array.from(walletTokenIds.entries()).map(([wallet, tokenIds]) => ({
    address: CONTRACT_ADDRESS,
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
        log(`[Ascendant] [ERROR] Unexpected tier result format for token ${tokenId}: ${JSON.stringify(tierResult)}`);
      }
    } else {
      log(`[Ascendant] [ERROR] Tier fetch failed for token ${tokenId}: ${tierResult?.error || 'Unknown'}`);
    }
    if (tier >= 1 && tier <= maxTier) {
      holder.tiers[tier] += 1;
      holder.total += 1;
      holder.multiplierSum += TIERS[tier]?.multiplier || 0;
    }

    const recordResult = recordResults[i];
    if (recordResult?.status === 'success' && Array.isArray(recordResult.result)) {
      const sharesRaw = recordResult.result[0] || '0';
      const lockedAscendantRaw = recordResult.result[1] || '0';
      const shares = parseFloat(formatUnits(sharesRaw, 18));
      const lockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
    } else {
      log(`[Ascendant] [ERROR] Record fetch failed for token ${tokenId}: ${recordResult?.error || 'Unknown'}`);
    }
  });

  let claimableIndex = 0;
  for (const [wallet, _tokenIds] of walletTokenIds.entries()) {
    const holder = holdersMap.get(wallet);
    if (!holder) {
      claimableIndex++;
      continue;
    }
    if (claimableResults[claimableIndex]?.status === 'success') {
      const claimableRaw = claimableResults[claimableIndex].result || '0';
      holder.claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
    } else {
      log(`[Ascendant] [ERROR] Claimable fetch failed for wallet ${wallet}: ${claimableResults[claimableIndex]?.error || 'Unknown'}`);
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

  await setCache(cacheKey, result, CACHE_TTL, COLLECTION);
  cacheState = { ...cacheState, isPopulating: false, step: 'completed', totalOwners: holders.length };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  return result;
}

async function getHolderData(wallet, _requestId = '') {
  const cacheKey = `ascendant_holder_${CONTRACT_ADDRESS}-${wallet.toLowerCase()}`;

  try {
    let cached;
    if (cacheState.isPopulating) {
      log(`[Ascendant] [INFO] Cache is populating for ${cacheKey}`);
      return { message: 'Cache is populating', ...await getCacheState(CONTRACT_ADDRESS) };
    }
    cached = await getCache(cacheKey, COLLECTION);
    if (cached) {
      log(`[Ascendant] [INFO] Cache hit: ${cacheKey}`);
      return cached;
    }
    log(`[Ascendant] [INFO] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[Ascendant] [ERROR] Cache read error for ${cacheKey}: ${cacheError.message}`);
  }

  if (!CONTRACT_ADDRESS || !TIERS) {
    log(`[Ascendant] [VALIDATION] Config error: contractAddress=${CONTRACT_ADDRESS}, tiers=${JSON.stringify(TIERS)}`);
    throw new Error('Missing contract address or tiers');
  }

  cacheState = { ...cacheState, isPopulating: true, step: 'fetching_nfts', processedNfts: 0, totalNfts: 0, totalOwners: 0 };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const nfts = await retry(() => getNftsForOwner(wallet.toLowerCase(), CONTRACT_ADDRESS, ascendant.abi));
  if (nfts.length === 0) {
    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);
    return null;
  }

  cacheState = { ...cacheState, step: 'processing_nfts', totalNfts: nfts.length, totalOwners: 1 };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const maxTier = Math.max(...Object.keys(TIERS).map(Number));
  const holder = {
    wallet: wallet.toLowerCase(),
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
    address: CONTRACT_ADDRESS,
    abi: config.abis.ascendant.main,
    functionName: 'getNFTAttribute',
    args: [tokenId],
  }));
  const recordCalls = tokenIds.map(tokenId => ({
    address: CONTRACT_ADDRESS,
    abi: config.abis.ascendant.main,
    functionName: 'userRecords',
    args: [tokenId],
  }));
  const claimableCall = {
    address: CONTRACT_ADDRESS,
    abi: config.abis.ascendant.main,
    functionName: 'batchClaimableAmount',
    args: [tokenIds],
  };

  cacheState = { ...cacheState, step: 'fetching_attributes' };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

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
        log(`[Ascendant] [ERROR] Unexpected tier result format for token ${tokenIds[i]}: ${JSON.stringify(result)}`);
        return;
      }
      if (tier >= 1 && tier <= maxTier) {
        holder.tiers[tier] += 1;
        holder.total += 1;
        holder.multiplierSum += TIERS[tier]?.multiplier || 0;
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
    log(`[Ascendant] [ERROR] Claimable fetch failed for wallet ${wallet}: ${claimableResults[0]?.error || 'Unknown'}`);
  }

  cacheState = { ...cacheState, step: 'fetching_shares' };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'totalShares',
    })
  );
  const totalMultiplierSum = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: config.abis.ascendant.main,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: CONTRACT_ADDRESS,
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

  await setCache(cacheKey, holder, CACHE_TTL, COLLECTION);
  cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
  await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);

  return holder;
}

export async function GET(request) {
  const _requestId = crypto.randomUUID();
  const { searchParams, pathname } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || PAGE_SIZE, 10);
  const wallet = searchParams.get('wallet');

  if (pathname.endsWith('/progress')) {
    const state = await getCacheState(CONTRACT_ADDRESS);
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
      const holder = await getHolderData(wallet, _requestId);
      if (!holder) {
        log(`[Ascendant] [ERROR] No holder data found for wallet ${wallet}`);
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      return NextResponse.json(safeSerialize(holder));
    }

    const data = await getAllHolders(page, pageSize, _requestId);
    if (!data.holders || !Array.isArray(data.holders)) {
      log(`[Ascendant] [ERROR] Invalid holders data returned: ${JSON.stringify(data)}`);
      return NextResponse.json({ error: 'Invalid holders data' }, { status: 500 });
    }
    return NextResponse.json(safeSerialize(data));
  } catch (error) {
    log(`[Ascendant] [ERROR] GET error: ${error.message}, stack: ${error.stack}`);
    let status = 500;
    let message = 'Failed to fetch Ascendant data';
    if (error.message.includes('Rate limit')) {
      status = 429;
      message = 'Rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}

export async function POST(_request) {
  try {
    cacheState = { ...cacheState, isPopulating: true, step: 'starting' };
    await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);
    const data = await getAllHolders(0, PAGE_SIZE);
    return NextResponse.json({ message: 'Cache population triggered', ...data });
  } catch (error) {
    log(`[Ascendant] [ERROR] POST error: ${error.message}, stack: ${error.stack}`);
    cacheState = { ...cacheState, isPopulating: false, step: 'error' };
    await saveCacheState(CONTRACT_ADDRESS, cacheState, COLLECTION);
    return NextResponse.json({ error: 'Failed to populate cache', details: error.message }, { status: 500 });
  }
}