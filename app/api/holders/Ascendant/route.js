// app/api/holders/Ascendant/route.js
import { NextResponse } from 'next/server';
import { alchemy, client, ascendantAbi, CACHE_TTL, log, batchMulticall } from '../../utils';
import { contractAddresses, contractTiers } from '@/app/nft-contracts';

let cache = {};
let tokenCache = new Map();

async function getAllHolders(page = 0, pageSize = 1000) {
  const contractAddress = contractAddresses.ascendantNFT;
  const tiers = contractTiers.ascendantNFT;
  const contractName = 'ascendantNFT';
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();

  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    log(`Returning cached data for ${cacheKey}`);
    return cache[cacheKey].data;
  }

  log(`Fetching holders, page=${page}, pageSize=${pageSize}`);
  if (!contractAddress) {
    log("Missing contract address");
    throw new Error("Contract address not found");
  }
  if (!tiers) {
    log("Missing tiers configuration");
    throw new Error("Tiers configuration not found");
  }

  log(`Using contract address: ${contractAddress}`);
  const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, {
    block: 'latest',
    withTokenBalances: true,
  });
  log(`Raw owners count: ${ownersResponse.owners.length}`);

  const burnAddress = '0x0000000000000000000000000000000000000000';
  const filteredOwners = ownersResponse.owners.filter(
    owner => owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances.length > 0
  );
  log(`Filtered live owners count: ${filteredOwners.length}`);

  const tokenOwnerMap = new Map();
  let totalTokens = 0;
  filteredOwners.forEach(owner => {
    const wallet = owner.ownerAddress.toLowerCase();
    owner.tokenBalances.forEach(tb => {
      const tokenId = BigInt(tb.tokenId);
      tokenOwnerMap.set(tokenId, wallet);
      totalTokens++;
    });
  });
  log(`Total tokens checked: ${totalTokens}`);

  const allTokenIds = Array.from(tokenOwnerMap.keys());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, allTokenIds.length);
  const paginatedTokenIds = allTokenIds.slice(start, end);
  log(`Paginated token IDs: ${paginatedTokenIds.length} (start=${start}, end=${end})`);

  const ownerOfCalls = paginatedTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }));

  const ownerOfResults = await batchMulticall(ownerOfCalls);
  const validTokenIds = paginatedTokenIds.filter((tokenId, i) => {
    const owner = ownerOfResults[i]?.status === 'success' && ownerOfResults[i].result.toLowerCase();
    return owner && owner !== burnAddress;
  });
  log(`Valid token IDs: ${validTokenIds.length}`);

  if (validTokenIds.length === 0) {
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
      totalPages: Math.ceil(totalTokens / pageSize) 
    };
    cache[cacheKey] = { timestamp: now, data: result };
    return result;
  }

  const tierCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'getNFTAttribute',
    args: [tokenId],
  }));
  const recordCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'userRecords',
    args: [tokenId],
  }));

  const [tierResults, recordResults] = await Promise.all([
    batchMulticall(tierCalls),
    batchMulticall(recordCalls),
  ]);

  const totalShares = Number(await client.readContract({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'totalShares',
  }));
  const toDistributeDay8 = Number(await client.readContract({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'toDistribute',
    args: [0], // POOLS.DAY8
  }));
  const toDistributeDay28 = Number(await client.readContract({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'toDistribute',
    args: [1], // POOLS.DAY28
  }));
  const toDistributeDay90 = Number(await client.readContract({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'toDistribute',
    args: [2], // POOLS.DAY90
  }));
  const rewardPerShare = Number(await client.readContract({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'rewardPerShare',
  }));

  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();
  let totalLockedAscendant = 0;

  tierResults.forEach((result, i) => {
    if (result?.status === 'success') {
      const tokenId = validTokenIds[i];
      const wallet = tokenOwnerMap.get(tokenId);
      const tier = Number(result.result[1]);
      const record = recordResults[i]?.status === 'success' ? recordResults[i].result : [0, 0, 0, 0, 0];
      const shares = Number(record[0]);
      const lockedAscendant = Number(record[1]);
      const rewardDebt = Number(record[2]);

      if (tier >= 1 && tier <= maxTier) {
        if (!holdersMap.has(wallet)) {
          holdersMap.set(wallet, {
            wallet,
            total: 0,
            multiplierSum: 0,
            tiers: Array(maxTier + 1).fill(0),
            shares: 0,
            lockedAscendant: 0,
            rewardDebt: 0,
            pendingDay8: 0,
            pendingDay28: 0,
            pendingDay90: 0,
            claimableRewards: 0,
          });
        }
        const holder = holdersMap.get(wallet);
        holder.total += 1;
        holder.multiplierSum += tiers[tier]?.multiplier || 0;
        holder.tiers[tier] += 1;
        holder.shares += shares;
        holder.lockedAscendant += lockedAscendant;
        holder.rewardDebt += rewardDebt;
        holder.claimableRewards += shares * rewardPerShare - rewardDebt;
        totalLockedAscendant += lockedAscendant;
      }
    }
  });

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

  holders.sort((a, b) => b.shares - a.shares || b.multiplierSum - a.multiplierSum || b.total - a.total);
  holders.forEach((holder, index) => (holder.rank = index + 1));
  log(`Final holders count: ${holders.length}`);

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

  cache[cacheKey] = { timestamp: now, data: result };
  log(`Returning: holders=${holders.length}, totalTokens=${totalTokens}, totalLockedAscendant=${totalLockedAscendant}, totalShares=${totalShares}, pendingRewards=${result.pendingRewards}`);
  return result;
}

