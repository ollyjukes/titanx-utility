// ./app/api/holders/Ascendant/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, getOwnersForContract, getNftsForOwner, log, batchMulticall, getCache, setCache, safeSerialize } from '@/app/api/utils.js';
import { formatUnits, getAddress } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import NodeCache from 'node-cache';
import ascendant from '@/abi/ascendantNFT.json';

const DISABLE_REDIS = process.env.DISABLE_ASCENDANT_REDIS === 'true';
const inMemoryCache = new NodeCache({ stdTTL: config.cache.nodeCache.stdTTL });

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

async function retry(
  fn,
  attempts = config.alchemy.maxRetries,
  delay = (retryCount, error) =>
    error?.details?.code === 429 ? config.alchemy.batchDelayMs * 2 ** retryCount : config.alchemy.batchDelayMs
) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[Ascendant] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay(i, error)));
    }
  }
}

async function getAllHolders(page = 0, pageSize = config.contractDetails.ascendant.pageSize, requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holders_${contractAddress}-${page}-${pageSize}`;

  try {
    let cached;
    if (cacheState.isPopulating) {
      return { message: 'Cache is populating', ...await getCacheState(contractAddress) };
    }
    if (DISABLE_REDIS) {
      cached = inMemoryCache.get(cacheKey);
    } else {
      cached = await getCache(cacheKey);
    }
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
    } catch (e) {
      log(`[Ascendant] [ERROR] Invalid wallet address: ${owner.ownerAddress}`);
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
      totalLockedAscendant: 0,
      totalShares: 0,
      toDistributeDay8: 0,
      toDistributeDay28: 0,
      toDistributeDay90: 0,
      pendingRewards: 0,
      page,
      pageSize,
      totalPages: Math.ceil(totalTokens / pageSize),
    };
    try {
      if (DISABLE_REDIS) {
        inMemoryCache.set(cacheKey, result);
      } else {
        await setCache(cacheKey, result);
      }
    } catch (cacheError) {
      log(`[Ascendant] [ERROR] Cache write error: ${cacheError.message}`);
    }
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
  let totalLockedAscendant = 0;

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

  const claimableCalls = Array.from(walletTokenIds.entries()).map(([wallet, tokenIds]) => ({
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
      totalLockedAscendant += lockedAscendant;
    }
  });

  let claimableIndex = 0;
  for (const [wallet, tokenIds] of walletTokenIds.entries()) {
    const holder = holdersMap.get(wallet);
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
    totalLockedAscendant,
    totalShares,
    toDistributeDay8,
    toDistributeDay28,
    toDistributeDay90,
    pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
    page,
    pageSize,
    totalPages: Math.ceil(totalTokens / pageSize),
  };

  try {
    if (DISABLE_REDIS) {
      inMemoryCache.set(cacheKey, result);
    } else {
      await setCache(cacheKey, result);
    }
  } catch (cacheError) {
    log(`[Ascendant] [ERROR] Cache write error: ${cacheError.message}`);
  }

  cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
  return result;
}

async function getHolderData(wallet, requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holder_${contractAddress}-${wallet.toLowerCase()}`;

  try {
    let cached;
    if (cacheState.isPopulating) {
      return { message: 'Cache is populating', ...await getCacheState(contractAddress) };
    }
    if (DISABLE_REDIS) {
      cached = inMemoryCache.get(cacheKey);
    } else {
      cached = await getCache(cacheKey);
    }
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
  const nfts = await retry(() => getNftsForOwner(wallet.toLowerCase(), contractAddress, ascendant.abi));
  if (nfts.length === 0) {
    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    return null;
  }
  cacheState = { ...cacheState, step: 'processing_nfts', totalNfts: nfts.length, totalOwners: 1 };

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
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
  let totalLockedAscendant = 0;
  recordResults.forEach((result, i) => {
    if (result?.status === 'success' && Array.isArray(result.result)) {
      const sharesRaw = result.result[0] || '0';
      const lockedAscendantRaw = result.result[1] || '0';
      const shares = parseFloat(formatUnits(sharesRaw, 18));
      const lockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      totalShares += shares;
      totalLockedAscendant += lockedAscendant;
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

  try {
    if (DISABLE_REDIS) {
      inMemoryCache.set(cacheKey, holder);
    } else {
      await setCache(cacheKey, holder);
    }
  } catch (cacheError) {
    log(`[Ascendant] [ERROR] Cache write error: ${cacheError.message}`);
  }

  cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
  return holder;
}

export async function GET(request) {
  const requestId = uuidv4();
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
      const holder = await getHolderData(wallet, requestId);
      if (!holder) {
        log(`[Ascendant] [ERROR] No holder data found for wallet ${wallet} (${requestId})`);
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      return NextResponse.json(safeSerialize(holder));
    }

    const data = await getAllHolders(page, pageSize, requestId);
    return NextResponse.json(safeSerialize(data));
  } catch (error) {
    log(`[Ascendant] [ERROR] Error (${requestId}): ${error.message}, stack: ${error.stack}`);
    let status = 500;
    let message = 'Failed to fetch Ascendant data';
    if (error.message.includes('Rate limit')) {
      status = 429;
      message = 'Rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}import { NextResponse } from 'next/server';
import { log } from '../../utils';
import NodeCache from 'node-cache';

// Redis toggle
const DISABLE_REDIS = process.env.DISABLE_E280_REDIS === 'true';

// In-memory cache (for future use when contract is deployed)
const inMemoryCache = new NodeCache({ stdTTL: 3600 });

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || '1000');
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[E280] GET Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}, Redis=${!DISABLE_REDIS}`);

  // Placeholder for future cache check when contract is deployed
  /*
  const cacheKey = `e280_holders_${page}_${pageSize}_${wallet || 'all'}`;
  let cachedData;
  try {
    if (DISABLE_REDIS) {
      cachedData = inMemoryCache.get(cacheKey);
    } else {
      cachedData = await getCache(cacheKey);
    }
    if (cachedData) {
      log(`[E280] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return NextResponse.json(cachedData);
    }
    log(`[E280] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[E280] Cache read error: ${cacheError.message}`);
  }
  */

  log('[E280] GET: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}

export async function POST(request) {
  log(`[E280] POST Request: Redis=${!DISABLE_REDIS}`);
  log('[E280] POST: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}// ./app/api/holders/Element369/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, getOwnersForContract, log, batchMulticall, getCache, setCache } from '@/app/api/utils.js';
import NodeCache from 'node-cache';

const contractAddress = config.contractAddresses.element369.address;
const vaultAddress = config.vaultAddresses.element369.address;
const tiersConfig = config.contractDetails.element369.tiers;
const defaultPageSize = config.contractDetails.element369.pageSize;
const element369MinimalAbi = config.abis.element369.main;
const element369VaultMinimalAbi = config.abis.element369.vault;
const inMemoryCache = new NodeCache({
  stdTTL: config.cache.nodeCache.stdTTL,
  checkperiod: config.cache.nodeCache.checkperiod,
});
const DISABLE_REDIS = process.env.DISABLE_ELEMENT369_REDIS === 'true';

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
      if (DISABLE_REDIS) {
        cachedData = inMemoryCache.get(cacheKey);
      } else {
        cachedData = await getCache(cacheKey);
      }
      if (cachedData) {
        log(`[Element369] [INFO] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
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
        const [availability, burned, infernoPool, fluxPool, e280Pool] = rewardsResults[i].result;
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

    try {
      if (DISABLE_REDIS) {
        inMemoryCache.set(cacheKey, response);
      } else {
        await setCache(cacheKey, response);
      }
      log(`[Element369] [INFO] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
    } catch (cacheError) {
      log(`[Element369] [ERROR] Cache write error: ${cacheError.message}`);
    }

    cacheState = { ...cacheState, isPopulating: false, step: 'completed' };
    log(`[Element369] Success: ${holders.length} holders`);
    return NextResponse.json(response);
  } catch (error) {
    log(`[Element369] [ERROR] Error: ${error.message}, stack: ${error.stack}`);
    cacheState = { ...cacheState, isPopulating: false, step: 'error' };
    return NextResponse.json({ error: 'Failed to fetch Element369 data', details: error.message }, { status: 500 });
  }
}// ./app/api/holders/Element280/route.js
import { NextResponse } from 'next/server';
import { log, saveCacheState, getCache, setCache, loadCacheState, batchMulticall, safeSerialize, getOwnersForContract, getNftsForOwner } from '@/app/api/utils.js';
import config from '@/config';
import { client } from '@/app/api/utils.js';
import pLimit from 'p-limit';
import { parseAbiItem } from 'viem';
import NodeCache from 'node-cache';
import element280 from '@/abi/element280.json';

const CACHE_TTL = config.cache.nodeCache.stdTTL;
const CACHE_STATE_KEY = 'element280_cache_state';
const HOLDERS_CACHE_KEY = 'element280_holders_map';
const TOKEN_CACHE_KEY = 'element280_token_cache';
const BURNED_EVENTS_CACHE_KEY = 'element280_burned_events';
const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === 'true';

const cache = new NodeCache({ stdTTL: CACHE_TTL });
cache.setMaxListeners(20);

function initStorage(contractAddress) {
  const cacheKey = `storage_${contractAddress}`;
  let storage = cache.get(cacheKey);
  if (!storage) {
    storage = {
      holdersMap: null,
      cacheState: {
        isCachePopulating: false,
        holdersMapCache: null,
        totalOwners: 0,
        progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 },
        debugId: 'state-' + Math.random().toString(36).slice(2),
      },
      burnedEventsCache: null,
    };
    cache.set(cacheKey, storage);
  }
  return storage;
}

export async function getCacheState(contractAddress) {
  const storage = initStorage(contractAddress);
  if (DISABLE_REDIS) {
    let state = storage.cacheState;
    if (!state || state.totalOwners === 0) {
      const persistedState = await loadCacheState(`state_${contractAddress}`);
      if (persistedState) {
        storage.cacheState = persistedState;
        state = persistedState;
      }
    }
    return state;
  }
  try {
    const state = await getCache(`${CACHE_STATE_KEY}_${contractAddress}`);
    return state || {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 },
    };
  } catch (error) {
    log(`[element280] [ERROR] Error fetching cache state for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    return {
      isCachePopulating: false,
      holdersMapCache: null,
      totalOwners: 0,
      progressState: { step: 'error', processedNfts: 0, totalNfts: 0 },
    };
  }
}

async function retry(fn, attempts = config.alchemy.maxRetries, delay = (retryCount) => Math.min(config.alchemy.batchDelayMs * 2 ** retryCount, config.alchemy.retryMaxDelayMs)) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[element280] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) {
        log(`[element280] [ERROR] Retry failed after ${attempts} attempts: ${error.message}, stack: ${error.stack}`);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay(i)));
    }
  }
}

async function getBurnedCountFromEvents(contractAddress, errorLog) {
  const burnAddress = '0x0000000000000000000000000000000000000000';
  const storage = initStorage(contractAddress);
  let cachedBurned = null;

  if (DISABLE_REDIS) {
    if (storage.burnedEventsCache) {
      cachedBurned = storage.burnedEventsCache;
    }
  } else {
    try {
      cachedBurned = await getCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`);
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for burned events: ${cacheError.message}`);
    }
  }

  if (cachedBurned) {
    return cachedBurned.count;
  }

  let burnedCount = 0;
  const endBlock = await retry(() => client.getBlockNumber());
  const limit = pLimit(2);
  const ranges = [];
  for (let fromBlock = BigInt(config.deploymentBlocks.element280.block); fromBlock <= endBlock; fromBlock += BigInt(config.nftContracts.element280.maxTokensPerOwnerQuery)) {
    const toBlock = BigInt(Math.min(Number(fromBlock) + config.nftContracts.element280.maxTokensPerOwnerQuery - 1, Number(endBlock)));
    ranges.push({ fromBlock, toBlock });
  }

  try {
    await Promise.all(
      ranges.map(({ fromBlock, toBlock }, index) =>
        limit(async () => {
          try {
            const logs = await retry(() =>
              client.getLogs({
                address: contractAddress,
                event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                fromBlock,
                toBlock,
              })
            );
            const burns = logs.filter(log => log.args.to.toLowerCase() === burnAddress);
            burnedCount += burns.length;
          } catch (error) {
            log(`[element280] [ERROR] Failed to fetch Transfer events for blocks ${fromBlock}-${toBlock}: ${error.message}`);
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned_events', error: error.message });
          }
        })
      )
    );

    const cacheData = { count: burnedCount, timestamp: Date.now() };
    if (DISABLE_REDIS) {
      storage.burnedEventsCache = cacheData;
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`burned_${contractAddress}`, cacheData);
    } else {
      await setCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`, cacheData, CACHE_TTL);
    }

    return burnedCount;
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch burned events for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned_events', error: error.message });
    throw error;
  }
}

