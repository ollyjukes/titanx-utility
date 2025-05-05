// ./contracts/config.js
import { abis } from './abi.js';

// E280 is not deployed
const e280MainAbi = null;

// Centralized contract configurations
const nftContracts = {
  element280: {
    name: 'Element 280',
    symbol: 'ELMNT',
    chain: 'ETH',
    contractAddress: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
    vaultAddress: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97',
    deploymentBlock: '20945304',
    totalMinted: 16883,
    abi: abis.element280.nft,
    tiers: {
      1: { name: 'Common', multiplier: 10, allocation: '100000000000000000000000000' },
      2: { name: 'Common Amped', multiplier: 12, allocation: '100000000000000000000000000' },
      3: { name: 'Rare', multiplier: 100, allocation: '1000000000000000000000000000' },
      4: { name: 'Rare Amped', multiplier: 120, allocation: '1000000000000000000000000000' },
      5: { name: 'Legendary', multiplier: 1000, allocation: '10000000000000000000000000000' },
      6: { name: 'Legendary Amped', multiplier: 1200, allocation: '10000000000000000000000000000' },
    },
    description: 'Element 280 NFTs can be minted with TitanX or ETH during a presale and redeemed for Element 280 tokens after a cooldown period. Multipliers contribute to a pool used for reward calculations.',
    maxTokensPerOwnerQuery: 100,
  },
  element369: {
    name: 'Element 369',
    symbol: 'E369',
    chain: 'ETH',
    contractAddress: '0x024D64E2F65747d8bB02dFb852702D588A062575',
    vaultAddress: '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5',
    deploymentBlock: '21224418',
    abi: abis.element369.nft,
    tiers: {
      1: { name: 'Common', multiplier: 1, price: '100000000000000000000000000' },
      2: { name: 'Rare', multiplier: 10, price: '1000000000000000000000000000' },
      3: { name: 'Legendary', multiplier: 100, price: '10000000000000000000000000000' },
    },
    description: 'Element 369 NFTs are minted with TitanX or ETH during specific sale cycles. Burning NFTs updates a multiplier pool and tracks burn cycles for reward distribution in the Holder Vault.',
  },
  stax: {
    name: 'Stax',
    symbol: 'STAX',
    chain: 'ETH',
    contractAddress: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
    vaultAddress: '0x5D27813C32dD705404d1A78c9444dAb523331717',
    deploymentBlock: '21452667',
    totalMinted: 503,
    abi: abis.stax.nft,
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
    description: 'Stax NFTs are minted with TitanX or ETH during a presale. Burning NFTs after a cooldown period claims backing rewards, with multipliers contributing to a pool for cycle-based reward calculations.',
  },
  ascendant: {
    name: 'Ascendant',
    symbol: 'ASCNFT',
    chain: 'ETH',
    contractAddress: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f',
    vaultAddress: null,
    deploymentBlock: '21112535',
    abi: abis.ascendant.nft,
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
    description: 'Ascendant NFTs are minted with ASCENDANT tokens and offer staking rewards from DragonX pools over 8, 28, and 90-day periods. Features fusion mechanics to combine same-tier NFTs into higher tiers.',
  },
  e280: {
    name: 'E280',
    symbol: 'E280',
    chain: 'BASE',
    contractAddress: null,
    vaultAddress: null,
    deploymentBlock: null,
    abi: null,
    tiers: {},
    description: 'E280 NFTs on BASE chain. Contract not yet deployed.',
    disabled: true,
  },
};

// Tier order configurations
const contractTiers = {
  element280: {
    tierOrder: [
      { tierId: '6', name: 'Legendary Amped' },
      { tierId: '5', name: 'Legendary' },
      { tierId: '4', name: 'Rare Amped' },
      { tierId: '3', name: 'Rare' },
      { tierId: '2', name: 'Common Amped' },
      { tierId: '1', name: 'Common' },
    ],
  },
  element369: {
    tierOrder: [
      { tierId: '3', name: 'Legendary' },
      { tierId: '2', name: 'Rare' },
      { tierId: '1', name: 'Common' },
    ],
  },
  stax: {
    tierOrder: [
      { tierId: '12', name: 'Legendary LFG' },
      { tierId: '11', name: 'Legendary Super' },
      { tierId: '10', name: 'Legendary Amped' },
      { tierId: '9', name: 'Legendary' },
      { tierId: '8', name: 'Rare LFG' },
      { tierId: '7', name: 'Rare Super' },
      { tierId: '6', name: 'Rare Amped' },
      { tierId: '5', name: 'Rare' },
      { tierId: '4', name: 'Common LFG' },
      { tierId: '3', name: 'Common Super' },
      { tierId: '2', name: 'Common Amped' },
      { tierId: '1', name: 'Common' },
    ],
  },
  ascendant: {
    tierOrder: [
      { tierId: '8', name: 'Tier 8' },
      { tierId: '7', name: 'Tier 7' },
      { tierId: '6', name: 'Tier 6' },
      { tierId: '5', name: 'Tier 5' },
      { tierId: '4', name: 'Tier 4' },
      { tierId: '3', name: 'Tier 3' },
      { tierId: '2', name: 'Tier 2' },
      { tierId: '1', name: 'Tier 1' },
    ],
  },
  e280: { tierOrder: [] },
};

