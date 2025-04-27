'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import config from '@/config.js';

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function HolderTable({ holders, loading, totalTokens, rewardToken }) {
  const safeHolders = Array.isArray(holders) ? holders.filter(h => h && h.wallet) : [];

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
      const tierCounts = staxTierOrder.map(tier => {
        const count =
          (Array.isArray(targetHolder.tiers) && Number(targetHolder.tiers[Number(tier.tierId) - 1]) || 0);
        return { tier: tier.name, count };
      });
      console.log('[Stax] Computed Tier Counts:', tierCounts);
      const tierSum = tierCounts.reduce((sum, { count }) => sum + Number(count), 0);
      console.log('[Stax] Tier Sum vs Total NFTs:', { tierSum, total: targetHolder.total });
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
        <div className="table-container">
          <table className="table">
            <thead className="table-head">
              <tr>
                <th className="table-cell w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
                <th className="table-cell w-[120px] md:w-[200px]">Wallet</th>
                <th className="table-cell w-[80px] md:w-[120px]">Total NFTs</th>
                <th className="table-cell w-[80px] md:w-[120px]">Claimable Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">Reward %</th>
                <th className="table-cell w-[80px] md:w-[120px]">Total Multiplier</th>
                {staxTierOrder.map(tier => (
                  <th key={tier.tierId} className="table-cell w-[80px] md:w-[120px]">
                    {tier.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="table-body">
              {Array(5).fill().map((_, i) => (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="table-row table-pulse"
                >
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  {staxTierOrder.map(tier => (
                    <td key={tier.tierId} className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <div className="text-body text-center py-4 w-full">No holders found.</div>;
  }

  const tiers = config.contractTiers.stax;
  if (!tiers) {
    return <div className="text-error text-center py-4 w-full">Error: Contract tiers not found for Stax.</div>;
  }

  return (
    <div className="table-container">
      {safeHolders.length > 0 && (
        <div className="text-body mb-4">
          <p><strong>Total Tokens:</strong> {totalTokens?.toLocaleString() || 'N/A'}</p>
          <p><strong>Reward Token:</strong> {rewardToken || 'N/A'}</p>
        </div>
      )}
      <table className="table">
        <thead className="table-head">
          <tr>
            <th className="table-cell w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
            <th className="table-cell w-[120px] md:w-[200px]">Wallet</th>
            <th className="table-cell w-[80px] md:w-[120px]">Total NFTs</th>
            <th className="table-cell w-[80px] md:w-[120px]">Claimable Rewards</th>
            <th className="table-cell w-[80px] md:w-[120px]">Reward %</th>
            <th className="table-cell w-[80px] md:w-[120px]">Total Multiplier</th>
            {staxTierOrder.map(tier => (
              <th key={tier.tierId} className="table-cell w-[80px] md:w-[120px]">
                {tier.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="table-body">
          {safeHolders.map((holder, index) => (
            <motion.tr
              key={holder.wallet}
              variants={rowVariants}
              initial="hidden"
              animate="visible"
              whileHover={{ scale: 1.02 }}
              transition={{ delay: index * 0.05 }}
              className={`table-row ${index % 2 === 0 ? 'table-row-even' : 'table-row-odd'}`}
            >
              <td className="table-cell">{holder.rank || '-'}</td>
              <td className="table-cell">
                <a
                  href={`https://etherscan.io/address/${holder.wallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="table-link"
                >
                  {holder.wallet.slice(0, 6)}...{holder.wallet.slice(-4)}
                </a>
              </td>
              <td className="table-cell">{holder.total || 0}</td>
              <td className="table-cell">
                {Math.floor(holder.claimableRewards || 0).toLocaleString()}
              </td>
              <td className="table-cell">
                {typeof holder.percentage === 'number' ? holder.percentage.toFixed(2) + '%' : '-'}
              </td>
              <td className="table-cell">
                {typeof holder.multiplierSum === 'number' ? holder.multiplierSum.toFixed(2) : '-'}
              </td>
              {staxTierOrder.map(tier => (
                <td key={tier.tierId} className="table-cell">
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