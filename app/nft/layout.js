'use client';
import { useState, useCallback } from 'react';
import SearchResultsModal from '@/components/SearchResultsModal';
import config from '@/config';
import dynamic from 'next/dynamic';

// Dynamic HolderTable components
const holderTableComponents = {
  element280: dynamic(
    () => import('@/components/HolderTable/Element280').catch((err) => {
      console.error('Failed to load Element280 HolderTable:', err);
      return { default: () => <div className="text-error">Error loading data for Element280</div> };
    }),
    { ssr: false, loading: () => <div className="text-body">Loading Element280 data...</div> }
  ),
  element369: dynamic(
    () => import('@/components/HolderTable/Element369').catch((err) => {
      console.error('Failed to load Element369 HolderTable:', err);
      return { default: () => <div className="text-error">Error loading data for Element369</div> };
    }),
    { ssr: false, loading: () => <div className="text-body">Loading Element369 data...</div> }
  ),
  stax: dynamic(
    () => import('@/components/HolderTable/Stax').catch((err) => {
      console.error('Failed to load Stax HolderTable:', err);
      return { default: () => <div className="text-error">Error loading data for Stax</div> };
    }),
    { ssr: false, loading: () => <div className="text-body">Loading Stax data...</div> }
  ),
  ascendant: dynamic(
    () => import('@/components/HolderTable/Ascendant').catch((err) => {
      console.error('Failed to load Ascendant HolderTable:', err);
      return { default: () => <div className="text-error">Error loading data for Ascendant</div> };
    }),
    { ssr: false, loading: () => <div className="text-body">Loading Ascendant data...</div> }
  ),
};

