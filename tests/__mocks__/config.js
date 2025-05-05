// tests/__mocks__/config.js
export default {
    contractDetails: {
      element280: {
        name: 'Element280',
        apiEndpoint: '/api/holders/Element280',
        pageSize: 100,
        disabled: false,
        rewardToken: 'ELMNT',
      },
      ascendant: {
        name: 'Ascendant',
        apiEndpoint: '/api/holders/Ascendant',
        pageSize: 1000,
        disabled: false,
        rewardToken: 'DRAGONX',
      },
      e280: {
        name: 'E280',
        apiEndpoint: '/api/holders/E280',
        pageSize: 1000,
        disabled: true,
        rewardToken: 'E280',
      },
    },
    nftContracts: {
      element280: { address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9' },
    },
    cache: {
      nodeCache: {
        stdTTL: 3600,
        checkperiod: 120,
      },
      redis: {
        disableElement280: false,
        disableElement369: true,
        disableStax: true,
        disableAscendant: true,
        disableE280: true,
      },
    },
    alchemy: {
      apiKey: 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI',
      timeoutMs: 30000,
      maxRetries: 2,
      batchDelayMs: 500,
    },
  };