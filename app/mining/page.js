// app/mining/page.js
'use client';
import { useState } from 'react';

export default function Mining() {
  const [selectedMine, setSelectedMine] = useState(null);

  const auctions = [
    { name: 'TitanX', url: 'https://app.titanx.win/mine' },
    { name: 'Hyper', url: 'https://app.hyper.win/mine' },
    { name: 'Hydra', url: 'https://app.hydra.win/mine' },
    { name: 'Helios', url: 'https://app.helios.win/mine' },
    { name: 'Eden', url: 'https://www.eden.win/mine' },
    { name: 'Lotus', url: 'https://lotus.win/mine' },
  ];

  const openModal = (mine) => {
    setSelectedMine(mine);
  };

  const closeModal = () => {
    setSelectedMine(null);
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
          TitanX Ecosystem Mining
        </h1>
        <p className="mt-4 text-lg sm:text-xl text-gray-300 text-center max-w-2xl mx-auto">
          Explore the current mining options available in the TitanX ecosystem.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((mine) => (
            <div
              key={mine.name}
              className="bg-gray-800 rounded-lg shadow-md p-6 hover:bg-gray-700 
                transition-all duration-200 hover:shadow-lg transform hover:-translate-y-1"
            >
              <button
                onClick={() => openModal(mine)}
                className="text-blue-400 hover:text-blue-300 text-xl font-semibold 
                  transition-colors duration-200 text-left w-full"
              >
                {mine.name} Mining
              </button>
              <p className="text-gray-400 mt-2 text-sm truncate">
                <span className="hover:underline">{mine.url}</span>
              </p>
            </div>
          ))}
        </div>
      </main>

      {selectedMine && (
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
            <h2 className="text-2xl font-bold text-white mb-4">{selectedMine.name} Mine</h2>
            <iframe
              src={selectedMine.url}
              className="w-full h-[calc(100%-4rem)] border-0 rounded"
              title={`${selectedMine.name} Mine`}
              allowFullScreen
            />
          </div>
        </div>
      )}
    </div>
  );
}