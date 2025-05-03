// app/api/utils/abis.js
import { parseAbi } from 'viem';
import config from '@/config';

export const nftAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getNftTier(uint256 tokenId) view returns (uint8)',
]);

export const ascendantAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function getNFTAttribute(uint256 tokenId) view returns (uint256 rarityNumber, uint8 tier, uint8 rarity)',
  'function userRecords(uint256 tokenId) view returns (uint256 shares, uint256 lockedAscendant, uint256 rewardDebt, uint32 startTime, uint32 endTime)',
  'function totalShares() view returns (uint256)',
  'function toDistribute(uint8 pool) view returns (uint256)',
  'function rewardPerShare() view returns (uint256)',
  'error NonExistentToken(uint256 tokenId)',
]);

// Export ABIs from config
export const staxNFTAbi = config.abis.stax.main;
export const element369Abi = config.abis.element369.main;
export const element369VaultAbi = config.abis.element369.vault;
export const staxVaultAbi = config.abis.stax.vault;
export const ascendantNFTAbi = config.abis.ascendant.main;
export const element280Abi = config.abis.element280.main;
export const element280VaultAbi = config.abis.element280.vault;