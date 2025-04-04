"use client";
import { useState } from "react";
import useNFTHolders from "./useNFTHolders";
import LoadingIndicator from "./LoadingIndicator";
import ProtocolTabs from "./ProtocolTabs";
import SearchBar from "./SearchBar";
import SearchResultsModal from "./SearchResultsModal";
import HolderTable from "./HolderTable";

export default function NFTHoldersDashboard({ holdersData = { element280: [], staxNFT: [], element369: [] } }) {
  const {
    holders,
    loading,
    status,
    progress,
    searchResult,
    setSearchAddress,
    handleSearch,
    activeTab,
    setActiveTab,
    isModalOpen,
    closeModal,
  } = useNFTHolders(holdersData);

  const [searchInput, setSearchInput] = useState(""); // Local state for input

  const handleBackgroundClick = (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-white p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">NFT Holders Dashboard</h1>

        <ProtocolTabs activeTab={activeTab} setActiveTab={setActiveTab} loading={loading} />

        <SearchBar
          setSearchAddress={(value) => {
            setSearchInput(value);
            setSearchAddress(value);
          }}
          handleSearch={handleSearch}
          loading={loading}
        />

        {loading ? (
          <LoadingIndicator status={status} progress={progress} />
        ) : (
          <>
            <p className={`mb-4 text-sm sm:text-base ${status.includes("Error") ? "text-red-500" : "text-green-500"}`}>
              {status}
            </p>
            <h2 className="text-xl font-semibold mb-2">
              {activeTab === "element280" ? "Element 280" : activeTab === "staxNFT" ? "Stax NFT" : "Element 369"} Holders (
              {holders[activeTab]?.length || 0})
            </h2>
            <HolderTable holders={holders[activeTab]} contract={activeTab} loading={loading} />
          </>
        )}

        {isModalOpen && searchResult && (
          <SearchResultsModal
            searchResult={searchResult}
            searchAddress={searchInput}
            closeModal={closeModal}
            handleBackgroundClick={handleBackgroundClick}
          />
        )}
      </div>
    </div>
  );
}