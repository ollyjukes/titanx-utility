export const contractConfig = {
    element280: {
      address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
      deploymentBlock: '20945304',
      tiers: {
        1: { name: 'Common', multiplier: 10 },
        2: { name: 'Common Amped', multiplier: 12 },
        3: { name: 'Rare', multiplier: 100 },
        4: { name: 'Rare Amped', multiplier: 120 },
        5: { name: 'Legendary', multiplier: 1000 },
        6: { name: 'Legendary Amped', multiplier: 1200 },
      },
    },
    staxNFT: {
      address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
      deploymentBlock: '21452667',
      tiers: {
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
    },
    element369: {
      address: '0x024D64E2F65747d8bB02dFb852702D588A062575',
      deploymentBlock: '21224418',
      tiers: {
        1: { name: 'Common', multiplier: 1 },
        2: { name: 'Rare', multiplier: 10 },
        3: { name: 'Legendary', multiplier: 100 },
      },
    },
  };
  
  export const contractAddresses = {
    element280: contractConfig.element280.address,
    staxNFT: contractConfig.staxNFT.address,
    element369: contractConfig.element369.address,
  };
  
  export const deploymentBlocks = {
    element280: contractConfig.element280.deploymentBlock,
    staxNFT: contractConfig.staxNFT.deploymentBlock,
    element369: contractConfig.element369.deploymentBlock,
  };
  
  export const contractTiers = {
    element280: contractConfig.element280.tiers,
    staxNFT: contractConfig.staxNFT.tiers,
    element369: contractConfig.element369.tiers,
  };