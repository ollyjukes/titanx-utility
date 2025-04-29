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
  console.log(`[NFTContractPage] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTContractPage] ${apiKey} is disabled`);
      return { error: `${apiKey} is not available` };
    }

    let endpoint = apiEndpoint;
    if (!endpoint || !endpoint.startsWith('http')) {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      endpoint = `${baseUrl}${apiEndpoint}`;
      console.log(`[NFTContractPage] Adjusted endpoint: ${endpoint}`);
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
      console.log(`[NFTContractPage] Fetching ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch ${url}: ${res.status} ${errorText}`);
      }

      const json = await res.json();
      if (json.error) {
        console.log(`[NFTContractPage] API error for ${apiKey}: ${json.error}`);
        return { error: json.error };
      }
      if (!json.holders || !Array.isArray(json.holders)) {
        throw new Error(`Invalid holders data for ${url}`);
      }

      allHolders = allHolders.concat(json.holders);
      totalTokens = json.totalTokens || totalTokens;
      totalShares = json.totalShares || json.summary?.multiplierPool || totalTokens;
      totalBurned = json.totalBurned || totalBurned;
      summary = json.summary || summary;
      totalPages = json.totalPages || 1;
      page++;
      console.log(`[NFTContractPage] Fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
    }

    return {
      holders: allHolders,
      totalTokens,
      totalShares,
      totalBurned,
      summary,
    };
  } catch (error) {
    console.error(`[NFTContractPage] Error fetching ${apiKey}: ${error.message}`);
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
      console.log(`[NFTContractPage] Not found: chain=${chain}, contract=${contract}`);
      notFound();
    }

    async function fetchData() {
      setLoading(true);
      setError(null);
      setData(null);

      const contractConfig = config.contractDetails[apiKey] || {};

      // Check cache first
      const cachedData = getCache(apiKey);
      if (cachedData) {
        console.log(`[NFTContractPage] Cache hit for ${apiKey}`);
        setData(cachedData);
        setLoading(false);
        return;
      }

      // Fetch data if not cached
      console.log(`[NFTContractPage] Cache miss for ${apiKey}, fetching data`);
      const result = await fetchCollectionData(apiKey, contractConfig.apiEndpoint, contractConfig.pageSize || 1000);
      if (result.error) {
        setError(result.error);
      } else {
        setCache(apiKey, result);
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