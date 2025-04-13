// components/AuctionCard.js
'use client';
import { memo } from 'react';

function AuctionCard({ auction, onOpenModal, renderDetails, renderActions }) {
  return (
    <div className="bg-gray-800 rounded-lg shadow-md p-6 hover:bg-gray-700 transition-all duration-200 hover:shadow-lg transform hover:-translate-y-1">
      <button
        onClick={() => onOpenModal(auction)}
        className="text-blue-400 hover:text-blue-300 text-xl font-semibold transition-colors duration-200 text-left w-full"
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
      {renderDetails()}
      {renderActions()}
    </div>
  );
}

export default memo(AuctionCard);