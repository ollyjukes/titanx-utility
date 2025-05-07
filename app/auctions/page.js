// app/auctions/page.js
'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';

export default function Auctions() {
  const [selectedAuction, setSelectedAuction] = useState(null);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-white">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-center mb-6">
          TitanX Ecosystem Auctions
        </h1>
        <p className="mt-4 text-lg sm:text-xl text-gray-300 text-center max-w-2xl mx-auto">
          Explore the current auctions running in the TitanX ecosystem. Click any auction to view it.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <div
              key={auction.name}
              className="bg-gray-800 rounded-lg shadow-md p-6 hover:bg-gray-700 
                transition-all duration-200 hover:shadow-lg transform hover:-translate-y-1"
            >
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => openModal(auction)}
                className="btn btn-primary w-full text-left font-semibold"
                aria-label={`View ${auction.name} Auction`}
              >
                {auction.name} Auction
              </motion.button>
              <p className="text-gray-400 mt-2 text-sm truncate">
                <span className="hover:underline">{auction.url}</span>
              </p>
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
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={closeModal}
              className="btn absolute top-2 right-2 bg-gray-800 text-gray-300 hover:bg-gray-700 rounded-full w-8 h-8 flex items-center justify-center"
              aria-label="Close auction modal"
            >
              ✕
            </motion.button>
            <h2 className="text-2xl font-bold text-white mb-4">{selectedAuction.name} Auction</h2>
            <iframe
              src={selectedAuction.url}
              className="w-full h-[calc(100%-4rem)] border-0 rounded"
              title={`${selectedAuction.name} Auction`}
              allowFullScreen
            />
          </div>
        </div>
      )}
    </div>
  );
}