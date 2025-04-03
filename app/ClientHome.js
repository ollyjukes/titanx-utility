// app/ClientHome.js
"use client";
import { useState, useEffect, useCallback } from "react";
import { contractAddresses, contractTiers } from "./nft-contracts";

export default function ClientHomeContent() {
  const [holders, setHolders] = useState({ element280: [], staxNFT: [], element369: [] });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("Fetching all holders data...");
  const [searchAddress, setSearchAddress] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [activeTab, setActiveTab] = useState("element280");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchAllHolders = useCallback(async (contract) => {
    try {
      const url = `/api/holders?contract=${contract}&address=${contractAddresses[contract]}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data.holders;
    } catch (error) {
      setStatus(`❌ Error fetching holders for ${contract === "element280" ? "Element 280" : contract === "staxNFT" ? "StaxNFT" : "Element 369"}: ${error.message}`);
      return [];
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setStatus("Fetching all holders data...");
    try {
      const contracts = ["element280", "staxNFT", "element369"];
      const results = await Promise.all(
        contracts.map(async (contract) => [contract, await fetchAllHolders(contract)])
      );
      const newHolders = Object.fromEntries(results);
      setHolders(newHolders);
      setStatus(`✅ Loaded: Element 280 (${newHolders.element280.length}), StaxNFT (${newHolders.staxNFT.length}), Element 369 (${newHolders.element369.length})`);
    } catch (error) {
      setStatus(`❌ Failed to load data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [fetchAllHolders]);

  const handleSearch = useCallback(() => {
    if (!searchAddress || searchAddress.length !== 42 || !searchAddress.startsWith("0x")) {
      setStatus("Please enter a valid Ethereum address");
      setSearchResult(null);
      return;
    }

    const searchData = {};
    let found = false;
    Object.entries(holders).forEach(([contract, holderList]) => {
      const match = holderList.find(
        (holder) => holder.wallet.toLowerCase() === searchAddress.toLowerCase()
      );
      if (match) {
        searchData[contract] = match;
        found = true;
      }
    });

    if (found) {
      setSearchResult(searchData);
      setIsModalOpen(true);
      setStatus(`✅ Found data for ${searchAddress}`);
    } else {
      setStatus(`❌ No data found for ${searchAddress} in cached results`);
      setSearchResult(null);
    }
  }, [holders, searchAddress]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setSearchResult(null);
  }, []);

  const handleBackgroundClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  }, [closeModal]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const renderTable = useCallback((holdersData, contract) => {
    if (!holdersData || holdersData.length === 0) {
      return (
        <div className="text-center text-gray-400 py-4 w-full">
          {loading ? "Loading data..." : "No holders found."}
        </div>
      );
    }
    const tiers = contractTiers[contract];
    if (!tiers) {
      return <div className="text-center text-red-500 py-4 w-full">Error: Contract tiers not found.</div>;
    }
    const maxTier = Math.max(...Object.keys(tiers).map(Number));
    const sortedHolders = [...holdersData].sort((a, b) => a.rank - b.rank);

    return (
      <div className="overflow-x-auto w-full rounded-lg shadow-lg">
        <table className="w-full bg-white table-auto md:table-fixed">
          <thead>
            <tr className="bg-gradient-to-r from-blue-600 to-blue-800 text-white text-sm md:text-base">
              <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
              <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[120px] md:w-[200px]">Wallet</th>
              <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total NFTs</th>
              <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
              {Array.from({ length: maxTier }, (_, i) => maxTier - i).map((tier) => (
                <th key={tier} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[100px]">
                  {tiers[tier].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-gray-700 text-xs md:text-sm">
            {sortedHolders.map((holder, index) => (
              <tr
                key={holder.wallet}
                className={`transition-colors ${index % 2 === 0 ? "bg-gray-50" : "bg-white"} hover:bg-blue-50`}
              >
                <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-200">{holder.rank}</td>
                <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-200">
                  <a
                    href={`https://etherscan.io/address/${holder.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline break-all"
                  >
                    {holder.wallet.slice(0, 6)}...{holder.wallet.slice(-4)}
                  </a>
                </td>
                <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-200">{holder.total}</td>
                <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-200">{holder.percentage.toFixed(2)}%</td>
                {holder.tiers.slice(1, maxTier + 1).reverse().map((count, i) => (
                  <td key={maxTier - i} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-200">
                    {count}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }, [loading]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-gray-900">
      <div className="max-w-full mx-auto w-full px-2 sm:px-4 lg:max-w-7xl lg:px-8">
        {/* Unified Container */}
        <div className="bg-white rounded-xl shadow-xl w-full flex flex-col min-h-[60vh]">
          <header className="p-4 sm:p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-gray-100 rounded-t-xl">
            <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">TitanX Utils</h1>
            <p className="mt-1 sm:mt-2 text-sm sm:text-lg text-gray-600">Deep dive into TitanX ecosystem stats</p>
          </header>

          <nav className="px-4 sm:px-6 py-2 sm:py-4 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-8">
              <button className="text-gray-900 font-semibold py-2 px-3 sm:px-4 rounded-md bg-gray-100 shadow-sm hover:bg-gray-200 transition-colors text-sm sm:text-base">
                NFT Protocols
              </button>
              <button className="text-gray-500 font-medium py-2 px-3 sm:px-4 rounded-md hover:text-gray-900 hover:bg-gray-200 transition-colors text-sm sm:text-base">
                Coming Soon
              </button>
            </div>
          </nav>

          <main className="p-4 sm:p-6 w-full flex-1 flex flex-col">
            <div className="flex flex-wrap gap-2 sm:gap-4 border-b border-gray-200 mb-4">
              {["element280", "staxNFT", "element369"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  disabled={loading}
                  className={`py-2 px-3 sm:py-3 sm:px-6 font-medium text-gray-700 rounded-t-lg transition-all duration-200 text-sm sm:text-base ${
                    activeTab === tab
                      ? "bg-blue-600 text-white shadow-md"
                      : "bg-gray-100 hover:bg-gray-200 hover:text-blue-700"
                  } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                >
                  {tab === "element280" ? "Element 280" : tab === "staxNFT" ? "Stax NFT" : "Element 369"}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 w-full">
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                placeholder="Enter wallet address (0x...)"
                className="p-2 sm:p-3 w-full sm:w-96 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-200 disabled:cursor-not-allowed transition-shadow text-sm sm:text-base"
                disabled={loading}
              />
              <button
                onClick={handleSearch}
                disabled={loading}
                className="p-2 sm:p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-md text-sm sm:text-base"
              >
                Search
              </button>
            </div>

            {loading && (
              <div className="flex items-center justify-center gap-3 animate-fade-in w-full flex-1">
                <svg
                  className="animate-spin h-6 w-6 sm:h-8 sm:w-8 text-blue-600"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <p className="text-sm sm:text-base text-gray-600">{status}</p>
              </div>
            )}
            {!loading && status && (
              <p className={`mb-4 text-sm sm:text-base ${status.includes("Error") ? "text-red-600" : "text-green-600"} animate-fade-in`}>
                {status}
              </p>
            )}

            {status.includes("Error") && !loading && (
              <div className="text-center mb-4 w-full">
                <button
                  onClick={loadAllData}
                  className="p-2 sm:p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md text-sm sm:text-base"
                >
                  Retry
                </button>
              </div>
            )}

            <h2 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
              Holders for {activeTab === "element280" ? "Element 280" : activeTab === "staxNFT" ? "Stax NFT" : "Element 369"}
            </h2>
            <div className="w-full flex-1">{renderTable(holders[activeTab], activeTab)}</div>
          </main>
        </div>

        {/* Search Results Modal */}
        {isModalOpen && searchResult && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-2 sm:px-0"
            onClick={handleBackgroundClick}
          >
            <div
              className="bg-white rounded-xl shadow-2xl p-4 sm:p-6 w-full max-w-full sm:max-w-4xl max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">
                  Search Results for {searchAddress.slice(0, 6)}...{searchAddress.slice(-4)}
                </h2>
                <button
                  onClick={closeModal}
                  className="text-gray-500 hover:text-gray-700 text-xl sm:text-2xl font-bold focus:outline-none"
                  aria-label="Close search results"
                >
                  ×
                </button>
              </div>
              {Object.entries(searchResult).map(
                ([contract, data]) =>
                  data &&
                  contract !== "unknown" && (
                    <div key={contract} className="mb-4">
                      <h3 className="text-lg sm:text-xl font-medium text-gray-700 mb-2">
                        {contract === "element280" ? "Element 280" : contract === "staxNFT" ? "Stax NFT" : "Element 369"}
                      </h3>
                      {renderTable([data], contract)}
                    </div>
                  )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}