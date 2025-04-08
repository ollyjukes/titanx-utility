// app/api/utils.js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';

export const alchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || (() => { throw new Error('Alchemy API key missing'); })(),
  network: Network.ETH_MAINNET,
});

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

export const nftAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getNftTier(uint256 tokenId) view returns (uint8)",
]);

export const ascendantAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getNFTAttribute(uint256 tokenId) view returns (uint256 rarityNumber, uint8 tier, uint8 rarity)",
  "function userRecords(uint256 tokenId) view returns (uint256 shares, uint256 lockedAscendant, uint256 rewardDebt, uint32 startTime, uint32 endTime)",
  "function totalShares() view returns (uint256)",
  "function toDistribute(uint8 pool) view returns (uint256)",
  "function rewardPerShare() view returns (uint256)",
  "error NonExistentToken(uint256 tokenId)"
]);

export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function log(message) {
  console.log(`[PROD_DEBUG] ${message}`);
}

export async function batchMulticall(calls, batchSize = 50) {
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