async function getTotalSupply(contractAddress, errorLog) {
  const cacheKey = `element280_total_supply_${contractAddress}`;
  if (!DISABLE_REDIS) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        return { totalSupply: cached.totalSupply, totalBurned: cached.totalBurned };
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for total supply: ${cacheError.message}`);
    }
  }

  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'totalSupply' },
        ],
      })
    );
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

    if (!DISABLE_REDIS) await setCache(cacheKey, { totalSupply, totalBurned }, CACHE_TTL);
    return { totalSupply, totalBurned };
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch total supply for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
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
  const owners = await retry(() => getOwnersForContract(contractAddress, element280.abi));
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
  const ownerResults = await retry(() => batchMulticall(ownerCalls));
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

  const { totalSupply, totalBurned } = await getTotalSupply(contractAddress, errorLog);
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

  return { ownershipByToken, ownershipByWallet, totalSupply, totalBurned };
}

async function populateHoldersMapCache(contractAddress, tiers) {
  const storage = initStorage(contractAddress);
  let state = await getCacheState(contractAddress);
  if (state.isCachePopulating) {
    return;
  }

  state.isCachePopulating = true;
  state.progressState = { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 };
  if (DISABLE_REDIS) {
    storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
    cache.set(`storage_${contractAddress}`, storage);
    await saveCacheState(`state_${contractAddress}`, storage.cacheState);
  } else {
    await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
  }

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
    const supplyStart = Date.now();
    const { ownershipByToken, ownershipByWallet, totalSupply, totalBurned } = await fetchAllNftOwnership(contractAddress, errorLog, timings);
    timings.totalSupply = Date.now() - supplyStart;
    state.progressState = { step: 'fetching_ownership', processedNfts: 0, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

    const holderInitStart = Date.now();
    const holdersMap = new Map();
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
      if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${wallet}-nfts`, tokenIds.map(id => ({ tokenId: id, tier: 0 })), CACHE_TTL);
    });
    timings.holderInit = Date.now() - holderInitStart;
    state.totalOwners = holdersMap.size;
    state.progressState = { step: 'fetching_tiers', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

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
        const results = await limit(() => retry(() => batchMulticall(chunk)));
        tierResults.push(...results);
        state.progressState = {
          step: 'fetching_tiers',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
          cache.set(`storage_${contractAddress}`, storage);
          await saveCacheState(`state_${contractAddress}`, storage.cacheState);
        } else {
          await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
        }
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
              if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${tokenId}-tier`, tier, CACHE_TTL);
            }
          }
        } else {
          log(`[element280] [ERROR] Failed to fetch tier for token ${tokenId}: ${result.error || 'unknown error'}`);
        }
      });
    }
    timings.tierFetch = Date.now() - tierFetchStart;
    state.progressState = { step: 'fetching_rewards', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

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
        const results = await limit(() => retry(() => batchMulticall(chunk)));
        rewardResults.push(...results);
        state.progressState = {
          step: 'fetching_rewards',
          processedNfts: Math.min(ownershipByToken.size, i + chunkSize),
          totalNfts: totalSupply,
        };
        if (DISABLE_REDIS) {
          storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
          cache.set(`storage_${contractAddress}`, storage);
          await saveCacheState(`state_${contractAddress}`, storage.cacheState);
        } else {
          await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
        }
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
          if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_element280-${wallet}-reward`, holder.claimableRewards, CACHE_TTL);
        }
      });
    }
    timings.rewardFetch = Date.now() - rewardFetchStart;
    state.progressState = { step: 'calculating_metrics', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }

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
    if (!DISABLE_REDIS) await setCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`, Array.from(holdersMap.entries()), CACHE_TTL);
    if (DISABLE_REDIS) {
      storage.holdersMap = holdersMap;
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`holders_${contractAddress}`, Array.from(holdersMap.entries()));
    }
    timings.metricsCalc = Date.now() - metricsStart;

    timings.total = Date.now() - totalStart;
    state.progressState = { step: 'completed', processedNfts: ownershipByToken.size, totalNfts: totalSupply };
  } catch (error) {
    log(`[element280] [ERROR] Failed to populate holdersMapCache for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'populate_cache', error: error.message });
    state.holdersMapCache = null;
    state.progressState = { step: 'error', processedNfts: 0, totalNfts: 0 };
  } finally {
    state.isCachePopulating = false;
    state.totalOwners = storage.holdersMap ? storage.holdersMap.size : 0;
    if (DISABLE_REDIS) {
      storage.cacheState = { ...state, debugId: storage.cacheState.debugId };
      cache.set(`storage_${contractAddress}`, storage);
      await saveCacheState(`state_${contractAddress}`, storage.cacheState);
    } else {
      await setCache(`${CACHE_STATE_KEY}_${contractAddress}`, state);
    }
  }
}

