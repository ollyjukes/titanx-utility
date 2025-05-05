// ./app/nft/[chain]/[contract]/page.js
'use client';
import { useState, useEffect } from 'react';
import { notFound } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import config from '@/contracts/config';
import LoadingIndicator from '@/client/components/LoadingIndicator';
import { useNFTStore } from '@/app/store';
import { HoldersResponseSchema } from '@/client/lib/schemas';
import * as React from 'react';
import { z } from 'zod'; // Import Zod for schema validation

const NFTPageWrapper = nextDynamic(() => import('@/client/components/NFTPageWrapper'), { ssr: false });
export const dynamic = 'force-dynamic';

// Schema for progress endpoint response
const ProgressResponseSchema = z.object({
  isPopulating: z.boolean(),
  totalLiveHolders: z.number(),
  totalOwners: z.number(),
  phase: z.string(),
  progressPercentage: z.string(),
  lastProcessedBlock: z.number().nullable(),
  error: z.any().nullable(),
  errorLog: z.array(z.any()),
});

async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[NFTContractPage] [INFO] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTContractPage] [INFO] ${apiKey} is disabled`);
      return { error: `${apiKey} is not available` };
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
    const endpoint = apiEndpoint.startsWith('http') ? apiEndpoint : `${baseUrl}${apiEndpoint}`;

    const pollProgress = async () => {
      const progressUrl = `${endpoint}/progress`;
      const res = await fetch(progressUrl, { cache: 'no-store', signal: AbortSignal.timeout(config.alchemy.timeoutMs) });
      if (!res.ok) throw new Error(`Progress fetch failed: ${res.status}`);
      const progress = await res.json();
      console.log(`[NFTContractPage] [DEBUG] Progress: ${JSON.stringify(progress)}`);

      // Validate progress response
      const validation = ProgressResponseSchema.safeParse(progress);
      if (!validation.success) {
        console.error(`[NFTContractPage] [ERROR] Invalid progress data: ${JSON.stringify(validation.error.errors)}`);
        throw new Error('Invalid progress data');
      }
      return validation.data;
    };

    let allHolders = [];
    let totalTokens = 0;
    let totalShares = 0;
    let totalBurned = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    const maxPollTime = 180000; // 180 seconds
    const startTime = Date.now();
    let progress = await pollProgress();

    while (progress.isPopulating || progress.phase !== 'Completed') {
      if (Date.now() - startTime > maxPollTime) {
        console.error(`[NFTContractPage] [ERROR] Cache population timeout for ${apiKey}`);
        return { error: 'Cache population timed out' };
      }
      console.log(`[NFTContractPage] [INFO] Waiting for ${apiKey} cache: ${progress.phase} (${progress.progressPercentage}%)`);
      await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
      progress = await pollProgress();
      if (progress.phase === 'Error') {
        console.error(`[NFTContractPage] [ERROR] Cache population failed: ${progress.error || 'Unknown error'}`);
        return { error: `Cache population failed: ${progress.error || 'Unknown error'}` };
      }
    }

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[NFTContractPage] [DEBUG] Fetching ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      console.log(`[NFTContractPage] [DEBUG] Response status: ${res.status}`);

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[NFTContractPage] [ERROR] Failed to fetch ${url}: ${res.status} ${errorText}`);
        return { error: `Failed to fetch data: ${res.status}` };
      }

      const json = await res.json();
      console.log(`[NFTContractPage] [DEBUG] Response body: ${JSON.stringify(json, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);

      if (json.isCachePopulating) {
        return { isCachePopulating: true, progress }; // Trigger polling
      }

      const validation = HoldersResponseSchema.safeParse(json);
      if (!validation.success) {
        console.error(`[NFTContractPage] [ERROR] Invalid holders data: ${JSON.stringify(validation.error.errors)}`);
        if (apiKey === 'ascendant') {
          console.log(`[NFTContractPage] [INFO] Triggering POST for ${apiKey}`);
          await fetch(endpoint, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceUpdate: false }) });
          const retryRes = await fetch(url, { cache: 'no-store' });
          if (!retryRes.ok) {
            const retryError = await retryRes.text();
            console.error(`[NFTContractPage] [ERROR] Retry failed: ${retryRes.status} ${retryError}`);
            return { error: `Retry failed: ${retryRes.status}` };
          }
          const retryJson = await retryRes.json();
          const retryValidation = HoldersResponseSchema.safeParse(retryJson);
          if (!retryValidation.success) {
            console.error(`[NFTContractPage] [ERROR] Retry invalid holders data: ${JSON.stringify(retryValidation.error.errors)}`);
            return { error: 'Invalid holders data after retry' };
          }
          json.holders = retryJson.holders;
          json.totalTokens = retryJson.totalTokens;
          json.totalShares = retryJson.totalShares;
          json.totalBurned = retryJson.totalBurned;
          json.summary = retryJson.summary;
          json.totalPages = retryJson.totalPages;
        } else {
          return { error: 'Invalid holders data' };
        }
      }

      allHolders = allHolders.concat(json.holders);
      totalTokens = json.totalTokens || totalTokens;
      totalShares = json.totalShares || json.summary?.multiplierPool || totalTokens;
      totalBurned = json.totalBurned || totalBurned;
      summary = json.summary || summary;
      totalPages = json.totalPages || 1;
      page++;
      console.log(`[NFTContractPage] [INFO] Fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
    }

    return {
      holders: allHolders,
      totalTokens,
      totalShares,
      totalBurned,
      summary,
    };
  } catch (error) {
    console.error(`[NFTContractPage] [ERROR] Error fetching ${apiKey}: ${error.message}, stack: ${error.stack}`);
    return { error: error.message };
  }
}

