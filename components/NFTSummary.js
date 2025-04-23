// components/NFTSummary.js
'use client';
import { motion } from 'framer-motion';

const NFTSummary = ({ collectionsData }) => {
  return (
    <div className="w-full max-w-6xl mt-6 mb-4">
      <h2 className="text-lg font-semibold text-white mb-3 text-center">NFT Collections</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {collectionsData.map(({ apiKey, data }) => {
          const isE280 = apiKey === 'e280';
          if (isE280) {
            return (
              <div
                key={apiKey}
                className="bg-gray-800 rounded-md p-3 text-gray-300"
              >
                <h3 className="text-sm font-semibold text-orange-500 mb-1">E280 (Base)</h3>
                <p className="text-xs">Not deployed yet</p>
              </div>
            );
          }

          const {
            holders = [],
            totalTokens = 0,
            summary = {},
            totalLockedAscendant = 0,
            toDistributeDay8 = 0,
            toDistributeDay28 = 0,
            toDistributeDay90 = 0,
            pendingRewards = 0,
            error,
          } = data;

          const uniqueWallets = holders.length;
          const liveNFTs = apiKey === 'element280' ? summary.totalLive || totalTokens : totalTokens;
          const burnedNFTs = summary.totalBurned || 0;
          const totalRewardPool = summary.totalRewardPool || 0;
          const infernoRewards = holders.reduce((sum, h) => sum + (h.infernoRewards || 0), 0);
          const fluxRewards = holders.reduce((sum, h) => sum + (h.fluxRewards || 0), 0);
          const e280Rewards = holders.reduce((sum, h) => sum + (h.e280Rewards || 0), 0);
          const claimableRewards = toDistributeDay8 + toDistributeDay28 + toDistributeDay90;

          const collectionName = {
            element280: 'Element 280',
            element369: 'Element 369',
            staxNFT: 'Stax',
            ascendantNFT: 'Ascendant',
          }[apiKey] || apiKey;

          if (error) {
            return (
              <div
                key={apiKey}
                className="bg-gray-800 rounded-md p-3 text-gray-300"
              >
                <h3 className="text-sm font-semibold text-orange-500 mb-1">{collectionName}</h3>
                <p className="text-xs">Error: {error}</p>
              </div>
            );
          }

          return (
            <motion.div
              key={apiKey}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="bg-gray-800 rounded-md p-3 text-gray-300 hover:shadow-md transition-shadow"
            >
              <h3 className="text-sm font-semibold text-orange-500 mb-1">{collectionName}</h3>
              <div className="space-y-1 text-xs">
                <p>
                  <span className="font-medium">Wallets:</span> {uniqueWallets.toLocaleString()}
                </p>
                <p>
                  <span className="font-medium">Live NFTs:</span> {liveNFTs.toLocaleString()}
                </p>
                {['element280', 'staxNFT'].includes(apiKey) && (
                  <p>
                    <span className="font-medium">Burned:</span> {burnedNFTs.toLocaleString()}
                  </p>
                )}
                {apiKey === 'element280' && (
                  <p>
                    <span className="font-medium">Rewards:</span>{' '}
                    {totalRewardPool.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ELMNT
                  </p>
                )}
                {apiKey === 'element369' && (
                  <>
                    <p>
                      <span className="font-medium">Inferno:</span>{' '}
                      {infernoRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH
                    </p>
                    <p>
                      <span className="font-medium">Flux:</span>{' '}
                      {fluxRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH
                    </p>
                    <p>
                      <span className="font-medium">E280:</span>{' '}
                      {e280Rewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETH
                    </p>
                  </>
                )}
                {apiKey === 'staxNFT' && (
                  <p>
                    <span className="font-medium">Rewards:</span>{' '}
                    {holders.reduce((sum, h) => sum + (h.claimableRewards || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} X28
                  </p>
                )}
                {apiKey === 'ascendantNFT' && (
                  <>
                    <p>
                      <span className="font-medium">Locked:</span>{' '}
                      {totalLockedAscendant.toLocaleString()}
                    </p>
                    <p>
                      <span className="font-medium">Claimable:</span>{' '}
                      {claimableRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DRAGONX
                    </p>
                    <p>
                      <span className="font-medium">Pending:</span>{' '}
                      {pendingRewards.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DRAGONX
                    </p>
                  </>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default NFTSummary;