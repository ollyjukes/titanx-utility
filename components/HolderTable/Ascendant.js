// components/HolderTable/Ascendant.js
'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import config from '@/config.js';

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function HolderTable({ holders, loading, totalShares }) {
  const safeHolders = Array.isArray(holders) ? holders.filter(h => h && h.wallet) : [];

  // Define Ascendant tier order (descending: Tier 8 to Tier 1)
  const ascendantTierOrder = [
    { tierId: '8', name: 'Tier 8', index: 7 },
    { tierId: '7', name: 'Tier 7', index: 6 },
    { tierId: '6', name: 'Tier 6', index: 5 },
    { tierId: '5', name: 'Tier 5', index: 4 },
    { tierId: '4', name: 'Tier 4', index: 3 },
    { tierId: '3', name: 'Tier 3', index: 2 },
    { tierId: '2', name: 'Tier 2', index: 1 },
    { tierId: '1', name: 'Tier 1', index: 0 },
  ];

  // Debugging: Log holders data for the specific wallet
  if (safeHolders.length) {
    const targetWallet = '0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA';
    const targetHolder = safeHolders.find(h => h.wallet.toLowerCase() === targetWallet.toLowerCase());
    if (targetHolder) {
      console.log('[Ascendant] Holder Data for Wallet:', targetHolder);
      console.log('[Ascendant] Tiers Raw Data:', targetHolder.tiers);
      console.log('[Ascendant] Tiers Length:', targetHolder.tiers?.length);
      // Compute tier counts and sum
      const tierCounts = ascendantTierOrder.map(tier => {
        const count =
          // Try one-based array (tiers[8] = Tier 8)
          (Array.isArray(targetHolder.tiers) && targetHolder.tiers[Number(tier.tierId)]) ||
          // Try zero-based array (tiers[7] = Tier 8)
          (Array.isArray(targetHolder.tiers) && targetHolder.tiers[Number(tier.tierId) - 1]) ||
          // Try object (tiers["8"] = Tier 8)
          (targetHolder.tiers && typeof targetHolder.tiers === 'object' && targetHolder.tiers[tier.tierId]) ||
          0;
        return { tier: tier.name, count };
      });
      console.log('[Ascendant] Computed Tier Counts:', tierCounts);
      const tierSum = tierCounts.reduce((sum, { count }) => sum + Number(count), 0);
      console.log('[Ascendant] Tier Sum vs Total NFTs:', { tierSum, total: targetHolder.total });
      if (targetHolder.tiers?.length && targetHolder.tiers.length !== 8) {
        console.warn('[Ascendant] Warning: Unexpected tiers array length:', targetHolder.tiers.length, 'Expected: 8');
      }
      if (tierSum !== targetHolder.total) {
        console.warn('[Ascendant] Warning: Tier sum does not match Total NFTs for wallet', targetWallet);
      }
    }
  }

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
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Claimable Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">% Share of Shares</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Shares</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY8 Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY28 Rewards</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY90 Rewards</th>
                {ascendantTierOrder.map(tier => (
                  <th key={tier.tierId} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">
                    {tier.name}
                  </th>
                ))}
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
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  {ascendantTierOrder.map(tier => (
                    <td key={tier.tierId} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <div className="text-center text-gray-400 py-4 w-full">No holders found.</div>;
  }

  const tiers = config.contractTiers.ascendant;
  if (!tiers) {
    return <div className="text-center text-red-500 py-4 w-full">Error: Contract tiers not found for Ascendant.</div>;
  }

  return (
    <div className="overflow-x-auto w-full rounded-lg shadow-lg">
      <table className="w-full bg-gray-800 text-white table-auto md:table-fixed">
        <thead>
          <tr className="bg-gradient-to-r from-blue-600 to-blue-800 text-sm md:text-base">
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[120px] md:w-[200px]">Wallet</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total NFTs</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Claimable Rewards</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">% Share of Shares</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Shares</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY8 Rewards</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY28 Rewards</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">DAY90 Rewards</th>
            {ascendantTierOrder.map(tier => (
              <th key={tier.tierId} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">
                {tier.name}
              </th>
            ))}
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
              className={`transition-colors ${index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900'}`}
            >
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.rank || '-'}</td>
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
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.total || 0}</td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {Math.floor(holder.claimableRewards || 0).toLocaleString()}
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {totalShares ? ((holder.shares || 0) / totalShares * 100).toFixed(2) : '0.00'}%
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {Math.floor(holder.shares || 0).toLocaleString()}
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {Math.floor(holder.pendingDay8 || 0).toLocaleString()}
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {Math.floor(holder.pendingDay28 || 0).toLocaleString()}
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {Math.floor(holder.pendingDay90 || 0).toLocaleString()}
              </td>
              {ascendantTierOrder.map(tier => (
                <td key={tier.tierId} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                  {
                    // Try one-based array (tiers[8] = Tier 8)
                    (Array.isArray(holder.tiers) && holder.tiers[Number(tier.tierId)]) ||
                    // Try zero-based array (tiers[7] = Tier 8)
                    (Array.isArray(holder.tiers) && holder.tiers[Number(tier.tierId) - 1]) ||
                    // Try object (tiers["8"] = Tier 8)
                    (holder.tiers && typeof holder.tiers === 'object' && holder.tiers[tier.tierId]) ||
                    // Fallback to 0
                    0
                  }
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default memo(HolderTable);