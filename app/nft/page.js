// app/nft/page.js
'use client';
import { motion } from 'framer-motion';
import { fetchCollectionData } from '@/client/lib/fetchCollectionData';
import config from '@/contracts/config';
import LoadingIndicator from '@/client/components/LoadingIndicator';
import NFTSummary from '@/client/components/NFTSummary';
import React from 'react';


const collections = Object.entries(config.contractDetails).map(([apiKey, { name, apiEndpoint, pageSize, disabled }]) => ({
  apiKey,
  name,
  apiEndpoint,
  pageSize,
  disabled,
}));

export default function NFTOverview() {
  const [collectionsData, setCollectionsData] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const handleCollectionClick = async (apiKey, apiEndpoint, pageSize, disabled) => {
    if (disabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCollectionData(apiKey, apiEndpoint, pageSize);
      if (data.error) {
        setError(data.error);
      } else {
        setCollectionsData([{ apiKey, data }]);
      }
    } catch (err) {
      setError(err.message);
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
      {collectionsData.some(c => c.data.error?.includes('Cache is populating') || c.data.error?.includes('Failed to fetch cache progress') || c.data.error?.includes('timed out')) && (
        <p className="text-body">Data is being loaded, please wait a moment...</p>
      )}
      {collectionsData.length > 0 && !loading && <NFTSummary collectionsData={collectionsData} />}
    </div>
  );
}