// components/HolderTable/Ascendant.js
import { memo } from 'react';
import { motion } from 'framer-motion';
import { contractTiers } from "@/app/nft-contracts";

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function HolderTable({ holders, contract, loading, totalShares }) {
  const safeHolders = Array.isArray(holders) ? holders.filter(h => h && h.wallet) : [];
  const isAscendant = contract === 'ascendantNFT';
  const isElement369 = contract === 'element369';
  const isStax = contract === 'staxNFT';

  if (!safeHolders.length) {
    if (loading) {
      return (
        <div className="overflow-x-auto w-full rounded-lg shadow-lg">
          <table className="w-full bg-gray-800 text-white table-auto md:table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-blue-600 to-blue-800 text-sm md:text-base">
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[120px] md:w-[200px]">Wallet</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total NFTs</th>
                {isElement369 ? (
                  <>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Inferno Rewards</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Flux Rewards</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">E280 Rewards</th>
                  </>
                ) : (
                  <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Claimable Rewards</th>
                )}
                {isAscendant ? (
                  <>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">% Share of Shares</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Shares</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY8 Rewards</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY28 Rewards</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY90 Rewards</th>
                  </>
                ) : (
                  <>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
                    <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total Multiplier</th>
                    {Object.keys(contractTiers[contract] || {})
                      .sort((a, b) => b - a)
                      .map(tier => (
                        <th key={tier} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">
                          {contractTiers[contract][tier].name}
                        </th>
                      ))}
                  </>
                )}
              </tr>
            </thead>
            <tbody className="text-gray-300 text-xs md:text-sm">
              {Array(5).fill().map((_, i) => (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="animate-pulse"
                >
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  {isElement369 ? (
                    <>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                    </>
                  ) : (
                    <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  )}
                  {isAscendant ? (
                    <>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      {Object.keys(contractTiers[contract] || {}).map(tier => (
                        <td key={tier} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                      ))}
                    </>
                  )}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <div className="text-center text-gray-400 py-4 w-full">No holders found.</div>;
  }

  const tiers = contractTiers[contract];
  if (!tiers) {
    return <div className="text-center text-red-500 py-4 w-full">Error: Contract tiers not found for {contract}.</div>;
  }

  return (
    <div className="overflow-x-auto w-full rounded-lg shadow-lg">
      <table className="w-full bg-gray-800 text-white table-auto md:table-fixed">
        <thead>
          <tr className="bg-gradient-to-r from-blue-600 to-blue-800 text-sm md:text-base">
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[120px] md:w-[200px]">Wallet</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total NFTs</th>
            {isElement369 ? (
              <>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Inferno Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Flux Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">E280 Rewards</th>
              </>
            ) : (
              <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Claimable Rewards</th>
            )}
            {isAscendant ? (
              <>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">% Share of Shares</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Shares</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY8 Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY28 Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY90 Rewards</th>
              </>
            ) : (
              <>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total Multiplier</th>
                {Object.keys(tiers)
                  .sort((a, b) => b - a)
                  .map(tier => (
                    <th key={tier} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">
                      {tiers[tier].name}
                    </th>
                  ))}
              </>
            )}
          </tr>
        </thead>
        <tbody className="text-gray-300 text-xs md:text-sm">
          {safeHolders.map((holder, index) => (
            <motion.tr
              key={holder.wallet}
              variants={rowVariants}
              initial="hidden"
              animate="visible"
              whileHover={{ scale: 1.02, backgroundColor: '#1e3a8a' }}
              transition={{ delay: index * 0.05 }}
              className={`transition-colors ${index % 2 === 0 ? "bg-gray-800" : "bg-gray-900"}`}
            >
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.rank}</td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                <a
                  href={`https://etherscan.io/address/${holder.wallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 hover:underline break-all"
                >
                  {holder.wallet.slice(0, 6)}...{holder.wallet.slice(-4)}
                </a>
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.total}</td>
              {isElement369 ? (
                <>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                    {Math.floor(holder.infernoRewards).toLocaleString()}
                  </td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                    {Math.floor(holder.fluxRewards).toLocaleString()}
                  </td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                    {Math.floor(holder.e280Rewards).toLocaleString()}
                  </td>
                </>
              ) : (
                <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                  {(isStax || isAscendant
                    ? Math.floor(holder.claimableRewards)
                    : holder.claimableRewards.toFixed(2)
                  ).toLocaleString()}
                </td>
              )}
              {isAscendant ? (
                <>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                    {totalShares ? ((holder.shares / totalShares) * 100).toFixed(2) : '0.00'}%
                  </td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{Math.floor(holder.shares).toLocaleString()}</td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{Math.floor(holder.pendingDay8).toLocaleString()}</td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{Math.floor(holder.pendingDay28).toLocaleString()}</td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{Math.floor(holder.pendingDay90).toLocaleString()}</td>
                </>
              ) : (
                <>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.percentage.toFixed(2)}%</td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.multiplierSum.toFixed(2)}</td>
                  {Object.keys(tiers)
                    .sort((a, b) => b - a)
                    .map(tier => (
                      <td key={tier} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                        {holder.tiers?.[tier] || 0}
                      </td>
                    ))}
                </>
              )}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(HolderTable);