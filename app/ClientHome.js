'use client';
import { useState, useEffect, useRef } from 'react';
import { contractAddresses, contractTiers } from './contract-config';

export default function ClientHomeContent() {
  const [holders, setHolders] = useState({ element280: [], staxNFT: [], element369: [] });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [activeTab, setActiveTab] = useState('element280');
  const tableBodyRef = useRef(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const highlightedRowRef = useRef(null);

  console.log('ClientHome.js loaded with contract addresses:', contractAddresses);

  const fetchAllHolders = async (contract) => {
    try {
      const url = `/api/holders?contract=${contract}&address=${contractAddresses[contract]}`;
      console.log(`Fetching from: ${url}`);
      const response = await fetch(url);
      const data = await response.json();
      console.log(`Table Response for ${contract}:`, data);
      if (data.error) throw new Error(data.error);
      return data.holders;
    } catch (error) {
      console.error(`Fetch error for ${contract}:`, error);
      setStatus(`❌ Error fetching holders for ${contract === 'element280' ? 'Element 280' : contract === 'staxNFT' ? 'StaxNFT' : 'Element 369'}`);
      return [];
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    setStatus('Fetching all holders data...');
    setLoadProgress(0);

    const contracts = ['element280', 'staxNFT', 'element369'];
    const totalSteps = contracts.length * 100;
    let currentStep = 0;

    const results = await Promise.all(
      contracts.map(async (contract) => {
        const holdersData = await fetchAllHolders(contract);
        currentStep += 100;
        setLoadProgress((currentStep / totalSteps) * 100);
        return [contract, holdersData];
      })
    );

    const newHolders = Object.fromEntries(results);
    setHolders(newHolders);
    setStatus(`✅ Done — Loaded data: Element 280 (${newHolders.element280.length}), StaxNFT (${newHolders.staxNFT.length}), Element 369 (${newHolders.element369.length})`);
    setLoading(false);
    setLoadProgress(100);
  };

  const handleSearch = async () => {
    if (!searchAddress || searchAddress.length !== 42 || !searchAddress.startsWith('0x')) {
      setStatus('Please enter a valid Ethereum address');
      setSearchResult(null);
      return;
    }
    setLoading(true);
    setStatus('Searching for wallet...');
    try {
      const response = await fetch(`/api/holders?address=${searchAddress}`);
      const data = await response.json();
      console.log('Wallet Search Response:', data);
      if (data.error) throw new Error(data.error);

      const searchData = data.holders.reduce((acc, holder) => {
        const contractMap = {
          7: 'element280',
          3: 'element369',
          13: 'staxNFT',
        };
        const contract = contractMap[holder.tiers.length] || 'unknown';
        acc[contract] = holder;
        return acc;
      }, {});
      console.log('Transformed Search Data:', searchData);

      setSearchResult(searchData);

      // Highlight and scroll to the row in the main table
      const matchedHolder = holders[activeTab].find(
        (h) => h.wallet.toLowerCase() === searchAddress.toLowerCase()
      );
      if (matchedHolder && tableBodyRef.current) {
        const rows = tableBodyRef.current.getElementsByTagName('tr');
        for (let row of rows) {
          const walletCell = row.cells[1].querySelector('a');
          if (walletCell && walletCell.href.includes(searchAddress.toLowerCase())) {
            if (highlightedRowRef.current) {
              highlightedRowRef.current.classList.remove('highlight-row');
            }
            row.classList.add('highlight-row');
            highlightedRowRef.current = row;
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }

      setStatus(`✅ Found data for ${searchAddress}`);
    } catch (error) {
      console.error('Search error:', error);
      setStatus(`❌ Error searching for ${searchAddress}: ${error.message}`);
      setSearchResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []); // Load all data once on mount

  const renderTable = (holdersData, contract) => {
    if (!holdersData || holdersData.length === 0) {
      return <p className="text-center text-gray-500">No holders found.</p>;
    }

    const tiers = contractTiers[contract];
    if (!tiers) {
      console.error(`No tiers defined for contract: ${contract}`);
      return <p className="text-center text-red-500">Error: Contract tiers not found.</p>;
    }
    const maxTier = Math.max(...Object.keys(tiers).map(Number));
    const sortedHolders = [...holdersData].sort((a, b) => a.rank - b.rank);

    return (
      <div className="overflow-x-auto min-h-[400px] w-full">
        <table className="w-full bg-white shadow-md rounded-lg table-fixed">
          <thead>
            <tr className="bg-blue-600 text-white">
              <th className="py-3 px-6 text-left font-semibold w-[80px]">Rank</th>
              <th className="py-3 px-6 text-left font-semibold w-[200px]">Wallet</th>
              <th className="py-3 px-6 text-left font-semibold w-[120px]">Total NFTs</th>
              <th className="py-3 px-6 text-left font-semibold w-[120px]">Reward %</th>
              {Array.from({ length: maxTier }, (_, i) => maxTier - i).map((tier) => (
                <th key={tier} className="py-3 px-6 text-left font-semibold w-[100px]">
                  {tiers[tier].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={tableBodyRef}>
            {sortedHolders.map((holder, index) => (
              <tr key={holder.wallet} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                <td className="py-3 px-6 border-b border-gray-200">{holder.rank}</td>
                <td className="py-3 px-6 border-b border-gray-200">
                  <a
                    href={`https://etherscan.io/address/${holder.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {holder.wallet.slice(0, 6)}...{holder.wallet.slice(-4)}
                  </a>
                </td>
                <td className="py-3 px-6 border-b border-gray-200">{holder.total}</td>
                <td className="py-3 px-6 border-b border-gray-200">{holder.percentage.toFixed(2)}%</td>
                {holder.tiers.slice(1, maxTier + 1).reverse().map((count, i) => (
                  <td key={maxTier - i} className="py-3 px-6 border-b border-gray-200">
                    {count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto bg-gray-100 rounded-lg shadow-lg min-h-screen w-full">
      <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">NFT Holders Dashboard</h1>

      <div className="mb-6 flex gap-4 border-b border-gray-300">
        {['element280', 'staxNFT', 'element369'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            disabled={loading}
            className={`py-2 px-4 font-medium text-gray-700 border-b-2 transition-colors ${
              activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent hover:text-blue-500'
            } ${loading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            {tab === 'element280' ? 'Element 280' : tab === 'staxNFT' ? 'Stax NFT' : 'Element 369'}
          </button>
        ))}
      </div>

      <div className="mb-6 flex gap-4">
        <input
          type="text"
          value={searchAddress}
          onChange={(e) => setSearchAddress(e.target.value)}
          placeholder="Enter wallet address (0x...)"
          className="p-2 w-80 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-200 disabled:cursor-not-allowed"
          disabled={loading}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="p-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          Search
        </button>
      </div>

      {loading && (
        <div className="mb-6">
          <progress value={loadProgress} max="100" className="w-full h-2 rounded-full bg-gray-200" />
          <p className={`mt-2 text-sm ${status.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
            {status}
          </p>
        </div>
      )}

      {!loading && status && (
        <p className={`mb-6 text-sm ${status.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
          {status}
        </p>
      )}

      <h2 className="text-2xl font-semibold text-gray-700 mb-4">
        Holders for {activeTab === 'element280' ? 'Element 280' : activeTab === 'staxNFT' ? 'Stax NFT' : 'Element 369'}
      </h2>
      {renderTable(holders[activeTab], activeTab)}

      {searchResult && Object.keys(searchResult).length > 0 && (
        <div className="mt-10">
          <h2 className="text-2xl font-semibold text-gray-700 mb-4">
            Search Results for {searchAddress.slice(0, 6)}...{searchAddress.slice(-4)}
          </h2>
          {Object.entries(searchResult).map(([contract, data]) => (
            data && contract !== 'unknown' && (
              <div key={contract} className="mb-6">
                <h3 className="text-xl font-medium text-gray-600 mb-2">
                  {contract === 'element280' ? 'Element 280' : contract === 'staxNFT' ? 'Stax NFT' : 'Element 369'}
                </h3>
                {renderTable([data], contract)}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}