// Contract details for API endpoints
const contractDetails = {
  element280: {
    name: 'Element 280',
    chain: 'ETH',
    pageSize: 100,
    apiEndpoint: '/api/holders/Element280',
    rewardToken: 'ELMNT',
  },
  element369: {
    name: 'Element 369',
    chain: 'ETH',
    pageSize: 1000,
    apiEndpoint: '/api/holders/Element369',
    rewardToken: 'INFERNO/FLUX/E280',
  },
  stax: {
    name: 'Stax',
    chain: 'ETH',
    pageSize: 1000,
    apiEndpoint: '/api/holders/Stax',
    rewardToken: 'X28',
  },
  ascendant: {
    name: 'Ascendant',
    chain: 'ETH',
    pageSize: 1000,
    apiEndpoint: '/api/holders/Ascendant',
    rewardToken: 'DRAGONX',
  },
  e280: {
    name: 'E280',
    chain: 'BASE',
    pageSize: 1000,
    apiEndpoint: '/api/holders/E280',
    rewardToken: 'E280',
    disabled: true,
  },
};

const config = {
  supportedChains: ['ETH', 'BASE'],

  abis: {
    element280: abis.element280,
    element369: abis.element369,
    stax: abis.stax,
    ascendant: abis.ascendant,
    e280: { main: e280MainAbi, vault: null },
  },

  nftContracts,

  contractAddresses: Object.keys(nftContracts).reduce((acc, key) => ({
    ...acc,
    [key]: { chain: nftContracts[key].chain, address: nftContracts[key].contractAddress },
  }), {}),

  vaultAddresses: Object.keys(nftContracts).reduce((acc, key) => ({
    ...acc,
    [key]: { chain: nftContracts[key].chain, address: nftContracts[key].vaultAddress },
  }), {}),

  deploymentBlocks: Object.keys(nftContracts).reduce((acc, key) => ({
    ...acc,
    [key]: { chain: nftContracts[key].chain, block: nftContracts[key].deploymentBlock },
  }), {}),

  contractTiers,

  contractDetails,

  getContractDetails: (contractName) => contractDetails[contractName.toLowerCase()] || null,

  alchemy: {
    apiKey: process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
    network: 'eth-mainnet',
    batchSize: 50,
    batchDelayMs: 500,
    retryMaxDelayMs: 10000,
    maxRetries: 1, // Reduced to minimize retry logs
    timeoutMs: 30000,
  },

  cache: {
    redis: {
      disableElement280: process.env.DISABLE_ELEMENT280_REDIS === 'true',
      disableElement369: process.env.DISABLE_ELEMENT369_REDIS === 'true',
      disableStax: process.env.DISABLE_STAX_REDIS === 'true',
      disableAscendant: process.env.DISABLE_ASCENDANT_REDIS === 'true',
      disableE280: process.env.DISABLE_E280_REDIS === 'true' || true,
    },
    nodeCache: {
      stdTTL: 3600,
      checkperiod: 120,
    },
  },

  debug: {
    enabled: process.env.DEBUG === 'true',
    logLevel: 'info', // Changed to reduce log volume
  },

  fallbackData: {
    element280: process.env.USE_FALLBACK_DATA === 'true' ? null : null,
  },

  burnAddress: '0x0000000000000000000000000000000000000000',

  validateContracts: () => {
    Object.entries(nftContracts).forEach(([key, contract]) => {
      if (!contract.disabled) {
        if (!contract.contractAddress) {
          throw new Error(`Missing contractAddress for ${key}`);
        }
        if (!Array.isArray(contract.abi)) {
          throw new Error(`Invalid or missing ABI for ${key}: expected array, got ${typeof contract.abi}`);
        }
      }
    });
  },
};

// Log config loading for debugging
console.log('Loaded config.js:', {
  staxAbi: Array.isArray(config.nftContracts.stax.abi) ? 'array' : 'invalid',
  ascendantAbi: Array.isArray(config.nftContracts.ascendant.abi) ? 'array' : 'invalid',
  element280Abi: Array.isArray(config.nftContracts.element280.abi) ? 'array' : 'invalid',
  element369Abi: Array.isArray(config.nftContracts.element369.abi) ? 'array' : 'invalid',
});

export default config;