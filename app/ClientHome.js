// app/ClientHome.js
'use client';
import { useState, useEffect } from 'react';

export default function ClientHomeContent() {
  const [holders, setHolders] = useState({ element280: [], staxNFT: [] });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [selectedContract, setSelectedContract] = useState('element280');

  const fetchAllHolders = async (contract) => {
    setLoading(true);
    setStatus(`Fetching holders for ${contract === 'element280' ? 'Element 280' : 'StaxNFT'}...`);
    try {
      const response = await fetch(`/api/holders?contract=${contract}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      setHolders((prev) => ({ ...prev, [contract]: data.holders }));
      setStatus(`✅ Done — ${data.holders.length} holders found for ${contract === 'element280' ? 'Element 280' : 'StaxNFT'}. ${data.cached ? '(From cache)' : ''}`);
    } catch (error) {
      console.error(`Fetch error for ${contract}:`, error);
      setStatus(`❌ Error fetching holders for ${contract === 'element280' ? 'Element 280' : 'StaxNFT'}`);
    } finally {
      setLoading(false);
    }
  };

  const searchHolder = async () => {
    if (!searchAddress || searchAddress.length !== 42 || !searchAddress.startsWith('0x')) {
      setSearchResult(null);
      setStatus('Please enter a valid Ethereum address (0x + 40 characters)');
      return;
    }
    setLoading(true);
    setStatus('Searching...');
    try {
      const response = await fetch(`/api/holders?address=${searchAddress.toLowerCase()}`);
      const data = await response.json();
      console.log('Search response:', data);
      if (data.error) throw new Error(data.error);
      setSearchResult(data.holders ? { staxNFT: data.holders.staxNFT, element280: data.holders.element280 } : null);
      setStatus(data.holders && (data.holders.staxNFT || data.holders.element280) ? '✅ Found holder' : '❌ Address not found in either collection');
    } catch (error) {
      console.error('Search error:', error);
      setStatus('❌ Error searching address');
      setSearchResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAllHolders('element280');
    fetchAllHolders('staxNFT');
  }, []);

  const renderTable = (holdersData, title, isStax = false) => (
    <div className="mt-6">
      <h2 className="text-2xl font-semibold text-center mb-4 text-white">{title}: {holdersData.length}</h2>
      {loading ? (
        <p className="text-center text-gray-400 mt-4">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black">
          <table className="min-w-full table-auto border-collapse bg-black/30 text-white border border-black" style={{ border: '1px solid black' }}>
            <thead className="bg-gray-800 text-purple-300 sticky top-0 z-10">
              <tr>
                <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rank</th>
                <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Wallet</th>
                <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Total NFTs</th>
                <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Multiplier Sum (%)</th>
                {isStax ? (
                  <>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary LFG</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary Super</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare LFG</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare Super</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common LFG</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common Super</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common</th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {holdersData.map((holder) => (
                <tr key={holder.wallet} className="border border-black hover:bg-gray-700/30 transition-colors" style={{ border: '1px solid black' }}>
                  <td className="px-6 py-4 font-semibold text-yellow-400 border border-black" style={{ border: '1px solid black' }}>{holder.rank}</td>
                  <td className="px-6 py-4 font-mono border border-black" style={{ border: '1px solid black' }}>
                    <a
                      href={`https://etherscan.io/address/${holder.wallet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-blue-400 hover:text-blue-300"
                    >
                      {holder.wallet.slice(0, 6)}...{holder.wallet.slice(-4)}
                    </a>
                  </td>
                  <td className="px-6 py-4 font-semibold text-fuchsia-400 border border-black" style={{ border: '1px solid black' }}>{holder.total}</td>
                  <td className="px-6 py-4 font-semibold text-cyan-400 border border-black" style={{ border: '1px solid black' }}>
                    {holder.multiplierSum} ({holder.percentage.toFixed(2)}%)
                  </td>
                  {isStax ? (
                    <>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[12] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[11] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[10] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[9] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[8] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[7] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[6] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[5] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[4] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[3] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[2] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[1] || 0}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[6] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[5] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[4] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[3] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[2] || 0}</td>
                      <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{holder.tiers[1] || 0}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderSearchResults = () => {
    if (!searchResult) return null;
    const { staxNFT, element280 } = searchResult;

    return (
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-white text-center mb-4">Search Results</h3>
        {staxNFT ? (
          <div className="mb-6">
            <h4 className="text-md font-semibold text-white text-center mb-2">StaxNFT</h4>
            <div className="overflow-x-auto rounded-xl border border-black">
              <table className="min-w-full table-auto border-collapse bg-gray-700 text-white border border-black" style={{ border: '1px solid black' }}>
                <thead className="bg-gray-800 text-purple-300">
                  <tr>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rank</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Wallet</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Total NFTs</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Multiplier Sum (%)</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary LFG</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary Super</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare LFG</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare Super</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common LFG</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common Super</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border border-black hover:bg-gray-600/30 transition-colors" style={{ border: '1px solid black' }}>
                    <td className="px-6 py-4 font-semibold text-yellow-400 border border-black" style={{ border: '1px solid black' }}>{staxNFT.rank}</td>
                    <td className="px-6 py-4 font-mono border border-black" style={{ border: '1px solid black' }}>
                      <a
                        href={`https://etherscan.io/address/${staxNFT.wallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-blue-400 hover:text-blue-300"
                      >
                        {staxNFT.wallet.slice(0, 6)}...{staxNFT.wallet.slice(-4)}
                      </a>
                    </td>
                    <td className="px-6 py-4 font-semibold text-fuchsia-400 border border-black" style={{ border: '1px solid black' }}>{staxNFT.total}</td>
                    <td className="px-6 py-4 font-semibold text-cyan-400 border border-black" style={{ border: '1px solid black' }}>
                      {staxNFT.multiplierSum} ({staxNFT.percentage.toFixed(2)}%)
                    </td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[12] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[11] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[10] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[9] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[8] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[7] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[6] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[5] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[4] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[3] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[2] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{staxNFT.tiers[1] || 0}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-center text-gray-400 mb-6">No StaxNFTs found for this address.</p>
        )}
        {element280 ? (
          <div className="mb-6">
            <h4 className="text-md font-semibold text-white text-center mb-2">Element 280</h4>
            <div className="overflow-x-auto rounded-xl border border-black">
              <table className="min-w-full table-auto border-collapse bg-gray-700 text-white border border-black" style={{ border: '1px solid black' }}>
                <thead className="bg-gray-800 text-purple-300">
                  <tr>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rank</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Wallet</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Total NFTs</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Multiplier Sum (%)</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Legendary</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Rare</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common Amped</th>
                    <th className="px-6 py-4 text-left font-semibold border border-black" style={{ border: '1px solid black' }}>Common</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border border-black hover:bg-gray-600/30 transition-colors" style={{ border: '1px solid black' }}>
                    <td className="px-6 py-4 font-semibold text-yellow-400 border border-black" style={{ border: '1px solid black' }}>{element280.rank}</td>
                    <td className="px-6 py-4 font-mono border border-black" style={{ border: '1px solid black' }}>
                      <a
                        href={`https://etherscan.io/address/${element280.wallet}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-blue-400 hover:text-blue-300"
                      >
                        {element280.wallet.slice(0, 6)}...{element280.wallet.slice(-4)}
                      </a>
                    </td>
                    <td className="px-6 py-4 font-semibold text-fuchsia-400 border border-black" style={{ border: '1px solid black' }}>{element280.total}</td>
                    <td className="px-6 py-4 font-semibold text-cyan-400 border border-black" style={{ border: '1px solid black' }}>
                      {element280.multiplierSum} ({element280.percentage.toFixed(2)}%)
                    </td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{element280.tiers[6] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{element280.tiers[5] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{element280.tiers[4] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{element280.tiers[3] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{element280.tiers[2] || 0}</td>
                    <td className="px-6 py-4 border border-black" style={{ border: '1px solid black' }}>{element280.tiers[1] || 0}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-center text-gray-400 mb-6">No Element 280 NFTs found for this address.</p>
        )}
      </div>
    );
  };

  return (
    <div className="w-full max-w-7xl bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl shadow-2xl p-6 sm:p-8 md:p-10 border border-purple-800 animate-fade-in">
      <div className="text-center mb-4 sm:mb-6 md:mb-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-fuchsia-400 to-cyan-400 bg-clip-text text-transparent drop-shadow-xl flex justify-center items-center gap-2">
          NFT Holders
        </h1>
        <p className="text-gray-400 mt-2 sm:mt-3 text-base sm:text-lg">
          Full historical list of NFT holders by tier — powered by Ethereum & Alchemy
        </p>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <div className="flex gap-4 w-full sm:w-auto">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            placeholder="Enter wallet address (0x...)"
            className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-xl border border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            onClick={searchHolder}
            disabled={loading}
            className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button
            onClick={() => fetchAllHolders(selectedContract)}
            disabled={loading}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="flex justify-center gap-4 mb-6">
        <button
          onClick={() => setSelectedContract('element280')}
          className={`px-4 py-2 rounded-xl font-semibold ${selectedContract === 'element280' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'} hover:bg-purple-500 transition-all`}
        >
          Element 280
        </button>
        <button
          onClick={() => setSelectedContract('staxNFT')}
          className={`px-4 py-2 rounded-xl font-semibold ${selectedContract === 'staxNFT' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'} hover:bg-purple-500 transition-all`}
        >
          StaxNFT
        </button>
      </div>

      <div className="text-center text-sm mb-6 text-gray-400 italic">
        {status}
      </div>

      {renderSearchResults()}

      {renderTable(
        holders[selectedContract],
        selectedContract === 'element280' ? 'Element 280 Holders' : 'StaxNFT Holders',
        selectedContract === 'staxNFT'
      )}
    </div>
  );
}