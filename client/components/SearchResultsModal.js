'use client';

import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import config from '@/contracts/config.js';

// Loading components
const Element280Loading = () => <div className="text-body">Loading Element280 data...</div>;
Element280Loading.displayName = 'Element280Loading';

const Element369Loading = () => <div className="text-body">Loading Element369 data...</div>;
Element369Loading.displayName = 'Element369Loading';

const StaxNFTLoading = () => <div className="text-body">Loading Stax data...</div>;
StaxNFTLoading.displayName = 'StaxNFTLoading';

const AscendantNFTLoading = () => <div className="text-body">Loading Ascendant data...</div>;
AscendantNFTLoading.displayName = 'AscendantNFTLoading';

const E280Loading = () => <div className="text-body">Loading E280 data...</div>;
E280Loading.displayName = 'E280Loading';

// Fallback components
const Element280Fallback = () => <div className="text-error">Error loading data for Element280</div>;
Element280Fallback.displayName = 'Element280ErrorFallback';

const Element369Fallback = () => <div className="text-error">Error loading data for Element369</div>;
Element369Fallback.displayName = 'Element369ErrorFallback';

const StaxNFTFallback = () => <div className="text-error">Error loading data for Stax</div>;
StaxNFTFallback.displayName = 'StaxNFTErrorFallback';

const AscendantNFTFallback = () => <div className="text-error">Error loading data for Ascendant</div>;
AscendantNFTFallback.displayName = 'AscendantNFTErrorFallback';

const E280Fallback = () => <div className="text-error">Error loading data for E280</div>;
E280Fallback.displayName = 'E280ErrorFallback';

const holderTableComponents = {
  element280: dynamic(
    () => import('./HolderTable/Element280').catch((err) => {
      console.error('Failed to load Element280 HolderTable:', err);
      return { default: Element280Fallback };
    }),
    { ssr: false, loading: Element280Loading }
  ),
  element369: dynamic(
    () => import('./HolderTable/Element369').catch((err) => {
      console.error('Failed to load Element369 HolderTable:', err);
      return { default: Element369Fallback };
    }),
    { ssr: false, loading: Element369Loading }
  ),
  stax: dynamic(
    () => import('./HolderTable/Stax').catch((err) => {
      console.error('Failed to load Stax HolderTable:', err);
      return { default: StaxNFTFallback };
    }),
    { ssr: false, loading: StaxNFTLoading }
  ),
  ascendantNFT: dynamic(
    () => import('./HolderTable/Ascendant').catch((err) => {
      console.error('Failed to load Ascendant HolderTable:', err);
      return { default: AscendantNFTFallback };
    }),
    { ssr: false, loading: AscendantNFTLoading }
  ),
  e280: dynamic(
    () => import('./HolderTable/E280').catch((err) => {
      console.error('Failed to load E280 HolderTable:', err);
      return { default: E280Fallback };
    }),
    { ssr: false, loading: E280Loading }
  ),
};

Object.keys(holderTableComponents).forEach((key) => {
  holderTableComponents[key].displayName = `${key}HolderTable`;
});

export default function SearchResultsModal({ searchResult, searchAddress, closeModal, handleBackgroundClick }) {
  const modalVariants = {
    hidden: { opacity: 0, y: -50 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -50 },
  };

  const collections = [
    { apiKey: 'element280', name: 'Element280' },
    { apiKey: 'element369', name: 'Element369' },
    { apiKey: 'stax', name: 'Stax' },
    { apiKey: 'ascendantNFT', name: 'Ascendant' },
    { apiKey: 'e280', name: 'E280' },
  ];

  return (
    <div className="modal-overlay" onClick={handleBackgroundClick}>
      <motion.div
        className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto border-gray-700"
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="subtitle">
            NFT Ownership for {searchAddress.slice(0, 6)}...{searchAddress.slice(-4)}
          </h2>
          <button onClick={closeModal} className="text-gray-300 hover:text-gray-100 text-2xl">
            ×
          </button>
        </div>

        <div className="space-y-section">
          {collections.map(({ apiKey, name }) => {
            const data = searchResult[apiKey];
            const HolderTable = holderTableComponents[apiKey] || (() => <div>Holder table not found for {apiKey}</div>);
            return (
              <div key={apiKey} className="border-b border-gray-700 pb-4">
                <h3 className="subtitle mb-2">{name}</h3>
                {data === null ? (
                  <p className="text-body">No NFTs owned in this collection.</p>
                ) : data?.error ? (
                  <p className="text-error">Error: {data.error}</p>
                ) : data?.message ? (
                  <p className="text-body">{data.message}</p>
                ) : (
                  <HolderTable
                    holders={[data]}
                    contract={apiKey}
                    loading={false}
                    totalTokens={data.totalTokens || 0}
                    totalShares={data.totalShares}
                    rewardToken={data.rewardToken || config.contractDetails[apiKey]?.rewardToken}
                  />
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}