// components/AuctionCard.js
'use client';
import { useState, useEffect } from 'react';
import { useFlareAuctionState } from '@/lib/auctions/flare';

export default function AuctionCard({ name, url, roiData, onClick }) {
  console.log('[AuctionCard] Rendering for', name);
  const { isMinting } = name === 'Flare' ? useFlareAuctionState() : { isMinting: false };
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    console.log('[AuctionCard] isModalOpen changed:', isModalOpen, 'for', name);
  }, [isModalOpen, name]);

  const openModal = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[AuctionCard] openModal called for', name);
    setIsModalOpen(true);
    if (onClick) {
      console.log('[AuctionCard] Triggering onClick for', name);
      onClick(name, url, roiData);
    }
  };

  const closeModal = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    console.log('[AuctionCard] closeModal called for', name);
    setIsModalOpen(false);
  };

  const handleBackgroundClick = (e) => {
    if (e.target === e.currentTarget) {
      console.log('[AuctionCard] Closing modal due to background click for', name);
      closeModal(e);
    }
  };

  return (
    <>
      <div className="bg-gray-800 rounded-lg shadow-md p-6">
        <button
          onClick={openModal}
          className="bg-blue-600 text-white text-xl font-semibold w-full p-2 rounded hover:bg-blue-700"
        >
          {name} Auction
        </button>
        {name === 'Flare' && isMinting && (
          <p className="text-yellow-500 mt-2 text-sm font-medium">Paused (Minting Phase)</p>
        )}
        <p className="text-gray-400 mt-2 text-sm">
          <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {url}
          </a>
        </p>
        {roiData && (
          <div className="mt-2 text-sm text-orange-400">
            {roiData.isLoading ? (
              <p>Loading data...</p>
            ) : roiData.hasError ? (
              <p>Data unavailable</p>
            ) : (
              <>
                {roiData.timeRemaining && <p>Time: {roiData.timeRemaining}</p>}
                <p>ROI: {roiData.roi !== null ? `${roiData.roi}%` : 'N/A'}</p>
                {roiData.currentFlarePerTitanX !== null && (
                  <p>Auction: {roiData.currentFlarePerTitanX.toFixed(2)} FLARE/TX</p>
                )}
                {roiData.marketFlareTitanXPrice !== null && (
                  <p>Market: {roiData.marketFlareTitanXPrice.toFixed(2)} FLARE/TX</p>
                )}
                {roiData.currentAscendPerTitanX !== null && (
                  <p>Auction: {roiData.currentAscendPerTitanX.toFixed(2)} ASCEND/TX</p>
                )}
                {roiData.marketAscendTitanXPrice !== null && (
                  <p>Market: {roiData.marketAscendTitanXPrice.toFixed(2)} ASCEND/TX</p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[1000]"
          onClick={handleBackgroundClick}
        >
          <div
            className="bg-gray-900 rounded-lg p-4 w-full max-w-4xl h-[80vh] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeModal}
              className="absolute top-2 right-2 text-gray-300 hover:text-white bg-gray-800 rounded-full w-8 h-8 flex items-center justify-center z-[1010]"
            >
              ✕
            </button>
            <h2 className="text-2xl font-bold text-white mb-4">{name} Auction</h2>
            {roiData && (
              <div className="text-gray-300 mb-4">
                {roiData.isLoading ? (
                  <p>Loading data...</p>
                ) : roiData.hasError ? (
                  <p>Error loading data</p>
                ) : (
                  <>
                    {roiData.timeRemaining && <p><strong>Time:</strong> {roiData.timeRemaining}</p>}
                    <p><strong>ROI:</strong> {roiData.roi !== null ? `${roiData.roi}%` : 'N/A'}</p>
                    {roiData.currentFlarePerTitanX !== null && (
                      <p><strong>Auction FLARE/TX:</strong> {roiData.currentFlarePerTitanX.toFixed(2)}</p>
                    )}
                    {roiData.marketFlareTitanXPrice !== null && (
                      <p><strong>Market FLARE/TX:</strong> {roiData.marketFlareTitanXPrice.toFixed(2)}</p>
                    )}
                    {roiData.currentAscendPerTitanX !== null && (
                      <p><strong>Auction ASCEND/TX:</strong> {roiData.currentAscendPerTitanX.toFixed(2)}</p>
                    )}
                    {roiData.marketAscendTitanXPrice !== null && (
                      <p><strong>Market ASCEND/TX:</strong> {roiData.marketAscendTitanXPrice.toFixed(2)}</p>
                    )}
                    {roiData.deviationStatus && (
                      <p><strong>Price Stability:</strong> {roiData.deviationStatus}</p>
                    )}
                    {roiData.mintCycle && (
                      <p>
                        <strong>Mint Cycle:</strong>{' '}
                        {roiData.mintCycle.isMinting
                          ? `Cycle ${roiData.mintCycle.currentCycle} (Minting)`
                          : `Cycle ${roiData.mintCycle.currentCycle} (Ended)`}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            <iframe
              src={url}
              className="w-full h-[calc(100%-8rem)] border-0 rounded"
              title={`${name} Auction`}
              allowFullScreen
              onLoad={() => console.log('[AuctionCard] Iframe loaded for', name)}
              onError={(e) => console.error('[AuctionCard] Iframe error for', name, e)}
            />
          </div>
        </div>
      )}
    </>
  );
}