// app/lib/useNFTData.js
'use client';
import { useQuery } from '@tanstack/react-query';
import { useNFTStore } from '@/app/store';
import config from '@/app/old/config';
import { HoldersResponseSchema } from '@/app/lib/schemas';

async function fetchNFTData(apiKey, apiEndpoint, pageSize) {
  if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
    return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Contract not deployed' };
  }

  const endpoint = apiEndpoint.startsWith('http')
    ? apiEndpoint
    : `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}${apiEndpoint}`;

  // Trigger cache update
  const postRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ forceUpdate: false }),
  });
  if (!postRes.ok) throw new Error(`POST failed: ${postRes.status}`);

  // Poll progress endpoint
  const maxPollAttempts = 600;
  const maxPollTime = 300000;
  const startTime = Date.now();
  let pollAttempts = 0;

  while (pollAttempts < maxPollAttempts && Date.now() - startTime < maxPollTime) {
    const progressRes = await fetch(`${endpoint}/progress`, { cache: 'no-store' });
    if (!progressRes.ok) throw new Error(`Progress fetch failed: ${progressRes.status}`);
    const progress = await progressRes.json();
    const validation = HoldersResponseSchema.safeParse(progress);
    if (!validation.success) throw new Error(`Invalid progress data: ${JSON.stringify(validation.error.errors)}`);

    if (progress.phase === 'Completed') break;
    if (progress.phase === 'Error') throw new Error(`Cache population failed: ${progress.error || 'Unknown error'}`);

    await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
    pollAttempts++;
  }

  if (pollAttempts >= maxPollAttempts || Date.now() - startTime >= maxPollTime) {
    throw new Error('Cache population timed out');
  }

  // Fetch data
  let allHolders = [];
  let totalTokens = 0;
  let totalBurned = 0;
  let summary = {};
  let page = 0;
  let totalPages = Infinity;

  while (page < totalPages) {
    const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`API request failed: ${res.status}`);
    const json = await res.json();

    const validation = HoldersResponseSchema.safeParse(json);
    if (!validation.success) {
      throw new Error(`Invalid holders schema: ${JSON.stringify(validation.error.errors)}`);
    }

    allHolders = allHolders.concat(json.holders);
    totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
    totalBurned = json.totalBurned || totalBurned;
    summary = json.summary || summary;
    totalPages = json.totalPages || 1;
    page++;
  }

  return { holders: allHolders, totalTokens, totalBurned, summary };
}

export function useNFTData(apiKey) {
  const { getCache, setCache } = useNFTStore();

  return useQuery({
    queryKey: ['nft', apiKey],
    queryFn: async () => {
      const cachedData = getCache(apiKey);
      if (cachedData) return cachedData;

      try {
        const { apiEndpoint, pageSize } = config.contractDetails[apiKey];
        const data = await fetchNFTData(apiKey, apiEndpoint, pageSize);
        setCache(apiKey, data);
        return data;
      } catch (error) {
        return { holders: [], totalTokens: 0, totalBurned: 0, error: error.message };
      }
    },
    enabled: !!apiKey && !!config.contractDetails[apiKey],
    retry: config.alchemy.maxRetries,
    retryDelay: attempt => config.alchemy.batchDelayMs * (attempt + 1),
    staleTime: 5 * 60 * 1000,
    onError: error => console.error(`[useNFTData] [ERROR] ${apiKey}: ${error.message}`),
  });
}