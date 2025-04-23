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
  console.log('[fetchContractData] contractAddress:', contractAddress);
  console.log('[fetchContractData] vaultAddress:', vaultAddress);
  if (!contractAddress || !vaultAddress) {
    throw new Error('Element280 contract or vault address not configured');
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI`, { timeout: 60000 }),
  });

  try {
    const [totalSupply, totalBurned, tierCounts, multiplierPool, totalRewardPool] = await retry(() =>
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
    console.error('[fetchContractData] Error:', error.message);
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
  console.log('[NFTPage] Received props:', { chain, contract });

  // Derive contract identifier (convert to lowercase)
  const contractId = contract ? contract.toLowerCase() : null;
  console.log('[NFTPage] Derived contractId:', contractId);

  // Validate contract
  if (!contractId || !contractDetails[contractId]) {
    console.error('[NFTPage] Invalid or missing contract:', { chain, contract });
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
  const [cache, setCache] = useState({});

  const contractConfig = contractDetails[contractId];
  console.log('[NFTPage] contractConfig:', contractConfig);
  const { name, apiEndpoint, rewardToken, pageSize, disabled } = contractConfig;
  const isElement280 = contractId === 'element280';

  // Load HolderTable with error handling
  let HolderTable = holderTableComponents[contractId];
  if (!HolderTable) {
    console.error(`[NFTPage] HolderTable for ${contractId} not found`);
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
        <h1 className="text-4xl font-bold mb-6">{name || 'Unknown Contract'} Holders</h1>
        <p className="text-red-500 text-lg">Error: Holder table component for {contractId} not found</p>
      </div>
    );
  }
  console.log('[NFTPage] Selected HolderTable:', HolderTable.name);

  // Cache helpers
  const getCache = (key) => cache[key];
  const updateCache = (key, value) => setCache(prev => ({ ...prev, [key]: value }));

  // Check for disabled contract (e.g., E280)
  useEffect(() => {
    if (disabled) {
      console.log(`[NFTPage] Contract ${name} is disabled`);
      setError(`${name} is not yet supported (contract not deployed).`);
      setLoading(false);
    }
  }, [disabled, name]);

  // Fetch data function
  const fetchData = async () => {
    if (disabled || !apiEndpoint) {
      if (!disabled) {
        console.log('[NFTPage] Invalid contract configuration');
        setError('Invalid contract configuration');
      }
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (isElement280) {
        console.log(`[NFTPage] Fetching progress from ${apiEndpoint}/progress`);
        const res = await fetch(`${apiEndpoint}/progress`, { cache: 'no-store' });
        console.log('[NFTPage] Progress response status:', res.status);
        if (!res.ok) throw new Error(`Progress fetch failed: ${res.status}`);
        const progressData = await res.json();
        console.log('[NFTPage] Progress data:', progressData);
        setProgress(progressData);
      }
      await fetchAllHolders();
    } catch (err) {
      console.error('[NFTPage] Fetch error:', err.message);
      setError(`Failed to load ${name} data: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  };

  // Initial data fetch (no polling)
  useEffect(() => {
    fetchData();
  }, [apiEndpoint, contractId, isElement280, disabled]);

  async function fetchAllHolders() {
    const cachedData = getCache(contractId);
    if (cachedData) {
      console.log('[NFTPage] Using cached data for:', contractId);
      setData(cachedData);
      setLoading(false);
      return;
    }

    try {
      console.log(`[NFTPage] Starting fetch for ${contractId} at ${apiEndpoint}`);

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
            console.log(`[NFTPage] Fetching ${contractId} page ${page} at ${url}`);
            const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
            console.log('[NFTPage] Fetch response status:', res.status);
            if (!res.ok) {
              const errorText = await res.text();
              throw new Error(`Page ${page} failed with status: ${res.status} - ${errorText}`);
            }

            const json = await res.json();
            console.log('[NFTPage] Fetch response data:', json);
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
            console.log(`[NFTPage] Fetched page ${page}: ${newHolders.length} holders, totalPages: ${totalPages}`);
            page++;
            success = true;
            if (!newHolders || newHolders.length === 0) break;
          } catch (err) {
            attempts++;
            if (err.message.includes('Rate limit') || err.name === 'TimeoutError') {
              console.log(`[NFTPage] Retry ${attempts} for ${contractId} page ${page}: ${err.message}`);
              await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempts));
            } else {
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
          console.error('[NFTPage] Blockchain Summary Fetch Error:', err.message);
        }
      }

      updateCache(contractId, fetchedData);
      setData(fetchedData);
      setLoading(false);
      console.log(`[NFTPage] Successfully fetched ${uniqueHolders.length} holders for ${contractId}`);
    } catch (err) {
      console.error('[NFTPage] Fetch Error:', err.message);
      setError(`Failed to load ${name} holders: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  }

  const renderSummary = () => {
    if (!data) return null;

    const totalMultiplierSum = data.totalShares || data.holders.reduce((sum, h) => sum + (h.multiplierSum || 0), 0);
    const totalTokens = data.totalTokens || 0;
    const totalClaimableRewards = data.totalClaimableRewards || 0;
    const totalInfernoRewards = data.totalInfernoRewards || 0;
    const totalFluxRewards = data.totalFluxRewards || 0;
    const totalE280Rewards = data.totalE280Rewards || 0;

    if (contractId === 'element280') {
      const summary = data.summary || {};
      const totalSupply = Number(summary.totalLive || totalTokens || 0);
      const totalBurned = Number(summary.totalBurned || 0);
      const totalInitialSupply = totalSupply + totalBurned;
      const percentBurned = totalInitialSupply > 0 ? ((totalBurned / totalInitialSupply) * 100).toFixed(2) : '0.00';
      const tierDistribution = summary.tierDistribution || [0, 0, 0, 0, 0, 0];
      const burnedDistribution = summary.burnedDistribution || [0, 0, 0, 0, 0, 0];
      const multiplierPool = Number(summary.multiplierPool || totalShares || 0);
      const totalRewardPool = Number(summary.totalRewardPool || totalClaimableRewards || 0);

      // Define tier order to match HolderTable/Element280.js
      const element280TierOrder = [
        { tierId: '6', name: 'Legendary Amped', index: 5 },
        { tierId: '5', name: 'Legendary', index: 4 },
        { tierId: '4', name: 'Rare Amped', index: 3 },
        { tierId: '2', name: 'Common Amped', index: 1 },
        { tierId: '3', name: 'Rare', index: 2 },
        { tierId: '1', name: 'Common', index: 0 },
      ];

      const tierData = element280TierOrder.map(tier => {
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
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold mb-2">Element280 Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Initial Supply</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalInitialSupply.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Minted NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total NFTs Burned</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalBurned.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Burned NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total NFTs Remaining</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalSupply.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Circulating NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Burned Percentage</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{percentBurned}%</p>
              <p className="text-sm text-gray-400">Of Total Minted</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Multiplier Pool</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{multiplierPool.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Sum of Multipliers</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Reward Pool</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">
                {totalRewardPool.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {rewardToken || 'ELMNT'}
              </p>
              <p className="text-sm text-gray-400">Claimable Rewards</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold text-gray-300">Tier distribution of remaining live NFTs</h3>
              <motion.button
                className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 focus:outline-none"
                onClick={() => setShowChart(!showChart)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {showChart ? 'Hide Chart' : 'Show Chart'}
              </motion.button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse bg-gray-800 rounded-lg">
                <thead>
                  <tr className="bg-gray-700 text-gray-300">
                    <th className="p-3 text-sm font-semibold">Tier</th>
                    <th className="p-3 text-sm font-semibold text-right">Count</th>
                    <th className="p-3 text-sm font-semibold text-right">% remaining NFTs</th>
                    <th className="p-3 text-sm font-semibold text-right">Multiplier</th>
                    <th className="p-3 text-sm font-semibold text-right">Burned</th>
                    <th className="p-3 text-sm font-semibold text-right">% Burned</th>
                  </tr>
                </thead>
                <tbody>
                  {tierData.map((tier, index) => (
                    <tr
                      key={tier.name}
                      className={`border-b border-gray-700 ${index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}`}
                    >
                      <td className="p-3 text-gray-300">{tier.name}</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.count.toLocaleString('en-US')}</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.percentage}%</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.multiplier}</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.burned.toLocaleString('en-US')}</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.burnedPercentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <AnimatePresence>
            {showChart && (
              <motion.div
                className="bg-gray-800 p-4 rounded-lg shadow-md"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <h3 className="text-lg font-semibold text-gray-300 mb-3">Tier Distribution Chart</h3>
                <div className="w-full max-w-[800px] mx-auto" style={{ height: '300px' }}>
                  <Bar
                    data={{
                      labels: tierData.map(t => t.name),
                      datasets: [
                        {
                          label: 'Remaining NFTs',
                          data: tierData.map(t => t.count),
                          backgroundColor: 'rgba(75, 192, 192, 0.6)',
                          borderColor: 'rgba(75, 192, 192, 1)',
                          borderWidth: 1,
                        },
                        {
                          label: 'Burned NFTs',
                          data: tierData.map(t => t.burned),
                          backgroundColor: 'rgba(255, 99, 132, 0.6)',
                          borderColor: 'rgba(255, 99, 132, 1)',
                          borderWidth: 1,
                        },
                      ],
                    }}
                    options={{
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          beginAtZero: true,
                          title: { display: true, text: 'Number of NFTs', color: '#d1d5db' },
                          ticks: { color: '#d1d5db', callback: value => value.toLocaleString('en-US') },
                          grid: { color: '#4b5563' },
                        },
                        x: {
                          title: { display: true, text: 'Tier', color: '#d1d5db' },
                          ticks: { color: '#d1d5db' },
                          grid: { display: false },
                        },
                      },
                      plugins: { legend: { labels: { color: '#d1d5db' } } },
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="bg-gray-800 p-4 rounded-lg shadow-md">
            <p className="text-gray-300">
              Number of Unique Wallets Holding NFTs: <span className="font-bold text-white font-mono">{data.holders.length.toLocaleString('en-US')}</span>
            </p>
            <p className="text-gray-300">
              Total Number of Active NFTs in Circulation: <span className="font-bold text-white font-mono">{totalSupply.toLocaleString('en-US')}</span>
            </p>
            <p className="text-gray-300">
              Total Multiplier Sum: <span className="font-bold text-white font-mono">{multiplierPool.toLocaleString('en-US')}</span>
            </p>
            <p className="text-gray-300">
              Total Reward Pool: <span className="font-bold text-white font-mono">
                {totalRewardPool.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {rewardToken || 'ELMNT'}
              </span>
            </p>
          </div>
        </div>
      );
    } else if (contractId === 'ascendant') {
      return (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold mb-2">Ascendant Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Unique Wallets</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{data.holders.length.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalTokens.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Locked</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{(data.totalLockedAscendant || 0).toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Ascendant NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Shares</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{(data.totalShares || 0).toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Claimable Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">
                {Math.floor(totalClaimableRewards).toLocaleString('en-US')} {rewardToken || 'DRAGONX'}
              </p>
              <p className="text-sm text-gray-400">Total Rewards</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Pending Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{(data.pendingRewards || 0).toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">DragonX Rewards</p>
            </div>
          </div>
        </div>
      );
    } else if (contractId === 'element369') {
      return (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold mb-2">Element369 Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Unique Wallets</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{data.holders.length.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalTokens.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Multiplier</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalMultiplierSum.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Inferno Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{Math.floor(totalInfernoRewards).toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Claimable</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Flux Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{Math.floor(totalFluxRewards).toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Claimable</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">E280 Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{Math.floor(totalE280Rewards).toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Claimable</p>
            </div>
          </div>
        </div>
      );
    } else if (contractId === 'stax') {
      return (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold mb-2">Stax Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Unique Wallets</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{data.holders.length.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalTokens.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Multiplier</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalMultiplierSum.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Claimable Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">
                {Math.floor(totalClaimableRewards).toLocaleString('en-US')} {rewardToken || 'X28'}
              </p>
              <p className="text-sm text-gray-400">Total Rewards</p>
            </div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="space-y-6">
          <h2 className="text-2xl font-semibold mb-2">{name} Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Unique Wallets</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{data.holders.length.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalTokens.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Multiplier</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">{totalMultiplierSum.toLocaleString('en-US')}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Claimable Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right tracking-tight">
                {Math.floor(totalClaimableRewards).toLocaleString('en-US')} {rewardToken || 'Unknown'}
              </p>
              <p className="text-sm text-gray-400">Total Rewards</p>
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
          <div className="mt-8">
            <h3 className="text-xl font-bold mb-2">Raw Data:</h3>
            <pre className="text-sm bg-gray-800 p-4 rounded-lg shadow-md overflow-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}