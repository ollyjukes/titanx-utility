// app/api/holders/Ascendant/route.js
import { NextResponse } from 'next/server';
import config from '@/config.js';
import { client, getOwnersForContract, getNftsForOwner, log, batchMulticall, getCache, setCache, safeSerialize } from '@/app/api/utils.js';
import { formatUnits, getAddress } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import NodeCache from 'node-cache';
import ascendant from '@/abi/ascendantNFT.json'; // Fixed import

const DISABLE_REDIS = process.env.DISABLE_ASCENDANT_REDIS === 'true';
const inMemoryCache = new NodeCache({ stdTTL: config.cache.nodeCache.stdTTL });

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
      log(`[Ascendant] Retry ${i + 1}/${attempts}: ${error.message}`);
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
    if (DISABLE_REDIS) {
      cached = inMemoryCache.get(cacheKey);
    } else {
      cached = await getCache(cacheKey);
    }
    if (cached) {
      log(`[Ascendant] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return cached;
    }
    log(`[Ascendant] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[Ascendant] Cache read error: ${cacheError.message}`);
  }

  if (!contractAddress || !tiers) {
    log(`[Ascendant] Config error: contractAddress=${contractAddress}, tiers=${JSON.stringify(tiers)}`);
    throw new Error('Missing contract address or tiers');
  }

  const owners = await retry(() => getOwnersForContract(contractAddress, ascendant.abi));
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
      log(`[Ascendant] Invalid wallet address: ${owner.ownerAddress}`);
      return;
    }
    const tokenId = Number(owner.tokenId);
    tokenOwnerMap.set(tokenId, wallet);
    totalTokens++;
  });

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
      log(`[Ascendant] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
    } catch (cacheError) {
      log(`[Ascendant] Cache write error: ${cacheError.message}`);
    }
    return result;
  }

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

  const failedTiers = tierResults.filter(r => r.status === 'failure');
  if (failedTiers.length) {
    log(`[Ascendant] Failed tier calls: ${failedTiers.map(r => r.error).join(', ')}`);
  }
  const failedRecords = recordResults.filter(r => r.status === 'failure');
  if (failedRecords.length) {
    log(`[Ascendant] Failed record calls: ${failedRecords.map(r => r.error).join(', ')}`);
  }

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
  const failedClaimables = claimableResults.filter(r => r.status === 'failure');
  if (failedClaimables.length) {
    log(`[Ascendant] Failed claimable calls: ${failedClaimables.map(r => r.error).join(', ')}`);
  }

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
        log(`[Ascendant] Unexpected tier result format for token ${tokenId}: ${JSON.stringify(tierResult.result)}`);
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
    log(`[Ascendant] Cached response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
  } catch (cacheError) {
    log(`[Ascendant] Cache write error: ${cacheError.message}`);
  }

  log(`[Ascendant] Success: ${holders.length} holders, totalTokens=${totalTokens}, totalLockedAscendant=${totalLockedAscendant}`);
  return result;
}

async function getHolderData(wallet, requestId = '') {
  const contractAddress = config.contractAddresses.ascendant.address;
  const tiers = config.contractTiers.ascendant;
  const cacheKey = `ascendant_holder_${contractAddress}-${wallet.toLowerCase()}`;

  try {
    let cached;
    if (DISABLE_REDIS) {
      cached = inMemoryCache.get(cacheKey);
    } else {
      cached = await getCache(cacheKey);
    }
    if (cached) {
      log(`[Ascendant] Cache hit for holder: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return cached;
    }
    log(`[Ascendant] Cache miss for holder: ${cacheKey}`);
  } catch (cacheError) {
    log(`[Ascendant] Cache read error: ${cacheError.message}`);
  }

  if (!contractAddress || !tiers) {
    log(`[Ascendant] Config error: contractAddress=${contractAddress}, tiers=${JSON.stringify(tiers)}`);
    throw new Error('Missing contract address or tiers');
  }

  const nfts = await retry(() => getNftsForOwner(wallet.toLowerCase(), contractAddress, ascendant.abi));
  if (nfts.length === 0) {
    log(`[Ascendant] No NFTs found for wallet ${wallet}`);
    return null;
  }

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
        log(`[Ascendant] Unexpected tier result format for token ${tokenIds[i]}: ${JSON.stringify(result.result)}`);
        return;
      }
      if (tier >= 1 && tier <= maxTier) {
        holder.tiers[tier] += 1;
        holder.total += 1;
        holder.multiplierSum += tiers[tier]?.multiplier || 0;
      }
    } else {
      log(`[Ascendant] Tier fetch failed for token ${tokenIds[i]}: ${result?.error || 'Unknown'}`);
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
      log(`[Ascendant] Record fetch failed for token ${tokenIds[i]}: ${result?.error || 'Unknown'}`);
    }
  });

  if (claimableResults[0]?.status === 'success') {
    const claimableRaw = claimableResults[0].result || '0';
    holder.claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
  } else {
    log(`[Ascendant] Claimable fetch failed for wallet ${wallet}: ${claimableResults[0]?.error || 'Unknown'}`);
  }

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
    log(`[Ascendant] Cached holder response: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
  } catch (cacheError) {
    log(`[Ascendant] Cache write error: ${cacheError.message}`);
  }

  return holder;
}

export async function GET(request) {
  const requestId = uuidv4();
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails.ascendant.pageSize, 10);
  const wallet = searchParams.get('wallet');

  try {
    if (wallet) {
      const holder = await getHolderData(wallet, requestId);
      if (!holder) {
        log(`[Ascendant] No holder data found for wallet ${wallet} (${requestId})`);
        return NextResponse.json({ message: 'No holder data found for wallet' }, { status: 404 });
      }
      log(`[Ascendant] Success: Holder data for ${wallet} (${requestId})`);
      return NextResponse.json(safeSerialize(holder));
    }

    const data = await getAllHolders(page, pageSize, requestId);
    log(`[Ascendant] Success: ${data.holders.length} holders, page=${page}, pageSize=${pageSize} (${requestId})`);
    return NextResponse.json(safeSerialize(data));
  } catch (error) {
    log(`[Ascendant] Error (${requestId}): ${error.message}`);
    console.error('[Ascendant] Error stack:', error.stack);
    let status = 500;
    let message = 'Failed to fetch Ascendant data';
    if (error.message.includes('Rate limit')) {
      status = 429;
      message = 'Rate limit exceeded';
    }
    return NextResponse.json({ error: message, details: error.message }, { status });
  }
}