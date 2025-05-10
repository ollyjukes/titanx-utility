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
  transport: http(
    process.env.ETH_RPC_URL ||
    `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`
  ),
});

// Generic NFT ABI for common functions
export const nftAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getNftTier(uint256 tokenId) view returns (uint8)',
]);

// Ascendant NFT ABI with specific functions
export const ascendantAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getNFTAttribute(uint256 tokenId) view returns (uint256 rarityNumber, uint8 tier, uint8 rarity)',
  'function userRecords(uint256 tokenId) view returns (uint256 shares, uint256 lockedAscendant, uint256 rewardDebt, uint32 startTime, uint32 endTime)',
  'function totalShares() view returns (uint256)',
  'function toDistribute(uint8 pool) view returns (uint256)',
  'function rewardPerShare() view returns (uint256)',
  'error NonExistentToken(uint256 tokenId)',
]);

export function log(message) {
  console.log(`[PROD_DEBUG] ${message}`);
}