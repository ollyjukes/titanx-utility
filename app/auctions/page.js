// app/auctions/page.js
'use client';
import { useState } from 'react';
import { useFlareROI } from '@/lib/auctions/flare';
import { useAscendantROI } from '@/lib/auctions/ascendant';

export default function Auctions() {
  const [selectedAuction, setSelectedAuction] = useState(null);

  const {
    auctionFlarePerTitanX,
    marketFlarePerTitanX,
    flarePerX28,
    roi: flareROI,
    isLoading: flareLoading,
    hasError: flareError,
    status: flareStatus,
  } = useFlareROI();

  const {
    auctionAscendantPerTitanX,
    marketAscendantPerTitanX,
    ascendPerDragonX,
    marketDragonXPerTitanX,
    roi: ascendantROI,
    isLoading: ascendantLoading,
    hasError: ascendantError,
    status: ascendantStatus,
  } = useAscendantROI();

  const auctions = [
    { name: 'Ascendant', url: 'https://app.ascendant.win/auction' },
    { name: 'Flare', url: 'https://www.flare.win/auction' },
    { name: 'Shogun', url: 'https://app.shogun.win/auction' },
    { name: 'Blaze', url: 'https://app.titanblaze.win/auction' },
    { name: 'Volt', url: 'https://app.volt.win/auction' },
    { name: 'Vyper', url: 'https://app.vyper.win/auction' },
    { name: 'Flux', url: 'https://app.flux.win/auction' },
    { name: 'Phoenix', url: 'https://app.phoenix.win/' },
    { name: 'Turbo', url: 'https://app.turbo.win/auction' },
    { name: 'GoatX', url: 'https://app.thegoatx.win/auction' },
  ];

  const openModal = (auction) => {
    setSelectedAuction(auction);
  };

  const closeModal = () => {
    setSelectedAuction(null);
  };

  const handleBackgroundClick = (e) => {
    if (e.target === e.currentTarget) {
      closeModal();
    }
  };

  const renderAuctionDetails = (auction) => {
    if (auction.name === 'Flare') {
      if (flareLoading) {
        return <p className="text-gray-300 text-sm">Loading Flare data...</p>;
      }
      if (flareError || flareStatus === 'error') {
        return <p className="text-red-500 text-sm">Error loading Flare data.</p>;
      }
      if (flareStatus === 'no_data') {
        return <p className="text-gray-300 text-sm">No Flare auction data available.</p>;
      }
      return (
        <div className="text-gray-300 text-sm mt-2">
          <p><strong>ROI:</strong> {flareROI ? `${flareROI}%` : 'N/A'}</p>
          <p><strong>Auction Rate:</strong> {auctionFlarePerTitanX ? `${auctionFlarePerTitanX.toFixed(2)} FLARE/TX` : 'N/A'}</p>
          <p><strong>Market Rate:</strong> {marketFlarePerTitanX ? `${marketFlarePerTitanX.toFixed(2)} FLARE/TX` : 'N/A'}</p>
          <p><strong>FLARE/X28:</strong> {flarePerX28 ? `${flarePerX28.toFixed(2)} FLARE/X28` : 'N/A'}</p>
        </div>
      );
    }
    if (auction.name === 'Ascendant') {
      if (ascendantLoading) {
        return <p className="text-gray-300 text-sm">Loading Ascendant data...</p>;
      }
      if (ascendantError || ascendantStatus === 'error') {
        return <p className="text-red-500 text-sm">Error loading Ascendant data.</p>;
      }
      if (ascendantStatus === 'no_data') {
        return <p className="text-gray-300 text-sm">No Ascendant auction data available.</p>;
      }
      return (
        <div className="text-gray-300 text-sm mt-2">
          <p><strong>ROI:</strong> {ascendantROI ? `${ascendantROI}%` : 'N/A'}</p>
          <p><strong>Auction Rate:</strong> {auctionAscendantPerTitanX ? `${auctionAscendantPerTitanX.toFixed(2)} ASCEND/TX` : 'N/A'}</p>
          <p><strong>Market Rate:</strong> {marketAscendantPerTitanX ? `${marketAscendantPerTitanX.toFixed(2)} ASCEND/TX` : 'N/A'}</p>
          <p><strong>ASCEND/DRAGONX:</strong> {ascendPerDragonX ? `${ascendPerDragonX.toFixed(2)} ASCEND/DRAGONX` : 'N/A'}</p>
          <p><strong>DRAGONX/TITANX:</strong> {marketDragonXPerTitanX ? `${marketDragonXPerTitanX.toFixed(2)} DRAGONX/TX` : 'N/A'}</p>
        </div>
      );
    }
    return null; // No details for other auctions
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-white">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-center mb-6">
          TitanX Ecosystem Auctions
        </h1>
        <p className="mt-4 text-lg sm:text-xl text-gray-300 text-center max-w-2xl mx-auto">
          Explore the current auctions in the TitanX ecosystem. Click to view.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <div
              key={auction.name}
              className="bg-gray-800 rounded-lg shadow-md p-6 hover:bg-gray-700 
                transition-all duration-200 hover:shadow-lg transform hover:-translate-y-1"
            >
              <button
                onClick={() => openModal(auction)}
                className="text-blue-400 hover:text-blue-300 text-xl font-semibold 
                  transition-colors duration-200 text-left w-full"
              >
                {auction.name} Auction
              </button>
              <p className="text-gray-400 mt-2 text-sm truncate">
                <a
                  href={auction.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  onClick={(e) => e.preventDefault()}
                >
                  {auction.url}
                </a>
              </p>
              {renderAuctionDetails(auction)}
            </div>
          ))}
        </div>
      </main>

      {selectedAuction && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"
          onClick={handleBackgroundClick}
        >
          <div className="bg-gray-900 rounded-lg p-4 w-full max-w-4xl h-[80vh] relative">
            <button
              onClick={closeModal}
              className="absolute top-2 right-2 text-gray-300 hover:text-white 
                bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>
            <iframe
              src={selectedAuction.url}
              className="w-full h-full border-0 rounded"
              title={`${selectedAuction.name} Auction`}
              allowFullScreen
              onError={(e) => {
                console.error(`Failed to load iframe for ${selectedAuction.name}: ${selectedAuction.url}`, e);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}