export default function NFTLayout({ children }) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchAddress, setSearchAddress] = useState('');
  const [searchResult, setSearchResult] = useState({});
  const [selectedChain, setSelectedChain] = useState(null);
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [collectionData, setCollectionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSearchResults = useCallback(async (address) => {
    const collections = [
      { apiKey: 'element280', name: 'Element280' },
      { apiKey: 'element369', name: 'Element369' },
      { apiKey: 'stax', name: 'Stax' },
      { apiKey: 'ascendant', name: 'Ascendant' },
    ];

    const results = {};
    for (const { apiKey } of collections) {
      try {
        const contractConfig = config.contractDetails[apiKey];
        if (!contractConfig || contractConfig.disabled) {
          results[apiKey] = { message: `${apiKey} is disabled` };
          continue;
        }

        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
        const url = `${baseUrl}/api/holders/${apiKey}`;
        console.log(`Fetching holders for ${apiKey}: ${url}`);
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Fetch failed for ${apiKey}: ${response.status} - ${errorText}`);
          results[apiKey] = { error: `Failed to fetch data: ${response.status} - ${errorText}` };
          continue;
        }
        const data = await response.json();
        console.log(`Holders data for ${apiKey}:`, data);
        if (data.holders && data.holders.length > 0) {
          console.log(`First holder for ${apiKey}:`, data.holders[0]);
        }

        // Check if holders is an array
        if (!Array.isArray(data.holders)) {
          console.error(`Invalid holders format for ${apiKey}:`, data.holders);
          results[apiKey] = { error: 'Invalid holders data format' };
          continue;
        }

        // Filter holders by address
        const filteredHolders = data.holders.filter(
          (holder) => {
            const holderAddress = holder.address || holder.ownerAddress;
            if (!holderAddress) {
              console.warn(`No address field in holder for ${apiKey}:`, holder);
              return false;
            }
            return holderAddress.toLowerCase() === address.toLowerCase();
          }
        );
        results[apiKey] = filteredHolders.length > 0
          ? {
              holders: filteredHolders,
              totalBurned: data.totalBurned || 0,
              timestamp: data.timestamp || Date.now(),
            }
          : { message: 'No NFTs owned in this collection' };
      } catch (error) {
        console.error(`Error fetching ${apiKey} data for ${address}:`, error);
        results[apiKey] = { error: error.message };
      }
    }
    setSearchResult(results);
  }, []);

  const fetchCollectionData = useCallback(async (apiKey, retries = 2) => {
    setLoading(true);
    setError(null);
    setCollectionData(null);

    const contractConfig = config.contractDetails[apiKey];
    if (!contractConfig || contractConfig.disabled) {
      setError(`${apiKey} is disabled`);
      setLoading(false);
      return;
    }

    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
    const endpoints = [
      `${baseUrl}/api/holders/${apiKey}`,
    ];

    for (let attempt = 1; attempt <= retries; attempt++) {
      for (const url of endpoints) {
        try {
          console.log(`Fetching collection data (attempt ${attempt}) for ${apiKey}: ${url}`);
          const response = await fetch(url, { cache: 'force-cache' });
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Fetch failed for ${apiKey}: ${response.status} - ${errorText}`);
            throw new Error(`Failed to fetch data: ${response.status} - ${errorText}`);
          }
          const data = await response.json();
          console.log(`Collection data for ${apiKey}:`, data);
          if (data.holders && data.holders.length > 0) {
            console.log(`First holder for ${apiKey}:`, data.holders[0]);
          }

          if (!data || !Array.isArray(data.holders)) {
            console.warn(`No valid holders data for ${apiKey}:`, data);
            setError(`No holder data available for ${config.nftContracts[apiKey].name}`);
            setCollectionData({
              holders: [],
              totalTokens: data.totalTokens || data.totalBurned || 0,
              totalShares: data.totalBurned || 0,
              summary: data.summary || {},
            });
            setLoading(false);
            return;
          }

          setCollectionData({
            holders: data.holders.map((holder) => ({
              ...holder,
              address: holder.address || holder.ownerAddress,
            })) || [],
            totalTokens: data.totalTokens || data.totalBurned || 0,
            totalShares: data.totalBurned || 0,
            summary: data.summary || {},
          });
          setLoading(false);
          return;
        } catch (error) {
          console.error(`Attempt ${attempt} failed for ${apiKey} at ${url}:`, error);
          if (attempt === retries && url === endpoints[endpoints.length - 1]) {
            setError(error.message || `Failed to fetch data for ${config.nftContracts[apiKey].name}`);
            setCollectionData({
              holders: [],
              totalTokens: 0,
              totalShares: 0,
              summary: {},
            });
            setLoading(false);
          }
        }
      }
    }
  }, []);

  const openSearchModal = async () => {
    if (searchAddress && searchAddress.length === 42 && searchAddress.startsWith('0x')) {
      await fetchSearchResults(searchAddress);
      setIsSearchOpen(true);
    }
  };

  const closeSearchModal = () => {
    setIsSearchOpen(false);
    setSearchAddress('');
    setSearchResult({});
  };

  const handleBackgroundClick = (e) => {
    if (e.target.classList.contains('modal-overlay')) {
      closeSearchModal();
    }
  };

  const handleChainSelect = (chain) => {
    setSelectedChain(chain);
    setSelectedCollection(null);
    setCollectionData(null);
  };

  const handleCollectionSelect = (collection) => {
    setSelectedCollection(collection);
    fetchCollectionData(collection);
  };

  const availableCollections = Object.keys(config.nftContracts)
    .filter(
      (key) => !config.nftContracts[key].disabled && config.nftContracts[key].chain === selectedChain
    )
    .map((key) => ({
      apiKey: key,
      name: config.nftContracts[key].name,
    }));

  return (
    <>
      <div className="container mx-auto py-4">
        {/* Centered Search Box */}
        <div className="flex justify-center mb-4">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            placeholder="Enter wallet address (0x...)"
            className="px-4 py-2 bg-gray-800 text-gray-100 rounded-l-md focus:outline-none focus:ring-2 focus:ring-blue-600 w-64"
          />
          <button
            onClick={openSearchModal}
            disabled={!searchAddress || searchAddress.length !== 42 || !searchAddress.startsWith('0x')}
            className="px-4 py-2 bg-blue-600 text-white rounded-r-md hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Search
          </button>
        </div>

        {/* Chain Buttons */}
        <div className="flex justify-center gap-4 mb-4">
          {config.supportedChains.map((chain) => (
            <button
              key={chain}
              onClick={() => handleChainSelect(chain)}
              className={`px-4 py-2 rounded-md ${
                selectedChain === chain
                  ? 'bg-blue-700 text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              } transition`}
            >
              {chain}
            </button>
          ))}
        </div>

        {/* NFT Collection Buttons */}
        {selectedChain && (
          <div className="flex justify-center flex-wrap gap-4 mb-4">
            {availableCollections.length > 0 ? (
              availableCollections.map(({ apiKey, name }) => (
                <button
                  key={apiKey}
                  onClick={() => handleCollectionSelect(apiKey)}
                  className={`px-4 py-2 rounded-md ${
                    selectedCollection === apiKey
                      ? 'bg-blue-700 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } transition`}
                >
                  {name}
                </button>
              ))
            ) : (
              <p className="text-gray-100">No collections available for {selectedChain}</p>
            )}
          </div>
        )}
      </div>

      {/* Holder Table for Selected Collection */}
      <main className="flex-grow container page-content">
        {selectedCollection && (
          <div className="mb-4">
            {loading ? (
              <p className="text-body">Loading {config.nftContracts[selectedCollection].name} data...</p>
            ) : error ? (
              <p className="text-error">{error}</p>
            ) : collectionData ? (
              (() => {
                const HolderTable = holderTableComponents[selectedCollection];
                return (
                  <HolderTable
                    holders={collectionData.holders || []}
                    contract={selectedCollection}
                    loading={false}
                    totalTokens={collectionData.totalTokens || 0}
                    totalShares={collectionData.totalShares || 0}
                    rewardToken={config.contractDetails[selectedCollection]?.rewardToken}
                  />
                );
              })()
            ) : (
              <p className="text-body">No data available for ${config.nftContracts[selectedCollection].name}</p>
            )}
          </div>
        )}
      </main>

      {/* Search Modal */}
      {isSearchOpen && (
        <SearchResultsModal
          searchResult={searchResult}
          searchAddress={searchAddress}
          closeModal={closeSearchModal}
          handleBackgroundClick={handleBackgroundClick}
        />
      )}
    </>
  );
}