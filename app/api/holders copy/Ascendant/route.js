// app/api/holders/Ascendant/route.js
import { NextResponse } from 'next/server';
import { alchemy, client, CACHE_TTL, log, batchMulticall } from '../../utils';
import { contractAddresses, contractTiers, contractDetails } from '@/app/nft-contracts';
import { formatUnits, getAddress } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import ascendantABI from '../../../../abi/ascendantNFT.json';

let cache = {};
let tokenCache = new Map();

// Utility to sanitize BigInt values
function sanitizeBigInt(obj) {
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeBigInt(item));
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBigInt(value);
    }
    return sanitized;
  }
  return obj;
}

// Utility to serialize response objects
function safeSerialize(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

// Fetch data for all holders with pagination
async function getAllHolders(page = 0, pageSize = 1000, requestId = '') {
  const contractAddress = contractAddresses.ascendant.address; // Fix: Use .address
  const tiers = contractTiers.ascendant;
  const defaultPageSize = contractDetails.ascendant?.pageSize || 1000;
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();

  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  if (!contractAddress || !tiers) {
    throw new Error('Missing contract address or tiers');
  }

  const retry = async (fn, attempts = 3, delay = 1000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) throw error;
        await new Promise((res) => setTimeout(res, delay * 2 ** i));
      }
    }
  };

  let owners = [];
  let pageKey = null;
  do {
    const response = await retry(() =>
      alchemy.nft.getOwnersForContract(contractAddress, {
        block: 'latest',
        withTokenBalances: true,
        pageKey,
      })
    );
    owners = owners.concat(response.owners);
    pageKey = response.pageKey;
  } while (pageKey);

  const burnAddress = '0x000000000000000 DOB0000000000000000000000';
  const filteredOwners = owners.filter(
    (owner) => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances?.length > 0
  );

  const tokenOwnerMap = new Map();
  let totalTokens = 0;
  filteredOwners.forEach((owner) => {
    if (!owner.ownerAddress) return;
    let wallet;
    try {
      wallet = getAddress(owner.ownerAddress);
    } catch (e) {
      return;
    }
    owner.tokenBalances.forEach((tb) => {
      if (!tb.tokenId) return;
      const tokenId = Number(tb.tokenId);
      tokenOwnerMap.set(tokenId, wallet);
      totalTokens++;
    });
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
    cache[cacheKey] = { timestamp: now, data: result };
    return result;
  }

  const tierCalls = paginatedTokenIds.map((tokenId) => ({
    address: contractAddress,
    abi: ascendantABI,
    functionName: 'getNFTAttribute',
    args: [BigInt(tokenId)],
  }));
  const recordCalls = paginatedTokenIds.map((tokenId) => ({
    address: contractAddress,
    abi: ascendantABI,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));

  const [rawTierResults, rawRecordResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls)),
    retry(() => batchMulticall(recordCalls)),
  ]);

  const tierResults = sanitizeBigInt(rawTierResults);
  const recordResults = sanitizeBigInt(rawRecordResults);

  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'totalShares',
    })
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw.toString(), 18));
  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));
  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));
  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();
  let totalLockedAscendant = 0;

  const walletTokenIds = new Map();
  paginatedTokenIds.forEach((tokenId) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!walletTokenIds.has(wallet)) {
      walletTokenIds.set(wallet, []);
    }
    walletTokenIds.get(wallet).push(tokenId);
  });

  const claimableCalls = Array.from(walletTokenIds.entries()).map(([wallet, tokenIds]) => ({
    address: contractAddress,
    abi: ascendantABI,
    functionName: 'batchClaimableAmount',
    args: [tokenIds.map((id) => BigInt(id))],
  }));

  const rawClaimableResults = await retry(() => batchMulticall(claimableCalls));
  const claimableResults = sanitizeBigInt(rawClaimableResults);

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

  holders.forEach((holder) => {
    holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
    holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
    holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  holders.sort((a, b) => b.shares - a.shares || b.multiplierSum - a.multiplierSum || b.total - a.total);
  holders.forEach((holder, index) => (holder.rank = index + 1));

  const result = {
    holders: sanitizeBigInt(holders),
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

  cache[cacheKey] = { timestamp: now, data: result };
  return result;
}

// Fetch data for a specific wallet
async function getHolderData(wallet, requestId = '') {
  const contractAddress = contractAddresses.ascendant.address; // Fix: Use .address
  const tiers = contractTiers.ascendant;
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();


  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_TTL) {
    return cache[cacheKey].data;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error('Invalid wallet address');
  }

  const checksummedWallet = getAddress(wallet);

  const retry = async (fn, attempts = 3, delay = 1000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) throw error;
        await new Promise((res) => setTimeout(res, delay * 2 ** i));
      }
    }
  };

  const nfts = await retry(() =>
    alchemy.nft.getNftsForOwner(checksummedWallet, { contractAddresses: [contractAddress] })
  );

  if (nfts.totalCount === 0) return null;

  const tokenIds = nfts.ownedNfts
    .filter((nft) => nft.contract.address.toLowerCase() === contractAddress.toLowerCase())
    .map((nft) => Number(nft.tokenId));

  if (tokenIds.length === 0) return null;

  const tierCalls = tokenIds.map((tokenId) => ({
    address: contractAddress,
    abi: ascendantABI,
    functionName: 'getNFTAttribute',
    args: [BigInt(tokenId)],
  }));
  const recordCalls = tokenIds.map((tokenId) => ({
    address: contractAddress,
    abi: ascendantABI,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));
  const claimableCall = [
    {
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'batchClaimableAmount',
      args: [tokenIds.map((id) => BigInt(id))],
    },
  ];

  const [rawTierResults, rawRecordResults, rawClaimableResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls)),
    retry(() => batchMulticall(recordCalls)),
    retry(() => batchMulticall(claimableCall)),
  ]);

  const tierResults = sanitizeBigInt(rawTierResults);
  const recordResults = sanitizeBigInt(rawRecordResults);
  const claimableResults = sanitizeBigInt(rawClaimableResults);

  let claimableRewards = 0;
  if (claimableResults[0]?.status === 'success') {
    const claimableRaw = claimableResults[0].result || '0';
    claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
  }

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const tiersArray = Array(maxTier + 1).fill(0);
  let total = 0;
  let multiplierSum = 0;
  let shares = 0;
  let lockedAscendant = 0;

  tokenIds.forEach((tokenId, i) => {
    const tierResult = tierResults[i];
    let tier;
    if (tierResult?.status === 'success') {
      if (Array.isArray(tierResult.result) && tierResult.result.length >= 2) {
        tier = Number(tierResult.result[1]);
      } else if (typeof tierResult.result === 'object' && tierResult.result.tier !== undefined) {
        tier = Number(tierResult.result.tier);
      }
    }
    if (tier >= 1 && tier <= maxTier) {
      tiersArray[tier] += 1;
      total += 1;
      multiplierSum += tiers[tier]?.multiplier || 0;
    }

    const recordResult = recordResults[i];
    if (recordResult?.status === 'success' && Array.isArray(recordResult.result)) {
      const sharesRaw = recordResult.result[0] || '0';
      const lockedAscendantRaw = recordResult.result[1] || '0';
      const tokenShares = parseFloat(formatUnits(sharesRaw, 18));
      const tokenLockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      shares += tokenShares;
      lockedAscendant += tokenLockedAscendant;
    }
  });

  const totalSharesRaw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'totalShares',
    })
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw.toString(), 18));

  const toDistributeDay8Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'toDistribute',
      args: [0],
    })
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw.toString(), 18));

  const toDistributeDay28Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'toDistribute',
      args: [1],
    })
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw.toString(), 18));

  const toDistributeDay90Raw = await retry(() =>
    client.readContract({
      address: contractAddress,
      abi: ascendantABI,
      functionName: 'toDistribute',
      args: [2],
    })
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw.toString(), 18));

  const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
  const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
  const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

  const totalMultiplierSum = multiplierSum || 1;
  const percentage = (multiplierSum / totalMultiplierSum) * 100;
  const rank = 1;

  const result = {
    wallet: checksummedWallet,
    rank,
    total,
    multiplierSum,
    displayMultiplierSum: multiplierSum,
    percentage,
    tiers: tiersArray,
    shares,
    lockedAscendant,
    pendingDay8: shares * pendingRewardPerShareDay8,
    pendingDay28: shares * pendingRewardPerShareDay28,
    pendingDay90: shares * pendingRewardPerShareDay90,
    claimableRewards,
  };

  const sanitizedResult = sanitizeBigInt(result);
  cache[cacheKey] = { timestamp: now, data: sanitizedResult };
  return sanitizedResult;
}

// API endpoint handler
export async function GET(request) {
  const requestId = uuidv4();
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || contractDetails.ascendant?.pageSize || 1000, 10);

  try {
    if (wallet) {
      const holderData = await getHolderData(wallet, requestId);
      const response = { holders: holderData ? [holderData] : [] };
      return NextResponse.json(safeSerialize(response));
    }

    const result = await getAllHolders(page, pageSize, requestId);
    return NextResponse.json(safeSerialize(result));
  } catch (error) {
    console.error(`[${requestId}] [PROD_ERROR] Ascendant API error: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}