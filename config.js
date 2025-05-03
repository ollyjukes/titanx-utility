// config.js
import element280MainAbi from './abi/element280.json' with { type: 'json' };
import element280VaultAbi from './abi/element280Vault.json' with { type: 'json' };
import element369MainAbi from './abi/element369.json' with { type: 'json' };
import element369VaultAbi from './abi/element369Vault.json' with { type: 'json' };
import staxMainAbi from './abi/staxNFT.json' with { type: 'json' };
import staxVaultAbi from './abi/staxVault.json' with { type: 'json' };
import ascendantMainAbi from './abi/ascendantNFT.json' with { type: 'json' };
// E280 ABI placeholder (not deployed)
const e280MainAbi = [];

const config = {
  // Supported blockchain networks
  supportedChains: ['ETH', 'BASE'],

  // ABIs for all collections
  abis: {
    element280: {
      main: element280MainAbi,
      vault: element280VaultAbi,
    },
    element369: {
      main: element369MainAbi,
      vault: element369VaultAbi,
    },
    stax: {
      main: staxMainAbi,
      vault: staxVaultAbi,
    },
    ascendant: {
      main: ascendantMainAbi,
      vault: [], // No vault ABI provided for Ascendant
    },
    e280: {
      main: e280MainAbi,
      vault: [],
    },
  },

  // NFT contract configurations
  nftContracts: {
    element280: {
      name: 'Element 280',
      symbol: 'ELMNT',
      chain: 'ETH',
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
      expectedTotalSupply: 8107,
      expectedBurned: 8776,
      maxTokensPerOwnerQuery: 100,
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
      disabled: true,
    },
  },

  // Contract addresses
  contractAddresses: {
    element280: { chain: 'ETH', address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9' },
    element369: { chain: 'ETH', address: '0x024D64E2F65747d8bB02dFb852702D588A062575' },
    stax: { chain: 'ETH', address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1' },
    ascendant: { chain: 'ETH', address: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f' },
    e280: { chain: 'BASE', address: null },
  },

  // Vault addresses
  vaultAddresses: {
    element280: { chain: 'ETH', address: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97' },
    element369: { chain: 'ETH', address: '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5' },
    stax: { chain: 'ETH', address: '0x5D27813C32dD705404d1A78c9444dAb523331717' },
    e280: { chain: 'BASE', address: null },
  },

  // Deployment blocks
  deploymentBlocks: {
    element280: { chain: 'ETH', block: '20945304' },
    element369: { chain: 'ETH', block: '21224418' },
    stax: { chain: 'ETH', block: '21452667' },
    ascendant: { chain: 'ETH', block: '21112535' },
    e280: { chain: 'BASE', block: null },
  },

  // Contract tiers
  contractTiers: {
    element280: {
      1: { name: 'Common', multiplier: 10 },
      2: { name: 'Common Amped', multiplier: 12 },
      3: { name: 'Rare', multiplier: 100 },
      4: { name: 'Rare Amped', multiplier: 120 },
      5: { name: 'Legendary', multiplier: 1000 },
      6: { name: 'Legendary Amped', multiplier: 1200 },
    },
    element369: {
      1: { name: 'Common', multiplier: 1 },
      2: { name: 'Rare', multiplier: 10 },
      3: { name: 'Legendary', multiplier: 100 },
      tierOrder: [
        { tierId: '3', name: 'Legendary' },
        { tierId: '2', name: 'Rare' },
        { tierId: '1', name: 'Common' },
      ],
    },
    stax: {
      1: { name: 'Common', multiplier: 1 },
      2: { name: 'Common Amped', multiplier: 1.2 },
      3: { name: 'Common Super', multiplier: 1.4 },
      4: { name: 'Common LFG', multiplier: 2 },
      5: { name: 'Rare', multiplier: 10 },
      6: { name: 'Rare Amped', multiplier: 12 },
      7: { name: 'Rare Super', multiplier: 14 },
      8: { name: 'Rare LFG', multiplier: 20 },
      9: { name: 'Legendary', multiplier: 100 },
      10: { name: 'Legendary Amped', multiplier: 120 },
      11: { name: 'Legendary Super', multiplier: 140 },
      12: { name: 'Legendary LFG', multiplier: 200 },
    },
    ascendant: {
      1: { name: 'Tier 1', multiplier: 1.01 },
      2: { name: 'Tier 2', multiplier: 1.02 },
      3: { name: 'Tier 3', multiplier: 1.03 },
      4: { name: 'Tier 4', multiplier: 1.04 },
      5: { name: 'Tier 5', multiplier: 1.05 },
      6: { name: 'Tier 6', multiplier: 1.06 },
      7: { name: 'Tier 7', multiplier: 1.07 },
      8: { name: 'Tier 8', multiplier: 1.08 },
    },
    e280: {},
  },

  // Contract details
  contractDetails: {
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
  },

  // Utility function to get contract details by name
  getContractDetails: (contractName) => {
    return config.nftContracts[contractName] || null;
  },

  alchemy: {
    apiKey: process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
    network: 'eth-mainnet',
    batchSize: 50, // Increased for larger batches
    batchDelayMs: 500, // Reduced for speed
    retryMaxDelayMs: 10000, // Reduced to fail faster
    maxRetries: 2, // Reduced to minimize retry overhead
    timeoutMs: 30000,
  },
  
  // Cache settings
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

  // Debug settings
  debug: {
    enabled: process.env.DEBUG === 'true',
    logLevel: 'debug',
  },

  // Fallback data (optional, for testing)
  fallbackData: {
    element280: process.env.USE_FALLBACK_DATA === 'true' ? element280NftStatus : null,
  },
};

export default config;