// File: components/NFTSummary.js

'use client';

import { useState, useEffect } from 'react';
import config from '@/contracts/config.js';

export default function NFTSummary({ collectionsData }) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-section w-full max-w-6xl">
      {collectionsData.map(({ apiKey, data }) => (
        <div key={apiKey} className="card">
          <h2 className="subtitle">{config.contractDetails[apiKey]?.name || apiKey}</h2>
          {data.error ? (
            <p className="text-error">{data.error}</p>
          ) : (
            <div className="grid-responsive text-body">
              <div>
                <p>
                  <strong>Total Tokens:</strong> {data.totalTokens?.toLocaleString() || 'N/A'}
                </p>
                <p>
                  <strong>Total Holders:</strong> {data.holders?.length || 0}
                </p>
              </div>
              {data.totalLockedAscendant > 0 && (
                <p>
                  <strong>Total Locked Ascendant:</strong>{' '}
                  {data.totalLockedAscendant?.toLocaleString() || 'N/A'}
                </p>
              )}
              {data.pendingRewards > 0 && (
                <p>
                  <strong>Pending Rewards:</strong>{' '}
                  {data.pendingRewards?.toLocaleString() || 'N/A'}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}