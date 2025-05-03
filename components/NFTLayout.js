// File: components/NFTLayout.js
'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import config from '@/config.js';
import { useNFTStore } from '@/app/store';
import { useDebounce } from 'use-debounce';

// Dynamically import SearchResultsModal
const SearchResultsModal = dynamic(() => import('@/components/SearchResultsModal'), { ssr: false });

export default function NFTLayout({ children }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [showE280Message, setShowE280Message] = useState(false);
  const [searchAddress, setSearchAddress] = useState('');
  const [debouncedAddress] = useDebounce(searchAddress, 500);
  const [searchResults, setSearchResults] = useState({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const { getCache, setCache } = useNFTStore();

  useEffect(() => {
    setIsClient(true);
  }, []);

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

  const fetchSearchData = async (address, apiKey, apiEndpoint) => {
    console.log(`[NFTLayout] Fetching search data for ${apiKey} with address: ${address}`);
    try {
      if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
        console.log(`[NFTLayout] ${apiKey} is disabled`);
        return { error: `${apiKey} is not available` };
      }

      let endpoint = apiEndpoint;
      if (!endpoint || !endpoint.startsWith('http')) {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
        endpoint = `${baseUrl}${apiEndpoint}`;
        console.log(`[NFTLayout] Adjusted endpoint: ${endpoint}`);
      }

      const url = `${endpoint}?address=${encodeURIComponent(address)}`;
      console.log(`[NFTLayout] Fetching ${url}`);
      const res = await fetch(url, {
        cache: 'no-store', // Ensure fresh data for address-specific queries
        signal: AbortSignal.timeout(config.alchemy.timeoutMs || 30000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch ${url}: ${res.status} ${errorText}`);
      }

      const json = await res.json();
      console.log(`[NFTLayout] Response for ${apiKey}:`, json);

      if (json.error) {
        console.log(`[NFTLayout] API error for ${apiKey}: ${json.error}`);
        return { error: json.error };
      }

      if (!json.holders || !Array.isArray(json.holders)) {
        throw new Error(`Invalid holders data for ${url}`);
      }

      return {
        holders: json.holders,
        totalTokens: json.totalTokens || json.summary?.totalLive || 0,
        totalShares: json.totalShares || json.summary?.multiplierPool || 0,
        totalBurned: json.totalBurned || 0,
        summary: json.summary || {},
      };
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
      setIsModalOpen(false);
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
          searchResults[apiKey] = { error: `${apiKey} is not available` };
          console.log(`[NFTLayout] Skipping disabled contract ${apiKey}`);
          continue;
        }
  
        const contractConfig = config.contractDetails[apiKey] || {};
        const data = await fetchSearchData(lowerSearchAddress, apiKey, contractConfig.apiEndpoint);
  
        if (data.error) {
          searchResults[apiKey] = { error: data.error };
        } else {
          searchResults[apiKey] = {
            holders: data.holders || [],
            totalTokens: data.totalTokens,
            totalShares: apiKey === 'ascendant' ? data.totalShares : undefined,
            totalBurned: data.totalBurned,
            rewardToken: config.contractDetails[apiKey]?.rewardToken,
            summary: data.summary,
          };
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

  useEffect(() => {
    if (debouncedAddress && /^0x[a-fA-F0-9]{40}$/.test(debouncedAddress)) {
      handleSearch();
    }
  }, [debouncedAddress]);

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

  if (!isClient) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center bg-gray-900 min-h-screen">
        <h1 className="title mb-8">TitanX NFT Protocols</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 flex flex-col items-center bg-gray-900 min-h-screen">
      <h1 className="title mb-8">TitanX NFT Protocols</h1>

      <div className="w-full max-w-2xl mb-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value.trim())}
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

      <SearchResultsModal
        searchResult={searchResults}
        searchAddress={searchAddress}
        closeModal={() => setIsModalOpen(false)}
        handleBackgroundClick={(e) => e.target === e.currentTarget && setIsModalOpen(false)}
        isOpen={isModalOpen}
        isLoading={searchLoading}
      />

      <div className="w-full max-w-6xl mt-6">{children}</div>
    </div>
  );
}