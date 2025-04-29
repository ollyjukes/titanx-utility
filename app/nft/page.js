// File: app/nft/page.js

'use client';

import { useState } from 'react';
import nextDynamic from 'next/dynamic';
import config from '@/config';
import LoadingIndicator from '@/components/LoadingIndicator';
import { motion } from 'framer-motion';
import { useNFTStore } from '@/app/store';

// Dynamically import NFTSummary
const NFTSummary = nextDynamic(() => import('@/components/NFTSummary'), { ssr: false });

// Force dynamic rendering to skip static prerendering
export const dynamic = 'force-dynamic';

async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[NFTOverview] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTOverview] ${apiKey} is disabled, returning empty data`);
      return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Contract not deployed' };
    }

    let endpoint = apiEndpoint;
    if (!endpoint || !endpoint.startsWith('http')) {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      endpoint = `${baseUrl}${apiEndpoint}`;
      console.log(`[NFTOverview] Adjusted endpoint to ${endpoint}`);
    }

    let allHolders = [];
    let totalTokens = 0;
    let totalBurned = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[NFTOverview] Fetching ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[NFTOverview] Failed to fetch ${url}: ${res.status} ${errorText}`);
        return { holders: [], totalTokens: 0, totalBurned: 0, error: `API request failed: ${res.status}` };
      }

      const json = await res.json();
      if (json.error) {
        console.log(`[NFTOverview] API error for ${apiKey}: ${json.error}`);
        return { holders: [], totalTokens: 0, totalBurned: 0, error: json.error };
      }
      if (!json.holders || !Array.isArray(json.holders)) {
        console.error(`[NFTOverview] Invalid holders data for ${url}`);
        return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Invalid holders data' };
      }

      allHolders = allHolders.concat(json.holders);
      totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
      totalBurned = json.totalBurned || totalBurned;
      summary = json.summary || summary;
      totalPages = json.totalPages || 1;
      page++;
      console.log(`[NFTOverview] Successfully fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
    }

    return {
      holders: allHolders,
      totalTokens,
      totalBurned,
      summary,
    };
  } catch (error) {
    console.error(`[NFTOverview] Error fetching ${apiKey}: ${error.message}`);
    return { holders: [], totalTokens: 0, totalBurned: 0, error: error.message };
  }
}

export default function NFTOverview() {
  const [collectionsData, setCollectionsData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { getCache, setCache } = useNFTStore();

  const collections = Object.keys(config.contractDetails).map((key) => ({
    apiKey: key,
    ...config.contractDetails[key],
  }));

  const handleCollectionClick = async (apiKey, apiEndpoint, pageSize, disabled) => {
    setLoading(true);
    setError(null);
    setCollectionsData([]);

    try {
      if (disabled) {
        setCollectionsData([{ apiKey, data: { holders: [], totalTokens: 0, totalBurned: 0, error: 'Contract not deployed' } }]);
        setLoading(false);
        return;
      }

      const cachedData = getCache(apiKey);
      if (cachedData) {
        console.log(`[NFTOverview] Cache hit for ${apiKey}`);
        setCollectionsData([{ apiKey, data: cachedData }]);
      } else {
        console.log(`[NFTOverview] Cache miss for ${apiKey}, fetching data`);
        const data = await fetchCollectionData(apiKey, apiEndpoint, pageSize || 1000);
        setCache(apiKey, data);
        setCollectionsData([{ apiKey, data }]);
      }
    } catch (err) {
      setError(`Failed to load ${apiKey}: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 flex flex-col items-center">
      <h1 className="title mb-6">NFT Collections</h1>
      <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0 w-full max-w-6xl mb-6">
        {collections.map(({ apiKey, name, apiEndpoint, pageSize, disabled }) => (
          <motion.button
            key={apiKey}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleCollectionClick(apiKey, apiEndpoint, pageSize, disabled)}
            className={`btn btn-secondary w-full ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={disabled}
          >
            {name}
          </motion.button>
        ))}
      </div>
      {loading && <LoadingIndicator status="Loading collection..." />}
      {error && <p className="text-error">{error}</p>}
      {collectionsData.length > 0 && !loading && <NFTSummary collectionsData={collectionsData} />}
    </div>
  );
}