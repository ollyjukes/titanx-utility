// components/SearchResultsModal.js
'use client';

import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import config from '@/config.js';

// Loading components
const Element280Loading = () => <div className="text-gray-400">Loading Element280 holder table...</div>;
Element280Loading.displayName = 'Element280Loading';

const Element369Loading = () => <div className="text-gray-400">Loading Element369 holder table...</div>;
Element369Loading.displayName = 'Element369Loading';

const StaxNFTLoading = () => <div className="text-gray-400">Loading Stax holder table...</div>;
StaxNFTLoading.displayName = 'StaxNFTLoading';

const AscendantNFTLoading = () => <div className="text-gray-400">Loading Ascendant holder table...</div>;
AscendantNFTLoading.displayName = 'AscendantNFTLoading';

const E280Loading = () => <div className="text-gray-400">Loading E280 holder table...</div>;
E280Loading.displayName = 'E280Loading';

// Fallback components
const Element280Fallback = () => <div>Error loading holder table for Element280</div>;
Element280Fallback.displayName = 'Element280ErrorFallback';

const Element369Fallback = () => <div>Error loading holder table for Element369</div>;
Element369Fallback.displayName = 'Element369ErrorFallback';

const StaxNFTFallback = () => <div>Error loading holder table for Stax</div>;
StaxNFTFallback.displayName = 'StaxNFTErrorFallback';

const AscendantNFTFallback = () => <div>Error loading holder table for Ascendant</div>;
AscendantNFTFallback.displayName = 'AscendantNFTErrorFallback';

const E280Fallback = () => <div>Error loading holder table for E280</div>;
E280Fallback.displayName = 'E280ErrorFallback';

// Define holder table components for each contract
const holderTableComponents = {
  element280: dynamic(
    () =>
      import('./HolderTable/Element280').catch(err => {
        console.error('Failed to load Element280 HolderTable:', err);
        return { default: Element280Fallback };
      }),
    {
      ssr: false,
      loading: Element280Loading,
    }
  ),
  element369: dynamic(
    () =>
      import('./HolderTable/Element369').catch(err => {
        console.error('Failed to load Element369 HolderTable:', err);
        return { default: Element369Fallback };
      }),
    {
      ssr: false,
      loading: Element369Loading,
    }
  ),
  staxNFT: dynamic(
    () =>
      import('./HolderTable/Stax').catch(err => {
        console.error('Failed to load Stax HolderTable:', err);
        return { default: StaxNFTFallback };
      }),
    {
      ssr: false,
      loading: StaxNFTLoading,
    }
  ),
  ascendantNFT: dynamic(
    () =>
      import('./HolderTable/Ascendant').catch(err => {
        console.error('Failed to load Ascendant HolderTable:', err);
        return { default: AscendantNFTFallback };
      }),
    {
      ssr: false,
      loading: AscendantNFTLoading,
    }
  ),
  e280: dynamic(
    () =>
      import('./HolderTable/E280').catch(err => {
        console.error('Failed to load E280 HolderTable:', err);
        return { default: E280Fallback };
      }),
    {
      ssr: false,
      loading: E280Loading,
    }
  ),
};

// Assign displayName to each dynamically imported component
Object.keys(holderTableComponents).forEach(key => {
  const Component = holderTableComponents[key];
  Component.displayName = `${key}HolderTable`;
});

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
                <h3 className="text-xl font-semibold mb-2">{config.contractDetails[contract]?.name || contract}</h3>
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