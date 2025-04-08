// app/components/NFTPage.js
'use client';
import { useState, useEffect } from 'react';
import HolderTable from '@/components/HolderTable';
import LoadingIndicator from '@/components/LoadingIndicator'; // Import the component
import { contractDetails } from '@/app/nft-contracts';

const cache = {};
const CACHE_TTL = 30 * 60 * 1000;

export default function NFTPage({ contractKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { name, apiEndpoint } = contractDetails[contractKey] || {};

  useEffect(() => {
    async function fetchAllHolders() {
      if (!apiEndpoint) {
        setError('Invalid contract configuration');
        setLoading(false);
        return;
      }

      const cachedEntry = cache[contractKey];
      const now = Date.now();
      if (cachedEntry && (now - cachedEntry.timestamp) < CACHE_TTL) {
        console.log(`[NFTPage] Using cached data for ${contractKey}`);
        setData(cachedEntry.data);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        console.log(`[NFTPage] Starting fetch for ${contractKey} at ${apiEndpoint}`);
        let allHolders = [];
        let totalTokens = 0;
        let totalLockedAscendant = 0;
        let totalShares = 0;
        let toDistributeDay8 = 0;
        let toDistributeDay28 = 0;
        let toDistributeDay90 = 0;
        let pendingRewards = 0;
        let page = 0;
        let totalPages = Infinity;
        const pageSize = 1000;

        while (page < totalPages) {
          let attempts = 0;
          const maxAttempts = 3;
          let success = false;

          while (attempts < maxAttempts && !success) {
            try {
              console.log(`[NFTPage] Fetching ${contractKey} page ${page}: ${apiEndpoint}?page=${page}&pageSize=${pageSize}`);
              const res = await fetch(`${apiEndpoint}?page=${page}&pageSize=${pageSize}`, {
                signal: AbortSignal.timeout(30000),
              });
              console.log(`[NFTPage] Fetch status for ${contractKey} page ${page}: ${res.status}`);

              if (!res.ok) {
                const errorText = await res.text();
                console.error(`[NFTPage] Fetch failed with status ${res.status}: ${errorText}`);
                if (res.status === 429) throw new Error('Rate limit exceeded');
                throw new Error(`Page ${page} failed with status: ${res.status} - ${errorText}`);
              }

              const json = await res.json();
              console.log(`[NFTPage] Page ${page} response for ${contractKey}: holders=${json.holders.length}, totalTokens=${json.totalTokens}, totalPages=${json.totalPages}`);

              allHolders = allHolders.concat(json.holders);
              totalTokens = json.totalTokens;
              totalLockedAscendant = json.totalLockedAscendant || 0;
              totalShares = json.totalShares || 0;
              toDistributeDay8 = json.toDistributeDay8 || 0;
              toDistributeDay28 = json.toDistributeDay28 || 0;
              toDistributeDay90 = json.toDistributeDay90 || 0;
              pendingRewards = json.pendingRewards || 0;
              totalPages = json.totalPages;
              if (json.holders.length === 0) break;

              page++;
              success = true;
            } catch (err) {
              attempts++;
              if (err.message.includes('Rate limit')) {
                console.log(`[NFTPage] Rate limit hit on ${contractKey} page ${page}, attempt ${attempts}. Waiting...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
              } else {
                throw err;
              }
            }
          }
          if (!success) throw new Error(`Failed to fetch page ${page} for ${contractKey} after ${maxAttempts} attempts`);
        }

        const uniqueHoldersMap = new Map();
        allHolders.forEach(holder => uniqueHoldersMap.set(holder.wallet, holder));
        let uniqueHolders = Array.from(uniqueHoldersMap.values());
        console.log(`[NFTPage] Total Unique ${contractKey} Holders:`, uniqueHolders.length);

        const totalMultiplierSum = uniqueHolders.reduce((sum, h) => sum + h.multiplierSum, 0);
        console.log(`[NFTPage] Total ${contractKey} Multiplier Sum:`, totalMultiplierSum);

        uniqueHolders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
        uniqueHolders.forEach((holder, index) => {
          holder.rank = index + 1;
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
        });

        const fetchedData = {
          holders: uniqueHolders,
          totalTokens,
          totalLockedAscendant,
          totalShares,
          toDistributeDay8,
          toDistributeDay28,
          toDistributeDay90,
          pendingRewards,
          totalMultiplierSum,
          page: 0,
          totalPages: 1
        };

        cache[contractKey] = {
          data: fetchedData,
          timestamp: Date.now()
        };

        setData(fetchedData);
        setLoading(false);
      } catch (err) {
        console.error('[NFTPage] Fetch Error:', err);
        setError(`Failed to load ${name} holders: ${err.message}. Try refreshing later (Alchemy limit possible).`);
        setLoading(false);
      }
    }

    fetchAllHolders();
  }, [contractKey, name, apiEndpoint]);

  const renderSummary = () => {
    if (!data) return null;

    if (contractKey === 'ascendantNFT') {
      return (
        <>
          <h2 className="text-2xl font-semibold mb-2">Summary</h2>
          <p>Number of Unique Wallets Holding NFTs: <span className="font-bold">{data.holders.length}</span></p>
          <p>Total Number of Active NFTs in Circulation: <span className="font-bold">{data.totalTokens.toLocaleString()}</span></p>
          <p>Total Locked Ascendant: <span className="font-bold">{(data.totalLockedAscendant / 1e18).toLocaleString()}</span></p>
          <p>Total Shares: <span className="font-bold">{(data.totalShares / 1e18).toLocaleString()}</span></p>
          <p>Total Pending DragonX Rewards: <span className="font-bold">{(data.pendingRewards / 1e18).toLocaleString()}</span></p>
          <p>Pending DAY8 Rewards: <span className="font-bold">{(data.toDistributeDay8 / 1e18).toLocaleString()}</span></p>
          <p>Pending DAY28 Rewards: <span className="font-bold">{(data.toDistributeDay28 / 1e18).toLocaleString()}</span></p>
          <p>Pending DAY90 Rewards: <span className="font-bold">{(data.toDistributeDay90 / 1e18).toLocaleString()}</span></p>
        </>
      );
    } else {
      return (
        <>
          <h2 className="text-2xl font-semibold mb-2">Summary</h2>
          <p>Number of Unique Wallets Holding NFTs: <span className="font-bold">{data.holders.length}</span></p>
          <p>Total Number of Active NFTs in Circulation: <span className="font-bold">{data.totalTokens.toLocaleString()}</span></p>
          <p>Total Multiplier Sum: <span className="font-bold">{data.totalMultiplierSum.toLocaleString()}</span></p>
        </>
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-6">{name} Holders</h1>
      {loading ? (
        <LoadingIndicator status={`Loading all ${name} holders...`} />
      ) : error ? (
        <p className="text-red-500 text-lg">Error: {error}</p>
      ) : (
        <div className="w-full max-w-6xl">
          <div className="mb-6 p-4 bg-gray-800 rounded-lg shadow">
            {renderSummary()}
          </div>
          <HolderTable
            holders={data.holders}
            contract={contractKey}
            loading={loading}
            totalShares={contractKey === 'ascendantNFT' ? data.totalShares : undefined}
          />
          <div className="mt-8">
            <h3 className="text-xl font-bold mb-2">Raw Data:</h3>
            <pre className="text-sm bg-gray-700 p-4 rounded max-h-96 overflow-auto border-2 border-red-500">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}