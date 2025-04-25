'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import LoadingIndicator from './LoadingIndicator';
import { contractDetails, contractTiers, contractAddresses, vaultAddresses, element280MainAbi, element280VaultAbi } from '@/app/nft-contracts';
import { Bar } from 'react-chartjs-2';
import Chart from 'chart.js/auto';
import { motion, AnimatePresence } from 'framer-motion';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { useNFTStore } from '../app/store';

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
          { address: contractAddress, abi: element280MainAbi, functionName: 'totalSupply' },
          { address: contractAddress, abi: element280MainAbi, functionName: 'getTotalNftsPerTiers' },
          { address: contractAddress, abi: element280MainAbi, functionName: 'multiplierPool' },
          { address: vaultAddress, abi: element280VaultAbi, functionName: 'totalRewardPool' },
        ],
      })
    );
    console.log(`[NFTPage] [DEBUG] multicall results: ${JSON.stringify(results, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)}`);
    const [totalSupply, tierCounts, multiplierPool, totalRewardPool] = results;
    if (totalSupply.status === 'failure') {
      throw new Error(`totalSupply call failed: ${totalSupply.error}`);
    }
    if (tierCounts.status === 'failure' || !tierCounts.result) {
      console.warn(`[NFTPage] [WARN] getTotalNftsPerTiers failed or returned no data: ${tierCounts.error || 'empty result'}`);
    }
    if (multiplierPool.status === 'failure' || !multiplierPool.result) {
      console.warn(`[NFTPage] [WARN] multiplierPool failed or returned no data: ${multiplierPool.error || 'empty result'}`);
    }
    if (totalRewardPool.status === 'failure') {
      throw new Error(`totalRewardPool call failed: ${totalRewardPool.error}`);
    }

    let burnedDistribution = [0, 0, 0, 0, 0, 0];
    let totalBurned = 0;
    try {
      const res = await fetch('/api/holders/Element280/validate-burned', { cache: 'no-store' });
      if (res.ok) {
        const reader = res.body.getReader();
        let events = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = new TextDecoder().decode(value);
          const lines = chunk.split('\n').filter(line => line);
          for (const line of lines) {
            const data = JSON.parse(line);
            if (data.event) {
              const tier = data.event.tier;
              if (tier >= 1 && tier <= 6) {
                burnedDistribution[tier - 1]++;
              }
            }
            if (data.complete) {
              events = data.result.events;
              totalBurned = data.result.burnedCount;
            }
          }
        }
        console.log(`[NFTPage] [DEBUG] Burned distribution: ${burnedDistribution}, total events: ${events.length}, totalBurned: ${totalBurned}`);
      } else {
        console.error(`[NFTPage] [ERROR] Failed to fetch burned distribution: ${res.status}`);
      }
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Burned distribution fetch error: ${err.message}, stack: ${err.stack}`);
    }

    return {
      totalMinted: Number(totalSupply.result) + totalBurned,
      totalBurned,
      totalLive: Number(totalSupply.result),
      tierDistribution: tierCounts.status === 'success' && tierCounts.result ? tierCounts.result.map(Number) : [0, 0, 0, 0, 0, 0],
      multiplierPool: multiplierPool.status === 'success' && multiplierPool.result ? Number(multiplierPool.result) : 0,
      totalRewardPool: Number(totalRewardPool.result) / 1e18,
      burnedDistribution,
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
      let progressData = { isPopulating: false, phase: 'Idle', progressPercentage: 0, totalOwners: 0 };
      if (isElement280) {
        try {
          console.log(`[NFTPage] [INFO] Fetching progress from ${apiEndpoint}/progress`);
          const res = await fetch(`${apiEndpoint}/progress`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
          if (!res.ok) {
            console.error(`[NFTPage] [ERROR] Progress fetch failed: ${res.status}`);
          } else {
            progressData = await res.json();
            if (progressData.totalOwners === 0 && progressData.phase === 'Idle') {
              console.log(`[NFTPage] [INFO] Stale progress, triggering cache refresh`);
              await fetch(apiEndpoint, { method: 'POST', cache: 'no-store' });
              const retryRes = await fetch(`${apiEndpoint}/progress`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
              if (retryRes.ok) progressData = await retryRes.json();
            }
          }
        } catch (err) {
          console.error(`[NFTPage] [ERROR] Progress fetch error: ${err.message}, stack: ${err.stack}`);
        }
        setProgress(progressData);
      }

      const cacheKey = `contract_data_${contractId}`;
      const cachedData = getCache(cacheKey);
      if (cachedData && cachedData.totalMinted > 0) {
        console.log(`[NFTPage] [INFO] Cache hit for ${cacheKey}`);
        setData(cachedData);
        setLoading(false);
        return;
      }

      let contractData;
      if (isElement280) {
        contractData = await fetchContractData();
      } else {
        // Placeholder for other contracts (unchanged)
        contractData = {
          totalMinted: 0,
          totalBurned: 0,
          totalLive: 0,
          tierDistribution: [0, 0, 0, 0, 0, 0],
          multiplierPool: 0,
          totalRewardPool: 0,
          burnedDistribution: [0, 0, 0, 0, 0, 0],
        };
        console.log(`[NFTPage] [INFO] Using placeholder data for non-Element280 contract: ${contractId}`);
      }

      setCache(cacheKey, contractData);
      setData(contractData);
      setLoading(false);
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Fetch error: ${err.message}, stack: ${err.stack}`);
      setError(`Failed to load ${name} data: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  };

  // Fetch holders data
  async function fetchAllHolders() {
    const cacheKey = `holders_${contractId}`;
    const cachedData = getCache(cacheKey);
    if (cachedData) {
      setData(prev => ({ ...prev, holders: cachedData.holders, summary: cachedData.summary }));
      setLoading(false);
      return;
    }
    console.log(`[NFTPage] [INFO] Cache miss for ${cacheKey}, fetching holders`);

    try {
      console.log(`[NFTPage] [INFO] Starting holders fetch for ${contractId} at ${apiEndpoint}`);

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
            totalClaimableRewards = json.totalClaimableRewards || totalClaimableRewards;
            totalInfernoRewards = json.totalInfernoRewards || totalInfernoRewards;
            totalFluxRewards = json.totalFluxRewards || totalFluxRewards;
            totalE280Rewards = json.totalE280Rewards || totalE280Rewards;
            summary = json.summary || summary;
            burnedNfts = json.burnedNfts || burnedNfts;
            totalPages = json.totalPages || 1;
            page++;
            success = true;
            if (!newHolders || newHolders.length === 0) break;
          } catch (err) {
            attempts++;
            console.error(`[NFTPage] [ERROR] Attempt ${attempts}/${maxAttempts} failed for page ${page}: ${err.message}`);
            if (attempts >= maxAttempts) {
              throw new Error(`Failed to fetch page ${page} after ${maxAttempts} attempts: ${err.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          }
        }
      }

      const holdersData = {
        holders: allHolders,
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

      setCache(cacheKey, holdersData);
      setData(prev => ({ ...prev, ...holdersData }));
      setLoading(false);
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Holders fetch error: ${err.message}, stack: ${err.stack}`);
      setError(`Failed to load holders data: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  }

  // Initial data fetch
  useEffect(() => {
    fetchData();
  }, [apiEndpoint, contractId, isElement280, disabled]);

  // Chart data for tier distribution
  const chartData = data && isElement280 ? {
    labels: ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6'],
    datasets: [
      {
        label: 'Live NFTs',
        data: data.tierDistribution || [0, 0, 0, 0, 0, 0],
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
      },
      {
        label: 'Burned NFTs',
        data: data.burnedDistribution || [0, 0, 0, 0, 0, 0],
        backgroundColor: 'rgba(255, 99, 132, 0.6)',
      },
    ],
  } : null;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-6">{name || 'Unknown Contract'} Holders</h1>

      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="w-full max-w-4xl"
          >
            <LoadingIndicator message={`Loading ${name} data... ${isElement280 ? `Phase: ${progress.phase} (${progress.progressPercentage}%)` : ''}`} />
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-red-500 text-lg mb-6"
        >
          {error}
        </motion.p>
      )}

      {!loading && !error && data && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-4xl"
        >
          <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
            <h2 className="text-2xl font-semibold mb-4">Contract Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p><strong>Total Minted:</strong> {data.totalMinted?.toLocaleString() || 'N/A'}</p>
                <p><strong>Total Live:</strong> {data.totalLive?.toLocaleString() || 'N/A'}</p>
                <p><strong>Total Burned:</strong> {data.totalBurned?.toLocaleString() || 'N/A'}</p>
              </div>
              <div>
                <p><strong>Multiplier Pool:</strong> {data.multiplierPool?.toLocaleString() || 'N/A'}</p>
                <p><strong>Total Reward Pool:</strong> {data.totalRewardPool?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || 'N/A'} {rewardToken}</p>
                <p><strong>Total Holders:</strong> {progress.totalOwners?.toLocaleString() || 'N/A'}</p>
              </div>
            </div>
            {isElement280 && (
              <div className="mt-4">
                <button
                  onClick={() => setShowChart(!showChart)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-200"
                >
                  {showChart ? 'Hide Tier Distribution' : 'Show Tier Distribution'}
                </button>
                {showChart && chartData && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4"
                  >
                    <Bar
                      data={chartData}
                      options={{
                        responsive: true,
                        plugins: {
                          legend: { position: 'top' },
                          title: { display: true, text: 'NFT Tier Distribution' },
                        },
                        scales: {
                          y: { beginAtZero: true, title: { display: true, text: 'Number of NFTs' } },
                          x: { title: { display: true, text: 'Tiers' } },
                        },
                      }}
                    />
                  </motion.div>
                )}
              </div>
            )}
          </div>

          <HolderTable
            holders={data.holders || []}
            totalPages={data.totalPages || 1}
            totalTokens={data.totalTokens || 0}
            totalLockedAscendant={data.totalLockedAscendant || 0}
            totalShares={data.totalShares || 0}
            toDistributeDay8={data.toDistributeDay8 || 0}
            toDistributeDay28={data.toDistributeDay28 || 0}
            toDistributeDay90={data.toDistributeDay90 || 0}
            pendingRewards={data.pendingRewards || 0}
            totalClaimableRewards={data.totalClaimableRewards || 0}
            totalInfernoRewards={data.totalInfernoRewards || 0}
            totalFluxRewards={data.totalFluxRewards || 0}
            totalE280Rewards={data.totalE280Rewards || 0}
            summary={data.summary || {}}
            burnedNfts={data.burnedNfts || []}
            rewardToken={rewardToken}
          />
        </motion.div>
      )}
    </div>
  );
}