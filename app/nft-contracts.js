// app/nft-contracts.js
export const nftContracts = {
  element280: {
    name: "Element 280",
    symbol: "ELMNT",
    address: "0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9",
    deploymentBlock: "20945304",
    tiers: {
      1: { name: "Common", multiplier: 10, allocation: "100000000000000000000000000" },
      2: { name: "Common Amped", multiplier: 12, allocation: "100000000000000000000000000" },
      3: { name: "Rare", multiplier: 100, allocation: "1000000000000000000000000000" },
      4: { name: "Rare Amped", multiplier: 120, allocation: "1000000000000000000000000000" },
      5: { name: "Legendary", multiplier: 1000, allocation: "10000000000000000000000000000" },
      6: { name: "Legendary Amped", multiplier: 1200, allocation: "10000000000000000000000000000" },
    },
    description:
      "Element 280 NFTs can be minted with TitanX or ETH during a presale and redeemed for Element 280 tokens after a cooldown period. Multipliers contribute to a pool used for reward calculations.",
  },
  element369: {
    name: "Element 369",
    symbol: "E369",
    address: "0x024D64E2F65747d8bB02dFb852702D588A062575",
    deploymentBlock: "21224418",
    tiers: {
      1: { name: "Common", multiplier: 1, price: "100000000000000000000000000" },
      2: { name: "Rare", multiplier: 10, price: "1000000000000000000000000000" },
      3: { name: "Legendary", multiplier: 100, price: "10000000000000000000000000000" },
    },
    description:
      "Element 369 NFTs are minted with TitanX or ETH during specific sale cycles. Burning NFTs updates a multiplier pool and tracks burn cycles for reward distribution in the Holder Vault.",
  },
  staxNFT: {
    name: "Stax",
    symbol: "STAX",
    address: "0x74270Ca3a274B4dbf26be319A55188690CACE6E1",
    deploymentBlock: "21452667",
    tiers: {
      1: { name: "Common", multiplier: 1, price: "100000000000000000000000000" },
      2: { name: "Common Amped", multiplier: 1.2, price: "100000000000000000000000000", amplifier: "10000000000000000000000000" },
      3: { name: "Common Super", multiplier: 1.4, price: "100000000000000000000000000", amplifier: "20000000000000000000000000" },
      4: { name: "Common LFG", multiplier: 2, price: "100000000000000000000000000", amplifier: "50000000000000000000000000" },
      5: { name: "Rare", multiplier: 10, price: "1000000000000000000000000000" },
      6: { name: "Rare Amped", multiplier: 12, price: "1000000000000000000000000000", amplifier: "100000000000000000000000000" },
      7: { name: "Rare Super", multiplier: 14, price: "1000000000000000000000000000", amplifier: "200000000000000000000000000" },
      8: { name: "Rare LFG", multiplier: 20, price: "1000000000000000000000000000", amplifier: "500000000000000000000000000" },
      9: { name: "Legendary", multiplier: 100, price: "10000000000000000000000000000" },
      10: { name: "Legendary Amped", multiplier: 120, price: "10000000000000000000000000000", amplifier: "1000000000000000000000000000" },
      11: { name: "Legendary Super", multiplier: 140, price: "10000000000000000000000000000", amplifier: "2000000000000000000000000000" },
      12: { name: "Legendary LFG", multiplier: 200, price: "10000000000000000000000000000", amplifier: "5000000000000000000000000000" },
    },
    description:
      "Stax NFTs are minted with TitanX or ETH during a presale. Burning NFTs after a cooldown period claims backing rewards, with multipliers contributing to a pool for cycle-based reward calculations.",
  },
  ascendantNFT: {
    name: "Ascendant",
    symbol: "ASCNFT",
    address: "0x9da95c32c5869c84ba2c020b5e87329ec0adc97f",
    deploymentBlock: "21112535",
    tiers: {
      1: { name: "Tier 1", price: "7812500000000000000000", multiplier: 1.01 },
      2: { name: "Tier 2", price: "15625000000000000000000", multiplier: 1.02 },
      3: { name: "Tier 3", price: "31250000000000000000000", multiplier: 1.03 },
      4: { name: "Tier 4", price: "62500000000000000000000", multiplier: 1.04 },
      5: { name: "Tier 5", price: "125000000000000000000000", multiplier: 1.05 },
      6: { name: "Tier 6", price: "250000000000000000000000", multiplier: 1.06 },
      7: { name: "Tier 7", price: "500000000000000000000000", multiplier: 1.07 },
      8: { name: "Tier 8", price: "1000000000000000000000000", multiplier: 1.08 },
    },
    description:
      "Ascendant NFTs are minted with ASCENDANT tokens and offer staking rewards from DragonX pools over 8, 28, and 90-day periods. Features fusion mechanics to combine same-tier NFTs into higher tiers.",
  },
};

export const contractAddresses = {
  element280: nftContracts.element280.address,
  element369: nftContracts.element369.address,
  staxNFT: nftContracts.staxNFT.address,
  ascendantNFT: nftContracts.ascendantNFT.address,
};

export const deploymentBlocks = {
  element280: nftContracts.element280.deploymentBlock,
  element369: nftContracts.element369.deploymentBlock,
  staxNFT: nftContracts.staxNFT.deploymentBlock,
  ascendantNFT: nftContracts.ascendantNFT.deploymentBlock,
};

export const contractTiers = {
  element280: nftContracts.element280.tiers,
  element369: nftContracts.element369.tiers,
  staxNFT: nftContracts.staxNFT.tiers,
  ascendantNFT: nftContracts.ascendantNFT.tiers,
};

// Add contractDetails for NFTPage compatibility
export const contractDetails = {
  element280: {
    name: nftContracts.element280.name,
    totalTokens: 8209, // From your logs
    pageSize: 1000,   // From your API
    apiEndpoint: '/api/holders/Element280'
  },
  element369: {
    name: nftContracts.element369.name,
    totalTokens: 0,   // Placeholder - update with actual value
    pageSize: 1000,   // Adjust as needed
    apiEndpoint: '/api/holders/Element369'
  },
  staxNFT: {
    name: nftContracts.staxNFT.name,
    totalTokens: 0,   // Placeholder - update with actual value
    pageSize: 1000,   // Adjust as needed
    apiEndpoint: '/api/holders/Stax'
  },
  ascendantNFT: {
    name: nftContracts.ascendantNFT.name,
    totalTokens: 0,   // Placeholder - update with actual value
    pageSize: 1000,   // Adjust as needed
    apiEndpoint: '/api/holders/Ascendant'
  },
};

export function getContractDetails(contractName) {
  return nftContracts[contractName] || null;
}