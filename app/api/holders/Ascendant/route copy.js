import { NextResponse } from 'next/server';
import { alchemy, client, CACHE_TTL, log, batchMulticall } from '../../utils';
import { contractAddresses, contractTiers } from '@/app/nft-contracts';
import { formatUnits, getAddress } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import ascendantABI from '../../../../abi/ascendantNFT.json';

let cache = {};
let tokenCache = new Map();

// Utility to sanitize BigInt values by converting them to strings
function sanitizeBigInt(obj, path = 'root') {
  if (typeof obj === 'bigint') {
    log(`[BigInt Detected] at ${path}: ${obj}`);
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeBigInt(item, `${path}[${i}]`));
  }
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBigInt(value, `${path}.${key}`);
    }
    return sanitized;
  }
  return obj;
}

// Utility to safely log objects containing BigInt
function safeLog(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

// Utility to safely serialize response objects containing BigInt
function safeSerialize(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

// Fetch data for all holders with pagination
async function getAllHolders(page = 0, pageSize = 1000, requestId = '') {
  const contractAddress = contractAddresses.ascendantNFT;
  const tiers = contractTiers.ascendantNFT;
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();

  if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_TTL) {
    log(`[${requestId}] Returning cached data for ${cacheKey}`);
    return cache[cacheKey].data;
  }

  log(`[${requestId}] Fetching holders, page=${page}, pageSize=${pageSize}`);
  if (!contractAddress || !tiers) {
    throw new Error('Missing contract address or tiers');
  }

  const retry = async (fn, attempts = 3, delay = 1000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) throw error;
        log(`[${requestId}] Retry ${i + 1}/${attempts} failed: ${error.message}`);
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
  log(`[${requestId}] Raw owners count: ${owners.length}`);

  const burnAddress = '0x0000000000000000000000000000000000000000';
  const filteredOwners = owners.filter(
    (owner) => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances?.length > 0
  );
  log(`[${requestId}] Filtered live owners count: ${filteredOwners.length}`);

  const tokenOwnerMap = new Map();
  let totalTokens = 0;
  filteredOwners.forEach((owner) => {
    if (!owner.ownerAddress) {
      log(`[${requestId}] Skipping owner with missing ownerAddress`);
      return;
    }
    let wallet;
    try {
      wallet = getAddress(owner.ownerAddress);
    } catch (e) {
      log(`[${requestId}] Invalid ownerAddress: ${owner.ownerAddress}, error: ${e.message}`);
      return;
    }
    owner.tokenBalances.forEach((tb) => {
      if (!tb.tokenId) {
        log(`[${requestId}] Skipping token with missing tokenId for owner ${wallet}`);
        return;
      }
      const tokenId = Number(tb.tokenId);
      tokenOwnerMap.set(tokenId, wallet);
      totalTokens++;
    });
  });
  log(`[${requestId}] Total tokens checked: ${totalTokens}`);

  const allTokenIds = Array.from(tokenOwnerMap.keys());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, allTokenIds.length);
  const paginatedTokenIds = allTokenIds.slice(start, end);
  log(`[${requestId}] Paginated token IDs: ${paginatedTokenIds.length}`);

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

  log(`[${requestId}] Tier calls: ${safeLog(tierCalls.map((c) => ({ tokenId: c.args[0], functionName: c.functionName })))}`);
  log(`[${requestId}] Record calls: ${safeLog(recordCalls.map((c) => ({ tokenId: c.args[0], functionName: c.functionName })))}`);

  const [rawTierResults, rawRecordResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls)),
    retry(() => batchMulticall(recordCalls)),
  ]);

  log(`[${requestId}] Raw tierResults: ${safeLog(rawTierResults)}`);

  const tierResults = sanitizeBigInt(rawTierResults, 'tierResults');
  const recordResults = sanitizeBigInt(rawRecordResults, 'recordResults');

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
    if (!wallet) {
      log(`[${requestId}] Skipping token ${tokenId}: no wallet found`);
      return;
    }
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

  log(`[${requestId}] Claimable calls: ${safeLog(claimableCalls.map((c) => ({ tokenIds: c.args[0] })))}`);

  const rawClaimableResults = await retry(() => batchMulticall(claimableCalls));
  const claimableResults = sanitizeBigInt(rawClaimableResults, 'claimableResults');

  paginatedTokenIds.forEach((tokenId, i) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) {
      log(`[${requestId}] Skipping token ${tokenId}: no wallet found in holdersMap`);
      return;
    }
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
    } else {
      log(`[${requestId}] Invalid tier ${tier} for tokenId ${tokenId}: ${safeLog(tierResult)}`);
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
    } else {
      log(`[${requestId}] Invalid recordResult for tokenId ${tokenId}: ${safeLog(recordResult)}`);
    }
  });

  let claimableIndex = 0;
  for (const [wallet, tokenIds] of walletTokenIds.entries()) {
    const holder = holdersMap.get(wallet);
    if (!holder) {
      log(`[${requestId}] Skipping claimable for wallet ${wallet}: no holder found`);
      claimableIndex++;
      continue;
    }
    if (claimableResults[claimableIndex]?.status === 'success') {
      const claimableRaw = claimableResults[claimableIndex].result || '0';
      holder.claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
    } else {
      holder.claimableRewards = 0;
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
  const contractAddress = contractAddresses.ascendantNFT;
  const tiers = contractTiers.ascendantNFT;
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();

  delete cache[cacheKey]; // Force fresh data

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error('Invalid wallet address');
  }

  const checksummedWallet = getAddress(wallet);
  log(`[${requestId}] getHolderData start: wallet=${checksummedWallet}, contract=${contractAddress}`);

  const retry = async (fn, attempts = 3, delay = 1000) => {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === attempts - 1) throw error;
        log(`[${requestId}] Retry ${i + 1}/${attempts} failed: ${error.message}`);
        await new Promise((res) => setTimeout(res, delay * 2 ** i));
      }
    }
  };

  const nfts = await retry(() =>
    alchemy.nft.getNftsForOwner(checksummedWallet, { contractAddresses: [contractAddress] })
  );
  log(`[${requestId}] ${contractAddress} - Initial NFTs for ${checksummedWallet}: ${nfts.totalCount}`);

  if (nfts.totalCount === 0) return null;

  const tokenIds = nfts.ownedNfts
    .filter((nft) => nft.contract.address.toLowerCase() === contractAddress.toLowerCase())
    .map((nft) => Number(nft.tokenId));
  log(`[${requestId}] ${contractAddress} - Token IDs for ${checksummedWallet}: [${tokenIds.join(', ')}]`);

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

  log(`[${requestId}] Tier calls: ${safeLog(tierCalls.map((c) => ({ tokenId: c.args[0], functionName: c.functionName })))}`);
  log(`[${requestId}] Record calls: ${safeLog(recordCalls.map((c) => ({ tokenId: c.args[0], functionName: c.functionName })))}`);
  log(`[${requestId}] Claimable call: ${safeLog(claimableCall)}`);

  const [rawTierResults, rawRecordResults, rawClaimableResults] = await Promise.all([
    retry(() => batchMulticall(tierCalls)),
    retry(() => batchMulticall(recordCalls)),
    retry(() => batchMulticall(claimableCall)),
  ]);

  log(`[${requestId}] Raw tierResults: ${safeLog(rawTierResults)}`);

  const tierResults = sanitizeBigInt(rawTierResults, 'tierResults');
  const recordResults = sanitizeBigInt(rawRecordResults, 'recordResults');
  const claimableResults = sanitizeBigInt(rawClaimableResults, 'claimableResults');

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
    } else {
      log(`[${requestId}] Invalid tier ${tier} for tokenId ${tokenId}: ${safeLog(tierResult)}`);
    }

    const recordResult = recordResults[i];
    if (recordResult?.status === 'success' && Array.isArray(recordResult.result)) {
      const sharesRaw = recordResult.result[0] || '0';
      const lockedAscendantRaw = recordResult.result[1] || '0';
      const tokenShares = parseFloat(formatUnits(sharesRaw, 18));
      const tokenLockedAscendant = parseFloat(formatUnits(lockedAscendantRaw, 18));
      shares += tokenShares;
      lockedAscendant += tokenLockedAscendant;
    } else {
      log(`[${requestId}] Invalid recordResult for tokenId ${tokenId}: ${safeLog(recordResult)}`);
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
  const pageSize = parseInt(searchParams.get('pageSize') || '1000', 10);
  log(`[${requestId}] Received request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  try {
    if (wallet) {
      const holderData = await getHolderData(wallet, requestId);
      const response = { holders: holderData ? [holderData] : [] };
      return NextResponse.json(safeSerialize(response));
    }

    const result = await getAllHolders(page, pageSize, requestId);
    return NextResponse.json(safeSerialize(result));
  } catch (error) {
    console.error(`[${requestId}] [PROD_ERROR] AscendantNFT API error: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}