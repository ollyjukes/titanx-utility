// app/api/holders/route.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'wagmi/chains';
import { NextResponse } from 'next/server';

const NFT_CONTRACTS = {
  'element280': '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
  'staxNFT': '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
};

const TRANSFER_ABI = {
  name: 'Transfer',
  type: 'event',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'tokenId', type: 'uint256', indexed: true },
  ],
};
const GET_NFT_TIER_ABI = {
  name: 'getNftTier',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ type: 'uint8' }],
};

const ALCHEMY_URL = `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`;
const CONTRACT_DEPLOY_BLOCKS = {
  'element280': 20945304n,
  'staxNFT': 21452667n,
};

const TIER_MULTIPLIERS = {
  'element280': { 1: 10, 2: 12, 3: 100, 4: 120, 5: 1000, 6: 1200 },
  'staxNFT': {
    1: 1, 2: 1.2, 3: 1.4, 4: 2,
    5: 10, 6: 12, 7: 14, 8: 20,
    9: 100, 10: 120, 11: 140, 12: 200,
  },
};

let cache = {
  holders: { element280: [], staxNFT: [] },
  tokenTiers: { element280: new Map(), staxNFT: new Map() },
  lastBlock: { element280: CONTRACT_DEPLOY_BLOCKS.element280, staxNFT: CONTRACT_DEPLOY_BLOCKS.staxNFT },
  lastUpdated: 0,
  isFetching: false,
};
const CACHE_DURATION = 15 * 60 * 1000;

const client = createPublicClient({
  chain: mainnet,
  transport: http(ALCHEMY_URL),
});

async function getLogs(contractKey, fromBlock, toBlock) {
  return await client.getLogs({
    address: NFT_CONTRACTS[contractKey],
    event: TRANSFER_ABI,
    fromBlock,
    toBlock,
  });
}