export default function NFTContractPage({ params }) {
  const { chain, contract } = React.use(params);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(null);

  const { getCache, setCache } = useNFTStore();

  const apiKeyMap = {
    Element280: 'element280',
    Element369: 'element369',
    Stax: 'stax',
    Ascendant: 'ascendant',
    E280: 'e280',
  };
  const apiKey = apiKeyMap[contract];

  useEffect(() => {
    if (!config.supportedChains.includes(chain) || !apiKey) {
      console.log(`[NFTContractPage] [ERROR] Invalid chain=${chain} or contract=${contract}`);
      notFound();
    }

    async function fetchData() {
      setLoading(true);
      setError(null);
      setData(null);

      const contractConfig = config.contractDetails[apiKey] || {};
      const cacheKey = `contract_${apiKey}`;
      const cachedData = getCache(cacheKey);

      if (cachedData) {
        console.log(`[NFTContractPage] [INFO] Cache hit for ${cacheKey}`);
        setData(cachedData);
        setLoading(false);
        return;
      }

      console.log(`[NFTContractPage] [INFO] Cache miss for ${cacheKey}, fetching data`);
      const result = await fetchCollectionData(apiKey, contractConfig.apiEndpoint, contractConfig.pageSize || 1000);

      if (result.isCachePopulating) {
        const poll = async () => {
          const progressResult = await fetchCollectionData(apiKey, contractConfig.apiEndpoint, contractConfig.pageSize || 1000);
          setProgress(progressResult.progress);
          if (progressResult.isCachePopulating) {
            setTimeout(poll, config.alchemy.batchDelayMs);
          } else if (progressResult.error) {
            setError(progressResult.error);
            setLoading(false);
          } else {
            setCache(cacheKey, progressResult);
            setData(progressResult);
            setLoading(false);
          }
        };
        poll();
      } else if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        setCache(cacheKey, result);
        setData(result);
        setLoading(false);
      }
    }

    fetchData();
  }, [chain, contract, apiKey, getCache, setCache]);

  if (!config.supportedChains.includes(chain) || !apiKey) {
    notFound();
  }

  if (loading) {
    return (
      <div className="container page-content">
        <h1 className="title mb-6">{contract} Collection</h1>
        <LoadingIndicator
          status={`Loading ${contract} data... ${progress ? `Phase: ${progress.phase} (${progress.progressPercentage}%)` : ''}`}
          progress={progress}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container page-content">
        <h1 className="title mb-6">{contract} Collection</h1>
        <p className="text-error">{error}</p>
      </div>
    );
  }

  return (
    <div className="container page-content">
      <h1 className="title mb-6">{contract} Collection</h1>
      <NFTPageWrapper
        chain={chain}
        contract={apiKey}
        data={data}
        rewardToken={config.contractDetails[apiKey]?.rewardToken}
      />
    </div>
  );
}