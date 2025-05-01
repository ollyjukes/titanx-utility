// lib/useNFTData.js
'use client';
import { useQuery } from '@tanstack/react-query';
import { useNFTStore } from '@/app/store';
import config from '@/config';
import { HoldersResponseSchema } from '@/lib/schemas';

async function fetchNFTData(apiKey, apiEndpoint, pageSize, page = 0) {
  if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
    return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Contract not deployed' };
  }

  const endpoint = apiEndpoint.startsWith('http') ? apiEndpoint : `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}${apiEndpoint}`;
  const progressUrl = `${endpoint}/progress`;

  const progressRes = await fetch(progressUrl, { cache: 'no-store' });
  if (!progressRes.ok) throw new Error(`Progress fetch failed: ${progressRes.status}`);
  const progress = await progressRes.json();

  if (progress.isPopulating || progress.phase !== 'Completed') {
    throw new Error('Cache is populating');
  }

  let allHolders = [];
  let totalTokens = 0;
  let totalShares = 0;
  let totalBurned = 0;
  let summary = {};
  let totalPages = Infinity;

  while (page < totalPages) {
    const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`API request failed: ${res.status}`);
    const json = await res.json();

    if (json.message === 'Cache is populating' || json.isCachePopulating) {
      throw new Error('Cache is populating');
    }

    const validation = HoldersResponseSchema.safeParse(json);
    if (!validation.success) {
      throw new Error(`Invalid holders schema: ${JSON.stringify(validation.error.errors)}`);
    }

    allHolders = allHolders.concat(json.holders);
    totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
    totalShares = json.totalShares || json.summary?.multiplierPool || totalShares;
    totalBurned = json.totalBurned || totalBurned;
    summary = json.summary || summary;
    totalPages = json.totalPages || 1;
    page++;
  }

  return { holders: allHolders, totalTokens, totalShares, totalBurned, summary };
}

export function useNFTData(apiKey, pageSize) {
  const { getCache, setCache } = useNFTStore();

  return useQuery({
    queryKey: ['nft', apiKey],
    queryFn: async () => {
      const cachedData = getCache(apiKey);
      if (cachedData) return cachedData;

      const data = await fetchNFTData(apiKey, config.contractDetails[apiKey].apiEndpoint, pageSize);
      setCache(apiKey, data);
      return data;
    },
    retry: config.alchemy.maxRetries,
    retryDelay: attempt => config.alchemy.batchDelayMs * (attempt + 1),
    staleTime: 30 * 60 * 1000, // 30 minutes
    refetchInterval: progress => (progress?.isPopulating ? 2000 : false),
    onError: error => console.error(`[useNFTData] [ERROR] ${apiKey}: ${error.message}`),
  });
}