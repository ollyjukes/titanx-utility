// File: components/SearchResultsModal.js
'use client';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import config from '@/config';

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
    () => import('@/components/HolderTable/Element280').catch((err) => {
      console.error('Failed to load Element280 HolderTable:', err);
      return { default: Element280Fallback };
    }),
    { ssr: false, loading: Element280Loading }
  ),
  element369: dynamic(
    () => import('@/components/HolderTable/Element369').catch((err) => {
      console.error('Failed to load Element369 HolderTable:', err);
      return { default: Element369Fallback };
    }),
    { ssr: false, loading: Element369Loading }
  ),
  stax: dynamic(
    () => import('@/components/HolderTable/Stax').catch((err) => {
      console.error('Failed to load Stax HolderTable:', err);
      return { default: StaxNFTFallback };
    }),
    { ssr: false, loading: StaxNFTLoading }
  ),
  ascendant: dynamic(
    () => import('@/components/HolderTable/Ascendant').catch((err) => {
      console.error('Failed to load Ascendant HolderTable:', err);
      return { default: AscendantNFTFallback };
    }),
    { ssr: false, loading: AscendantNFTLoading }
  ),
  e280: dynamic(
    () => import('@/components/HolderTable/E280').catch((err) => {
      console.error('Failed to load E280 HolderTable:', err);
      return { default: E280Fallback };
    }),
    { ssr: false, loading: E280Loading }
  ),
};

Object.keys(holderTableComponents).forEach((key) => {
  holderTableComponents[key].displayName = `${key}HolderTable`;
});

export default function SearchResultsModal({ searchResult, searchAddress, closeModal, handleBackgroundClick, isOpen, isLoading }) {
  if (!isOpen) return null;

  console.log('[SearchResultsModal] Props:', { searchResult, searchAddress, isOpen, isLoading });

  const modalVariants = {
    hidden: { opacity: 0, y: -50 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -50 },
  };

  const collections = Object.keys(config.nftContracts)
  .filter((key) => !config.nftContracts[key].disabled)
  .map((key) => ({
    apiKey: key,
    name: config.nftContracts[key].name,
  }));

  if (isLoading) {
    return (
      <div className="modal-overlay" onClick={handleBackgroundClick}>
        <motion.div
          className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto border-gray-700 p-6"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-body">Loading search results...</p>
        </motion.div>
      </div>
    );
  }

  if (!searchResult || Object.keys(searchResult).length === 0) {
    return (
      <div className="modal-overlay" onClick={handleBackgroundClick}>
        <motion.div
          className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto border-gray-700 p-6"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-4">
            <h2 className="subtitle">Search Error</h2>
            <button onClick={closeModal} className="text-gray-300 hover:text-gray-100 text-2xl">
              ×
            </button>
          </div>
          <p className="text-error">No search results available. Please try again.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={handleBackgroundClick}>
      <motion.div
        className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto border-gray-700 p-6"
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="subtitle">
            {searchAddress
              ? `NFT Ownership for ${searchAddress.slice(0, 6)}...${searchAddress.slice(-4)}`
              : 'NFT Ownership'}
          </h2>
          <button onClick={closeModal} className="text-gray-300 hover:text-gray-100 text-2xl">
            ×
          </button>
        </div>

        <div className="space-y-section">
          {collections.map(({ apiKey, name }) => {
            const data = searchResult[apiKey];
            console.log(`[SearchResultsModal] Collection ${apiKey} data:`, data);
            const HolderTable = holderTableComponents[apiKey] || (() => <div>Holder table not found for ${apiKey}</div>);
            return (
              <div key={apiKey} className="border-b border-gray-700 pb-4">
                <h3 className="subtitle mb-2">{name}</h3>
                {data === null || data === undefined ? (
                  <p className="text-body">No NFTs owned in this collection.</p>
                ) : data?.error ? (
                  <p className="text-error">Error: {data.error}</p>
                ) : data?.message ? (
                  <p className="text-body">{data.message}</p>
                ) : (
                  <HolderTable
                    holders={data.holders?.map((holder) => ({
                      ...holder,
                      wallet: holder.wallet || holder.address || holder.ownerAddress || '',
                    })) || []}
                    contract={apiKey}
                    loading={false}
                    totalTokens={data.totalTokens || data.totalBurned || 0}
                    totalShares={data.totalShares || data.totalBurned || 0}
                    rewardToken={config.contractDetails[apiKey]?.rewardToken || 'Unknown'}
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