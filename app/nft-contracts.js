// app/nft-contracts.js

// Supported blockchain networks
export const supportedChains = ['ETH', 'BASE'];

// ABI for the main Element280 token contract (unchanged)
export const element280MainAbi = [
  {
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: 'result', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'balanceOf',
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'ownerOf',
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'getNftTier',
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ABI for Element280 vault contract (unchanged)
export const element280VaultAbi = [
  {
    name: 'getRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIds', type: 'uint256[]' },
      { name: 'account', type: 'address' },
    ],
    outputs: [
      { name: 'availability', type: 'bool[]' },
      { name: 'totalReward', type: 'uint256' },
    ],
  },
  {
    name: 'totalRewardPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

// NFT contract configurations
export const nftContracts = {
  element280: {
    name: 'Element 280',
    symbol: 'ELMNT',
    chain: 'ETH', // Added chain property
    address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
    vaultAddress: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97',
    deploymentBlock: '20945304',
    tiers: {
      1: { name: 'Common', multiplier: 10, allocation: '100000000000000000000000000' },
      2: { name: 'Common Amped', multiplier: 12, allocation: '100000000000000000000000000' },
      3: { name: 'Rare', multiplier: 100, allocation: '1000000000000000000000000000' },
      4: { name: 'Rare Amped', multiplier: 120, allocation: '1000000000000000000000000000' },
      5: { name: 'Legendary', multiplier: 1000, allocation: '10000000000000000000000000000' },
      6: { name: 'Legendary Amped', multiplier: 1200, allocation: '10000000000000000000000000000' },
    },
    description:
      'Element 280 NFTs can be minted with TitanX or ETH during a presale and redeemed for Element 280 tokens after a cooldown period. Multipliers contribute to a pool used for reward calculations.',
  },
  element369: {
    name: 'Element 369',
    symbol: 'E369',
    chain: 'ETH',
    address: '0x024D64E2F65747d8bB02dFb852702D588A062575',
    vaultAddress: '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5',
    deploymentBlock: '21224418',
    tiers: {
      1: { name: 'Common', multiplier: 1, price: '100000000000000000000000000' },
      2: { name: 'Rare', multiplier: 10, price: '1000000000000000000000000000' },
      3: { name: 'Legendary', multiplier: 100, price: '10000000000000000000000000000' },
    },
    description:
      'Element 369 NFTs are minted with TitanX or ETH during specific sale cycles. Burning NFTs updates a multiplier pool and tracks burn cycles for reward distribution in the Holder Vault.',
  },
  stax: {
    name: 'Stax',
    symbol: 'STAX',
    chain: 'ETH',
    address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
    vaultAddress: '0x5D27813C32dD705404d1A78c9444dAb523331717',
    deploymentBlock: '21452667',
    tiers: {
      1: { name: 'Common', multiplier: 1, price: '100000000000000000000000000' },
      2: { name: 'Common Amped', multiplier: 1.2, price: '100000000000000000000000000', amplifier: '10000000000000000000000000' },
      3: { name: 'Common Super', multiplier: 1.4, price: '100000000000000000000000000', amplifier: '20000000000000000000000000' },
      4: { name: 'Common LFG', multiplier: 2, price: '100000000000000000000000000', amplifier: '50000000000000000000000000' },
      5: { name: 'Rare', multiplier: 10, price: '1000000000000000000000000000' },
      6: { name: 'Rare Amped', multiplier: 12, price: '1000000000000000000000000000', amplifier: '100000000000000000000000000' },
      7: { name: 'Rare Super', multiplier: 14, price: '1000000000000000000000000000', amplifier: '200000000000000000000000000' },
      8: { name: 'Rare LFG', multiplier: 20, price: '1000000000000000000000000000', amplifier: '500000000000000000000000000' },
      9: { name: 'Legendary', multiplier: 100, price: '10000000000000000000000000000' },
      10: { name: 'Legendary Amped', multiplier: 120, price: '10000000000000000000000000000', amplifier: '1000000000000000000000000000' },
      11: { name: 'Legendary Super', multiplier: 140, price: '10000000000000000000000000000', amplifier: '2000000000000000000000000000' },
      12: { name: 'Legendary LFG', multiplier: 200, price: '10000000000000000000000000000', amplifier: '5000000000000000000000000000' },
    },
    description:
      'Stax NFTs are minted with TitanX or ETH during a presale. Burning NFTs after a cooldown period claims backing rewards, with multipliers contributing to a pool for cycle-based reward calculations.',
  },
  ascendant: {
    name: 'Ascendant',
    symbol: 'ASCNFT',
    chain: 'ETH',
    address: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f',
    deploymentBlock: '21112535',
    tiers: {
      1: { name: 'Tier 1', price: '7812500000000000000000', multiplier: 1.01 },
      2: { name: 'Tier 2', price: '15625000000000000000000', multiplier: 1.02 },
      3: { name: 'Tier 3', price: '31250000000000000000000', multiplier: 1.03 },
      4: { name: 'Tier 4', price: '62500000000000000000000', multiplier: 1.04 },
      5: { name: 'Tier 5', price: '125000000000000000000000', multiplier: 1.05 },
      6: { name: 'Tier 6', price: '250000000000000000000000', multiplier: 1.06 },
      7: { name: 'Tier 7', price: '500000000000000000000000', multiplier: 1.07 },
      8: { name: 'Tier 8', price: '1000000000000000000000000', multiplier: 1.08 },
    },
    description:
      'Ascendant NFTs are minted with ASCENDANT tokens and offer staking rewards from DragonX pools over 8, 28, and 90-day periods. Features fusion mechanics to combine same-tier NFTs into higher tiers.',
  },
  e280: {
    name: 'E280',
    symbol: 'E280',
    chain: 'BASE',
    address: null,
    deploymentBlock: null,
    tiers: {},
    description: 'E280 NFTs on BASE chain. Contract not yet deployed.',
  },
};

// Contract addresses (updated to include chain)
export const contractAddresses = {
  element280: { chain: nftContracts.element280.chain, address: nftContracts.element280.address },
  element369: { chain: nftContracts.element369.chain, address: nftContracts.element369.address },
  stax: { chain: nftContracts.stax.chain, address: nftContracts.stax.address },
  ascendant: { chain: nftContracts.ascendant.chain, address: nftContracts.ascendant.address },
  e280: { chain: nftContracts.e280.chain, address: nftContracts.e280.address },
};

// Vault addresses (updated to include chain)
export const vaultAddresses = {
  element280: { chain: nftContracts.element280.chain, address: nftContracts.element280.vaultAddress },
  element369: { chain: nftContracts.element369.chain, address: nftContracts.element369.vaultAddress },
  stax: { chain: nftContracts.stax.chain, address: nftContracts.stax.vaultAddress },
  e280: { chain: nftContracts.e280.chain, address: null },
};

// Deployment blocks (updated to include chain)
export const deploymentBlocks = {
  element280: { chain: nftContracts.element280.chain, block: nftContracts.element280.deploymentBlock },
  element369: { chain: nftContracts.element369.chain, block: nftContracts.element369.deploymentBlock },
  stax: { chain: nftContracts.stax.chain, block: nftContracts.stax.deploymentBlock },
  ascendant: { chain: nftContracts.ascendant.chain, block: nftContracts.ascendant.deploymentBlock },
  e280: { chain: nftContracts.e280.chain, block: nftContracts.e280.deploymentBlock },
};

// Contract tiers (unchanged)
export const contractTiers = {
  element280: {
    1: { name: nftContracts.element280.tiers[1].name, multiplier: nftContracts.element280.tiers[1].multiplier },
    2: { name: nftContracts.element280.tiers[2].name, multiplier: nftContracts.element280.tiers[2].multiplier },
    3: { name: nftContracts.element280.tiers[3].name, multiplier: nftContracts.element280.tiers[3].multiplier },
    4: { name: nftContracts.element280.tiers[4].name, multiplier: nftContracts.element280.tiers[4].multiplier },
    5: { name: nftContracts.element280.tiers[5].name, multiplier: nftContracts.element280.tiers[5].multiplier },
    6: { name: nftContracts.element280.tiers[6].name, multiplier: nftContracts.element280.tiers[6].multiplier },
  },
  element369: nftContracts.element369.tiers,
  stax: nftContracts.stax.tiers,
  ascendant: nftContracts.ascendant.tiers,
  e280: nftContracts.e280.tiers,
};

// Contract details (updated to include chain)
export const contractDetails = {
  element280: {
    name: nftContracts.element280.name,
    chain: nftContracts.element280.chain,
    pageSize: 100,
    apiEndpoint: '/api/holders/Element280',
    rewardToken: 'ELMNT',
  },
  element369: {
    name: nftContracts.element369.name,
    chain: nftContracts.element369.chain,
    pageSize: 1000,
    apiEndpoint: '/api/holders/Element369',
    rewardToken: 'INFERNO/FLUX/E280',
  },
  stax: {
    name: nftContracts.stax.name,
    chain: nftContracts.stax.chain,
    pageSize: 1000,
    apiEndpoint: '/api/holders/Stax',
    rewardToken: 'X28',
  },
  ascendant: {
    name: nftContracts.ascendant.name,
    chain: nftContracts.ascendant.chain,
    pageSize: 1000,
    apiEndpoint: '/api/holders/Ascendant',
    rewardToken: 'DRAGONX',
  },
  e280: {
    name: nftContracts.e280.name,
    chain: nftContracts.e280.chain,
    pageSize: 1000,
    apiEndpoint: '/api/holders/E280',
    rewardToken: 'E280',
    disabled: true,
  },
};

// Utility function to get contract details by name
export function getContractDetails(contractName) {
  return nftContracts[contractName] || null;
}