// File: app/store.js

'use client';
import { create } from 'zustand';

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export const useNFTStore = create((set, get) => ({
  cache: {},
  setCache: (contractKey, data) => {
    const key = `nft:${contractKey}`;
    console.log(`[NFTStore] Setting cache for ${key}: ${data.holders?.length || 0} holders`);
    set((state) => ({
      cache: {
        ...state.cache,
        [key]: { data, timestamp: Date.now() },
      },
    }));
  },
  getCache: (contractKey) => {
    const key = `nft:${contractKey}`;
    console.log(`[NFTStore] Getting cache for ${key}`);
    const cachedEntry = get().cache[key];
    if (!cachedEntry) {
      console.log(`[NFTStore] Cache miss for ${key}`);
      return null;
    }
    const now = Date.now();
    if (now - cachedEntry.timestamp > CACHE_TTL) {
      console.log(`[NFTStore] Cache expired for ${key}`);
      set((state) => {
        const newCache = { ...state.cache };
        delete newCache[key];
        return { cache: newCache };
      });
      return null;
    }
    console.log(`[NFTStore] Cache hit for ${key}: ${cachedEntry.data.holders?.length || 0} holders`);
    return cachedEntry.data;
  },
}));