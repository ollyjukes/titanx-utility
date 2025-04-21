// app/nft/layout.js
'use client';
import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import SearchResultsModal from '@/components/SearchResultsModal';
import { contractDetails } from '@/app/nft-contracts';
import { useNFTStore } from '@/app/store';

export default function NFTLayout({ children }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [showE280Message, setShowE280Message] = useState(false);
  const [searchAddress, setSearchAddress] = useState('');
  const [searchResults, setSearchResults] = useState({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasRun = useRef(false);

  const { getCache, setCache } = useNFTStore();

  const chains = [
    { name: 'ETH', id: 'eth' },
    { name: 'BASE', id: 'base' },
  ];

  const ethNFTs = [
    { name: 'Element280', href: '/nft/ETH/Element280', apiKey: 'element280' },
    { name: 'Element369', href: '/nft/ETH/Element369', apiKey: 'element369' },
    { name: 'Stax', href: '/nft/ETH/Stax', apiKey: 'staxNFT' },
    { name: 'Ascendant', href: '/nft/ETH/Ascendant', apiKey: 'ascendantNFT' },
  ];

  const baseNFTs = [
    { name: 'E280', href: null, apiKey: 'e280' },
  ];

  const allNFTs = Object.keys(contractDetails).map((key) => ({
    name: contractDetails[key].name,
    apiKey: key,
    href: key === 'e280' ? null : `/nft/${key === 'e280' ? 'BASE' : 'ETH'}/${contractDetails[key].name.replace(/\s+/g, '')}`,
  }));

  const fetchCollectionData = async (contractKey) => {
    console.log(`[NFTLayout] Fetching data for ${contractKey}`);
    // Bypass cache for ascendantNFT to ensure fresh data
    if (contractKey !== 'ascendantNFT') {
      const cachedData = getCache(contractKey);
      if (cachedData) {
        console.log(`[NFTLayout] Using cached data for ${contractKey}: ${cachedData.holders.length} holders`);
        return cachedData;
      }
    } else {
      console.log(`[NFTLayout] Bypassing cache for ascendantNFT to ensure fresh sorting`);
    }
  
    if (contractKey === 'e280') {
      console.log(`[NFTLayout] Skipping fetch for ${contractKey} - not deployed`);
      const result = { holders: [], totalTokens: 0, message: 'E280 data not available yet' };
      setCache(contractKey, result);
      return result;
    }
  
    const { apiEndpoint, pageSize = 1000 } = contractDetails[contractKey];
    let allHolders = [];
    let totalTokens = 0;
    let totalLockedAscendant = 0;
    let totalShares = 0;
    let toDistributeDay8 = 0;
    let toDistributeDay28 = 0;
    let toDistributeDay90 = 0;
    let pendingRewards = 0;
    let page = 0;
    let totalPages = Infinity;
  
    try {
      while (page < totalPages) {
        console.log(`[NFTLayout] Fetching ${contractKey} page ${page}`);
        const res = await fetch(`${apiEndpoint}?page=${page}&pageSize=${pageSize}`, {
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Fetch failed for ${contractKey} page ${page}: ${res.status} - ${errorText}`);
        }
        const json = await res.json();
        console.log(`[NFTLayout] ${contractKey} page ${page} fetched: holders=${json.holders?.length || 0}`);
        console.log(`[NFTLayout] Raw API response sample:`, JSON.stringify(json.holders?.slice(0, 2), null, 2));
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
        if (!json.holders || json.holders.length === 0) break;
      }
  
      const uniqueHoldersMap = new Map();
      allHolders.forEach(holder => {
        if (holder && holder.wallet) {
          // Map API fields to expected names
          holder.Shares = holder.shares || holder.totalShares || 0;
          holder.totalNfts = holder.totalNfts || holder.total || 0;
          if (holder.Shares === undefined || holder.totalNfts === undefined) {
            console.warn(`[NFTLayout] Holder ${holder.wallet} missing Shares or totalNfts:`, holder);
          }
          uniqueHoldersMap.set(holder.wallet, holder);
        }
      });
      let uniqueHolders = Array.from(uniqueHoldersMap.values());
      console.log(`[NFTLayout] Total Unique ${contractKey} Holders: ${uniqueHolders.length}`);
      console.log(`[NFTLayout] Aggregate totalShares for ${contractKey}: ${totalShares}`);
  
      const totalMultiplierSum = uniqueHolders.reduce((sum, h) => sum + (h.multiplierSum || 0), 0);
  
      // Calculate sharesPercentage for display
      uniqueHolders.forEach(holder => {
        holder.sharesPercentage = totalShares > 0 ? ((holder.Shares || 0) / totalShares) * 100 : 0;
        console.log(`[NFTLayout] Holder ${holder.wallet.slice(0, 8)}: sharesPercentage=${holder.sharesPercentage.toFixed(2)}%, totalNfts=${holder.totalNfts || 0}, Shares=${holder.Shares || 0}`);
      });
  
      if (contractKey === 'ascendantNFT') {
        // Sort by Shares (descending), then by totalNfts (descending)
        uniqueHolders.sort((a, b) => {
          const sharesDiff = (b.Shares || 0) - (a.Shares || 0);
          if (sharesDiff !== 0) return sharesDiff; // Primary: Shares
          return (b.totalNfts || 0) - (a.totalNfts || 0); // Secondary: Total NFTs
        });
        // Assign ranks and log sorted order
        uniqueHolders.forEach((holder, index) => {
          holder.rank = index + 1;
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0; // For compatibility
          console.log(`[NFTLayout] Rank ${holder.rank}: ${holder.wallet.slice(0, 8)}, sharesPercentage=${holder.sharesPercentage.toFixed(2)}%, totalNfts=${holder.totalNfts || 0}, Shares=${holder.Shares || 0}`);
        });
      } else {
        uniqueHolders.sort((a, b) => (b.multiplierSum || 0) - (a.multiplierSum || 0) || (b.totalNfts || 0) - (a.totalNfts || 0));
        uniqueHolders.forEach((holder, index) => {
          holder.rank = index + 1;
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
        });
      }
  
      const result = {
        holders: uniqueHolders,
        totalTokens,
        totalLockedAscendant,
        totalShares,
        toDistributeDay8,
        toDistributeDay28,
        toDistributeDay90,
        pendingRewards,
        totalMultiplierSum,
      };
      setCache(contractKey, result);
      console.log(`[NFTLayout] Cached ${contractKey} with ${uniqueHolders.length} holders`);
      return result;
    } catch (err) {
      console.error(`[NFTLayout] Error fetching ${contractKey}: ${err.message}`);
      const errorResult = { holders: [], totalTokens: 0, error: err.message };
      setCache(contractKey, errorResult);
      return errorResult;
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
      console.log('[NFTLayout] Fetching all collection data before search');
      const fetchPromises = allNFTs.map(nft => 
        fetchCollectionData(nft.apiKey)
          .then(data => ({ apiKey: nft.apiKey, data }))
          .catch(err => {
            console.error(`[NFTLayout] Fetch failed for ${nft.apiKey}: ${err.message}`);
            return { apiKey: nft.apiKey, data: { holders: [], totalTokens: 0, error: err.message } };
          })
      );
      const results = await Promise.all(fetchPromises);
      console.log('[NFTLayout] All collections fetched and cached');

      const searchResults = {};
      const lowerSearchAddress = searchAddress.toLowerCase();
      results.forEach(({ apiKey, data }) => {
        if (data.error) {
          searchResults[apiKey] = { error: data.error };
        } else if (data.message) {
          searchResults[apiKey] = { message: data.message };
        } else {
          const holder = data.holders.find(h => h && h.wallet && h.wallet.toLowerCase() === lowerSearchAddress);
          if (holder) {
            // Include totalShares for Ascendant to calculate Shares %
            searchResults[apiKey] = {
              ...holder,
              totalShares: apiKey === 'ascendantNFT' ? data.totalShares : undefined,
            };
          } else {
            searchResults[apiKey] = null;
          }
          console.log(`[NFTLayout] ${apiKey} search result:`, holder ? JSON.stringify(searchResults[apiKey]) : 'not found');
        }
      });

      setSearchResults(searchResults);
      setIsModalOpen(true);
    } catch (err) {
      console.error('[NFTLayout] Search error:', err);
      setError(`Search failed: ${err.message}`);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleChainSelect = (chainId) => {
    setShowE280Message(false);
    setSelectedChain(chainId === selectedChain ? null : chainId);
  };

  const handleE280Click = () => {
    if (selectedChain === 'base') {
      setShowE280Message(true);
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-8">TitanX NFT Protocols</h1>

      <div className="w-full max-w-2xl mb-6">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            placeholder="Search by wallet address (e.g., 0x...)"
            className="p-2 w-full bg-gray-700 text-white rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSearch}
            disabled={searchLoading}
            className={`px-4 py-2 bg-orange-500 text-white rounded-md font-semibold hover:bg-orange-600 transition-colors ${searchLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {searchLoading ? 'Searching...' : 'Search'}
          </motion.button>
        </div>
        {error && <p className="text-red-500 mt-2">{error}</p>}
      </div>

      <div className="flex space-x-4 mb-6">
        {chains.map((chain) => (
          <motion.button
            key={chain.id}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleChainSelect(chain.id)}
            className={`px-6 py-2 rounded-md font-semibold transition-colors ${
              selectedChain === chain.id
                ? 'bg-orange-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
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
                onClick={() => setShowE280Message(false)}
                className="w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-md font-semibold hover:bg-orange-500 hover:text-white transition-colors"
              >
                {nft.name}
              </motion.button>
            </Link>
          ))}
        </div>
      )}
      {selectedChain === 'base' && (
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0 w-full max-w-6xl">
          {baseNFTs.map((nft) => (
            nft.href ? (
              <Link key={nft.name} href={nft.href} className="flex-1">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowE280Message(false)}
                  className="w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-md font-semibold hover:bg-orange-500 hover:text-white transition-colors"
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
                className="flex-1 w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-md font-semibold hover:bg-orange-500 hover:text-white transition-colors"
              >
                {nft.name}
              </motion.button>
            )
          ))}
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

      <div className="w-full max-w-6xl">{children}</div>
    </div>
  );
}