'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import { contractTiers } from '@/app/nft-contracts';

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function HolderTable({ holders, loading }) {
  const safeHolders = Array.isArray(holders) ? holders.filter(h => h && h.wallet) : [];

  // Define Stax tier order (highest to lowest: Legendary LFG to Common)
  const staxTierOrder = [
    { tierId: '12', name: 'Legendary LFG', index: 11 },
    { tierId: '11', name: 'Legendary Super', index: 10 },
    { tierId: '10', name: 'Legendary Amped', index: 9 },
    { tierId: '9', name: 'Legendary', index: 8 },
    { tierId: '8', name: 'Rare LFG', index: 7 },
    { tierId: '7', name: 'Rare Super', index: 6 },
    { tierId: '6', name: 'Rare Amped', index: 5 },
    { tierId: '5', name: 'Rare', index: 4 },
    { tierId: '4', name: 'Common LFG', index: 3 },
    { tierId: '3', name: 'Common Super', index: 2 },
    { tierId: '2', name: 'Common Amped', index: 1 },
    { tierId: '1', name: 'Common', index: 0 },
  ];

  // Debugging: Log holders data for the specific wallet
  if (safeHolders.length) {
    const targetWallet = '0x15702443110894B26911B913b17ea4931F803B02';
    const targetHolder = safeHolders.find(h => h.wallet.toLowerCase() === targetWallet.toLowerCase());
    if (targetHolder) {
      console.log('[Stax] Holder Data for Wallet:', targetHolder);
      console.log('[Stax] Tiers Raw Data:', targetHolder.tiers);
      console.log('[Stax] Tiers Length:', targetHolder.tiers?.length);
      // Compute tier counts
      const tierCounts = staxTierOrder.map(tier => {
        const count =
          (Array.isArray(targetHolder.tiers) && Number(targetHolder.tiers[Number(tier.tierId) - 1]) || 0);
        return { tier: tier.name, count };
      });
      console.log('[Stax] Computed Tier Counts:', tierCounts);
      const tierSum = tierCounts.reduce((sum, { count }) => sum + Number(count), 0);
      console.log('[Stax] Tier Sum vs Total NFTs:', { tierSum, total: targetHolder.total });
      // Calculate expected multiplier sum
      const multipliers = {
        '12': 200, '11': 140, '10': 120, '9': 100, '8': 20, '7': 14, '6': 12, '5': 10,
        '4': 2, '3': 1.4, '2': 1.2, '1': 1
      };
      const expectedMultiplierSum = tierCounts.reduce((sum, { count }, idx) => {
        const tierId = staxTierOrder[idx].tierId;
        return sum + count * multipliers[tierId];
      }, 0);
      console.log('[Stax] Multiplier Sum:', {
        actual: targetHolder.multiplierSum,
        expected: expectedMultiplierSum
      });
      if (targetHolder.tiers?.length && targetHolder.tiers.length !== 12) {
        console.warn('[Stax] Warning: Unexpected tiers array length:', targetHolder.tiers.length, 'Expected: 12');
      }
      if (tierSum !== targetHolder.total) {
        console.warn('[Stax] Warning: Tier sum does not match Total NFTs for wallet', targetWallet);
      }
      if (targetHolder.multiplierSum !== expectedMultiplierSum) {
        console.warn('[Stax] Warning: Multiplier sum mismatch for wallet', targetWallet, {
          actual: targetHolder.multiplierSum,
          expected: expectedMultiplierSum
        });
      }
    } else {
      console.warn('[Stax] Warning: Wallet not found in holders:', targetWallet);
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
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total Multiplier</th>
                {staxTierOrder.map(tier => (
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
                  {staxTierOrder.map(tier => (
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

  const tiers = contractTiers.stax;
  if (!tiers) {
    return <div className="text-center text-red-500 py-4 w-full">Error: Contract tiers not found for Stax.</div>;
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
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total Multiplier</th>
            {staxTierOrder.map(tier => (
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
                {typeof holder.percentage === 'number' ? holder.percentage.toFixed(2) + '%' : '-'}
              </td>
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                {typeof holder.multiplierSum === 'number' ? holder.multiplierSum.toFixed(2) : '-'}
              </td>
              {staxTierOrder.map(tier => (
                <td key={tier.tierId} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                  {Array.isArray(holder.tiers) ? Number(holder.tiers[Number(tier.tierId) - 1]) || 0 : 0}
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