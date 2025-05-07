// app/store.js
import { create } from 'zustand';

export const useNFTStore = create((set, get) => ({
  cache: {},
  setCache: (apiKey, data) => set(state => ({
    cache: { ...state.cache, [apiKey]: data },
  })),
  getCache: (apiKey) => get().cache[apiKey] || null,
  clearCache: (apiKey) => set(state => {
    const newCache = { ...state.cache };
    delete newCache[apiKey];
    return { cache: newCache };
  }),
}));