async function getHolderData(wallet) {
  const contractAddress = contractAddresses.ascendantNFT;
  const tiers = contractTiers.ascendantNFT;
  const contractName = 'ascendantNFT';
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();

  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    log(`Returning cached data for ${cacheKey}`);
    return cache[cacheKey].data;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error('Invalid wallet address');
  }

  log(`getHolderData start: wallet=${wallet}, contract=${contractAddress}`);
  const nfts = await alchemy.nft.getNftsForOwner(wallet, { contractAddresses: [contractAddress] });
  log(`${contractAddress} - Initial NFTs for ${wallet}: ${nfts.totalCount}`);

  if (nfts.totalCount === 0) return null;

  const walletLower = wallet.toLowerCase();
  const tokenIds = nfts.ownedNfts.map(nft => BigInt(nft.tokenId));
  const ownerOfCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }));

  const ownerOfResults = await batchMulticall(ownerOfCalls);
  const validTokenIds = tokenIds.filter((tokenId, i) => {
    const owner = ownerOfResults[i]?.status === 'success' && ownerOfResults[i].result.toLowerCase();
    const cacheKey = `${contractAddress}-${tokenId}-owner`;
    tokenCache.set(cacheKey, owner);
    return owner === walletLower;
  });
  log(`${contractAddress} - Valid token IDs for ${wallet}: ${validTokenIds.length}`);

  if (validTokenIds.length === 0) return null;

  const tierCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'getNFTAttribute',
    args: [tokenId],
  }));
  const recordCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'userRecords',
    args: [tokenId],
  }));

  const [tierResults, recordResults] = await Promise.all([
    batchMulticall(tierCalls),
    batchMulticall(recordCalls),
  ]);

  const rewardPerShare = Number(await client.readContract({
    address: contractAddress,
    abi: ascendantAbi,
    functionName: 'rewardPerShare',
  }));
  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const tiersArray = Array(maxTier + 1).fill(0);
  let total = 0;
  let multiplierSum = 0;
  let shares = 0;
  let lockedAscendant = 0;
  let claimableRewards = 0;

  tierResults.forEach((result, i) => {
    if (result?.status === 'success') {
      const tier = Number(result.result[1]);
      const record = recordResults[i]?.status === 'success' ? recordResults[i].result : [0, 0, 0, 0, 0];
      const tokenShares = Number(record[0]);
      const tokenLockedAscendant = Number(record[1]);
      const rewardDebt = Number(record[2]);

      if (tier >= 1 && tier <= maxTier) {
        tiersArray[tier] += 1;
        total += 1;
        multiplierSum += tiers[tier]?.multiplier || 0;
        shares += tokenShares;
        lockedAscendant += tokenLockedAscendant;
        claimableRewards += tokenShares * rewardPerShare - rewardDebt;
      }
    }
  });

  const allHolders = await getAllHolders(0, 1000);
  const totalMultiplierSum = allHolders.holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  const percentage = totalMultiplierSum > 0 ? (multiplierSum / totalMultiplierSum) * 100 : 0;
  const holder = allHolders.holders.find(h => h.wallet === walletLower) || { rank: allHolders.holders.length + 1 };

  const pendingRewardPerShareDay8 = allHolders.totalShares > 0 ? allHolders.toDistributeDay8 / allHolders.totalShares : 0;
  const pendingRewardPerShareDay28 = allHolders.totalShares > 0 ? allHolders.toDistributeDay28 / allHolders.totalShares : 0;
  const pendingRewardPerShareDay90 = allHolders.totalShares > 0 ? allHolders.toDistributeDay90 / allHolders.totalShares : 0;

  const result = {
    wallet: walletLower,
    rank: holder.rank,
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

  cache[cacheKey] = { timestamp: now, data: result };
  log(`${contractAddress} - Final data for ${wallet}: total=${total}, shares=${shares}, claimableRewards=${claimableRewards}`);
  return result;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '1000', 10);
  log(`Received request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  try {
    if (wallet) {
      const holderData = await getHolderData(wallet);
      return NextResponse.json({ holders: holderData ? [holderData] : [] });
    }

    const result = await getAllHolders(page, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[PROD_ERROR] AscendantNFT API error: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}