// components/NFTPage.js
'use client';
import { useState, useEffect } from 'react';
import HolderTable from '@/components/HolderTable';
import LoadingIndicator from '@/components/LoadingIndicator';
import { contractDetails } from '@/app/nft-contracts';
import { useNFTStore } from '@/app/store';

export default function NFTPage({ contractKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const { name, apiEndpoint, rewardToken } = contractDetails[contractKey] || {};
  const { getCache, setCache } = useNFTStore();
  const isElement369 = contractKey === 'element369';
  const isStax = contractKey === 'staxNFT';

  useEffect(() => {
    async function fetchAllHolders() {
      if (!apiEndpoint) {
        setError('Invalid contract configuration');
        setLoading(false);
        return;
      }

      if (contractKey === 'e280') {
        setData({ holders: [], totalTokens: 0, message: 'E280 data not available yet' });
        setCache(contractKey, { holders: [], totalTokens: 0, message: 'E280 data not available yet' });
        setLoading(false);
        return;
      }

      const cachedData = getCache(contractKey);
      if (cachedData) {
        setData(cachedData);
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
        let totalClaimableRewards = 0;
        let totalInfernoRewards = 0;
        let totalFluxRewards = 0;
        let totalE280Rewards = 0;
        let page = 0;
        let totalPages = Infinity;
        const pageSize = 1000;

        while (page < totalPages) {
          let attempts = 0;
          const maxAttempts = 3;
          let success = false;

          while (attempts < maxAttempts && !success) {
            try {
              console.log(`[NFTPage] Fetching ${contractKey} page ${page}`);
              const res = await fetch(`${apiEndpoint}?page=${page}&pageSize=${pageSize}`, {
                signal: AbortSignal.timeout(30000),
              });
              if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Page ${page} failed with status: ${res.status} - ${errorText}`);
              }

              const json = await res.json();
              allHolders = allHolders.concat(json.holders || []);
              totalTokens = json.totalTokens || totalTokens;
              totalLockedAscendant = json.totalLockedAscendant || totalLockedAscendant;
              totalShares = json.totalShares || totalShares;
              toDistributeDay8 = json.toDistributeDay8 || toDistributeDay8;
              toDistributeDay28 = json.toDistributeDay28 || toDistributeDay28;
              toDistributeDay90 = json.toDistributeDay90 || toDistributeDay90;
              pendingRewards = json.pendingRewards || pendingRewards;
              totalPages = json.totalPages || 1;
              page++;
              success = true;
              if (!json.holders || json.holders.length === 0) break;
            } catch (err) {
              attempts++;
              if (err.message.includes('Rate limit') || err.name === 'TimeoutError') {
                console.log(`[NFTPage] Retry ${attempts} for ${contractKey} page ${page} due to: ${err.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
              } else {
                throw err;
              }
            }
          }
          if (!success) {
            throw new Error(`Failed to fetch page ${page} for ${contractKey} after ${maxAttempts} attempts`);
          }
        }

        const uniqueHoldersMap = new Map();
        allHolders.forEach(holder => {
          if (holder && holder.wallet) uniqueHoldersMap.set(holder.wallet, holder);
        });
        const uniqueHolders = Array.from(uniqueHoldersMap.values());
        console.log(`[NFTPage] Total Unique ${contractKey} Holders: ${uniqueHolders.length}`);

        const totalMultiplierSum = uniqueHolders.reduce((sum, h) => sum + (h.multiplierSum || 0), 0);
        if (isElement369) {
          totalInfernoRewards = uniqueHolders.reduce((sum, h) => sum + (h.infernoRewards || 0), 0);
          totalFluxRewards = uniqueHolders.reduce((sum, h) => sum + (h.fluxRewards || 0), 0);
          totalE280Rewards = uniqueHolders.reduce((sum, h) => sum + (h.e280Rewards || 0), 0);
        } else {
          totalClaimableRewards = uniqueHolders.reduce((sum, h) => sum + (h.claimableRewards || 0), 0);
        }
        if (!totalTokens && uniqueHolders.length > 0) {
          totalTokens = uniqueHolders.reduce((sum, h) => sum + (h.total || 0), 0);
        }

        if (contractKey === 'ascendantNFT') {
          uniqueHolders.forEach((holder, index) => {
            holder.rank = index + 1;
            holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
          });
        } else {
          uniqueHolders.sort((a, b) => (b.multiplierSum || 0) - (a.multiplierSum || 0) || (b.total || 0) - (a.total || 0));
          uniqueHolders.forEach((holder, index) => {
            holder.rank = index + 1;
            holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
          });
        }

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
          totalClaimableRewards,
          totalInfernoRewards,
          totalFluxRewards,
          totalE280Rewards,
        };

        setCache(contractKey, fetchedData);
        setData(fetchedData);
        setLoading(false);
      } catch (err) {
        console.error('[NFTPage] Fetch Error:', err);
        setError(`Failed to load ${name} holders: ${err.message}. Try refreshing later (Alchemy limit possible).`);
        setLoading(false);
      }
    }

    fetchAllHolders();
  }, [contractKey, name, apiEndpoint, getCache, setCache]);

  const renderSummary = () => {
    if (!data) return null;

    const totalMultiplierSum = data.totalMultiplierSum || 0;
    const totalTokens = data.totalTokens || 0;
    const totalClaimableRewards = data.totalClaimableRewards || 0;
    const totalInfernoRewards = data.totalInfernoRewards || 0;
    const totalFluxRewards = data.totalFluxRewards || 0;
    const totalE280Rewards = data.totalE280Rewards || 0;

    if (contractKey === 'ascendantNFT') {
      return (
        <>
          <h2 className="text-2xl font-semibold mb-2">Summary</h2>
          <p>Number of Unique Wallets Holding NFTs: <span className="font-bold">{data.holders.length}</span></p>
          <p>Total Number of Active NFTs in Circulation: <span className="font-bold">{totalTokens.toLocaleString()}</span></p>
          <p>Total Locked Ascendant: <span className="font-bold">{(data.totalLockedAscendant || 0).toLocaleString()}</span></p>
          <p>Total Shares: <span className="font-bold">{(data.totalShares || 0).toLocaleString()}</span></p>
          <p>Total Claimable Rewards: <span className="font-bold">{Math.floor(totalClaimableRewards).toLocaleString()} DRAGONX</span></p>
          <p>Total Pending DragonX Rewards: <span className="font-bold">{(data.pendingRewards || 0).toLocaleString()}</span></p>
          <p>Pending DAY8 Rewards: <span className="font-bold">{(data.toDistributeDay8 || 0).toLocaleString()}</span></p>
          <p>Pending DAY28 Rewards: <span className="font-bold">{(data.toDistributeDay28 || 0).toLocaleString()}</span></p>
          <p>Pending DAY90 Rewards: <span className="font-bold">{(data.toDistributeDay90 || 0).toLocaleString()}</span></p>
        </>
      );
    } else if (isElement369) {
      return (
        <>
          <h2 className="text-2xl font-semibold mb-2">Summary</h2>
          <p>Number of Unique Wallets Holding NFTs: <span className="font-bold">{data.holders.length}</span></p>
          <p>Total Number of Active NFTs in Circulation: <span className="font-bold">{totalTokens.toLocaleString()}</span></p>
          <p>Total Multiplier Sum: <span className="font-bold">{totalMultiplierSum.toLocaleString()}</span></p>
          <p>Total Claimable Inferno Rewards: <span className="font-bold">{Math.floor(totalInfernoRewards).toLocaleString()}</span></p>
          <p>Total Claimable Flux Rewards: <span className="font-bold">{Math.floor(totalFluxRewards).toLocaleString()}</span></p>
          <p>Total Claimable E280 Rewards: <span className="font-bold">{Math.floor(totalE280Rewards).toLocaleString()}</span></p>
        </>
      );
    } else {
      return (
        <>
          <h2 className="text-2xl font-semibold mb-2">Summary</h2>
          <p>Number of Unique Wallets Holding NFTs: <span className="font-bold">{data.holders.length}</span></p>
          <p>Total Number of Active NFTs in Circulation: <span className="font-bold">{totalTokens.toLocaleString()}</span></p>
          <p>Total Multiplier Sum: <span className="font-bold">{totalMultiplierSum.toLocaleString()}</span></p>
          <p>
            Total Claimable Rewards:{' '}
            <span className="font-bold">
              {Math.floor(totalClaimableRewards).toLocaleString()} {rewardToken || ''}
            </span>
          </p>
        </>
      );
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-6">{name || 'Unknown Contract'} Holders</h1>
      {loading ? (
        <LoadingIndicator status={`Loading all ${name || 'contract'} holders...`} />
      ) : error ? (
        <p className="text-red-500 text-lg">Error: {error}</p>
      ) : !data ? (
        <p className="text-gray-400 text-lg">No data available for {name || 'this contract'}.</p>
      ) : data.message ? (
        <p className="text-gray-400 text-lg">{data.message}</p>
      ) : (
        <div className="w-full max-w-6xl">
          <div className="mb-6 p-4 bg-gray-800 rounded-lg shadow">{renderSummary()}</div>
          <HolderTable
            holders={data.holders || []}
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