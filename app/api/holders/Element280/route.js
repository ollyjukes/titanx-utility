// app/api/holders/Element280/route.js
import { NextResponse } from 'next/server';
import { alchemy, client, nftAbi, element280VaultAbi, CACHE_TTL, log, batchMulticall } from '../../utils';
import { contractAddresses, contractTiers, vaultAddresses } from '@/app/nft-contracts';

let cache = {};
let tokenCache = new Map();

async function getAllHolders(contractAddress, tiers, page = 0, pageSize = 1000) {
  const contractName = 'element280';
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();

  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    log(`getAllHolders: Returning cached data for ${cacheKey}`);
    return cache[cacheKey].data;
  }

  log(`getAllHolders start: ${contractName} at ${contractAddress}, page=${page}, pageSize=${pageSize}`);
  const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, { withTokenBalances: true });
  log(`${contractName} - Raw owners count: ${ownersResponse.owners.length}`);

  const burnAddress = '0x0000000000000000000000000000000000000000';
  const filteredOwners = ownersResponse.owners.filter(
    owner => owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances.length > 0
  );
  log(`${contractName} - Filtered live owners count: ${filteredOwners.length}`);

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
  log(`${contractName} - Total tokens checked: ${totalTokens}`);

  const allTokenIds = Array.from(tokenOwnerMap.keys());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, allTokenIds.length);
  const paginatedTokenIds = allTokenIds.slice(start, end);
  log(`${contractName} - Paginated token IDs: ${paginatedTokenIds.length} (start=${start}, end=${end})`);

  const ownerOfCalls = paginatedTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: nftAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }));

  const ownerOfResults = await batchMulticall(ownerOfCalls);
  const validTokenIds = [];
  paginatedTokenIds.forEach((tokenId, i) => {
    const owner = ownerOfResults[i]?.status === 'success' && ownerOfResults[i].result.toLowerCase();
    const cacheKey = `${contractAddress}-${tokenId}-owner`;
    if (owner && owner !== burnAddress) {
      validTokenIds.push(tokenId);
      tokenCache.set(cacheKey, owner);
    } else {
      tokenCache.set(cacheKey, null);
    }
  });
  log(`${contractName} - Valid token IDs after ownerOf: ${validTokenIds.length}`);

  if (validTokenIds.length === 0) {
    log(`${contractName} - No valid tokens found in this page`);
    return { holders: [], totalTokens, page, pageSize, totalPages: Math.ceil(allTokenIds.length / pageSize) };
  }

  const tierCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: nftAbi,
    functionName: 'getNftTier',
    args: [tokenId],
  }));

  log(`${contractName} - Starting tier multicall for ${tierCalls.length} tokens`);
  const tierResults = await batchMulticall(tierCalls);
  log(`${contractName} - Tier results length: ${tierResults.length}`);
  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();
  let totalNftsHeld = 0;

  tierResults.forEach((result, i) => {
    if (!result) {
      log(`${contractName} - Undefined tier result at index ${i}, tokenId: ${validTokenIds[i]}`);
      return;
    }
    if (result.status === 'success') {
      const tokenId = validTokenIds[i];
      const wallet = tokenOwnerMap.get(tokenId);
      const tier = Number(result.result);
      const cacheKey = `${contractAddress}-${tokenId}-tier`;
      tokenCache.set(cacheKey, tier);

      if (tier >= 1 && tier <= maxTier) {
        if (!holdersMap.has(wallet)) {
          holdersMap.set(wallet, {
            wallet,
            total: 0,
            multiplierSum: 0,
            tiers: Array(maxTier + 1).fill(0),
            claimableRewards: 0,
          });
        }

        const holder = holdersMap.get(wallet);
        holder.total += 1;
        holder.multiplierSum += tiers[tier]?.multiplier || 0;
        holder.tiers[tier] += 1;
        totalNftsHeld += 1;
      } else {
        log(`${contractName} - Invalid tier ${tier} for token ${tokenId}`);
      }
    } else {
      log(`${contractName} - Failed tier fetch at index ${i}, tokenId: ${validTokenIds[i]}`);
    }
  });
  log(`${contractName} - Total NFTs held after tier check: ${totalNftsHeld}`);

  // Fetch claimable rewards from vault
  const holders = Array.from(holdersMap.values());
  const rewardCalls = holders.map(holder => ({
    address: vaultAddresses.element280,
    abi: element280VaultAbi,
    functionName: 'claimableReward',
    args: [holder.wallet],
  }));

  const rewardResults = await batchMulticall(rewardCalls);
  holders.forEach((holder, i) => {
    if (rewardResults[i]?.status === 'success') {
      holder.claimableRewards = Number(rewardResults[i].result);
    } else {
      holder.claimableRewards = 0;
      log(`${contractName} - Failed to fetch rewards for ${holder.wallet}`);
    }
  });

  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  holders.forEach(holder => {
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = holder.multiplierSum / 10;
  });

  const sortFn = (a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total;
  holders.sort(sortFn);
  holders.forEach((holder, index) => (holder.rank = index + 1));

  const result = {
    holders,
    totalTokens,
    page,
    pageSize,
    totalPages: Math.ceil(allTokenIds.length / pageSize),
  };

  cache[cacheKey] = { timestamp: now, data: result };
  log(`${contractName} - Final holders count: ${holders.length}`);
  return result;
}

