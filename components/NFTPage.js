'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import LoadingIndicator from '@/components/LoadingIndicator';
import config from '@/config.js';
import { motion, AnimatePresence } from 'framer-motion';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { useNFTStore } from '@/app/store';
import { barChartOptions } from '@/lib/chartOptions';

// Dynamically import chart component
const Bar = dynamic(() => import('react-chartjs-2').then(mod => mod.Bar), { ssr: false });

// Default timeout for fetches
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

// Retry utility
async function retry(fn, attempts = config.alchemy.maxRetries, delay = (retryCount) => Math.min(config.alchemy.batchDelayMs * 2 ** retryCount, config.alchemy.retryMaxDelayMs)) {
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
  const contractAddress = config.contractAddresses.element280.address;
  const vaultAddress = config.vaultAddresses.element280.address;
  console.log(`[NFTPage] [INFO] Fetching contract data for Element280: contract=${contractAddress}, vault=${vaultAddress}`);
  if (!contractAddress || !vaultAddress) {
    throw new Error('Element280 contract or vault address not configured');
  }
  if (!config.alchemy.apiKey) {
    throw new Error('Alchemy API key not configured');
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`, { timeout: Number.isFinite(config.alchemy.timeoutMs) ? config.alchemy.timeoutMs : DEFAULT_TIMEOUT_MS }),
  });

  try {
    const results = await retry(() =>
      client.multicall({
        contracts: [
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'totalSupply' },
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'getTotalNftsPerTiers' },
          { address: contractAddress, abi: config.abis.element280.main, functionName: 'multiplierPool' },
          { address: vaultAddress, abi: config.abis.element280.vault, functionName: 'totalRewardPool' },
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
      const res = await fetch('/api/holders/Element280/validate-burned', { cache: 'force-cache', signal: AbortSignal.timeout(Number.isFinite(config.alchemy.timeoutMs) ? config.alchemy.timeoutMs : DEFAULT_TIMEOUT_MS) });
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
  e280: dynamic(() => import('./HolderTable/E280'), { ssr: false }),
  ascendant: dynamic(() => import('./HolderTable/Ascendant'), { ssr: false }),
  element280: dynamic(() => import('./HolderTable/Element280'), { ssr: false }),
  element369: dynamic(() => import('./HolderTable/Element369'), { ssr: false }),
  stax: dynamic(() => import('./HolderTable/Stax'), { ssr: false }),
};

export default function NFTPage({ chain, contract }) {
  console.log(`[NFTPage] [INFO] Received props: chain=${chain}, contract=${contract}`);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showChart, setShowChart] = useState(false);
  const [progress, setProgress] = useState({ isPopulating: true, totalWallets: 0, totalOwners: 0, phase: 'Initializing', progressPercentage: 0 });
  const [isInvalidContract, setIsInvalidContract] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Call useNFTStore unconditionally
  const { getCache, setCache } = useNFTStore();
  // Use useMemo to stabilize effectiveGetCache and effectiveSetCache
  const effectiveGetCache = useMemo(() => (isClient ? getCache : () => null), [isClient, getCache]);
  const effectiveSetCache = useMemo(() => (isClient ? setCache : () => {}), [isClient, setCache]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const contractId = contract ? contract.toLowerCase() : null;
  console.log(`[NFTPage] [INFO] Derived contractId: ${contractId}`);

  const contractConfig = config.contractDetails[contractId] || {};
  const { name, apiEndpoint, rewardToken, pageSize, disabled } = contractConfig;
  const isElement280 = contractId === 'element280';

  const fetchData = useCallback(async () => {
    if (!apiEndpoint) {
      console.error(`[NFTPage] [ERROR] Invalid contract configuration for ${contractId}`);
      setError('Invalid contract configuration');
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
          const res = await fetch(`${apiEndpoint}/progress`, { cache: 'force-cache', signal: AbortSignal.timeout(Number.isFinite(config.alchemy.timeoutMs) ? config.alchemy.timeoutMs : DEFAULT_TIMEOUT_MS) });
          if (!res.ok) {
            console.error(`[NFTPage] [ERROR] Progress fetch failed: ${res.status}`);
          } else {
            progressData = await res.json();
            if (progressData.totalOwners === 0 && progressData.phase === 'Idle') {
              console.log(`[NFTPage] [INFO] Stale progress, triggering cache refresh`);
              await fetch(apiEndpoint, { method: 'POST', cache: 'force-cache' });
              const retryRes = await fetch(`${apiEndpoint}/progress`, { cache: 'force-cache', signal: AbortSignal.timeout(Number.isFinite(config.alchemy.timeoutMs) ? config.alchemy.timeoutMs : DEFAULT_TIMEOUT_MS) });
              if (retryRes.ok) progressData = await retryRes.json();
            }
          }
        } catch (err) {
          console.error(`[NFTPage] [ERROR] Progress fetch error: ${err.message}, stack: ${err.stack}`);
        }
        setProgress(progressData);
      }

      const cacheKey = `contract_data_${contractId}`;
      const cachedData = isClient ? effectiveGetCache(cacheKey) : null;
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

      if (isClient) {
        effectiveSetCache(cacheKey, contractData);
      }
      setData(contractData);
      setLoading(false);
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Fetch error: ${err.message}, stack: ${err.stack}`);
      setError(`Failed to load ${name} data: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  }, [apiEndpoint, contractId, isElement280, isClient, effectiveGetCache, effectiveSetCache, name]);

  const fetchAllHolders = useCallback(async () => {
    const cacheKey = `holders_${contractId}`;
    const cachedData = isClient ? effectiveGetCache(cacheKey) : null;
    if (cachedData) {
      console.log(`[NFTPage] [INFO] Cache hit for ${cacheKey}, holders: ${cachedData.holders.length}`);
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
      const effectivePageSize = pageSize || config.contractDetails[contractId]?.pageSize;

      let progressData = await fetch(`${apiEndpoint}/progress`, { cache: 'force-cache', signal: AbortSignal.timeout(Number.isFinite(config.alchemy.timeoutMs) ? config.alchemy.timeoutMs : DEFAULT_TIMEOUT_MS) }).then(res => res.json()).catch(() => ({}));
      if (progressData.phase === 'Idle' || progressData.totalOwners === 0) {
        console.log(`[NFTPage] [INFO] Cache is Idle or empty, triggering POST`);
        await fetch(apiEndpoint, { method: 'POST', cache: 'force-cache' });
      }

      while (page < totalPages) {
        let attempts = 0;
        const maxAttempts = config.alchemy.maxRetries;
        let success = false;

        while (attempts < maxAttempts && !success) {
          try {
            const url = `${apiEndpoint}?page=${page}&pageSize=${effectivePageSize}`;
            console.log(`[NFTPage] [INFO] Fetching ${contractId} page ${page} at ${url}`);
            const res = await fetch(url, { cache: 'force-cache', signal: AbortSignal.timeout(Number.isFinite(config.alchemy.timeoutMs) ? config.alchemy.timeoutMs : DEFAULT_TIMEOUT_MS) });
            if (!res.ok) {
              const errorText = await res.text();
              console.error(`[NFTPage] [ERROR] Fetch failed for ${url}: ${res.status} - ${errorText}`);
              throw new Error(`Page ${page} failed with status: ${res.status} - ${errorText}`);
            }

            const json = await res.json();
            console.log(`[NFTPage] [DEBUG] API response for ${url}: holders=${json.holders?.length}, totalTokens=${json.totalTokens}`);
            if (json.error) {
              console.error(`[NFTPage] [ERROR] API error for ${url}: ${json.error}`);
              throw new Error(json.error);
            }
            if (!json.holders || !Array.isArray(json.holders)) {
              console.error(`[NFTPage] [ERROR] Invalid holders data for ${url}: ${JSON.stringify(json, null, 2)}`);
              await fetch(apiEndpoint, { method: 'POST', cache: 'force-cache' });
              throw new Error(`Invalid holders data: retrying after POST`);
            }
            const newHolders = json.holders;
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
            if (!newHolders.length && json.totalPages === 0) {
              console.log(`[NFTPage] [INFO] Empty holders with zero pages, accepting as valid`);
              break;
            }
          } catch (err) {
            attempts++;
            console.error(`[NFTPage] [ERROR] Attempt ${attempts}/${maxAttempts} failed for page ${page}: ${err.message}`);
            if (attempts >= maxAttempts) {
              throw new Error(`Failed to fetch page ${page} after ${maxAttempts} attempts: ${err.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs * attempts));
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

      console.log(`[NFTPage] [INFO] Fetched ${allHolders.length} holders for ${contractId}`);
      if (isClient) {
        effectiveSetCache(cacheKey, holdersData);
      }
      setData(prev => ({ ...prev, ...holdersData }));
      setLoading(false);
    } catch (err) {
      console.error(`[NFTPage] [ERROR] Holders fetch error: ${err.message}, stack: ${err.stack}`);
      setError(`Failed to load ${name} data: ${err.message}. Please try again later.`);
      setLoading(false);
    }
  }, [apiEndpoint, contractId, isClient, effectiveGetCache, effectiveSetCache, name, pageSize]);

  useEffect(() => {
    if (!contractId || !config.contractDetails[contractId]) {
      console.error(`[NFTPage] [ERROR] Invalid or missing contract: chain=${chain}, contract=${contract}`);
      setIsInvalidContract(true);
      setLoading(false);
    } else if (disabled) {
      console.log(`[NFTPage] [INFO] Contract ${name} is disabled`);
      setError(`${name} is not yet supported (contract not deployed).`);
      setLoading(false);
    } else {
      setIsInvalidContract(false);
      fetchData();
      fetchAllHolders();
    }
  }, [contractId, chain, contract, disabled, name, fetchData, fetchAllHolders]);

  if (!isClient) {
    return (
      <div className="container page-content">
        <h1 className="title mb-6">{name || 'Unknown Contract'} Holders</h1>
        <p>Loading...</p>
      </div>
    );
  }

  const HolderTable = holderTableComponents[contractId] || null;

  const chartData = data && isElement280 ? {
    labels: ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Tier 5', 'Tier 6'],
    datasets: [
      {
        label: 'Live NFTs',
        data: data.tierDistribution || [0, 0, 0, 0, 0, 0],
        backgroundColor: 'rgba(96, 165, 250, 0.6)', // text-blue-400
      },
      {
        label: 'Burned NFTs',
        data: data.burnedDistribution || [0, 0, 0, 0, 0, 0],
        backgroundColor: 'rgba(248, 113, 113, 0.6)', // text-red-400
      },
    ],
  } : null;

  if (isInvalidContract) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="container text-center-section"
      >
        <h1 className="title mb-4">Invalid Contract</h1>
        <p className="text-error text-lg">
          The contract "{contractId || 'none specified'}" is not supported.
        </p>
      </motion.div>
    );
  }

  if (!HolderTable) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="container text-center-section"
      >
        <h1 className="title mb-4">{name || 'Unknown Contract'} Holders</h1>
        <p className="text-error text-lg">
          Error: Holder table component for {contractId} not found.
        </p>
      </motion.div>
    );
  }

  // Define props for each HolderTable component
  const holderTableProps = {
    e280: { holders: data?.holders || [], loading, totalTokens: data?.totalTokens || 0, rewardToken },
    ascendant: { holders: data?.holders || [], loading, totalShares: data?.totalShares || 0, totalTokens: data?.totalTokens || 0, rewardToken },
    element280: { holders: data?.holders || [], loading, totalTokens: data?.totalTokens || 0, rewardToken },
    element369: { holders: data?.holders || [], loading, totalTokens: data?.totalTokens || 0, rewardToken },
    stax: { holders: data?.holders || [], loading, totalTokens: data?.totalTokens || 0, rewardToken },
  };

  return (
    <div className="container page-content">
      <motion.h1
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="title mb-6"
      >
        {name || 'Unknown Contract'} Holders
      </motion.h1>

      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="card text-center-section"
          >
            <LoadingIndicator
              status={`Loading ${name} data... ${
                isElement280 ? `Phase: ${progress.phase} (${progress.progressPercentage}%)` : ''
              }`}
              progress={progress}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="text-error text-lg mb-6 text-center"
        >
          {error}
        </motion.p>
      )}

      {!loading && !error && data && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-section"
        >
          <div className="card">
            <h2 className="subtitle mb-4">Contract Summary</h2>
            <div className="grid-responsive text-body">
              <div>
                <p>
                  <strong>Total Minted:</strong> {data.totalMinted?.toLocaleString() || 'N/A'}
                </p>
                <p>
                  <strong>Total Live:</strong> {data.totalLive?.toLocaleString() || 'N/A'}
                </p>
                <p>
                  <strong>Total Burned:</strong> {data.totalBurned?.toLocaleString() || 'N/A'}
                </p>
              </div>
              <div>
                <p>
                  <strong>Multiplier Pool:</strong>{' '}
                  {data.multiplierPool?.toLocaleString() || 'N/A'}
                </p>
                <p>
                  <strong>Total Reward Pool:</strong>{' '}
                  {data.totalRewardPool?.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }) || 'N/A'}{' '}
                  {rewardToken}
                </p>
                <p>
                  <strong>Total Holders:</strong>{' '}
                  {progress.totalOwners?.toLocaleString() || 'N/A'}
                </p>
              </div>
            </div>
            {isElement280 && (
              <div className="mt-6">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowChart(!showChart)}
                  className="btn btn-primary"
                >
                  {showChart ? 'Hide Tier Distribution' : 'Show Tier Distribution'}
                </motion.button>
                <AnimatePresence>
                  {showChart && chartData && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="chart-container mt-6"
                    >
                      <Bar data={chartData} options={barChartOptions} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="subtitle mb-4">Holders</h2>
            <HolderTable {...holderTableProps[contractId]} />
          </div>
        </motion.div>
      )}
    </div>
  );
}