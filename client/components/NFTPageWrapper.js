// File: components/NFTPageWrapper.js

'use client';

import { useState, useEffect } from 'react';
import HolderTable from './HolderTable';

export default function NFTPageWrapper({ chain, contract, data, rewardToken }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return (
      <div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div>
        <p className="text-error">
          {data?.error || 'Failed to load collection data'}
        </p>
      </div>
    );
  }

  return (
    <HolderTable
      chain={chain}
      contract={contract}
      holders={data.holders}
      totalTokens={data.totalTokens}
      totalShares={data.totalShares}
      rewardToken={rewardToken}
      totalBurned={data.totalBurned}
    />
  );
}