async function fetchLogsInParallel(contractKey, start, end, chunkSize = 2000n) {
  const chunks = [];
  for (let i = start; i <= end; i += chunkSize) {
    const to = i + chunkSize - 1n > end ? end : i + chunkSize - 1n;
    chunks.push(getLogs(contractKey, i, to));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return (await Promise.all(chunks)).flat();
}

async function batchGetTiers(contractKey, tokenIds) {
  const calls = tokenIds.map((tokenId) => ({
    address: NFT_CONTRACTS[contractKey],
    abi: [GET_NFT_TIER_ABI],
    functionName: 'getNftTier',
    args: [tokenId],
  }));
  try {
    const results = await client.multicall({ contracts: calls });
    return results.map((result) => result.result ?? 0);
  } catch (error) {
    console.error(`Multicall failed for ${contractKey}:`, error);
    return tokenIds.map(() => 0);
  }
}

async function fetchElementHolders(lastBlock) {
  const latestBlock = await client.getBlockNumber();
  if (lastBlock >= latestBlock) return cache.holders.element280;

  const logs = await fetchLogsInParallel('element280', lastBlock + 1n, latestBlock);
  const ownershipMap = new Map(cache.holders.element280.map((h) => [h.wallet, { ...h }]));
  const newTokenIds = new Set();

  for (const log of logs) {
    const { from, to, tokenId } = log.args;
    const tokenIdNum = Number(tokenId);

    if (!cache.tokenTiers.element280.has(tokenIdNum)) newTokenIds.add(tokenIdNum);

    if (to !== '0x0000000000000000000000000000000000000000') {
      const current = ownershipMap.get(to) || { total: 0, tiers: {} };
      current.total += 1;
      ownershipMap.set(to, current);
    }
    if (from !== '0x0000000000000000000000000000000000000000') {
      const current = ownershipMap.get(from) || { total: 0, tiers: {} };
      current.total -= 1;
      if (current.total <= 0) ownershipMap.delete(from);
      else ownershipMap.set(from, current);
    }
  }

  if (newTokenIds.size > 0) {
    const tokenIds = Array.from(newTokenIds);
    const tiers = await batchGetTiers('element280', tokenIds);
    tokenIds.forEach((id, idx) => cache.tokenTiers.element280.set(id, tiers[idx]));
  }

  for (const log of logs) {
    const { from, to, tokenId } = log.args;
    const tokenIdNum = Number(tokenId);
    const tier = cache.tokenTiers.element280.get(tokenIdNum) ?? 0;

    if (to !== '0x0000000000000000000000000000000000000000') {
      const current = ownershipMap.get(to) || { total: 0, tiers: {} };
      current.tiers[tier] = (current.tiers[tier] || 0) + 1;
    }
    if (from !== '0x0000000000000000000000000000000000000000' && ownershipMap.has(from)) {
      const current = ownershipMap.get(from);
      current.tiers[tier] = (current.tiers[tier] || 0) - 1;
      if (current.tiers[tier] <= 0) delete current.tiers[tier];
    }
  }

  return processHolders(ownershipMap, 'element280');
}

async function fetchStaxHolders() {
  const totalSupply = Number(await client.readContract({
    address: NFT_CONTRACTS.staxNFT,
    abi: [{ name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
    functionName: 'totalSupply',
  }));

  const maxTokenId = Math.max(totalSupply, 2000);
  const tokenIds = Array.from({ length: maxTokenId }, (_, i) => i + 1);
  const ownershipMap = new Map();

  const ownerCalls = tokenIds.map((tokenId) => ({
    address: NFT_CONTRACTS.staxNFT,
    abi: [{ name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] }],
    functionName: 'ownerOf',
    args: [tokenId],
  }));
  const tierCalls = tokenIds.map((tokenId) => ({
    address: NFT_CONTRACTS.staxNFT,
    abi: [GET_NFT_TIER_ABI],
    functionName: 'getNftTier',
    args: [tokenId],
  }));
  const burnCalls = tokenIds.map((tokenId) => ({
    address: NFT_CONTRACTS.staxNFT,
    abi: [{ name: 'getBurnCycle', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint64' }] }],
    functionName: 'getBurnCycle',
    args: [tokenId],
  }));

  const [owners, tiers, burns] = await Promise.all([
    client.multicall({ contracts: ownerCalls }),
    client.multicall({ contracts: tierCalls }),
    client.multicall({ contracts: burnCalls }),
  ]);

  for (let i = 0; i < maxTokenId; i++) {
    const owner = owners[i].result;
    const tier = Number(tiers[i].result ?? 0);
    const burnCycle = Number(burns[i].result ?? 0);
    const ownerLower = owner ? owner.toLowerCase() : null;
    if (ownerLower && ownerLower !== '0x0000000000000000000000000000000000000000' && burnCycle === 0) {
      const current = ownershipMap.get(ownerLower) || { total: 0, tiers: {} };
      current.total += 1;
      current.tiers[tier] = (current.tiers[tier] || 0) + 1;
      ownershipMap.set(ownerLower, current);
    }
  }

  return processHolders(ownershipMap, 'staxNFT');
}

function processHolders(ownershipMap, contractKey) {
  const holders = Array.from(ownershipMap.entries())
    .filter(([, data]) => data.total > 0)
    .map(([wallet, data]) => {
      const multiplierSum = Object.entries(data.tiers).reduce((sum, [tier, count]) => {
        return sum + (TIER_MULTIPLIERS[contractKey][tier] || 0) * count;
      }, 0);
      return { wallet, total: data.total, tiers: data.tiers, multiplierSum };
    })
    .sort((a, b) => b.multiplierSum - a.multiplierSum);

  const totalMultiplierSum = holders.reduce((sum, holder) => sum + holder.multiplierSum, 0);
  return holders.map((holder, index) => ({
    ...holder,
    rank: index + 1,
    percentage: totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0,
  }));
}

async function fetchHolders(contractKey, lastBlock) {
  if (contractKey === 'element280') {
    return fetchElementHolders(lastBlock);
  } else if (contractKey === 'staxNFT') {
    const holders = await fetchStaxHolders();
    cache.holders.staxNFT = holders;
    return holders;
  }
  throw new Error('Invalid contract key');
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address')?.toLowerCase();
    const contract = searchParams.get('contract') || 'element280';

    if (!NFT_CONTRACTS[contract]) {
      return NextResponse.json({ error: 'Invalid contract specified' }, { status: 400 });
    }

    const now = Date.now();
    if (cache.holders[contract].length > 0 && now - cache.lastUpdated < CACHE_DURATION && !cache.isFetching) {
      if (address) {
        const staxHolder = cache.holders.staxNFT.find((h) => h.wallet.toLowerCase() === address);
        const elementHolder = cache.holders.element280.find((h) => h.wallet.toLowerCase() === address);
        return NextResponse.json({
          holders: {
            staxNFT: staxHolder || null,
            element280: elementHolder || null,
          },
          cached: true,
          timestamp: cache.lastUpdated,
        });
      }
      return NextResponse.json({ holders: cache.holders[contract], contract, cached: true, timestamp: cache.lastUpdated });
    }

    if (cache.isFetching) {
      while (cache.isFetching) await new Promise((resolve) => setTimeout(resolve, 100));
      if (address) {
        const staxHolder = cache.holders.staxNFT.find((h) => h.wallet.toLowerCase() === address);
        const elementHolder = cache.holders.element280.find((h) => h.wallet.toLowerCase() === address);
        return NextResponse.json({
          holders: {
            staxNFT: staxHolder || null,
            element280: elementHolder || null,
          },
          cached: true,
          timestamp: cache.lastUpdated,
        });
      }
      return NextResponse.json({ holders: cache.holders[contract], contract, cached: true, timestamp: cache.lastUpdated });
    }

    cache.isFetching = true;
    const [staxHolders, elementHolders] = await Promise.all([
      fetchHolders('staxNFT', cache.lastBlock.staxNFT),
      fetchHolders('element280', cache.lastBlock.element280),
    ]);
    cache.holders.staxNFT = staxHolders;
    cache.holders.element280 = elementHolders;
    cache.lastBlock.element280 = await client.getBlockNumber();
    cache.lastUpdated = Date.now();
    cache.isFetching = false;

    if (address) {
      const staxHolder = staxHolders.find((h) => h.wallet.toLowerCase() === address);
      const elementHolder = elementHolders.find((h) => h.wallet.toLowerCase() === address);
      return NextResponse.json({
        holders: {
          staxNFT: staxHolder || null,
          element280: elementHolder || null,
        },
        cached: false,
        timestamp: cache.lastUpdated,
      });
    }
    return NextResponse.json({ holders: cache.holders[contract], contract, cached: false, timestamp: cache.lastUpdated });
  } catch (error) {
    console.error('API Error:', error);
    cache.isFetching = false;
    return NextResponse.json({ error: 'Failed to fetch holders' }, { status: 500 });
  }
}