// app/api/utils.js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';
import { Redis } from '@upstash/redis';

// Initialize Upstash Redis
export const redis = Redis.fromEnv();

// Import all ABI JSON files
import staxNFTAbi from '@/abi/staxNFT.json';
import element369Abi from '@/abi/element369.json';
import element369VaultAbi from '@/abi/element369Vault.json';
import staxVaultAbi from '@/abi/staxVault.json';
import ascendantNFTAbi from '@/abi/ascendantNFT.json';
import element280Abi from '@/abi/element280.json';
import element280VaultAbi from '@/abi/element280Vault.json';

export const alchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || (() => { throw new Error('Alchemy API key missing'); })(),
  network: Network.ETH_MAINNET,
});

export const client = createPublicClient({
  chain: mainnet,
  transport: http(
    process.env.ETH_RPC_URL ||
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
    { timeout: 60000 }
  ),
});

// Generic NFT ABI
export const nftAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getNftTier(uint256 tokenId) view returns (uint8)',
]);

// Ascendant NFT ABI
export const ascendantAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getNFTAttribute(uint256 tokenId) view returns (uint256 rarityNumber, uint8 tier, uint8 rarity)',
  'function userRecords(uint256 tokenId) view returns (uint256 shares, uint256 lockedAscendant, uint256 rewardDebt, uint32 startTime, uint32 endTime)',
  'function totalShares() view returns (uint256)',
  'function toDistribute(uint8 pool) view returns (uint256)',
  'function rewardPerShare() view returns (uint256)',
  'error NonExistentToken(uint256 tokenId)',
]);

// Export ABIs
export {
  staxNFTAbi,
  element369Abi,
  element369VaultAbi,
  staxVaultAbi,
  ascendantNFTAbi,
  element280Abi,
  element280VaultAbi,
};

export const CACHE_TTL = 5 * 60; // 5 minutes in seconds

export function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [PROD_DEBUG] ${message}`);
}

// Upstash Redis cache functions
export async function getCache(key) {
  try {
    const cached = await redis.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL * 1000) {
      log(`[UpstashRedis] Cache hit for ${key}`);
      return cached.data;
    }
    log(`[UpstashRedis] Cache miss for ${key}: ${cached ? 'expired' : 'no entry'}`);
    return null;
  } catch (error) {
    log(`[UpstashRedis] Error getting cache for ${key}: ${error.message}`);
    return null;
  }
}

export async function setCache(key, data) {
  try {
    await redis.set(key, { data, timestamp: Date.now() }, { ex: CACHE_TTL }); // Expiry in seconds
    log(`[UpstashRedis] Cached ${key}`);
  } catch (error) {
    log(`[UpstashRedis] Error setting cache for ${key}: ${error.message}`);
  }
}

export async function batchMulticall(calls, batchSize = 50) {
  log(`batchMulticall: Processing ${calls.length} calls in batches of ${batchSize}`);
  const results = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    try {
      const batchResults = await client.multicall({ contracts: batch });
      results.push(...batchResults.map((result, idx) => ({
        status: result.status,
        result: result.status === 'success' ? result.result : null,
        error: result.status === 'failure' ? result.error?.message || 'Unknown error' : null,
      })));
      log(`batchMulticall: Batch ${i}-${i + batchSize - 1} completed with ${batchResults.length} results`);
    } catch (error) {
      console.error(`[PROD_ERROR] batchMulticall failed for batch ${i}-${i + batchSize - 1}: ${error.message}`);
      results.push(...batch.map(() => ({
        status: 'failure',
        result: null,
        error: error.message || 'Unknown error',
      })));
    }
  }
  log(`batchMulticall: Completed with ${results.length} results`);
  return results;
}