async function getHolderData(contractAddress, wallet, tiers) {
  const cacheKey = `element280_holder_${contractAddress}-${wallet.toLowerCase()}`;
  const storage = initStorage(contractAddress);
  if (!DISABLE_REDIS) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for holder: ${cacheError.message}`);
    }
  }

  let state = await getCacheState(contractAddress);
  while (state.isCachePopulating) {
    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    state = await getCacheState(contractAddress);
  }

  let holdersMap;
  if (!DISABLE_REDIS) {
    try {
      const holdersEntries = await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`);
      holdersMap = holdersEntries ? new Map(holdersEntries) : new Map();
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}`);
      holdersMap = new Map();
    }
  } else {
    holdersMap = storage.holdersMap || new Map();
  }

  const walletLower = wallet.toLowerCase();
  if (holdersMap.has(walletLower)) {
    const holder = holdersMap.get(walletLower);
    if (!DISABLE_REDIS) await setCache(cacheKey, safeSerialize(holder), CACHE_TTL);
    return safeSerialize(holder);
  }

  const nfts = await retry(() => getNftsForOwner(walletLower, contractAddress, element280.abi));
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

  const results = await retry(() => batchMulticall(calls));
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
        if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_${contractAddress}-${nft.tokenId}-tier`, tier, CACHE_TTL);
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
  if (!DISABLE_REDIS) setCache(`${TOKEN_CACHE_KEY}_element280-${walletLower}-reward`, holder.claimableRewards, CACHE_TTL);

  const multipliers = Object.values(tiers).map(t => t.multiplier);
  holder.multiplierSum = holder.tiers.reduce(
    (sum, count, index) => sum + count * (multipliers[index] || 0),
    0
  );
  holder.displayMultiplierSum = holder.multiplierSum / 10;

  if (!DISABLE_REDIS) await setCache(cacheKey, safeSerialize(holder), CACHE_TTL);
  return safeSerialize(holder);
}

