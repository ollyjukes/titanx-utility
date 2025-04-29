'use client';
import { create } from 'zustand';

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const useNFTStore = create((set, get) => ({
  cache: {},
  setCache: (contractKey, data) => {
    console.log(`[NFTStore] Setting cache for ${contractKey}: ${data.holders.length} holders`);
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
    const now = Date.now();
    if (now - cachedEntry.timestamp > CACHE_TTL) {
      console.log(`[NFTStore] Cache expired for ${contractKey}`);
      set((state) => {
        const newCache = { ...state.cache };
        delete newCache[contractKey];
        return { cache: newCache };
      });
      return null;
    }
    console.log(`[NFTStore] Returning cached data for ${contractKey}: ${cachedEntry.data.holders.length} holders`);
    return cachedEntry.data;
  },
  clearCache: () => {
    console.log('[NFTStore] Clearing cache');
    set({ cache: {} });
  },
}));