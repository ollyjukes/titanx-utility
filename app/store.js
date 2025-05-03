import { getCache, setCache } from '@/app/api/utils/index.js';

export const useNFTStore = create((set, get) => ({
  cache: {},
  getCache: async (key) => {
    const cacheData = await getCache(key, 'global');
    return cacheData;
  },
  setCache: async (key, value) => {
    await setCache(key, value, 0, 'global');
    set(state => ({
      cache: { ...state.cache, [key]: value },
    }));
  },
}));