async function getAllHolders(contractAddress, page = 0, pageSize = 100) {
  const storage = initStorage(contractAddress);
  let state = await getCacheState(contractAddress);

  if (state.progressState.step === 'completed' && (!storage.holdersMap || storage.holdersMap.size === 0)) {
    const persistedHolders = await loadCacheState(`holders_${contractAddress}`);
    if (persistedHolders) {
      storage.holdersMap = new Map(persistedHolders);
    } else {
      await populateHoldersMapCache(contractAddress, config.contractTiers.element280).catch(err => {
        log(`[element280] [ERROR] Cache population failed: ${err.message}, stack: ${err.stack}`);
      });
      state = await getCacheState(contractAddress);
    }
  }

  while (state.isCachePopulating) {
    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    state = await getCacheState(contractAddress);
  }

  let holdersMap;
  if (!DISABLE_REDIS) {
    try {
      const holdersEntries = await getCache(`${HOLDERS_CACHE_KEY}_${contractAddress}`);
      holdersMap = holdersEntries ? new Map(holdersEntries) : new Map();
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for holders map: ${cacheError.message}`);
      holdersMap = new Map();
    }
  } else {
    holdersMap = storage.holdersMap || new Map();
  }

  if (holdersMap.size === 0 && state.progressState.step !== 'completed') {
    await populateHoldersMapCache(contractAddress, config.contractTiers.element280).catch(err => {
      log(`[element280] [ERROR] Cache population failed: ${err.message}, stack: ${err.stack}`);
    });
    state = await getCacheState(contractAddress);
    holdersMap = storage.holdersMap || new Map();
  }

  let tierDistribution = [0, 0, 0, 0, 0, 0];
  let multiplierPool = 0;
  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'getTotalNftsPerTiers' },
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'multiplierPool' },
        ],
      })
    );
    if (results[0].status === 'success' && results[0].result) {
      tierDistribution = results[0].result.map(Number);
    }
    if (results[1].status === 'success' && results[1].result) {
      multiplierPool = Number(results[1].result);
    }
  } catch (error) {
    log(`[element280] [ERROR] Failed to fetch tierDistribution or multiplierPool: ${error.message}, stack: ${error.stack}`);
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
        cache.set(`element280_tier_distribution_${contractAddress}`, { tierDistribution, multiplierPool }, CACHE_TTL);
      } catch (computeError) {
        log(`[element280] [ERROR] Failed to compute tierDistribution: ${computeError.message}, stack: ${computeError.stack}`);
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
      const holder = await getHolderData(address, wallet, config.contractTiers.element280);
      if (!holder) {
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      return NextResponse.json(safeSerialize(holder));
    }

    const data = await getAllHolders(address, page, pageSize);
    return NextResponse.json(data);
  } catch (error) {
    log(`[element280] [ERROR] GET error: ${error.message}, stack: ${error.stack}`);
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
    populateHoldersMapCache(address, config.contractTiers.element280).catch((error) => {
      log(`[element280] [ERROR] Async cache population failed: ${error.message}, stack: ${error.stack}`);
    });
    return NextResponse.json({ message: 'Cache population started' });
  } catch (error) {
    log(`[element280] [ERROR] POST error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}// ./app/api/holders/Stax/route.js
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
}// ./app/api/holders/Element280/progress/route.js
import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '@/app/api/holders/Element280/route';
import config from '@/config';

export async function GET() {
  const address = config.contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [VALIDATION] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    const state = await getCacheState(address);
    if (!state || !state.progressState) {
      log(`[element280] [VALIDATION] Invalid cache state for ${address}`);
      return NextResponse.json({ error: 'Cache state not initialized' }, { status: 500 });
    }
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
  } catch (error) {
    log(`[element280] [ERROR] Progress endpoint error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}// ./app/api/holders/Element280/validate-burned/route.js
import { NextResponse } from 'next/server';
import config from '@/config';
import { getTransactionReceipt, log, client } from '@/app/api/utils.js';
import { parseAbiItem } from 'viem';

export async function POST(request) {
  if (process.env.DEBUG === 'true') {
    log(`[validate-burned] [DEBUG] Processing POST request for validate-burned`);
  }

  try {
    const { transactionHash } = await request.json();
    if (!transactionHash || typeof transactionHash !== 'string' || !transactionHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      log(`[validate-burned] [VALIDATION] Invalid transaction hash: ${transactionHash || 'undefined'}`);
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const contractAddress = config.contractAddresses?.element280?.address;
    if (!contractAddress) {
      log(`[validate-burned] [VALIDATION] Element280 contract address not configured in config.js`);
      return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 });
    }

    if (process.env.DEBUG === 'true') {
      log(`[validate-burned] [DEBUG] Fetching transaction receipt for hash: ${transactionHash}`);
    }
    const receipt = await getTransactionReceipt(transactionHash);
    if (!receipt) {
      log(`[validate-burned] [VALIDATION] Transaction receipt not found for hash: ${transactionHash}`);
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const burnAddress = '0x0000000000000000000000000000000000000000';
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
    const burnedTokenIds = [];

    for (const logEntry of receipt.logs) {
      if (
        logEntry.address.toLowerCase() === contractAddress.toLowerCase() &&
        logEntry.topics[0] === transferEvent.topics[0]
      ) {
        try {
          const decodedLog = client.decodeEventLog({
            abi: [transferEvent],
            data: logEntry.data,
            topics: logEntry.topics,
          });
          if (decodedLog.args.to.toLowerCase() === burnAddress) {
            burnedTokenIds.push(decodedLog.args.tokenId.toString());
          }
        } catch (decodeError) {
          log(`[validate-burned] [ERROR] Failed to decode log entry for transaction ${transactionHash}: ${decodeError.message}`);
        }
      }
    }

    if (burnedTokenIds.length === 0) {
      log(`[validate-burned] [VALIDATION] No burn events found in transaction: ${transactionHash}`);
      return NextResponse.json({ error: 'No burn events found in transaction' }, { status: 400 });
    }

    if (process.env.DEBUG === 'true') {
      log(`[validate-burned] [DEBUG] Found ${burnedTokenIds.length} burned tokens in transaction: ${transactionHash}`);
    }
    return NextResponse.json({
      transactionHash,
      burnedTokenIds,
      blockNumber: receipt.blockNumber.toString(),
    });
  } catch (error) {
    log(`[validate-burned] [ERROR] Error processing transaction: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: 'Failed to validate transaction', details: error.message }, { status: 500 });
  }
}'use client';
import { create } from 'zustand';

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const useNFTStore = create((set, get) => ({
  cache: {},
  setCache: (contractKey, data) => {
    console.log(`[NFTStore] Setting cache for ${contractKey}: ${data.holders.length} holders`);
    set((state) => ({
      cache: {
        ...state.cache,
        [contractKey]: { data, timestamp: Date.now() },
      },
    }));
  },
  getCache: (contractKey) => {
    const cachedEntry = get().cache[contractKey];
    if (!cachedEntry) return null;
    const now = Date.now();
    if (now - cachedEntry.timestamp > CACHE_TTL) {
      console.log(`[NFTStore] Cache expired for ${contractKey}`);
      set((state) => {
        const newCache = { ...state.cache };
        delete newCache[contractKey];
        return { cache: newCache };
      });
      return null;
    }
    console.log(`[NFTStore] Returning cached data for ${contractKey}: ${cachedEntry.data.holders.length} holders`);
    return cachedEntry.data;
  },
  clearCache: () => {
    console.log('[NFTStore] Clearing cache');
    set({ cache: {} });
  },
}));// config.js
import element280NftStatus from './element280_nft_status.json' assert { type: 'json' };
import element280MainAbi from './abi/element280.json' assert { type: 'json' };
import element280VaultAbi from './abi/element280Vault.json' assert { type: 'json' };
import element369MainAbi from './abi/element369.json' assert { type: 'json' };
import element369VaultAbi from './abi/element369Vault.json' assert { type: 'json' };
import staxMainAbi from './abi/staxNFT.json' assert { type: 'json' };
import staxVaultAbi from './abi/staxVault.json' assert { type: 'json' };
import ascendantMainAbi from './abi/ascendantNFT.json' assert { type: 'json' };
// E280 ABI placeholder (not deployed)
const e280MainAbi = [];

