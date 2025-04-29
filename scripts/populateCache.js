// scripts/populateCache.js
import { create } from 'zustand';

// Mock zustand store for standalone script
const mockStore = create((set, get) => ({
  cache: {},
  setCache: (contractKey, data) => {
    console.log(`[MockStore] Setting cache for ${contractKey}: ${data.holders.length} holders`);
    set((state) => ({
      cache: {
        ...state.cache,
        [contractKey]: { data, timestamp: Date.now() },
      },
    }));
  },
  getCache: (contractKey) => {
    const cachedEntry = get().cache[contractKey];
    if (!cachedEntry) return null;
    return cachedEntry.data;
  },
}));

const mockData = {
  element280: {
    holders: [
      {
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
        rank: 1,
        total: 5,
        claimableRewards: 1000,
        percentage: 2.5,
        displayMultiplierSum: 60,
        tiers: [2, 1, 1, 1, 0, 0], // Common, Common Amped, Rare, Rare Amped, Legendary, Legendary Amped
      },
    ],
    totalTokens: 7,
    summary: { totalLive: 7, totalBurned: 0, totalRewardPool: 1500 },
  },
  element369: {
    holders: [
      {
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
        rank: 1,
        total: 3,
        infernoRewards: 1.5,
        fluxRewards: 2.0,
        e280Rewards: 0.5,
        percentage: 1.0,
        multiplierSum: 30,
        tiers: [1, 1, 1], // Common, Rare, Legendary
      },
    ],
    totalTokens: 3,
    summary: { totalLive: 3, totalBurned: 0, totalRewardPool: 4 },
  },
  staxNFT: {
    holders: [
      {
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
        rank: 1,
        total: 1,
        claimableRewards: 200,
        percentage: 0.5,
        multiplierSum: 100,
        tiers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], // Legendary LFG
      },
    ],
    totalTokens: 1,
    summary: { totalLive: 1, totalBurned: 0, totalRewardPool: 200 },
  },
  ascendantNFT: {
    holders: [
      {
        wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
        rank: 1,
        total: 4,
        claimableRewards: 500,
        shares: 400,
        pendingDay8: 100,
        pendingDay28: 200,
        pendingDay90: 200,
        tiers: [0, 0, 0, 0, 0, 0, 0, 4], // Tier 8
      },
    ],
    totalTokens: 4,
    totalShares: 400,
    summary: { totalLive: 4, totalBurned: 0, totalRewardPool: 300 },
  },
  e280: {
    holders: [],
    totalTokens: 0,
    message: 'E280 data not available yet',
  },
};

async function populateCache() {
  try {
    for (const [key, data] of Object.entries(mockData)) {
      mockStore.getState().setCache(key, data);
    }
    console.log('Cache populated successfully');
  } catch (error) {
    console.error('Error populating cache:', error);
  }
}

populateCache();