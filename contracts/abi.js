// ./contracts/abi.js
import staxNFT from '@/abi/staxNFT.json';
import staxVault from '@/abi/staxVault.json';
import element280NFT from '@/abi/element280.json';
import element280Vault from '@/abi/element280Vault.json';
import element369NFT from '@/abi/element369.json';
import element369Vault from '@/abi/element369Vault.json';
import ascendantNFT from '@/abi/ascendantNFT.json';

// ABI function mappings for each collection
const abiFunctions = {
  stax: {
    nft: staxNFT,
    vault: staxVault,
    rewardFunction: {
      name: 'getRewards',
      contract: 'vault',
      inputs: ['tokenIds', 'account'],
      outputs: ['availability', 'totalPayout'],
    },
    tierFunction: {
      name: 'getNftTier',
      contract: 'nft',
      inputs: ['tokenId'],
      outputs: ['tier'],
    },
    batchTokenData: {
      name: 'batchGetTokenData',
      contract: 'nft',
      inputs: ['tokenIds'],
      outputs: ['tiers', 'multipliers', 'mintCycles', 'burnCycles', 'burnAddresses'],
    },
  },
  element280: {
    nft: element280NFT,
    vault: element280Vault,
    rewardFunction: {
      name: 'getRewards',
      contract: 'vault',
      inputs: ['tokenIds', 'account'],
      outputs: ['availability', 'totalReward'],
    },
    tierFunction: {
      name: 'getNftTier',
      contract: 'nft',
      inputs: ['tokenId'],
      outputs: ['tier'],
    },
    batchTokenData: {
      name: 'getBatchedTokensData',
      contract: 'nft',
      inputs: ['tokenIds', 'nftOwner'],
      outputs: ['timestamps', 'multipliers'],
    },
  },
  element369: {
    nft: element369NFT,
    vault: element369Vault,
    rewardFunction: {
      name: 'getRewards',
      contract: 'vault',
      inputs: ['tokenIds', 'account', 'isBacking'],
      outputs: ['availability', 'burned', 'infernoPool', 'fluxPool', 'e280Pool'],
    },
    tierFunction: {
      name: 'getNftTier',
      contract: 'nft',
      inputs: ['tokenId'],
      outputs: ['tier'],
    },
    batchTokenData: {
      name: 'batchGetTokenData',
      contract: 'nft',
      inputs: ['tokenIds'],
      outputs: ['tiers', 'multipliers', 'mintCycles', 'burnCycles', 'burnAddresses'],
    },
  },
  ascendant: {
    nft: ascendantNFT,
    vault: null,
    rewardFunction: {
      name: 'batchClaimableAmount',
      contract: 'nft',
      inputs: ['tokenIds'],
      outputs: ['toClaim'],
    },
    tierFunction: {
      name: 'getNFTAttribute',
      contract: 'nft',
      inputs: ['tokenId'],
      outputs: ['attributes'], // Extract tier from attributes[1]
    },
    batchTokenData: null, // Ascendant doesn't support batch token data
  },
  e280: {
    nft: null,
    vault: null,
    rewardFunction: null,
    tierFunction: null,
    batchTokenData: null,
  },
};

// Common ABI functions
export const commonFunctions = {
  totalSupply: {
    name: 'totalSupply',
    contract: 'nft',
    inputs: [],
    outputs: ['result'],
  },
  totalBurned: {
    name: 'totalBurned',
    contract: 'nft',
    inputs: [],
    outputs: ['result'],
  },
  ownerOf: {
    name: 'ownerOf',
    contract: 'nft',
    inputs: ['tokenId'],
    outputs: ['owner'],
  },
  tokenId: {
    name: 'tokenId',
    contract: 'nft',
    inputs: [],
    outputs: ['result'],
  },
};

// Validate ABIs at startup
Object.entries(abiFunctions).forEach(([key, { nft, vault, rewardFunction, tierFunction }]) => {
  if (key === 'e280') return; // Skip disabled
  if (!nft) throw new Error(`Missing NFT ABI for ${key}`);
  if (key !== 'ascendant' && !vault) throw new Error(`Missing vault ABI for ${key}`);
  if (!rewardFunction) throw new Error(`Missing reward function for ${key}`);
  if (!tierFunction) throw new Error(`Missing tier function for ${key}`);
  if (key !== 'ascendant' && !nft.find(f => f.name === commonFunctions.totalSupply.name)) {
    throw new Error(`Missing totalSupply for ${key}`);
  }
  if (key === 'ascendant' && !nft.find(f => f.name === commonFunctions.tokenId.name)) {
    throw new Error(`Missing tokenId for ${key}`);
  }
  if (!nft.find(f => f.name === commonFunctions.ownerOf.name)) {
    throw new Error(`Missing ownerOf for ${key}`);
  }
});

// Utility functions
export function getContractAbi(contractKey, contractType = 'nft') {
  const collection = abiFunctions[contractKey.toLowerCase()];
  if (!collection) throw new Error(`Unknown contract key: ${contractKey}`);
  return collection[contractType] || null;
}

export function getRewardFunction(contractKey) {
  const collection = abiFunctions[contractKey.toLowerCase()];
  if (!collection) throw new Error(`Unknown contract key: ${contractKey}`);
  return collection.rewardFunction || null;
}

export function getTierFunction(contractKey) {
  const collection = abiFunctions[contractKey.toLowerCase()];
  if (!collection) throw new Error(`Unknown contract key: ${contractKey}`);
  return collection.tierFunction || null;
}

export function getBatchTokenDataFunction(contractKey) {
  const collection = abiFunctions[contractKey.toLowerCase()];
  if (!collection) throw new Error(`Unknown contract key: ${contractKey}`);
  return collection.batchTokenData || null;
}

export const abis = {
  stax: { nft: staxNFT, vault: staxVault },
  element280: { nft: element280NFT, vault: element280Vault },
  element369: { nft: element369NFT, vault: element369Vault },
  ascendant: { nft: ascendantNFT, vault: null },
  e280: { nft: null, vault: null },
};