const config = {
  // Supported blockchain networks
  supportedChains: ['ETH', 'BASE'],

  // ABIs for all collections
  abis: {
    element280: {
      main: element280MainAbi,
      vault: element280VaultAbi,
    },
    element369: {
      main: element369MainAbi,
      vault: element369VaultAbi,
    },
    stax: {
      main: staxMainAbi,
      vault: staxVaultAbi,
    },
    ascendant: {
      main: ascendantMainAbi,
      vault: [], // No vault ABI provided for Ascendant
    },
    e280: {
      main: e280MainAbi,
      vault: [],
    },
  },

  // NFT contract configurations
  nftContracts: {
    element280: {
      name: 'Element 280',
      symbol: 'ELMNT',
      chain: 'ETH',
      address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
      vaultAddress: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97',
      deploymentBlock: '20945304',
      tiers: {
        1: { name: 'Common', multiplier: 10, allocation: '100000000000000000000000000' },
        2: { name: 'Common Amped', multiplier: 12, allocation: '100000000000000000000000000' },
        3: { name: 'Rare', multiplier: 100, allocation: '1000000000000000000000000000' },
        4: { name: 'Rare Amped', multiplier: 120, allocation: '1000000000000000000000000000' },
        5: { name: 'Legendary', multiplier: 1000, allocation: '10000000000000000000000000000' },
        6: { name: 'Legendary Amped', multiplier: 1200, allocation: '10000000000000000000000000000' },
      },
      description:
        'Element 280 NFTs can be minted with TitanX or ETH during a presale and redeemed for Element 280 tokens after a cooldown period. Multipliers contribute to a pool used for reward calculations.',
      expectedTotalSupply: 8107,
      expectedBurned: 8776,
      maxTokensPerOwnerQuery: 100,
    },
    element369: {
      name: 'Element 369',
      symbol: 'E369',
      chain: 'ETH',
      address: '0x024D64E2F65747d8bB02dFb852702D588A062575',
      vaultAddress: '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5',
      deploymentBlock: '21224418',
      tiers: {
        1: { name: 'Common', multiplier: 1, price: '100000000000000000000000000' },
        2: { name: 'Rare', multiplier: 10, price: '1000000000000000000000000000' },
        3: { name: 'Legendary', multiplier: 100, price: '10000000000000000000000000000' },
      },
      description:
        'Element 369 NFTs are minted with TitanX or ETH during specific sale cycles. Burning NFTs updates a multiplier pool and tracks burn cycles for reward distribution in the Holder Vault.',
    },
    stax: {
      name: 'Stax',
      symbol: 'STAX',
      chain: 'ETH',
      address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
      vaultAddress: '0x5D27813C32dD705404d1A78c9444dAb523331717',
      deploymentBlock: '21452667',
      tiers: {
        1: { name: 'Common', multiplier: 1, price: '100000000000000000000000000' },
        2: { name: 'Common Amped', multiplier: 1.2, price: '100000000000000000000000000', amplifier: '10000000000000000000000000' },
        3: { name: 'Common Super', multiplier: 1.4, price: '100000000000000000000000000', amplifier: '20000000000000000000000000' },
        4: { name: 'Common LFG', multiplier: 2, price: '100000000000000000000000000', amplifier: '50000000000000000000000000' },
        5: { name: 'Rare', multiplier: 10, price: '1000000000000000000000000000' },
        6: { name: 'Rare Amped', multiplier: 12, price: '1000000000000000000000000000', amplifier: '100000000000000000000000000' },
        7: { name: 'Rare Super', multiplier: 14, price: '1000000000000000000000000000', amplifier: '200000000000000000000000000' },
        8: { name: 'Rare LFG', multiplier: 20, price: '1000000000000000000000000000', amplifier: '500000000000000000000000000' },
        9: { name: 'Legendary', multiplier: 100, price: '10000000000000000000000000000' },
        10: { name: 'Legendary Amped', multiplier: 120, price: '10000000000000000000000000000', amplifier: '1000000000000000000000000000' },
        11: { name: 'Legendary Super', multiplier: 140, price: '10000000000000000000000000000', amplifier: '2000000000000000000000000000' },
        12: { name: 'Legendary LFG', multiplier: 200, price: '10000000000000000000000000000', amplifier: '5000000000000000000000000000' },
      },
      description:
        'Stax NFTs are minted with TitanX or ETH during a presale. Burning NFTs after a cooldown period claims backing rewards, with multipliers contributing to a pool for cycle-based reward calculations.',
    },
    ascendant: {
      name: 'Ascendant',
      symbol: 'ASCNFT',
      chain: 'ETH',
      address: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f',
      deploymentBlock: '21112535',
      tiers: {
        1: { name: 'Tier 1', price: '7812500000000000000000', multiplier: 1.01 },
        2: { name: 'Tier 2', price: '15625000000000000000000', multiplier: 1.02 },
        3: { name: 'Tier 3', price: '31250000000000000000000', multiplier: 1.03 },
        4: { name: 'Tier 4', price: '62500000000000000000000', multiplier: 1.04 },
        5: { name: 'Tier 5', price: '125000000000000000000000', multiplier: 1.05 },
        6: { name: 'Tier 6', price: '250000000000000000000000', multiplier: 1.06 },
        7: { name: 'Tier 7', price: '500000000000000000000000', multiplier: 1.07 },
        8: { name: 'Tier 8', price: '1000000000000000000000000', multiplier: 1.08 },
      },
      description:
        'Ascendant NFTs are minted with ASCENDANT tokens and offer staking rewards from DragonX pools over 8, 28, and 90-day periods. Features fusion mechanics to combine same-tier NFTs into higher tiers.',
    },
    e280: {
      name: 'E280',
      symbol: 'E280',
      chain: 'BASE',
      address: null,
      deploymentBlock: null,
      tiers: {},
      description: 'E280 NFTs on BASE chain. Contract not yet deployed.',
      disabled: true,
    },
  },

  // Contract addresses
  contractAddresses: {
    element280: { chain: 'ETH', address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9' },
    element369: { chain: 'ETH', address: '0x024D64E2F65747d8bB02dFb852702D588A062575' },
    stax: { chain: 'ETH', address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1' },
    ascendant: { chain: 'ETH', address: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f' },
    e280: { chain: 'BASE', address: null },
  },

  // Vault addresses
  vaultAddresses: {
    element280: { chain: 'ETH', address: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97' },
    element369: { chain: 'ETH', address: '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5' },
    stax: { chain: 'ETH', address: '0x5D27813C32dD705404d1A78c9444dAb523331717' },
    e280: { chain: 'BASE', address: null },
  },

  // Deployment blocks
  deploymentBlocks: {
    element280: { chain: 'ETH', block: '20945304' },
    element369: { chain: 'ETH', block: '21224418' },
    stax: { chain: 'ETH', block: '21452667' },
    ascendant: { chain: 'ETH', block: '21112535' },
    e280: { chain: 'BASE', block: null },
  },

  // Contract tiers
  contractTiers: {
    element280: {
      1: { name: 'Common', multiplier: 10 },
      2: { name: 'Common Amped', multiplier: 12 },
      3: { name: 'Rare', multiplier: 100 },
      4: { name: 'Rare Amped', multiplier: 120 },
      5: { name: 'Legendary', multiplier: 1000 },
      6: { name: 'Legendary Amped', multiplier: 1200 },
    },
    element369: {
      1: { name: 'Common', multiplier: 1 },
      2: { name: 'Rare', multiplier: 10 },
      3: { name: 'Legendary', multiplier: 100 },
      tierOrder: [
        { tierId: '3', name: 'Legendary' },
        { tierId: '2', name: 'Rare' },
        { tierId: '1', name: 'Common' },
      ],
    },
    stax: {
      1: { name: 'Common', multiplier: 1 },
      2: { name: 'Common Amped', multiplier: 1.2 },
      3: { name: 'Common Super', multiplier: 1.4 },
      4: { name: 'Common LFG', multiplier: 2 },
      5: { name: 'Rare', multiplier: 10 },
      6: { name: 'Rare Amped', multiplier: 12 },
      7: { name: 'Rare Super', multiplier: 14 },
      8: { name: 'Rare LFG', multiplier: 20 },
      9: { name: 'Legendary', multiplier: 100 },
      10: { name: 'Legendary Amped', multiplier: 120 },
      11: { name: 'Legendary Super', multiplier: 140 },
      12: { name: 'Legendary LFG', multiplier: 200 },
    },
    ascendant: {
      1: { name: 'Tier 1', multiplier: 1.01 },
      2: { name: 'Tier 2', multiplier: 1.02 },
      3: { name: 'Tier 3', multiplier: 1.03 },
      4: { name: 'Tier 4', multiplier: 1.04 },
      5: { name: 'Tier 5', multiplier: 1.05 },
      6: { name: 'Tier 6', multiplier: 1.06 },
      7: { name: 'Tier 7', multiplier: 1.07 },
      8: { name: 'Tier 8', multiplier: 1.08 },
    },
    e280: {},
  },

  // Contract details
  contractDetails: {
    element280: {
      name: 'Element 280',
      chain: 'ETH',
      pageSize: 100,
      apiEndpoint: '/api/holders/Element280',
      rewardToken: 'ELMNT',
    },
    element369: {
      name: 'Element 369',
      chain: 'ETH',
      pageSize: 1000,
      apiEndpoint: '/api/holders/Element369',
      rewardToken: 'INFERNO/FLUX/E280',
    },
    stax: {
      name: 'Stax',
      chain: 'ETH',
      pageSize: 1000,
      apiEndpoint: '/api/holders/Stax',
      rewardToken: 'X28',
    },
    ascendant: {
      name: 'Ascendant',
      chain: 'ETH',
      pageSize: 1000,
      apiEndpoint: '/api/holders/Ascendant',
      rewardToken: 'DRAGONX',
    },
    e280: {
      name: 'E280',
      chain: 'BASE',
      pageSize: 1000,
      apiEndpoint: '/api/holders/E280',
      rewardToken: 'E280',
      disabled: true,
    },
  },

  // Utility function to get contract details by name
  getContractDetails: (contractName) => {
    return config.nftContracts[contractName] || null;
  },

  // Alchemy settings (optimized for free tier)
  alchemy: {
    network: 'eth-mainnet',
    batchSize: 10,
    batchDelayMs: 1000,
    retryMaxDelayMs: 30000,
    maxRetries: 3,
    timeoutMs: 30000 // 30 seconds
  },

  // Cache settings
  cache: {
    redis: {
      disableElement280: process.env.DISABLE_ELEMENT280_REDIS === 'true',
      disableElement369: process.env.DISABLE_ELEMENT369_REDIS === 'true',
      disableStax: process.env.DISABLE_STAX_REDIS === 'true',
      disableAscendant: process.env.DISABLE_ASCENDANT_REDIS === 'true',
      disableE280: process.env.DISABLE_E280_REDIS === 'true' || true,
    },
    nodeCache: {
      stdTTL: 3600,
      checkperiod: 120,
    },
  },

  // Debug settings
  debug: {
    enabled: process.env.DEBUG === 'true',
    logLevel: 'debug',
  },

  // Fallback data (optional, for testing)
  fallbackData: {
    element280: process.env.USE_FALLBACK_DATA === 'true' ? element280NftStatus : null,
  },
};

export default config;// ./app/api/utils.js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { Redis } from '@upstash/redis';
import NodeCache from 'node-cache';
import pino from 'pino';
import { promises as fs } from 'fs';
import config from '@/config.js';
import { Network, Alchemy } from 'alchemy-sdk';

// Singleton logger instance
let loggerInstance = null;

const ALCHEMY_API_KEY = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
    timeout: 60000,
  }),
});

