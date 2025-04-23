'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import LoadingIndicator from './LoadingIndicator';
import { contractDetails, contractTiers, contractAddresses, vaultAddresses } from '@/app/nft-contracts';
import { Bar } from 'react-chartjs-2';
import Chart from 'chart.js/auto';
import { motion, AnimatePresence } from 'framer-motion';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { useNFTStore } from '../app/store';

// Contract ABIs for Element280
const element280Abi = [
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalBurned', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getTotalNftsPerTiers', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256[]' }] },
  { name: 'multiplierPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];
const element280VaultAbi = [
  { name: 'totalRewardPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

// Retry utility
async function retry(fn, attempts = 5, delay = retryCount => Math.min(2000 * 2 ** retryCount, 10000)) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`[NFTPage] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) {
        throw new Error(`Failed after ${attempts} attempts: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, delay(i)));
    }
  }
}

// Fetch summary data for Element280
async function fetchContractData() {
  const contractAddress = contractAddresses.element280.address;
  const vaultAddress = vaultAddresses.element280.address;
  console.log(`[NFTPage] [INFO] Fetching contract data for Element280: contract=${contractAddress}, vault=${vaultAddress}`);
  if (!contractAddress || !vaultAddress) {
    throw new Error('Element280 contract or vault address not configured');
  }
  if (!process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    throw new Error('Alchemy API key not configured');
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`, { timeout: 60000 }),
  });

  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: element280Abi, functionName: 'totalSupply' },
          { address: contractAddress, abi: element280Abi, functionName: 'totalBurned' },
          { address: contractAddress, abi: element280Abi, functionName: 'getTotalNftsPerTiers' },
          { address: contractAddress, abi: element280Abi, functionName: 'multiplierPool' },
          { address: vaultAddress, abi: element280VaultAbi, functionName: 'totalRewardPool' },
        ],
      })
    );
    const [totalSupply, totalBurned, tierCounts, multiplierPool, totalRewardPool] = results;
    if (totalSupply.status === 'failure') {
      throw new Error(`totalSupply call failed: ${totalSupply.error}`);
    }
    if (totalBurned.status === 'failure') {
      throw new Error(`totalBurned call failed: ${totalBurned.error}`);
    }
    if (tierCounts.status === 'failure') {
      throw new Error(`getTotalNftsPerTiers call failed: ${tierCounts.error}`);
    }
    if (multiplierPool.status === 'failure') {
      throw new Error(`multiplierPool call failed: ${multiplierPool.error}`);
    }
    if (totalRewardPool.status === 'failure') {
      throw new Error(`totalRewardPool call failed: ${totalRewardPool.error}`);
    }
    return {
      totalMinted: Number(totalSupply.result) + Number(totalBurned.result),
      totalBurned: Number(totalBurned.result),
      totalLive: Number(totalSupply.result),
      tierDistribution: tierCounts.result.map(Number),
      multiplierPool: Number(multiplierPool.result),
      totalRewardPool: Number(totalRewardPool.result) / 1e18,
      burnedDistribution: [0, 0, 0, 0, 0, 0],
    };
  } catch (error) {
    console.error(`[NFTPage] [ERROR] fetchContractData failed: ${error.message}, stack: ${error.stack}`);
    throw new Error(`Failed to fetch contract data: ${error.message}`);
  }
}

// Map contract to HolderTable component
const holderTableComponents = {
  element280: dynamic(() => import('./HolderTable/Element280'), { ssr: false }),
  element369: dynamic(() => import('./HolderTable/Element369'), { ssr: false }),
  stax: dynamic(() => import('./HolderTable/Stax'), { ssr: false }),
  ascendant: dynamic(() => import('./HolderTable/Ascendant'), { ssr: false }),
  e280: dynamic(() => import('./HolderTable/E280'), { ssr: false }),
};

export default function NFTPage({ chain, contract }) {
  console.log(`[NFTPage] [INFO] Received props: chain=${chain}, contract=${contract}`);

  // Derive contract identifier (convert to lowercase)
  const contractId = contract ? contract.toLowerCase() : null;
  console.log(`[NFTPage] [INFO] Derived contractId: ${contractId}`);

  // Validate contract
  if (!contractId || !contractDetails[contractId]) {
    console.error(`[NFTPage] [ERROR] Invalid or missing contract: chain=${chain}, contract=${contract}`);
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
        <h1 className="text-4xl font-bold mb-6">Error</h1>
        <p className="text-red-500 text-lg">Invalid contract: {contractId || 'none specified'}</p>
      </div>
    );
  }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showChart, setShowChart] = useState(false);
  const [progress, setProgress] = useState({ isPopulating: true, totalWallets: 0, totalOwners: 0, phase: 'Initializing', progressPercentage: 0 });

  const contractConfig = contractDetails[contractId];
  console.log(`[NFTPage] [INFO] contractConfig: name=${contractConfig.name}, apiEndpoint=${contractConfig.apiEndpoint}`);
  const { name, apiEndpoint, rewardToken, pageSize, disabled } = contractConfig;
  const isElement280 = contractId === 'element280';

  // Load HolderTable with error handling
  let HolderTable = holderTableComponents[contractId];
  if (!HolderTable) {
    console.error(`[NFTPage] [ERROR] HolderTable for ${contractId} not found`);
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
        <h1 className="text-4xl font-bold mb-6">{name || 'Unknown Contract'} Holders</h1>
        <p className="text-red-500 text-lg">Error: Holder table component for {contractId} not found</p>
      </div>
    );
  }

  // Use Zustand store for caching
  const { getCache, setCache } = useNFTStore();

  // Check for disabled contract (e.g., E280)
  useEffect(() => {
    if (disabled) {
      console.log(`[NFTPage] [INFO] Contract ${name} is disabled`);
      setError(`${name} is not yet supported (contract not deployed).`);
      setLoading(false);
    }
  }, [disabled, name]);

  // Fetch data function
  const fetchData = async () => {
    if (disabled || !apiEndpoint) {
      if (!disabled) {
        console.error(`[NFTPage] [ERROR] Invalid contract configuration for ${contractId}`);
        setError('Invalid contract configuration');
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let progressData = { isPopulating: false, phase: 'Idle', progressPercentage: 0 };
      if (isElement280) {
        try {
          console.log(`[NFTPage] [INFO] Fetching progress from ${apiEndpoint}/progress`);
          const res = await fetch(`${apiEndpoint}/progress`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
          if (!res.ok) {
            console.error(`[NFTPage] [ERROR] Progress fetch failed: ${res.status}`);
          } else {
            progressData = await res.json();
          }
        } catch (err) {
          console.error(`[NFTPage] [ERROR] Progress fetch error: ${err.message}, stack: ${err.stack}`);
        }
        setProgress(progressData);
      }
      await fetchAllHolders();
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Fetch error: ${err.message}, stack: ${err.stack}`);
      setError(`Failed to load ${name} data: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  };

  // Initial data fetch (no polling)
  useEffect(() => {
    fetchData();
  }, [apiEndpoint, contractId, isElement280, disabled]);

  async function fetchAllHolders() {
    const cacheKey = `holders_${contractId}`;
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      setData(cachedData);
      setLoading(false);
      return;
    }
    console.log(`[NFTPage] [INFO] Cache miss for ${cacheKey}, fetching data`);

    try {
      console.log(`[NFTPage] [INFO] Starting fetch for ${contractId} at ${apiEndpoint}`);

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
      let summary = {};
      let burnedNfts = [];
      let page = 0;
      let totalPages = Infinity;
      const effectivePageSize = pageSize || 100;

      while (page < totalPages) {
        let attempts = 0;
        const maxAttempts = 5;
        let success = false;

        while (attempts < maxAttempts && !success) {
          try {
            const url = `${apiEndpoint}?page=${page}&pageSize=${effectivePageSize}`;
            console.log(`[NFTPage] [INFO] Fetching ${contractId} page ${page} at ${url}`);
            const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
            if (!res.ok) {
              const errorText = await res.text();
              console.error(`[NFTPage] [ERROR] Fetch failed for ${url}: ${res.status} - ${errorText}`);
              throw new Error(`Page ${page} failed with status: ${res.status} - ${errorText}`);
            }

            const json = await res.json();
            const newHolders = json.holders || [];
            allHolders = allHolders.concat(newHolders);
            totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
            totalLockedAscendant = json.totalLockedAscendant || totalLockedAscendant;
            totalShares = json.totalShares || json.summary?.multiplierPool || totalShares;
            toDistributeDay8 = json.toDistributeDay8 || toDistributeDay8;
            toDistributeDay28 = json.toDistributeDay28 || toDistributeDay28;
            toDistributeDay90 = json.toDistributeDay90 || toDistributeDay90;
            pendingRewards = json.pendingRewards || pendingRewards;
            summary = json.summary || summary;
            burnedNfts = json.burnedNfts || burnedNfts;
            totalPages = json.totalPages || 1;
            page++;
            success = true;
            if (!newHolders || newHolders.length === 0) break;
          } catch (err) {
            attempts++;
            if (err.message.includes('Rate limit') || err.name === 'TimeoutError') {
              console.log(`[NFTPage] [INFO] Retry ${attempts} for ${contractId} page ${page}: ${err.message}`);
              await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempts));
            } else {
              console.error(`[NFTPage] [ERROR] Fetch error for ${contractId} page ${page}: ${err.message}, stack: ${err.stack}`);
              throw err;
            }
          }
        }
        if (!success) {
          throw new Error(`Failed to fetch page ${page} for ${contractId} after ${maxAttempts} attempts`);
        }
      }

      const uniqueHoldersMap = new Map();
      allHolders.forEach(holder => {
        if (holder && holder.wallet) {
          holder.shares = holder.shares || holder.totalShares || 0;
          holder.totalNfts = holder.totalNfts || holder.total || 0;
          uniqueHoldersMap.set(holder.wallet, holder);
        }
      });
      const uniqueHolders = Array.from(uniqueHoldersMap.values());

      const totalMultiplierSum = uniqueHolders.reduce((sum, h) => sum + (h.multiplierSum || 0), 0);
      if (contractId === 'element369') {
        totalInfernoRewards = uniqueHolders.reduce((sum, h) => sum + (h.infernoRewards || 0), 0);
        totalFluxRewards = uniqueHolders.reduce((sum, h) => sum + (h.fluxRewards || 0), 0);
        totalE280Rewards = uniqueHolders.reduce((sum, h) => sum + (h.e280Rewards || 0), 0);
      } else {
        totalClaimableRewards = uniqueHolders.reduce((sum, h) => sum + (h.claimableRewards || 0), 0);
      }
      if (!totalTokens && uniqueHolders.length > 0) {
        totalTokens = uniqueHolders.reduce((sum, h) => sum + (isElement280 ? h.totalLive || 0 : h.totalNfts || 0), 0);
      }

      uniqueHolders.forEach(holder => {
        holder.sharesPercentage = totalShares > 0 ? ((holder.shares || 0) / totalShares) * 100 : 0;
      });

      if (contractId === 'ascendant') {
        uniqueHolders.sort((a, b) => {
          const sharesDiff = (b.shares || 0) - (a.shares || 0);
          if (sharesDiff !== 0) return sharesDiff;
          return (b.totalNfts || 0) - (a.totalNfts || 0);
        });
        uniqueHolders.forEach((holder, index) => {
          holder.rank = index + 1;
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
        });
      } else {
        uniqueHolders.sort((a, b) => (b.multiplierSum || 0) - (a.multiplierSum || 0) || (b.totalLive || b.total || 0) - (a.totalLive || a.total || 0));
        uniqueHolders.forEach((holder, index) => {
          holder.rank = index + 1;
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
        });
      }

      let fetchedData = {
        holders: uniqueHolders,
        totalTokens,
        totalLockedAscendant,
        totalShares,
        toDistributeDay8,
        toDistributeDay28,
        toDistributeDay90,
        pendingRewards,
        totalClaimableRewards,
        totalInfernoRewards,
        totalFluxRewards,
        totalE280Rewards,
        summary,
        burnedNfts,
      };

      if (isElement280) {
        try {
          const blockchainSummary = await fetchContractData();
          fetchedData.summary = { ...fetchedData.summary, ...blockchainSummary };
          fetchedData.totalTokens = blockchainSummary.totalLive || fetchedData.totalTokens;
          fetchedData.totalShares = blockchainSummary.multiplierPool || fetchedData.totalShares;
          fetchedData.totalClaimableRewards = blockchainSummary.totalRewardPool || fetchedData.totalClaimableRewards;
        } catch (err) {
          console.error(`[NFTPage] [ERROR] Blockchain Summary Fetch Error: ${err.message}, stack: ${err.stack}`);
        }
      }

      setCache(cacheKey, fetchedData);
      setData(fetchedData);
      setLoading(false);
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Fetch Error: ${err.message}, stack: ${err.stack}`);
      setError(`Failed to load ${name} holders: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  }

  // renderSummary function
  const renderSummary = () => {
    if (!data) return null;

    const totalTokens = data.totalTokens || 0;
    const totalBurned = data.summary?.totalBurned || 0;
    const totalLockedAscendant = data.totalLockedAscendant || 0;
    const totalClaimableRewards = (data.toDistributeDay8 || 0) + (data.toDistributeDay28 || 0) + (data.toDistributeDay90 || 0);
    const totalInfernoRewards = data.holders.reduce((sum, h) => sum + (h.infernoRewards || 0), 0);
    const totalFluxRewards = data.holders.reduce((sum, h) => sum + (h.fluxRewards || 0), 0);
    const totalE280Rewards = data.holders.reduce((sum, h) => sum + (h.e280Rewards || 0), 0);
    const pendingRewards = data.pendingRewards || 0;
    const totalRewardPool = data.summary?.totalRewardPool || 0;

    if (contractId === 'element280') {
      const summary = data.summary || {};
      const totalSupply = Number(summary.totalLive || totalTokens || 0);
      const tierDistribution = summary.tierDistribution || [0, 0, 0, 0, 0, 0];
      const burnedDistribution = summary.burnedDistribution || [0, 0, 0, 0, 0, 0];

      const element280TierOrder = [
        { tierId: '6', name: 'Legendary Amped', index: 5 },
        { tierId: '5', name: 'Legendary', index: 4 },
        { tierId: '4', name: 'Rare Amped', index: 3 },
        { tierId: '2', name: 'Common Amped', index: 1 },
        { tierId: '3', name: 'Rare', index: 2 },
        { tierId: '1', name: 'Common', index: 0 },
      ];

      const tierData = element280TierOrder.map((tier) => {
        const index = tier.index;
        const tierConfig = contractTiers.element280[tier.tierId];
        const remainingCount = Number(tierDistribution[index] || 0);
        const burnedCount = Number(burnedDistribution[index] || 0);
        const initialCount = remainingCount + burnedCount;
        const burnedPercentage = initialCount > 0 ? ((burnedCount / initialCount) * 100).toFixed(2) : '0.00';
        return {
          name: tier.name,
          count: remainingCount,
          percentage: totalSupply > 0 ? ((remainingCount / totalSupply) * 100).toFixed(2) : '0.00',
          multiplier: tierConfig.multiplier,
          burned: burnedCount,
          burnedPercentage,
        };
      });

      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white mb-2">Element 280 Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Wallets</h3>
              <p className="text-sm font-mono text-right">{data.holders.length.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Live NFTs</h3>
              <p className="text-sm font-mono text-right">{totalSupply.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Burned</h3>
              <p className="text-sm font-mono text-right">{totalBurned.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Rewards</h3>
              <p className="text-sm font-mono text-right">{totalRewardPool.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ELMNT</p>
            </div>
          </div>
          <div className="mt-4">
            <h3 className="text-md font-semibold text-white mb-2">Tier Distribution</h3>
            <div className="bg-gray-800 rounded-md p-3 overflow-x-auto">
              <table className="w-full text-sm text-gray-300">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left">Tier</th>
                    <th className="px-2 py-1 text-right">Count</th>
                    <th className="px-2 py-1 text-right">%</th>
                    <th className="px-2 py-1 text-right">Multiplier</th>
                    <th className="px-2 py-1 text-right">Burned</th>
                    <th className="px-2 py-1 text-right">Burned %</th>
                  </tr>
                </thead>
                <tbody>
                  {tierData.map((tier) => (
                    <tr key={tier.name}>
                      <td className="px-2 py-1">{tier.name}</td>
                      <td className="px-2 py-1 text-right">{tier.count.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{tier.percentage}%</td>
                      <td className="px-2 py-1 text-right">{tier.multiplier}</td>
                      <td className="px-2 py-1 text-right">{tier.burned.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{tier.burnedPercentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {showChart && (
            <div className="mt-4">
              <Bar
                data={{
                  labels: tierData.map(t => t.name),
                  datasets: [
                    {
                      label: 'Remaining NFTs',
                      data: tierData.map(t => t.count),
                      backgroundColor: 'rgba(255, 159, 64, 0.5)',
                      borderColor: 'rgba(255, 159, 64, 1)',
                      borderWidth: 1,
                    },
                    {
                      label: 'Burned NFTs',
                      data: tierData.map(t => t.burned),
                      backgroundColor: 'rgba(255, 99, 132, 0.5)',
                      borderColor: 'rgba(255, 99, 132, 1)',
                      borderWidth: 1,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { position: 'top' },
                    title: { display: true, text: 'Tier Distribution' },
                  },
                  scales: {
                    y: { beginAtZero: true },
                  },
                }}
              />
            </div>
          )}
          <button
            onClick={() => setShowChart(!showChart)}
            className="mt-2 px-4 py-2 bg-orange-500 text-white rounded-md font-semibold hover:bg-orange-600"
          >
            {showChart ? 'Hide Chart' : 'Show Chart'}
          </button>
        </div>
      );
    } else if (contractId === 'stax') {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white mb-2">Stax Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Wallets</h3>
              <p className="text-sm font-mono text-right">{data.holders.length.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Live NFTs</h3>
              <p className="text-sm font-mono text-right">{(totalTokens - totalBurned).toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Burned</h3>
              <p className="text-sm font-mono text-right">{totalBurned.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Rewards</h3>
              <p className="text-sm font-mono text-right">{data.holders.reduce((sum, h) => sum + (h.claimableRewards || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} X28</p>
            </div>
          </div>
        </div>
      );
    } else if (contractId === 'element369') {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white mb-2">Element 369 Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Wallets</h3>
              <p className="text-sm font-mono text-right">{data.holders.length.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Live NFTs</h3>
              <p className="text-sm font-mono text-right">{totalTokens.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Inferno</h3>
              <p className="text-sm font-mono text-right">{totalInfernoRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Flux</h3>
              <p className="text-sm font-mono text-right">{totalFluxRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">E280</h3>
              <p className="text-sm font-mono text-right">{totalE280Rewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH</p>
            </div>
          </div>
        </div>
      );
    } else if (contractId === 'ascendant') {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white mb-2">Ascendant Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Wallets</h3>
              <p className="text-sm font-mono text-right">{data.holders.length.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Live NFTs</h3>
              <p className="text-sm font-mono text-right">{totalTokens.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Locked</h3>
              <p className="text-sm font-mono text-right">{totalLockedAscendant.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Claimable</h3>
              <p className="text-sm font-mono text-right">{totalClaimableRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DRAGONX</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Pending</h3>
              <p className="text-sm font-mono text-right">{pendingRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DRAGONX</p>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white mb-2">{name} Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Wallets</h3>
              <p className="text-sm font-mono text-right">{data.holders.length.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Live NFTs</h3>
              <p className="text-sm font-mono text-right">{totalTokens.toLocaleString()}</p>
            </div>
            <div className="bg-gray-800 rounded-md p-3 text-gray-300">
              <h3 className="text-sm font-semibold">Rewards</h3>
              <p className="text-sm font-mono text-right">{totalClaimableRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {rewardToken || 'Unknown'}</p>
            </div>
          </div>
        </div>
      );
    }
  };

  const getLoadingMessage = () => {
    if (!isElement280) {
      return `Loading all ${name || 'contract'} holders (may take up to 60 seconds)...`;
    }
    if (progress.isPopulating) {
      return `Fetching ${name} data: ${progress.phase} (${progress.progressPercentage}%)...`;
    }
    return `Finalizing ${name} data...`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-6">{name || 'Unknown Contract'} Holders</h1>
      {loading ? (
        <LoadingIndicator status={getLoadingMessage()} progress={progress} />
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
            contract={contractId}
            summary={data.summary}
            loading={loading}
            totalShares={isElement280 ? data.summary?.multiplierPool : data.totalShares}
            totalLockedAscendant={data.totalLockedAscendant}
            toDistributeDay8={data.toDistributeDay8}
            toDistributeDay28={data.toDistributeDay28}
            toDistributeDay90={data.toDistributeDay90}
            pendingRewards={data.pendingRewards}
            totalClaimableRewards={data.totalClaimableRewards}
            totalInfernoRewards={data.totalInfernoRewards}
            totalFluxRewards={data.totalFluxRewards}
            totalE280Rewards={data.totalE280Rewards}
            burnedNfts={data.burnedNfts}
          />
        </div>
      )}
    </div>
  );
}