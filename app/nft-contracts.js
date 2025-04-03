// app/nft-contracts.js

// NFT contract configurations derived from Solidity implementations
export const nftContracts = {
    element280: {
      name: "Element 280",
      symbol: "ELMNT",
      address: "0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9", // From your contract-config.js
      deploymentBlock: "20945304", // From your contract-config.js
      tiers: {
        1: { name: "Common", multiplier: 10, allocation: "100000000000000000000000000" }, // 100M ether
        2: { name: "Common Amped", multiplier: 12, allocation: "100000000000000000000000000" },
        3: { name: "Rare", multiplier: 100, allocation: "1000000000000000000000000000" }, // 1B ether
        4: { name: "Rare Amped", multiplier: 120, allocation: "1000000000000000000000000000" },
        5: { name: "Legendary", multiplier: 1000, allocation: "10000000000000000000000000000" }, // 10B ether
        6: { name: "Legendary Amped", multiplier: 1200, allocation: "10000000000000000000000000000" },
      },
      description:
        "Element 280 NFTs can be minted with TitanX or ETH during a presale and redeemed for Element 280 tokens after a cooldown period. Multipliers contribute to a pool used for reward calculations.",
    },
    element369: {
      name: "Element 369",
      symbol: "E369",
      address: "0x024D64E2F65747d8bB02dFb852702D588A062575", // From your contract-config.js
      deploymentBlock: "21224418", // From your contract-config.js
      tiers: {
        1: { name: "Common", multiplier: 1, price: "100000000000000000000000000" }, // 100M ether
        2: { name: "Rare", multiplier: 10, price: "1000000000000000000000000000" }, // 1B ether
        3: { name: "Legendary", multiplier: 100, price: "10000000000000000000000000000" }, // 10B ether
      },
      description:
        "Element 369 NFTs are minted with TitanX or ETH during specific sale cycles. Burning NFTs updates a multiplier pool and tracks burn cycles for reward distribution in the Holder Vault.",
    },
    staxNFT: {
      name: "Stax",
      symbol: "STAX",
      address: "0x74270Ca3a274B4dbf26be319A55188690CACE6E1", // From your contract-config.js
      deploymentBlock: "21452667", // From your contract-config.js
      tiers: {
        1: { name: "Common", multiplier: 1, price: "100000000000000000000000000" }, // 100M ether
        2: { name: "Common Amped", multiplier: 1.2, price: "100000000000000000000000000", amplifier: "10000000000000000000000000" }, // 10M ether
        3: { name: "Common Super", multiplier: 1.4, price: "100000000000000000000000000", amplifier: "20000000000000000000000000" }, // 20M ether
        4: { name: "Common LFG", multiplier: 2, price: "100000000000000000000000000", amplifier: "50000000000000000000000000" }, // 50M ether
        5: { name: "Rare", multiplier: 10, price: "1000000000000000000000000000" }, // 1B ether
        6: { name: "Rare Amped", multiplier: 12, price: "1000000000000000000000000000", amplifier: "100000000000000000000000000" }, // 100M ether
        7: { name: "Rare Super", multiplier: 14, price: "1000000000000000000000000000", amplifier: "200000000000000000000000000" }, // 200M ether
        8: { name: "Rare LFG", multiplier: 20, price: "1000000000000000000000000000", amplifier: "500000000000000000000000000" }, // 500M ether
        9: { name: "Legendary", multiplier: 100, price: "10000000000000000000000000000" }, // 10B ether
        10: { name: "Legendary Amped", multiplier: 120, price: "10000000000000000000000000000", amplifier: "1000000000000000000000000000" }, // 1B ether
        11: { name: "Legendary Super", multiplier: 140, price: "10000000000000000000000000000", amplifier: "2000000000000000000000000000" }, // 2B ether
        12: { name: "Legendary LFG", multiplier: 200, price: "10000000000000000000000000000", amplifier: "5000000000000000000000000000" }, // 5B ether
      },
      description:
        "Stax NFTs are minted with TitanX or ETH during a presale. Burning NFTs after a cooldown period claims backing rewards, with multipliers contributing to a pool for cycle-based reward calculations.",
    },
  };
  
  // Export for compatibility with existing contract-config.js
  export const contractAddresses = {
    element280: nftContracts.element280.address,
    element369: nftContracts.element369.address,
    staxNFT: nftContracts.staxNFT.address,
  };
  
  export const deploymentBlocks = {
    element280: nftContracts.element280.deploymentBlock,
    element369: nftContracts.element369.deploymentBlock,
    staxNFT: nftContracts.staxNFT.deploymentBlock,
  };
  
  export const contractTiers = {
    element280: nftContracts.element280.tiers,
    element369: nftContracts.element369.tiers,
    staxNFT: nftContracts.staxNFT.tiers,
  };
  
  // Additional utility function to get contract details
  export function getContractDetails(contractName) {
    return nftContracts[contractName] || null;
  }