const alchemy = new Alchemy({
  apiKey: ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

const DEBUG = process.env.DEBUG === 'true';
const isProduction = process.env.NODE_ENV === 'production';

export const logger = (() => {
  if (loggerInstance) {
    if (DEBUG) console.log('[utils] [DEBUG] Reusing existing logger instance');
    return loggerInstance;
  }
  loggerInstance = pino({
    level: DEBUG ? 'debug' : 'error',
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Conditionally apply pino-pretty in development only
    ...(!isProduction
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'yyyy-mm-dd HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
  try {
    if (DEBUG) loggerInstance.debug('[utils] Pino logger initialized');
    console.log('[utils] Pino logger initialized (console)');
  } catch (error) {
    console.error('[utils] Failed to initialize logger:', error.message);
  }
  return loggerInstance;
})();

export function log(message) {
  try {
    if (message.includes('[ERROR]') || message.includes('[VALIDATION]')) {
      logger.error(message);
    } else if (DEBUG) {
      logger.debug(message);
    }
  } catch (error) {
    console.error('[utils] Logger error:', error.message);
  }
}

// ... (rest of utils.js remains unchanged)

const cache = new NodeCache({
  stdTTL: config.cache.nodeCache.stdTTL,
  checkperiod: config.cache.nodeCache.checkperiod,
});

const redis = config.cache.redis.disableElement280
  ? null
  : new Redis({
      url: process.env.REDIS_URL || config.redis.url,
      token: process.env.REDIS_TOKEN || config.redis.token,
    });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function batchMulticall(calls, batchSize = config.alchemy.batchSize, options = { retryCount: 0 }) {
  const batches = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    batches.push(calls.slice(i, i + batchSize));
  }
  const results = [];
  for (const batch of batches) {
    try {
      const batchResults = await client.multicall({ contracts: batch });
      results.push(...batchResults);
      await delay(config.alchemy.batchDelayMs);
    } catch (error) {
      log(`[utils] [ERROR] batchMulticall failed: ${error.message}`);
      if (options.retryCount < config.alchemy.maxRetries) {
        await delay(config.alchemy.retryMaxDelayMs / config.alchemy.maxRetries);
        return batchMulticall(calls, batchSize, { retryCount: options.retryCount + 1 });
      }
      throw error;
    }
  }
  return results;
}

export async function getCache(key) {
  let data = cache.get(key);
  if (!data && !config.cache.redis.disableElement280) {
    try {
      data = await redis?.get(key);
      data = data ? JSON.parse(data) : null;
    } catch (error) {
      log(`[utils] [ERROR] Redis get failed for key ${key}: ${error.message}`);
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Cache get for ${key}: ${data ? 'hit' : 'miss'}`);
  }
  return data;
}

export async function setCache(key, value, ttl = config.cache.nodeCache.stdTTL) {
  cache.set(key, value, ttl);
  if (!config.cache.redis.disableElement280) {
    try {
      await redis?.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      log(`[utils] [ERROR] Redis set failed for key ${key}: ${error.message}`);
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Cache set for ${key}`);
  }
}

export async function loadCacheState(contractAddress) {
  const cacheKey = `state_${contractAddress}`;
  let state = cache.get(cacheKey);
  if (!state && !config.cache.redis.disableElement280) {
    state = await redis?.get(cacheKey);
    state = state ? JSON.parse(state) : null;
  }
  if (!state && process.env.NODE_ENV !== 'production') {
    try {
      state = JSON.parse(await fs.readFile(`./cache_state_${contractAddress}.json`, 'utf8'));
    } catch (error) {
      state = {
        isCachePopulating: false,
        holdersMapCache: null,
        totalOwners: 0,
        progressState: { step: 'fetching_supply', processedNfts: 0, totalNfts: 0 },
      };
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Loaded cache state for ${cacheKey}: ${JSON.stringify(state)}`);
  }
  return state;
}

export async function saveCacheState(contractAddress, state) {
  const cacheKey = `state_${contractAddress}`;
  cache.set(cacheKey, state);
  if (!config.cache.redis.disableElement280) {
    try {
      await redis?.set(cacheKey, JSON.stringify(state));
    } catch (error) {
      log(`[utils] [ERROR] Redis set failed for key ${cacheKey}: ${error.message}`);
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    try {
      await fs.writeFile(`./cache_state_${contractAddress}.json`, JSON.stringify(state, null, 2));
    } catch (error) {
      log(`[utils] [ERROR] Failed to write cache state to file: ${error.message}`);
    }
  }
  if (DEBUG) {
    log(`[utils] [DEBUG] Saved cache state for ${cacheKey}`);
  }
}

export async function getNftsForOwner(ownerAddress, contractAddress, abi) {
  try {
    const contract = {
      address: contractAddress,
      abi: parseAbi(abi),
    };
    const balance = await client.readContract({
      ...contract,
      functionName: 'balanceOf',
      args: [ownerAddress],
    });
    const tokenIds = [];
    for (let i = 0; i < Number(balance); i++) {
      const tokenId = await client.readContract({
        ...contract,
        functionName: 'tokenOfOwnerByIndex',
        args: [ownerAddress, BigInt(i)],
      });
      tokenIds.push(tokenId);
    }
    if (DEBUG) {
      log(`[utils] [DEBUG] Fetched ${tokenIds.length} NFTs for owner ${ownerAddress} at contract ${contractAddress}`);
    }
    return tokenIds.map(id => ({ tokenId: id.toString(), balance: 1 }));
  } catch (error) {
    log(`[utils] [ERROR] Failed to fetch NFTs for owner ${ownerAddress}: ${error.message}`);
    throw error;
  }
}

export async function getOwnersForContract(contractAddress, abi, fromBlock = 0n) {
  const useAlchemy = process.env.USE_ALCHEMY_FOR_OWNERS === 'true';
  log(`[utils] [INFO] Fetching owners for contract ${contractAddress} using ${useAlchemy ? 'Alchemy SDK' : 'viem'}`);

  if (useAlchemy) {
    try {
      const response = await alchemy.nft.getOwnersForContract(contractAddress, {
        withTokenBalances: true,
      });
      const owners = response.owners.flatMap(owner => {
        const tokenBalances = owner.tokenBalances || [];
        return tokenBalances.map(balance => ({
          ownerAddress: owner.ownerAddress.toLowerCase(),
          tokenId: balance.tokenId,
        }));
      });
      if (DEBUG) {
        log(`[utils] [DEBUG] Fetched ${owners.length} owner-token pairs via Alchemy for contract ${contractAddress}`);
      }
      return owners;
    } catch (alchemyError) {
      log(`[utils] [ERROR] Alchemy failed for contract ${contractAddress}: ${alchemyError.message}`);
      throw new Error(`Failed to fetch owners via Alchemy: ${alchemyError.message}`);
    }
  } else {
    try {
      const fromBlockValue = config.deploymentBlocks.element369?.block || 0n;
      if (DEBUG) {
        log(`[utils] [DEBUG] Fetching logs for contract ${contractAddress} from block ${fromBlockValue}`);
        log(`[utils] [DEBUG] ABI passed: ${JSON.stringify(abi.filter(item => item.type === 'event').map(item => item.name))}`);
      }
      const logs = await client.getLogs({
        address: contractAddress,
        event: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']),
        fromBlock: BigInt(fromBlockValue),
      });
      const owners = {};
      logs.forEach(log => {
        const { tokenId, to } = log.args;
        if (to !== '0x0000000000000000000000000000000000000000') {
          owners[tokenId.toString()] = { ownerAddress: to, tokenId: tokenId.toString() };
        } else {
          delete owners[tokenId.toString()];
        }
      });
      if (DEBUG) {
        log(`[utils] [DEBUG] Fetched ${Object.keys(owners).length} owners for contract ${contractAddress}`);
      }
      return Object.values(owners);
    } catch (error) {
      log(`[utils] [ERROR] Failed to fetch owners for contract ${contractAddress}: ${error.message}`);
      throw error;
    }
  }
}

export async function getTransactionReceipt(txHash) {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (DEBUG) {
      log(`[utils] [DEBUG] Fetched transaction receipt for hash ${txHash}`);
    }
    return receipt;
  } catch (error) {
    log(`[utils] [ERROR] Failed to fetch transaction receipt for hash ${txHash}: ${error.message}`);
    throw error;
  }
}

export async function safeSerialize(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) => (typeof value === 'bigint' ? value.toString() : value))
  );
}