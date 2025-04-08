// app/api/holders/Element369/route.js
import { NextResponse } from 'next/server';
import { Alchemy, Network } from 'alchemy-sdk';
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { contractAddresses, contractTiers } from '@/app/nft-contracts';

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

function log(message) {
  console.log(`[PROD_DEBUG] element369 - ${message}`);
}

async function batchMulticall(calls, batchSize = 50) {
  log(`batchMulticall: Processing ${calls.length} calls`);
  const results = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    const batchResults = await client.multicall({ contracts: batch });
    results.push(...batchResults);
  }
  return results;
}

async function getAllHolders(page = 0, pageSize = 1000) {
  const contractAddress = contractAddresses.element369;
  const tiers = contractTiers.element369;
  log(`Fetching holders, page=${page}, pageSize=${pageSize}`);

  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    log("Missing NEXT_PUBLIC_ALCHEMY_API_KEY");
    throw new Error("Server configuration error: Missing Alchemy API key");
  }
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
    abi: nftAbi,
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
    return { holders: [], totalTokens, page, pageSize, totalPages: Math.ceil(totalTokens / pageSize) };
  }

  const tierCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: nftAbi,
    functionName: 'getNftTier',
    args: [tokenId],
  }));

  const tierResults = await batchMulticall(tierCalls);
  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();

  tierResults.forEach((result, i) => {
    if (result?.status === 'success') {
      const tokenId = validTokenIds[i];
      const wallet = tokenOwnerMap.get(tokenId);
      const tier = Number(result.result);

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
        holder.multiplierSum += tiers[tier].multiplier || 0;
        holder.tiers[tier] += 1;
      }
    }
  });

  const holders = Array.from(holdersMap.values());
  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  holders.forEach(holder => {
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
  holders.forEach((holder, index) => (holder.rank = index + 1));
  log(`Final holders count: ${holders.length}`);

  return {
    holders,
    totalTokens,
    page,
    pageSize,
    totalPages: Math.ceil(totalTokens / pageSize),
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '1000', 10);
  log(`Received request: page=${page}, pageSize=${pageSize}`);

  try {
    const result = await getAllHolders(page, pageSize);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`[PROD_ERROR] Element369 API error: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}