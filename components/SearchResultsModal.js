// components/SearchResultsModal.js
'use client';
import { motion } from 'framer-motion';
import HolderTable from './HolderTable';

export default function SearchResultsModal({ searchResult, searchAddress, closeModal, handleBackgroundClick }) {
  const modalVariants = {
    hidden: { opacity: 0, y: -50 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -50 },
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4"
      onClick={handleBackgroundClick}
    >
      <motion.div
        className="bg-gray-800 text-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Search Results for {searchAddress}</h2>
          <button onClick={closeModal} className="text-gray-400 hover:text-white text-2xl">
            &times;
          </button>
        </div>

        {Object.keys(searchResult).length === 0 ? (
          <p className="text-gray-400">No results available.</p>
        ) : (
          Object.entries(searchResult).map(([contract, data]) => (
            <div key={contract} className="mb-6">
              <h3 className="text-xl font-semibold mb-2">{contractDetails[contract]?.name || contract}</h3>
              {data === null ? (
                <p className="text-gray-400">Wallet not found in this collection.</p>
              ) : data.error ? (
                <p className="text-red-500">Error: {data.error}</p>
              ) : data.message ? (
                <p className="text-gray-400">{data.message}</p>
              ) : (
                <HolderTable
                  holders={[data]}
                  contract={contract}
                  loading={false}
                  totalShares={data.totalShares} // Pass totalShares from search result
                />
              )}
            </div>
          ))
        )}
      </motion.div>
    </div>
  );
}

const contractDetails = {
  element280: { name: 'Element280' },
  element369: { name: 'Element369' },
  staxNFT: { name: 'Stax' },
  ascendantNFT: { name: 'Ascendant' },
  e280: { name: 'E280' },
};