"use client";
import { useState, useEffect, useCallback } from "react";
import { contractAddresses } from "../app/nft-contracts";

export default function useNFTHolders(dataCache) {
  const [holders, setHolders] = useState(dataCache);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [searchAddress, setSearchAddress] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [activeTab, setActiveTab] = useState("element280");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const closeModal = () => setIsModalOpen(false);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setStatus("Fetching holders...");
    setProgress(0);
    try {
      const contracts = ["element280", "staxNFT", "element369"];
      const results = await Promise.all(
        contracts.map(async (contract, i) => {
          let page = 0;
          let totalPages = 1;
          const pageSize = 500;
          let holderMap = new Map();

          do {
            const response = await fetch(
              `/api/holders?contract=${contract}&address=${contractAddresses[contract]}&page=${page}&pageSize=${pageSize}`
            );
            if (!response.ok) throw new Error(`Failed to fetch ${contract} holders, page ${page}`);
            const data = await response.json();
            const holdersArray = Array.isArray(data.holders) ? data.holders : [];

            holdersArray.forEach((holder) => {
              const existing = holderMap.get(holder.wallet);
              if (existing) {
                existing.total += holder.total;
                existing.multiplierSum += holder.multiplierSum;
                existing.percentage += holder.percentage;
                existing.tiers = existing.tiers.map((t, idx) => t + (holder.tiers[idx] || 0));
                existing.rank = Math.min(existing.rank, holder.rank);
                existing.displayMultiplierSum += holder.displayMultiplierSum;
              } else {
                holderMap.set(holder.wallet, { ...holder });
              }
            });

            totalPages = data.totalPages || 1;
            page++;
          } while (page < totalPages);

          const allHolders = Array.from(holderMap.values());
          const totalMultiplierSum = allHolders.reduce((sum, h) => sum + h.multiplierSum, 0);
          allHolders.forEach((holder) => {
            holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
            holder.displayMultiplierSum = contract === "element280" ? holder.multiplierSum / 10 : holder.multiplierSum;
          });
          allHolders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
          allHolders.forEach((holder, index) => (holder.rank = index + 1));

          setProgress(((i + 1) / contracts.length) * 100);
          return [contract, allHolders];
        })
      );

      const updatedHolders = Object.fromEntries(results);
      setHolders(updatedHolders);
      Object.assign(dataCache, updatedHolders);
      setStatus("Holders loaded successfully!");
    } catch (error) {
      console.error(`Error fetching holders: ${error.message}`);
      setStatus(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [dataCache]);

  const handleSearch = useCallback(() => {
    if (!searchAddress) {
      setSearchResult(null);
      setIsModalOpen(false);
      setStatus("");
      return;
    }

    setLoading(true);
    setStatus(`Searching for address ${searchAddress}...`);

    // Search across all contracts
    const contracts = ["element280", "staxNFT", "element369"];
    const searchResults = {};

    contracts.forEach((contract) => {
      const contractHolders = holders[contract] || [];
      const foundHolder = contractHolders.find(
        (holder) => holder.wallet.toLowerCase() === searchAddress.toLowerCase()
      );
      searchResults[contract] = foundHolder || null;
    });

    console.log("Search results across contracts:", searchResults);

    // Check if any results were found
    const hasResults = Object.values(searchResults).some((result) => result !== null);

    setSearchResult(searchResults);
    setIsModalOpen(true);
    setStatus(hasResults ? "Search completed!" : "No results found for this address across all contracts.");
    setLoading(false);
  }, [searchAddress, holders]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  return {
    holders,
    loading,
    status,
    progress,
    searchResult,
    setSearchAddress,
    handleSearch,
    loadAllData,
    activeTab,
    setActiveTab,
    isModalOpen,
    closeModal,
  };
}