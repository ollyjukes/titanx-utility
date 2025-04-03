// app/api/holders/route.js
import { NextResponse } from 'next/server';
import { Alchemy, Network } from 'alchemy-sdk';
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { contractAddresses, deploymentBlocks, contractTiers } from '../../nft-contracts';

// Alchemy setup
const settings = {
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
};
const alchemy = new Alchemy(settings);

// Viem client
const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`),
});

// ABI for all contracts
const nftAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getNftTier(uint256 tokenId) view returns (uint8)",
]);

// In-memory cache
let cache = {};
let tokenCache = new Map();

// Debug logging control
const isDebug = process.env.NODE_ENV === "development"; // Only log in development
function debugLog(...args) {
  if (isDebug) {
    console.log(...args);
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const contract = searchParams.get('contract');
  const contractAddress = searchParams.get('address');
  const wallet = searchParams.get('address');
  const startBlock = contract === 'element280' ? undefined : (contract && deploymentBlocks[contract]);

  if (!process.env.ALCHEMY_API_KEY) {
    return NextResponse.json({ error: 'Server configuration error: Missing Alchemy API key' }, { status: 500 });
  }

  if (!alchemy.nft) {
    return NextResponse.json({ error: 'Server error: Alchemy NFT service unavailable' }, { status: 500 });
  }

  if (contract && !contractAddresses[contract]) {
    return NextResponse.json({ error: 'Invalid contract specified' }, { status: 400 });
  }

  try {
    if (wallet && !contract) {
      const holders = {
        element280: await getHolderData(contractAddresses.element280, wallet, undefined, contractTiers.element280),
        staxNFT: await getHolderData(contractAddresses.staxNFT, wallet, deploymentBlocks.staxNFT, contractTiers.staxNFT),
        element369: await getHolderData(contractAddresses.element369, wallet, deploymentBlocks.element369, contractTiers.element369),
      };
      return NextResponse.json({ holders: [holders.element280, holders.staxNFT, holders.element369].filter(h => h) });
    } else if (contract) {
      const tiers = contractTiers[contract];
      const effectiveAddress = contractAddress || contractAddresses[contract];
      
      const cacheKey = `${effectiveAddress}-${startBlock || 'latest'}`;
      if (cache[cacheKey]) {
        debugLog(`[DEBUG] Cache hit for ${cacheKey}`);
        return NextResponse.json({ holders: cache[cacheKey] });
      }

      const holders = await getAllHolders(effectiveAddress, startBlock, tiers, contract);
      cache[cacheKey] = holders;
      return NextResponse.json({ holders });
    }
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  } catch (error) {
    console.error(`API error for ${contract || 'wallet search'}:`, error.message); // Keep error logs for debugging
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

async function batchMulticall(calls, batchSize = 100) {
  const results = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    const batchResults = await client.multicall({ contracts: batch });
    results.push(...batchResults);
  }
  return results;
}

async function getAllHolders(contractAddress, startBlock, tiers, contractName) {
  const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, {
    block: startBlock,
    withTokenBalances: true,
  });

  const burnAddress = '0x0000000000000000000000000000000000000000';
  const filteredOwners = ownersResponse.owners.filter(
    owner => owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances.length > 0
  );
  debugLog(`[DEBUG] Contract ${contractAddress} - Total owners: ${ownersResponse.owners.length}, Live owners: ${filteredOwners.length}`);

  // Aggregate tokens
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

  const allTokenIds = Array.from(tokenOwnerMap.keys());
  debugLog(`[DEBUG] Contract ${contractAddress} - Total tokens checked: ${totalTokens}`);

  // Validate ownership with caching
  const ownerOfCalls = allTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: nftAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }));

  const ownerOfResults = await batchMulticall(ownerOfCalls);
  const validTokenIds = [];
  allTokenIds.forEach((tokenId, i) => {
    const owner = ownerOfResults[i].status === 'success' && ownerOfResults[i].result.toLowerCase();
    const cacheKey = `${contractAddress}-${tokenId}-owner`;
    if (owner && owner !== burnAddress) {
      validTokenIds.push(tokenId);
      tokenCache.set(cacheKey, owner);
    } else {
      debugLog(`[DEBUG] Token ${tokenId} invalid - owner: ${owner || 'reverted'}`);
      tokenCache.set(cacheKey, null);
    }
  });

  const totalRedeemed = totalTokens - validTokenIds.length;
  debugLog(`[DEBUG] Contract ${contractAddress} - Valid tokens: ${validTokenIds.length}`);

  if (validTokenIds.length === 0) {
    debugLog(`[DEBUG] No valid tokens found for contract ${contractAddress}`);
    return [];
  }

  // Fetch tiers with caching
  const tierCalls = validTokenIds.map(tokenId => ({
    address: contractAddress,
    abi: nftAbi,
    functionName: 'getNftTier',
    args: [tokenId],
  }));

  const tierResults = await batchMulticall(tierCalls);
  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const holdersMap = new Map();
  let totalNftsHeld = 0;

  tierResults.forEach((result, i) => {
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
        debugLog(`[DEBUG] Invalid tier ${tier} for token ${tokenId} on ${contractAddress}`);
      }
    } else {
      debugLog(`[DEBUG] Failed to fetch tier for token ${validTokenIds[i]} on ${contractAddress}`);
    }
  });

  const holders = Array.from(holdersMap.values());
  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  holders.forEach(holder => {
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holder.rank = 0;
    holder.displayMultiplierSum = contractName === 'element280' ? holder.multiplierSum / 10 : holder.multiplierSum;
  });

  debugLog(`[DEBUG] Contract ${contractAddress} - Total live NFTs held: ${totalNftsHeld}`);
  debugLog(`[DEBUG] Contract ${contractAddress} - Total redeemed NFTs: ${totalRedeemed}`);
  debugLog(`[DEBUG] Contract ${contractAddress} - Total MultiplierSum: ${totalMultiplierSum}`);

  // Sort by multiplierSum, then total
  const sortFn = (a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total;
  holders.sort(sortFn);
  holders.forEach((holder, index) => (holder.rank = index + 1));

  debugLog(`[DEBUG] Contract ${contractAddress} - Top 10:`, holders.slice(0, 10).map(h => ({
    wallet: h.wallet.slice(0, 6) + '...',
    rank: h.rank,
    total: h.total,
    multiplierSum: h.multiplierSum,
    displayMultiplierSum: h.displayMultiplierSum,
    percentage: h.percentage.toFixed(2),
  })));

  return holders;
}

async function getHolderData(contractAddress, wallet, startBlock, tiers) {
  const nfts = await alchemy.nft.getNftsForOwner(wallet, {
    contractAddresses: [contractAddress],
    block: startBlock,
  });

  if (nfts.totalCount === 0) return null;

  const walletLower = wallet.toLowerCase();
  const tokenIds = nfts.ownedNfts.map(nft => BigInt(nft.tokenId));
  debugLog(`[DEBUG] Wallet ${walletLower} on ${contractAddress} - Initial tokens from Alchemy: ${tokenIds.length}`);

  const ownerOfCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi: nftAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }));

  const ownerOfResults = await batchMulticall(ownerOfCalls);
  const validTokenIds = tokenIds.filter((tokenId, i) => {
    const owner = ownerOfResults[i].status === 'success' && ownerOfResults[i].result.toLowerCase();
    const cacheKey = `${contractAddress}-${tokenId}-owner`;
    tokenCache.set(cacheKey, owner);
    return owner === walletLower;
  });

  if (validTokenIds.length === 0) {
    debugLog(`[DEBUG] Wallet ${walletLower} on ${contractAddress} - No valid tokens after ownerOf check`);
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
    if (result.status === 'success') {
      const tier = Number(result.result);
      const tokenId = validTokenIds[i];
      const cacheKey = `${contractAddress}-${tokenId}-tier`;
      tokenCache.set(cacheKey, tier);
      if (tier >= 1 && tier <= maxTier) {
        tiersArray[tier] += 1;
        total += 1;
        multiplierSum += tiers[tier]?.multiplier || 0;
      } else {
        debugLog(`[DEBUG] Invalid tier ${tier} for token ${tokenId} on ${contractAddress} (wallet ${walletLower})`);
      }
    }
  });

  const tiersData = { tiers: tiersArray, total, multiplierSum };
  const contractName = Object.keys(contractAddresses).find(key => contractAddresses[key] === contractAddress);
  const allHolders = await getAllHolders(contractAddress, startBlock, tiers, contractName);
  const totalMultiplierSum = allHolders.reduce((sum, h) => sum + h.multiplierSum, 0);
  const percentage = totalMultiplierSum > 0 ? (tiersData.multiplierSum / totalMultiplierSum) * 100 : 0;

  const holder = allHolders.find(h => h.wallet === walletLower);
  const displayMultiplierSum = contractName === 'element280' ? multiplierSum / 10 : multiplierSum;
  debugLog(`[DEBUG] Wallet ${walletLower} on ${contractAddress} - Final: Total=${total}, Multiplier=${multiplierSum}, DisplayMultiplier=${displayMultiplierSum}, Tiers=${JSON.stringify(tiersArray)}`);
  return {
    wallet: walletLower,
    rank: holder ? holder.rank : allHolders.length + 1,
    total: tiersData.total,
    multiplierSum: tiersData.multiplierSum,
    displayMultiplierSum,
    percentage,
    tiers: tiersData.tiers,
  };
}