export default {
  nftContracts: {
    element280: { disabled: false },
    ascendant: { disabled: false },
  },
  alchemy: {
    apiKey: 'test-key',
    maxRetries: 2,
    batchDelayMs: 500,
    batchSize: 100,
  },
  burnAddress: '0x0000000000000000000000000000000000000000',
  deploymentBlocks: { ascendant: { block: 0 } },
  contractTiers: {
    ascendant: { 1: { multiplier: 1 }, 2: { multiplier: 2 } },
    element280: { 1: { multiplier: 1 } },
  },
};