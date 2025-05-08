// components/SearchResultsModal.js
'use client';
import { motion } from 'framer-motion';
import HolderTable from './HolderTable';
import Dialog from './Dialog';

export default function SearchResultsModal({ searchResult, searchAddress, closeModal, handleBackgroundClick }) {
  return (
    <Dialog isOpen={true} onClose={closeModal}>
      <div className="h-full flex flex-col bg-transparent">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-white">
            Search Results for {searchAddress}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto bg-transparent">
          {Object.keys(searchResult).length === 0 ? (
            <p className="text-gray-400">No results available.</p>
          ) : (
            Object.entries(searchResult).map(([contract, data]) => (
              <div key={contract} className="mb-6">
                <h3 className="text-xl font-semibold mb-2 text-white">
                  {contractDetails[contract]?.name || contract}
                </h3>
                {data === null ? (
                  <p className="text-gray-400">Wallet not found in this collection.</p>
                ) : data.error ? (
                  <p className="text-red-500">Error: {data.error}</p>
                ) : data.message ? (
                  <p className="text-gray-400">Data not available for this collection.</p>
                ) : (
                  <HolderTable
                    holders={[data]}
                    contract={contract}
                    loading={false}
                    totalShares={data.totalShares}
                    isModal={true}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}

const contractDetails = {
  element280: { name: 'Element280' },
  element369: { name: 'Element369' },
  staxNFT: { name: 'Stax' },
  ascendantNFT: { name: 'Ascendant' },
  e280: { name: 'E280' },
};