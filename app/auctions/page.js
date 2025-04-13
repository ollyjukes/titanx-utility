// app/auctions/page.js
'use client';
import { useState } from 'react';
import { useFlareROI } from '@/lib/auctions/flare';
import { useAscendantROI } from '@/lib/auctions/ascendant';
import { getAuctionConfigs } from '@/lib/auctions/config';
import AuctionCard from '@/components/AuctionCard';
import AuctionDetails from '@/components/AuctionDetails';
import AuctionActions from '@/components/AuctionActions';

export default function Auctions() {
  const [selectedAuction, setSelectedAuction] = useState(null);

  const flareROI = useFlareROI();
  const ascendantROI = useAscendantROI();

  const auctions = getAuctionConfigs().map((config) => ({
    name: config.name,
    url: config.externalUrl,
    roiData: config.name === 'Flare' ? flareROI : config.name === 'Ascendant' ? ascendantROI : null,
  }));

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
            <AuctionCard
              key={auction.name}
              auction={auction}
              onOpenModal={openModal}
              renderDetails={() => <AuctionDetails roiData={auction.roiData} />}
              renderActions={() => <AuctionActions auctionName={auction.name} />}
            />
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
              className="absolute top-2 right-2 text-gray-300 hover:text-white bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>
            <iframe
              src={selectedAuction.url}
              className="w-full h-full border-0 rounded"
              title={`${selectedAuction.name} Auction`}
              allowFullScreen
              onError={(e) => console.error(`Failed to load iframe for ${selectedAuction.name}: ${selectedAuction.url}`, e)}
            />
          </div>
        </div>
      )}
    </div>
  );
}