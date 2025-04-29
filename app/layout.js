'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import SearchResultsModal from '@/components/SearchResultsModal';
import config from '@/config.js';
import { useNFTStore } from '@/app/store';

export default function NFTLayout({ children }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [showE280Message, setShowE280Message] = useState(false);
  const [searchAddress, setSearchAddress] = useState('');
  const [searchResults, setSearchResults] = useState({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { getCache, setCache } = useNFTStore();

  const chains = [
    { name: 'ETH', id: 'eth' },
    { name: 'BASE', id: 'base' },
  ];

  const ethNFTs = [
    { name: 'Element280', href: '/nft/ETH/Element280', apiKey: 'element280' },
    { name: 'Element369', href: '/nft/ETH/Element369', apiKey: 'element369' },
    { name: 'Stax', href: '/nft/ETH/Stax', apiKey: 'stax' },
    { name: 'Ascendant', href: '/nft/ETH/Ascendant', apiKey: 'ascendant' },
  ];

  const baseNFTs = [
    { name: 'E280', href: null, apiKey: 'e280' },
  ];

  const allNFTs = Object.keys(config.contractDetails).map((key) => ({
    name: config.contractDetails[key].name,
    apiKey: key,
    href:
      key === 'e280'
        ? null
        : `/nft/${key === 'e280' ? 'BASE' : 'ETH'}/${config.contractDetails[key].name.replace(/\s+/g, '')}`,
  }));

  // Fetch data for a single collection
  const fetchCollectionData = async (apiKey, apiEndpoint, pageSize) => {
    console.log(`[NFTLayout] Fetching data for ${apiKey} from ${apiEndpoint}`);
    try {
      if (apiKey === 'e280') {
        console.log(`[NFTLayout] ${apiKey} is disabled, returning empty data`);
        return { holders: [], totalTokens: 0, error: 'Contract not deployed' };
      }

      if (!apiEndpoint || !apiEndpoint.startsWith('http')) {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
        apiEndpoint = `${baseUrl}/api/holders/${apiKey}`;
        console.log(`[NFTLayout] Adjusted apiEndpoint to ${apiEndpoint}`);
      }

      let allHolders = [];
      let totalTokens = 0;
      let totalLockedAscendant = 0;
      let totalShares = 0;
      let toDistributeDay8 = 0;
      let toDistributeDay28 = 0;
      let toDistributeDay90 = 0;
      let pendingRewards = 0;
      let summary = {};
      let page = 0;
      let totalPages = Infinity;

      while (page < totalPages) {
        let attempts = 0;
        const maxAttempts = config.alchemy.maxRetries;
        let success = false;

        while (attempts < maxAttempts && !success) {
          try {
            const url = `${apiEndpoint}?page=${page}&pageSize=${pageSize}`;
            console.log(`[NFTLayout] Attempt ${attempts + 1} fetching ${url}`);
            const res = await fetch(url, {
              signal: AbortSignal.timeout(config.alchemy.timeoutMs),
            });
            if (!res.ok) {
              const errorText = await res.text();
              throw new Error(`Failed to fetch ${url}: ${res.status} ${errorText}`);
            }

            const json = await res.json();
            if (json.error) {
              console.log(`[NFTLayout] API error for ${apiKey}: ${json.error}`);
              return { error: json.error };
            }
            if (!json.holders || !Array.isArray(json.holders)) {
              throw new Error(`Invalid holders data for ${url}`);
            }

            allHolders = allHolders.concat(json.holders);
            totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
            totalLockedAscendant = json.totalLockedAscendant || totalLockedAscendant;
            totalShares = json.totalShares || json.summary?.multiplierPool || totalShares;
            toDistributeDay8 = json.toDistributeDay8 || toDistributeDay8;
            toDistributeDay28 = json.toDistributeDay28 || toDistributeDay28;
            toDistributeDay90 = json.toDistributeDay90 || toDistributeDay90;
            pendingRewards = json.pendingRewards || pendingRewards;
            summary = json.summary || summary;
            totalPages = json.totalPages || 1;
            page++;
            success = true;
            console.log(`[NFTLayout] Successfully fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
          } catch (err) {
            attempts++;
            console.log(`[NFTLayout] Fetch attempt ${attempts} failed for ${apiKey}: ${err.message}`);
            if (attempts >= maxAttempts) {
              throw new Error(`Failed to fetch page ${page} after ${maxAttempts} attempts: ${err.message}`);
            }
            await new Promise((resolve) => setTimeout(resolve, config.alchemy.batchDelayMs * attempts));
          }
        }
      }

      const data = {
        holders: allHolders,
        totalTokens,
        totalLockedAscendant,
        totalShares,
        toDistributeDay8,
        toDistributeDay28,
        toDistributeDay90,
        pendingRewards,
        summary,
      };
      console.log(`[NFTLayout] Setting cache for ${apiKey}: ${allHolders.length} holders`);
      setCache(apiKey, data);
      return data;
    } catch (error) {
      console.error(`[NFTLayout] Error fetching ${apiKey}: ${error.message}`);
      return { error: error.message };
    }
  };

  const handleSearch = async () => {
    console.log('[NFTLayout] handleSearch called with address:', searchAddress);
    if (!searchAddress || !/^0x[a-fA-F0-9]{40}$/.test(searchAddress)) {
      setError('Please enter a valid Ethereum address (e.g., 0x...)');
      setSearchResults({});
      return;
    }

    setSearchLoading(true);
    setError(null);
    setSearchResults({});

    try {
      const searchResults = {};
      const lowerSearchAddress = searchAddress.toLowerCase();

      for (const { apiKey } of allNFTs) {
        if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
          searchResults[apiKey] = { message: `${apiKey} data not available` };
          console.log(`[NFTLayout] Skipping disabled contract ${apiKey}`);
          continue;
        }

        let data = getCache(apiKey);
        console.log(`[NFTLayout] Cache check for ${apiKey}: ${data ? 'hit' : 'miss'}`);
        if (!data) {
          const contractConfig = config.contractDetails[apiKey] || {};
          data = await fetchCollectionData(apiKey, contractConfig.apiEndpoint, contractConfig.pageSize);
        }

        if (data.error) {
          searchResults[apiKey] = { error: data.error };
        } else {
          const holder = data.holders.find(
            (h) => h && h.wallet && h.wallet.toLowerCase() === lowerSearchAddress
          );
          searchResults[apiKey] = holder
            ? {
                ...holder,
                totalShares: apiKey === 'ascendant' ? data.totalShares : undefined,
                totalTokens: data.totalTokens,
                rewardToken: config.contractDetails[apiKey]?.rewardToken,
              }
            : { message: 'No holdings found' };
          console.log(`[NFTLayout] ${apiKey} search result:`, searchResults[apiKey]);
        }
      }

      setSearchResults(searchResults);
      setIsModalOpen(true);
    } catch (err) {
      console.error('[NFTLayout] Search error:', err.message, err.stack);
      setError(`Search failed: ${err.message}`);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleChainSelect = (chainId) => {
    console.log('[NFTLayout] Chain selected:', chainId);
    setShowE280Message(false);
    setSelectedChain(chainId === selectedChain ? null : chainId);
  };

  const handleE280Click = () => {
    console.log('[NFTLayout] E280 button clicked, selectedChain:', selectedChain);
    if (selectedChain === 'base') {
      setShowE280Message(true);
    }
  };

  const handleCollectionClick = (name, href) => {
    console.log(`[NFTLayout] Collection button clicked: ${name}, href: ${href}`);
    setShowE280Message(false);
  };

  const handleClearCache = () => {
    try {
      console.log('[NFTLayout] Before clear cache:', useNFTStore.getState().cache);
      useNFTStore.getState().clearCache();
      console.log('[NFTLayout] After clear cache:', useNFTStore.getState().cache);
      setSearchResults({});
      setError('Cache cleared. Please reload or search again to repopulate cache.');
    } catch (err) {
      console.error('[NFTLayout] Clear cache error:', err.message, err.stack);
      setError('Failed to clear cache: ' + err.message);
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col items-center bg-gray-900 min-h-screen">
      <h1 className="title mb-8">TitanX NFT Protocols</h1>

      <div className="w-full max-w-2xl mb-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            placeholder="Search by wallet address (e.g., 0x...)"
            className="search-input"
            disabled={searchLoading}
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSearch}
            disabled={searchLoading}
            className={`btn btn-primary ${searchLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {searchLoading ? 'Searching...' : 'Search'}
          </motion.button>
        </div>
        {error && <p className="text-error mt-2">{error}</p>}
      </div>

      <div className="flex space-x-4 mb-6">
        {chains.map((chain) => (
          <motion.button
            key={chain.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleChainSelect(chain.id)}
            className={`btn btn-secondary ${
              selectedChain === chain.id ? 'bg-blue-500 text-gray-100' : ''
            }`}
          >
            {chain.name}
          </motion.button>
        ))}
      </div>

      {selectedChain === 'eth' && (
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0 w-full max-w-6xl">
          {ethNFTs.map((nft) => (
            <Link key={nft.name} href={nft.href} className="flex-1">
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleCollectionClick(nft.name, nft.href)}
                className="btn btn-secondary w-full"
              >
                {nft.name}
              </motion.button>
            </Link>
          ))}
        </div>
      )}
      {selectedChain === 'base' && (
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0 w-full max-w-6xl">
          {baseNFTs.map((nft) =>
            nft.href ? (
              <Link key={nft.name} href={nft.href} className="flex-1">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleCollectionClick(nft.name, nft.href)}
                  className="btn btn-secondary w-full"
                >
                  {nft.name}
                </motion.button>
              </Link>
            ) : (
              <motion.button
                key={nft.name}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleE280Click}
                className="btn btn-secondary flex-1 w-full"
              >
                {nft.name}
              </motion.button>
            )
          )}
        </div>
      )}
      {showE280Message && selectedChain === 'base' && (
        <div className="mt-6 text-center text-gray-100">
          <p className="text-body">Contract not yet deployed. Coming soon...</p>
        </div>
      )}

      {isModalOpen && (
        <SearchResultsModal
          searchResult={searchResults}
          searchAddress={searchAddress}
          closeModal={() => setIsModalOpen(false)}
          handleBackgroundClick={(e) => e.target === e.currentTarget && setIsModalOpen(false)}
        />
      )}

      <button
        onClick={handleClearCache}
        className="mt-6 btn btn-secondary"
      >
        Clear Client Cache
      </button>
      <div className="w-full max-w-6xl mt-6">{children}</div>
    </div>
  );
}