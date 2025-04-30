// File: app/nft/[chain]/[contract]/page.js
'use client';

import { useState, useEffect } from 'react';
import { notFound } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import config from '@/config';
import LoadingIndicator from '@/components/LoadingIndicator';
import { useNFTStore } from '@/app/store';

// Dynamically import NFTPageWrapper
const NFTPageWrapper = nextDynamic(() => import('@/components/NFTPageWrapper'), { ssr: false });

// Force dynamic rendering to skip static prerendering
export const dynamic = 'force-dynamic';

async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[NFTContractPage] [INFO] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTContractPage] [INFO] ${apiKey} is disabled`);
      return { error: `${apiKey} is not available` };
    }

    let endpoint = apiEndpoint;
    if (!endpoint || !endpoint.startsWith('http')) {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      endpoint = `${baseUrl}${apiEndpoint}`;
      console.log(`[NFTContractPage] [INFO] Adjusted endpoint: ${endpoint}`);
    }

    let allHolders = [];
    let totalTokens = 0;
    let totalShares = 0;
    let totalBurned = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[NFTContractPage] [DEBUG] Fetching ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      console.log(`[NFTContractPage] [DEBUG] Response status: ${res.status}, headers: ${JSON.stringify([...res.headers])}`);

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[NFTContractPage] [ERROR] Failed to fetch ${url}: ${res.status} ${errorText}`);
        return { error: `Failed to fetch ${url}: ${res.status} ${errorText}` };
      }

      const json = await res.json();
      console.log(`[NFTContractPage] [DEBUG] Response body: ${JSON.stringify(json, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);

      if (json.error) {
        console.error(`[NFTContractPage] [ERROR] API error for ${apiKey}: ${json.error}`);
        return { error: json.error };
      }
      if (!json.holders || !Array.isArray(json.holders)) {
        console.error(`[NFTContractPage] [ERROR] Invalid holders data for ${url}: ${JSON.stringify(json)}`);
        if (apiKey === 'ascendant') {
          console.log(`[NFTContractPage] [INFO] Triggering POST to refresh cache for ${apiKey}`);
          await fetch(endpoint, { method: 'POST', cache: 'force-cache' });
          // Retry fetching the page
          const retryRes = await fetch(url, { cache: 'no-store' });
          if (!retryRes.ok) {
            const retryError = await retryRes.text();
            console.error(`[NFTContractPage] [ERROR] Retry failed for ${url}: ${retryRes.status} ${retryError}`);
            return { error: `Retry failed: ${retryRes.status}` };
          }
          const retryJson = await retryRes.json();
          console.log(`[NFTContractPage] [DEBUG] Retry response: ${JSON.stringify(retryJson, (key, value) => typeof value === 'bigint' ? value.toString() : value)}`);
          if (!retryJson.holders || !Array.isArray(retryJson.holders)) {
            console.error(`[NFTContractPage] [ERROR] Retry invalid holders data: ${JSON.stringify(retryJson)}`);
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
  const { chain, contract } = params;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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
      console.log(`[NFTContractPage] [ERROR] Not found: chain=${chain}, contract=${contract}`);
      notFound();
    }

    async function fetchData() {
      setLoading(true);
      setError(null);
      setData(null);

      const contractConfig = config.contractDetails[apiKey] || {};

      // Check cache first
      const cacheKey = `contract_${apiKey}`;
      const cachedData = getCache(cacheKey);
      if (cachedData) {
        console.log(`[NFTContractPage] [INFO] Cache hit for ${cacheKey}`);
        setData(cachedData);
        setLoading(false);
        return;
      }

      // Fetch data if not cached
      console.log(`[NFTContractPage] [INFO] Cache miss for ${cacheKey}, fetching data`);
      const result = await fetchCollectionData(apiKey, contractConfig.apiEndpoint, contractConfig.pageSize || 1000);
      if (result.error) {
        setError(result.error);
      } else {
        setCache(cacheKey, result);
        setData(result);
      }
      setLoading(false);
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
        <LoadingIndicator status="Loading collection..." />
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