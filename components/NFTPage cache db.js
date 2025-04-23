'use client';

import { useState, useEffect, useCallback } from 'react';
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

// Constants
const MAX_INITIAL_SUPPLY = 16883; // Only hardcoded constant
const FALLBACK_TOTAL_SUPPLY = 8137; // Current, may decrease
const FALLBACK_TOTAL_BURNED = 8746; // Current, may increase
const FALLBACK_EXPECTED_HOLDERS = 921; // Current, may change

// Retry utility
async function retry(fn, attempts = 3, delay = retryCount => Math.min(1000 * 2 ** retryCount, 5000)) {
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

// Fetch blockchain summary for Element280
async function fetchContractData() {
  const contractAddress = contractAddresses.element280.address;
  const vaultAddress = vaultAddresses.element280.address;
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
    const totalSupplyNum = Number(totalSupply.result);
    const totalBurnedNum = Number(totalBurned.result);
    if (totalSupplyNum + totalBurnedNum > MAX_INITIAL_SUPPLY || totalSupplyNum < 0 || totalBurnedNum < 0) {
      throw new Error(`Invalid supply: totalSupply=${totalSupplyNum}, totalBurned=${totalBurnedNum}`);
    }
    const data = {
      totalMinted: totalSupplyNum + totalBurnedNum,
      totalBurned: totalBurnedNum,
      totalLive: totalSupplyNum,
      tierDistribution: tierCounts.result.map(Number),
      multiplierPool: Number(multiplierPool.result),
      totalRewardPool: Number(totalRewardPool.result) / 1e18,
      burnedDistribution: [0, 0, 0, 0, 0, 0],
    };
    return data;
  } catch (error) {
    console.error('[fetchContractData] Error:', error.message);
    return {
      totalMinted: MAX_INITIAL_SUPPLY,
      totalBurned: FALLBACK_TOTAL_BURNED,
      totalLive: FALLBACK_TOTAL_SUPPLY,
      tierDistribution: [0, 0, 0, 0, 0, 0],
      multiplierPool: 0,
      totalRewardPool: 0,
      burnedDistribution: [0, 0, 0, 0, 0, 0],
    };
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
  const contractId = contract ? contract.toLowerCase() : null;
  if (!contractId || !contractDetails[contractId]) {
    console.error('[NFTPage] Invalid contract:', { chain, contract });
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
        <h1 className="text-4xl font-bold mb-6">Error</h1>
        <p className="text-red-500 text-lg">Invalid contract: {contractId || 'none'}</p>
      </div>
    );
  }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showChart, setShowChart] = useState(false);
  const [progress, setProgress] = useState({
    isPopulating: true,
    totalWallets: 0,
    totalOwners: 0,
    phase: 'Initializing',
    progressPercentage: 0,
  });
  const [cache, setCache] = useState({});
  const [isFetching, setIsFetching] = useState(false);
  const [hasPolled, setHasPolled] = useState(false);

  const contractConfig = contractDetails[contractId];
  const { name, apiEndpoint, rewardToken, pageSize, disabled } = contractConfig;
  const isElement280 = contractId === 'element280';

  let HolderTable = holderTableComponents[contractId];
  if (!HolderTable) {
    console.error(`[NFTPage] HolderTable for ${contractId} not found`);
    return (
      <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
        <h1 className="text-4xl font-bold mb-6">{name} Holders</h1>
        <p className="text-red-500 text-lg">Error: Holder table for {contractId} not found</p>
      </div>
    );
  }

  const getCache = (key) => cache[key];
  const updateCache = (key, value) => setCache(prev => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (disabled) {
      setError(`${name} is not yet supported`);
      setLoading(false);
    }
  }, [disabled, name]);

  const fetchAllHolders = useCallback(async () => {
    if (isFetching) return;
    setIsFetching(true);
    const cachedData = getCache(contractId);
    if (cachedData) {
      setData(cachedData);
      setLoading(false);
      setIsFetching(false);
      return;
    }

    try {
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
        try {
          const url = `${apiEndpoint}?page=${page}&pageSize=${effectivePageSize}`;
          const res = await retry(() => fetch(url, { signal: AbortSignal.timeout(60000) }));
          if (!res.ok) {
            throw new Error(`Page ${page} failed with status: ${res.status}`);
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
          if (!newHolders.length) break;
        } catch (err) {
          console.error(`[NFTPage] Fetch page ${page} error: ${err.message}`);
          throw err;
        }
      }

      const uniqueHoldersMap = new Map();
      allHolders.forEach(holder => {
        if (holder?.wallet) {
          holder.shares = holder.shares || holder.totalShares || holder.multiplierSum || 0;
          holder.totalNfts = holder.totalNfts || holder.total || holder.totalLive || 0;
          const existing = uniqueHoldersMap.get(holder.wallet);
          if (existing) {
            existing.totalNfts += holder.totalNfts;
            existing.shares += holder.shares;
            existing.claimableRewards = (existing.claimableRewards || 0) + (holder.claimableRewards || 0);
            existing.tiers = existing.tiers.map((count, i) => count + (holder.tiers ? holder.tiers[i] : 0));
            existing.tokenIds = [...new Set([...existing.tokenIds, ...(holder.tokenIds || [])])];
          } else {
            uniqueHoldersMap.set(holder.wallet, { ...holder });
          }
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
      } else {
        uniqueHolders.sort((a, b) => (b.multiplierSum || 0) - (a.multiplierSum || 0) || (b.totalLive || b.total || 0) - (a.totalLive || a.total || 0));
      }
      uniqueHolders.forEach((holder, index) => {
        holder.rank = index + 1;
        holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      });

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
        const blockchainSummary = await fetchContractData();
        fetchedData.summary = { ...fetchedData.summary, ...blockchainSummary };
        fetchedData.totalTokens = blockchainSummary.totalLive || fetchedData.totalTokens;
        fetchedData.totalShares = blockchainSummary.multiplierPool || fetchedData.totalShares;
        fetchedData.totalClaimableRewards = blockchainSummary.totalRewardPool || fetchedData.totalClaimableRewards;
        if (fetchedData.totalTokens + fetchedData.summary.totalBurned > MAX_INITIAL_SUPPLY || fetchedData.totalTokens < 0) {
          console.error(`[NFTPage] Validation failed: totalTokens=${fetchedData.totalTokens}, totalBurned=${fetchedData.summary.totalBurned}`);
          setError(`Invalid data: total supply (${fetchedData.totalTokens}) + burned (${fetchedData.summary.totalBurned}) exceeds ${MAX_INITIAL_SUPPLY}`);
          setLoading(false);
          setIsFetching(false);
          return;
        }
      }

      console.log(`[NFTPage] Fetched ${uniqueHolders.length} holders, totalTokens=${totalTokens}`);
      updateCache(contractId, fetchedData);
      setData(fetchedData);
      setLoading(false);
    } catch (err) {
      console.error('[NFTPage] Fetch error:', err.message);
      setError(`Failed to load ${name} holders: ${err.message}`);
      setLoading(false);
    } finally {
      setIsFetching(false);
    }
  }, [contractId, apiEndpoint, isElement280, name, pageSize]);

  useEffect(() => {
    if (!isElement280 || disabled || !apiEndpoint || hasPolled) return;

    let timeoutId;
    let intervalId;
    const pollProgress = async () => {
      try {
        const res = await retry(() => fetch(`${apiEndpoint}/progress`, { cache: 'no-store' }));
        if (!res.ok) throw new Error(`Progress fetch failed: ${res.status}`);
        const progressData = await res.json();
        setProgress({
          ...progressData,
          phase: progressData.step || 'Processing',
          progressPercentage: progressData.progressPercentage || 0,
        });

        if (!progressData.isPopulating && progressData.totalWallets >= FALLBACK_EXPECTED_HOLDERS) {
          setHasPolled(true);
          await fetchAllHolders();
          clearInterval(intervalId);
          clearTimeout(timeoutId);
        } else if (!progressData.isPopulating && progressData.totalWallets < FALLBACK_EXPECTED_HOLDERS) {
          setError(`Incomplete data: ${progressData.totalWallets}/${FALLBACK_EXPECTED_HOLDERS} wallets`);
          setLoading(false);
          setHasPolled(true);
          clearInterval(intervalId);
          clearTimeout(timeoutId);
        }
      } catch (err) {
        console.error('[NFTPage] Progress error:', err.message);
        try {
          const blockchainSummary = await fetchContractData();
          setData({
            holders: [],
            totalTokens: blockchainSummary.totalLive,
            totalShares: blockchainSummary.multiplierPool,
            totalClaimableRewards: blockchainSummary.totalRewardPool,
            summary: blockchainSummary,
            burnedNfts: [],
          });
          setLoading(false);
          setHasPolled(true);
          clearInterval(intervalId);
          clearTimeout(timeoutId);
        } catch (fallbackErr) {
          console.error('[NFTPage] Fallback error:', fallbackErr.message);
          setError(`Failed to load ${name}: ${err.message}`);
          setLoading(false);
          setHasPolled(true);
          clearInterval(intervalId);
          clearTimeout(timeoutId);
        }
      }
    };

    pollProgress();
    intervalId = setInterval(pollProgress, 1000);
    timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      setError(`Failed to load ${name}: Progress check timed out`);
      setLoading(false);
      setHasPolled(true);
    }, 30000);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [isElement280, apiEndpoint, disabled, name, fetchAllHolders, hasPolled]);

  useEffect(() => {
    if (isElement280 || disabled || !apiEndpoint) return;
    fetchAllHolders();
  }, [isElement280, apiEndpoint, disabled, fetchAllHolders]);

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
      const totalSupply = Number(summary.totalLive || totalTokens || FALLBACK_TOTAL_SUPPLY);
      const totalBurned = Number(summary.totalBurned || FALLBACK_TOTAL_BURNED);
      const totalInitialSupply = MAX_INITIAL_SUPPLY;
      const percentBurned = totalInitialSupply > 0 ? ((totalBurned / totalInitialSupply) * 100).toFixed(2) : '0.00';
      const tierDistribution = summary.tierDistribution || [0, 0, 0, 0, 0, 0];
      const burnedDistribution = summary.burnedDistribution || [0, 0, 0, 0, 0, 0];
      const multiplierPool = Number(summary.multiplierPool || totalShares || 0);
      const totalRewardPool = Number(summary.totalRewardPool || totalClaimableRewards || 0);

      const tierData = Object.values(contractTiers.element280).map((tier, index) => {
        const remainingCount = Number(tierDistribution[index] || 0);
        const burnedCount = Number(burnedDistribution[index] || 0);
        const initialCount = remainingCount + burnedCount;
        const burnedPercentage = initialCount > 0 ? ((burnedCount / initialCount) * 100).toFixed(2) : '0.00';
        return {
          name: tier.name,
          count: remainingCount,
          percentage: totalSupply > 0 ? ((remainingCount / totalSupply) * 100).toFixed(2) : '0.00',
          multiplier: tier.multiplier,
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
              <p className="text-2xl font-bold text-white font-mono text-right">{totalInitialSupply.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Minted NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total NFTs Burned</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalBurned.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Burned NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total NFTs Remaining</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalSupply.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Circulating NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Burned Percentage</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{percentBurned}%</p>
              <p className="text-sm text-gray-400">Of Total Minted</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Multiplier Pool</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{multiplierPool.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Sum of Multipliers</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Reward Pool</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">
                {totalRewardPool.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {rewardToken || 'ELMNT'}
              </p>
              <p className="text-sm text-gray-400">Claimable Rewards</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold text-gray-300">Tier Distribution</h3>
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
                    <th className="p-3 text-sm font-semibold text-right">% Remaining</th>
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
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.count.toLocaleString()}</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.percentage}%</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.multiplier}</td>
                      <td className="p-3 text-gray-300 font-mono text-right">{tier.burned.toLocaleString()}</td>
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
                          ticks: { color: '#d1d5db', callback: value => value.toLocaleString() },
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
              Unique Wallets: <span className="font-bold text-white font-mono">{data.holders.length.toLocaleString()}</span>
            </p>
            <p className="text-gray-300">
              Active NFTs: <span className="font-bold text-white font-mono">{totalSupply.toLocaleString()}</span>
            </p>
            <p className="text-gray-300">
              Total Multiplier Sum: <span className="font-bold text-white font-mono">{multiplierPool.toLocaleString()}</span>
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
              <p className="text-2xl font-bold text-white font-mono text-right">{data.holders.length.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalTokens.toLocaleString()}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Locked</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{(data.totalLockedAscendant || 0).toLocaleString()}</p>
              <p className="text-sm text-gray-400">Ascendant NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Shares</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{(data.totalShares || 0).toLocaleString()}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Claimable Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">
                {Math.floor(totalClaimableRewards).toLocaleString()} {rewardToken || 'DRAGONX'}
              </p>
              <p className="text-sm text-gray-400">Total Rewards</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Pending Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{(data.pendingRewards || 0).toLocaleString()}</p>
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
              <p className="text-2xl font-bold text-white font-mono text-right">{data.holders.length.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalTokens.toLocaleString()}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Multiplier</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalMultiplierSum.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Inferno Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{Math.floor(totalInfernoRewards).toLocaleString()}</p>
              <p className="text-sm text-gray-400">Claimable</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Flux Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{Math.floor(totalFluxRewards).toLocaleString()}</p>
              <p className="text-sm text-gray-400">Claimable</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">E280 Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{Math.floor(totalE280Rewards).toLocaleString()}</p>
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
              <p className="text-2xl font-bold text-white font-mono text-right">{data.holders.length.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalTokens.toLocaleString()}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Multiplier</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalMultiplierSum.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Claimable Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">
                {Math.floor(totalClaimableRewards).toLocaleString()} {rewardToken || 'X28'}
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
              <p className="text-2xl font-bold text-white font-mono text-right">{data.holders.length.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Holding NFTs</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Active NFTs</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalTokens.toLocaleString()}</p>
              <p className="text-sm text-gray-400">In Circulation</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Total Multiplier</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">{totalMultiplierSum.toLocaleString()}</p>
              <p className="text-sm text-gray-400">Multiplier Sum</p>
            </div>
            <div className="bg-gray-800 p-4 rounded-lg shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-lg font-semibold text-gray-300">Claimable Rewards</h3>
              <p className="text-2xl font-bold text-white font-mono text-right">
                {Math.floor(totalClaimableRewards).toLocaleString()} {rewardToken || 'Unknown'}
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
      return `Loading ${name} holders...`;
    }
    if (progress.isPopulating) {
      return `Populating ${name} holders: ${progress.totalWallets} wallets`;
    }
    return `Finalizing ${name} data: ${progress.totalWallets} wallets...`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-6">{name} Holders</h1>
      {loading ? (
        <LoadingIndicator status={getLoadingMessage()} progress={progress} />
      ) : error ? (
        <p className="text-red-500 text-lg">Error: {error}</p>
      ) : !data ? (
        <p className="text-gray-400 text-lg">No data for {name}.</p>
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