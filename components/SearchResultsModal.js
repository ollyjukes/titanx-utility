'use client';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { contractDetails } from '@/app/nft-contracts';

// Define holder table components for each contract
const holderTableComponents = {
  element280: dynamic(
    () =>
      import('./HolderTable/Element280').catch(err => {
        console.error('Failed to load Element280 HolderTable:', err);
        return () => <div>Error loading holder table for Element280</div>;
      }),
    {
      ssr: false,
      loading: () => <div className="text-gray-400">Loading Element280 holder table...</div>,
    }
  ),
  element369: dynamic(
    () =>
      import('./HolderTable/Element369').catch(err => {
        console.error('Failed to load Element369 HolderTable:', err);
        return () => <div>Error loading holder table for Element369</div>;
      }),
    {
      ssr: false,
      loading: () => <div className="text-gray-400">Loading Element369 holder table...</div>,
    }
  ),
  stax: dynamic(
    () =>
      import('./HolderTable/Stax').catch(err => {
        console.error('Failed to load Stax HolderTable:', err);
        return () => <div>Error loading holder table for Stax</div>;
      }),
    {
      ssr: false,
      loading: () => <div className="text-gray-400">Loading Stax holder table...</div>,
    }
  ),
  ascendant: dynamic(
    () =>
      import('./HolderTable/Ascendant').catch(err => {
        console.error('Failed to load Ascendant HolderTable:', err);
        return () => <div>Error loading holder table for Ascendant</div>;
      }),
    {
      ssr: false,
      loading: () => <div className="text-gray-400">Loading Ascendant holder table...</div>,
    }
  ),
  e280: dynamic(
    () =>
      import('./HolderTable/E280').catch(err => {
        console.error('Failed to load E280 HolderTable:', err);
        return () => <div>Error loading holder table for E280</div>;
      }),
    {
      ssr: false,
      loading: () => <div className="text-gray-400">Loading E280 holder table...</div>,
    }
  ),
};

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
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Search Results for {searchAddress}</h2>
          <button onClick={closeModal} className="text-gray-400 hover:text-white text-2xl">
            ×
          </button>
        </div>

        {Object.keys(searchResult).length === 0 ? (
          <p className="text-gray-400">No results available.</p>
        ) : (
          Object.entries(searchResult).map(([contract, data]) => {
            const HolderTable = holderTableComponents[contract] || (() => <div>Holder table not found for {contract}</div>);
            return (
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
                    totalShares={data.totalShares}
                  />
                )}
              </div>
            );
          })
        )}
      </motion.div>
    </div>
  );
}