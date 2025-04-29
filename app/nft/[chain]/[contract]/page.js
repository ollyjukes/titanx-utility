// app/nft/[chain]/[contract]/page.js
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { notFound } from 'next/navigation';
import NFTPageWrapper from '@/components/NFTPageWrapper';
import { useNFTStore } from '@/app/store';
import config from '@/config.js';

export default function NFTContractPage() {
  const params = useParams();
  const chain = params.chain; // e.g., 'ETH'
  const contract = params.contract; // e.g., 'Stax'
  const { getCache } = useNFTStore();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Map contract name to apiKey
  const apiKeyMap = {
    Element280: 'element280',
    Element369: 'element369',
    Stax: 'stax',
    Ascendant: 'ascendant',
    E280: 'e280',
  };
  const apiKey = apiKeyMap[contract];

  useEffect(() => {
    console.log(`[NFTContractPage] Loading page for chain=${chain}, contract=${contract}, apiKey=${apiKey}`);
    if (!config.supportedChains.includes(chain) || !apiKey) {
      console.log(`[NFTContractPage] Not found: chain=${chain}, contract=${contract}`);
      notFound();
    }

    const cachedData = getCache(apiKey);
    if (cachedData) {
      console.log(`[NFTContractPage] Cache hit for ${apiKey}: ${cachedData.holders.length} holders`);
      setData(cachedData);
      setLoading(false);
    } else {
      console.log(`[NFTContractPage] Cache miss for ${apiKey}`);
      setError('No data available for this collection.');
      setLoading(false);
    }
  }, [chain, contract, apiKey, getCache]);

  if (loading) {
    return (
      <div className="container page-content">
        <div className="loading-container">
          <div className="spinner animate-spin"></div>
          <p className="text-body">Loading {contract} data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container page-content">
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