// components/NFTSummary.js
'use client';
import config from '@/config';
import { useNFTStore } from '@/app/store';

export default function NFTSummary({ collectionsData }) {
  const { getCache } = useNFTStore();

  return (
    <div className="space-y-section w-full max-w-6xl">
      {collectionsData.map(({ apiKey, data }) => {
        const cachedData = getCache(apiKey) || data;
        return (
          <div key={apiKey} className="card">
            <h2 className="subtitle">{config.contractDetails[apiKey]?.name || apiKey}</h2>
            {cachedData.error ? (
              <p className="text-error">{cachedData.error}</p>
            ) : (
              <div className="grid-responsive text-body">
                <div>
                  <p><strong>Total Tokens:</strong> {cachedData.totalTokens?.toLocaleString() || 'N/A'}</p>
                  <p><strong>Total Holders:</strong> {cachedData.holders?.length || 0}</p>
                </div>
                {cachedData.totalLockedAscendant > 0 && (
                  <p><strong>Total Locked Ascendant:</strong> {cachedData.totalLockedAscendant?.toLocaleString() || 'N/A'}</p>
                )}
                {cachedData.pendingRewards > 0 && (
                  <p><strong>Pending Rewards:</strong> {cachedData.pendingRewards?.toLocaleString() || 'N/A'}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}