async function getHolderData(contractAddress, wallet, tiers) {
  const contractName = 'element280';
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();

  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    log(`getHolderData: Returning cached data for ${cacheKey}`);
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
    abi: nftAbi,
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
    abi: nftAbi,
    functionName: 'getNftTier',
    args: [tokenId],
  }));

  const tierResults = await batchMulticall(tierCalls);
  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const tiersArray = Array(maxTier + 1).fill(0);
  let total = 0;
  let multiplierSum = 0;

  tierResults.forEach((result, i) => {
    if (!result) {
      log(`${contractAddress} - Undefined tier result for wallet ${wallet} at index ${i}, tokenId: ${validTokenIds[i]}`);
      return;
    }
    if (result.status === 'success') {
      const tier = Number(result.result);
      const tokenId = validTokenIds[i];
      const cacheKey = `${contractAddress}-${tokenId}-tier`;
      tokenCache.set(cacheKey, tier);
      if (tier >= 1 && tier <= maxTier) {
        tiersArray[tier] += 1;
        total += 1;
        multiplierSum += tiers[tier]?.multiplier || 0;
      }
    }
  });
  log(`${contractAddress} - Total NFTs for ${wallet} after tier check: ${total}`);

  const rewardResult = await client.readContract({
    address: vaultAddresses.element280,
    abi: element280VaultAbi,
    functionName: 'claimableReward',
    args: [walletLower],
  });
  const claimableRewards = Number(rewardResult) || 0;

  const allHolders = await getAllHolders(contractAddress, tiers, 0, 1000);
  const totalMultiplierSum = allHolders.holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  const percentage = totalMultiplierSum > 0 ? (multiplierSum / totalMultiplierSum) * 100 : 0;
  const holder = allHolders.holders.find(h => h.wallet === walletLower) || { rank: allHolders.holders.length + 1 };

  const result = {
    wallet: walletLower,
    rank: holder.rank,
    total,
    multiplierSum,
    displayMultiplierSum: multiplierSum / 10,
    percentage,
    tiers: tiersArray,
    claimableRewards,
  };

  cache[cacheKey] = { timestamp: now, data: result };
  log(`${contractAddress} - Final data for ${wallet}: total=${total}, multiplierSum=${multiplierSum}, claimableRewards=${claimableRewards}`);
  return result;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10));
  const pageSize = Math.max(1, Math.min(1000, parseInt(searchParams.get('pageSize') || '1000', 10)));

  const address = contractAddresses['element280'];
  if (!address) {
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    if (wallet) {
      const holderData = await getHolderData(address, wallet, contractTiers['element280']);
      return NextResponse.json({ holders: holderData ? [holderData] : [] });
    }

    const result = await getAllHolders(address, contractTiers['element280'], page, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    log(`Error in GET /api/holders/Element280: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}