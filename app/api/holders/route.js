// app/api/holders/route.js
import { NextResponse } from 'next/server';
import { Alchemy, Network } from 'alchemy-sdk';
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { contractAddresses, deploymentBlocks, contractTiers } from '../../nft-contracts';

const settings = {
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
};
const alchemy = new Alchemy(settings);

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

const nftAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getNftTier(uint256 tokenId) view returns (uint8)",
]);

let cache = {};
let tokenCache = new Map();

function log(message) {
  console.log(`[PROD_DEBUG] ${message}`);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  log("Dummy log for v0.0.5"); //   Added dummy change
  const contract = searchParams.get('contract');
  const contractAddress = searchParams.get('address');
  const wallet = searchParams.get('address');
  const startBlock = contract === 'element280' ? undefined : (contract && deploymentBlocks[contract]);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '1000', 10);

  log(`Request: contract=${contract}, address=${contractAddress || wallet}, startBlock=${startBlock || 'latest'}, page=${page}, pageSize=${pageSize}`);
  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    log("Missing NEXT_PUBLIC_ALCHEMY_API_KEY");
    return NextResponse.json({ error: 'Server configuration error: Missing Alchemy API key' }, { status: 500 });
  }

  if (!alchemy.nft) {
    log("Alchemy NFT service unavailable");
    return NextResponse.json({ error: 'Server error: Alchemy NFT service unavailable' }, { status: 500 });
  }

  if (contract && !contractAddresses[contract]) {
    log(`Invalid contract specified: ${contract}`);
    return NextResponse.json({ error: 'Invalid contract specified' }, { status: 400 });
  }

  try {
    if (wallet && !contract) {
      log(`Wallet search initiated for ${wallet}`);
      const holders = {
        element280: await getHolderData(contractAddresses.element280, wallet, undefined, contractTiers.element280),
        staxNFT: await getHolderData(contractAddresses.staxNFT, wallet, deploymentBlocks.staxNFT, contractTiers.staxNFT),
        element369: await getHolderData(contractAddresses.element369, wallet, deploymentBlocks.element369, contractTiers.element369),
      };
      log(`Wallet search result: element280=${!!holders.element280}, staxNFT=${!!holders.staxNFT}, element369=${!!holders.element369}`);
      return NextResponse.json({ holders: [holders.element280, holders.staxNFT, holders.element369].filter(h => h) });
    } else if (contract) {
      const tiers = contractTiers[contract];
      const effectiveAddress = contractAddress || contractAddresses[contract];
      
      const cacheKey = `${effectiveAddress}-${startBlock || 'latest'}-${page}-${pageSize}`;
      if (cache[cacheKey]) {
        log(`Cache hit for ${cacheKey}, holders count: ${cache[cacheKey].holders.length}`);
        return NextResponse.json(cache[cacheKey]);
      }

      log(`Fetching holders for ${contract} at ${effectiveAddress}`);
      const result = await getAllHolders(effectiveAddress, startBlock, tiers, contract, page, pageSize);
      cache[cacheKey] = result;
      log(`Contract ${contract} holders count: ${result.holders.length}, totalTokens: ${result.totalTokens}`);
      return NextResponse.json(result);
    }
    log("Missing parameters");
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  } catch (error) {
    console.error(`[PROD_ERROR] API error for ${contract || 'wallet search'}: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

async function batchMulticall(calls, batchSize = 50) {
  log(`batchMulticall: Processing ${calls.length} calls in batches of ${batchSize}`);
  const results = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    try {
      const batchResults = await client.multicall({ contracts: batch });
      results.push(...batchResults);
      log(`batchMulticall: Batch ${i}-${i + batchSize - 1} completed with ${batchResults.length} results`);
    } catch (error) {
      console.error(`[PROD_ERROR] batchMulticall failed for batch ${i}-${i + batchSize - 1}: ${error.message}`);
      results.push(...batch.map(() => ({ status: 'failure', result: null })));
    }
  }
  log(`batchMulticall: Completed with ${results.length} results`);
  return results;
}

async function getAllHolders(contractAddress, startBlock, tiers, contractName, page = 0, pageSize = 1000) {
  log(`getAllHolders start: ${contractName} at ${contractAddress}, block: ${startBlock || 'latest'}, page=${page}, pageSize=${pageSize}`);
  const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, {
    block: startBlock,
    withTokenBalances: true,
  });
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

  const totalRedeemed = totalTokens - allTokenIds.length; // Total across all pages
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

  const holders = Array.from(holdersMap.values());
  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  holders.forEach(holder => {
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = contractName === 'element280' ? holder.multiplierSum / 10 : holder.multiplierSum;
  });

  const sortFn = (a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total;
  holders.sort(sortFn);
  holders.forEach((holder, index) => (holder.rank = index + 1));

  log(`${contractName} - Final holders count: ${holders.length}`);
  return {
    holders,
    totalTokens,
    page,
    pageSize,
    totalPages: Math.ceil(allTokenIds.length / pageSize),
  };
}

async function getHolderData(contractAddress, wallet, startBlock, tiers) {
  log(`getHolderData start: wallet=${wallet}, contract=${contractAddress}, block=${startBlock || 'latest'}`);
  const nfts = await alchemy.nft.getNftsForOwner(wallet, {
    contractAddresses: [contractAddress],
    block: startBlock,
  });
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

  if (validTokenIds.length === 0) {
    return null;
  }

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

  const tiersData = { tiers: tiersArray, total, multiplierSum };
  const contractName = Object.keys(contractAddresses).find(key => contractAddresses[key] === contractAddress);
  const allHolders = await getAllHolders(contractAddress, startBlock, tiers, contractName, 0, 1000); // Limit for wallet search
  const totalMultiplierSum = allHolders.holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  const percentage = totalMultiplierSum > 0 ? (tiersData.multiplierSum / totalMultiplierSum) * 100 : 0;

  const holder = allHolders.holders.find(h => h.wallet === walletLower);
  const displayMultiplierSum = contractName === 'element280' ? multiplierSum / 10 : multiplierSum;
  log(`${contractAddress} - Final data for ${wallet}: total=${total}, multiplierSum=${multiplierSum}`);
  return {
    wallet: walletLower,
    rank: holder ? holder.rank : allHolders.holders.length + 1,
    total: tiersData.total,
    multiplierSum: tiersData.multiplierSum,
    displayMultiplierSum,
    percentage,
    tiers: tiersData.tiers,
  };
}