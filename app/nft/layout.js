// app/nft/layout.js
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [isCacheReady, setIsCacheReady] = useState(false);
  const hasRun = useRef(false);

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

  // Populate mock cache
  useEffect(() => {
    if (!hasRun.current) {
      const mockData = {
        element280: {
          holders: [
            {
              wallet: '0x1234567890abcdef1234567890abcdef12345678',
              rank: 1,
              total: 5,
              claimableRewards: 1000,
              percentage: 2.5,
              displayMultiplierSum: 60,
              tiers: [2, 1, 1, 1, 0, 0],
            },
          ],
          totalTokens: 7,
          summary: { totalLive: 7, totalBurned: 0, totalRewardPool: 1500 },
        },
        element369: {
          holders: [
            {
              wallet: '0x1234567890abcdef1234567890abcdef12345678',
              rank: 1,
              total: 3,
              infernoRewards: 1.5,
              fluxRewards: 2.0,
              e280Rewards: 0.5,
              percentage: 1.0,
              multiplierSum: 30,
              tiers: [1, 1, 1],
            },
          ],
          totalTokens: 3,
          summary: { totalLive: 3, totalBurned: 0, totalRewardPool: 4 },
        },
        stax: {
          holders: [
            {
              wallet: '0x1234567890abcdef1234567890abcdef12345678',
              rank: 1,
              total: 1,
              claimableRewards: 200,
              percentage: 0.5,
              multiplierSum: 100,
              tiers: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
            },
          ],
          totalTokens: 1,
          summary: { totalLive: 1, totalBurned: 0, totalRewardPool: 200 },
        },
        ascendant: {
          holders: [
            {
              wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
              rank: 1,
              total: 4,
              claimableRewards: 500,
              shares: 400,
              pendingDay8: 100,
              pendingDay28: 200,
              pendingDay90: 200,
              tiers: [0, 0, 0, 0, 0, 0, 0, 4],
            },
          ],
          totalTokens: 4,
          totalShares: 400,
          summary: { totalLive: 4, totalBurned: 0, totalRewardPool: 300 },
        },
        e280: {
          holders: [],
          totalTokens: 0,
          message: 'E280 data not available yet',
        },
      };
      Object.entries(mockData).forEach(([key, data]) => {
        console.log(`[NFTLayout] Setting cache for ${key}: ${data.holders.length} holders`);
        setCache(key, data);
      });
      setIsCacheReady(true);
      hasRun.current = true;
    }
  }, [setCache]);

  const waitForCache = async () => {
    if (isCacheReady) return;
    console.log('[NFTLayout] Waiting for cache to be ready...');
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const cacheStatus = allNFTs.map((nft) => {
          const data = getCache(nft.apiKey);
          return data && (nft.apiKey === 'e280' || data.holders?.length >= 0);
        });
        if (cacheStatus.every((status) => status)) {
          console.log('[NFTLayout] Cache is ready');
          setIsCacheReady(true);
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });
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
      await waitForCache();

      const searchResults = {};
      const lowerSearchAddress = searchAddress.toLowerCase();
      allNFTs.forEach(({ apiKey }) => {
        if (apiKey === 'e280') {
          searchResults[apiKey] = { message: 'E280 data not available yet' };
          return;
        }
        const data = getCache(apiKey);
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
            : null;
          console.log(`[NFTLayout] ${apiKey} search result:`, searchResults[apiKey] || 'not found');
        }
      });

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
      setIsCacheReady(false);
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
        {!isCacheReady && (
          <p className="text-body mt-2">Cache is loading, results will be available soon...</p>
        )}
      </div>

      <div className="flex space-x-4 mb-6">
        {chains.map((chain) => (
          <motion.button
            key={chain.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleChainSelect(chain.id)}
            className={`btn btn-secondary ${
              selectedChain === chain.id ? 'bg-blue-500 text-white' : ''
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
        <div className="mt-6 text-center text-white">
          <p className="text-lg">Contract not yet deployed. Coming soon...</p>
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