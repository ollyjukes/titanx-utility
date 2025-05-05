'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import config from '@/contracts/config.js';

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

function HolderTable({ holders, loading, totalShares, totalTokens, rewardToken }) {
  const safeHolders = Array.isArray(holders) ? holders.filter(h => h && h.wallet) : [];

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
      const tierCounts = ascendantTierOrder.map(tier => {
        const count =
          (Array.isArray(targetHolder.tiers) && targetHolder.tiers[Number(tier.tierId)]) ||
          (Array.isArray(targetHolder.tiers) && targetHolder.tiers[Number(tier.tierId) - 1]) ||
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
        <div className="table-container">
          <table className="table">
            <thead className="table-head">
              <tr>
                <th className="table-cell w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
                <th className="table-cell w-[120px] md:w-[200px]">Wallet</th>
                <th className="table-cell w-[80px] md:w-[120px]">Total NFTs</th>
                <th className="table-cell w-[80px] md:w-[120px]">Claimable Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">% Share of Shares</th>
                <th className="table-cell w-[80px] md:w-[120px]">Shares</th>
                <th className="table-cell w-[80px] md:w-[120px]">DAY8 Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">DAY28 Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">DAY90 Rewards</th>
                {ascendantTierOrder.map(tier => (
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
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  <td className="table-cell"><div className="table-pulse-placeholder"></div></td>
                  {ascendantTierOrder.map(tier => (
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

  const tiers = config.contractTiers.ascendant;
  if (!tiers) {
    return <div className="text-error text-center py-4 w-full">Error: Contract tiers not found for Ascendant.</div>;
  }

  return (
    <div className="table-container">
      {safeHolders.length > 0 && (
        <div className="text-body mb-4">
          <p><strong>Total Tokens:</strong> {totalTokens?.toLocaleString() || 'N/A'}</p>
          <p><strong>Reward Token:</strong> {rewardToken || 'N/A'}</p>
          <p><strong>Total Shares:</strong> {totalShares?.toLocaleString() || 'N/A'}</p>
        </div>
      )}
      <table className="table">
        <thead className="table-head">
          <tr>
            <th className="table-cell w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
            <th className="table-cell w-[120px] md:w-[200px]">Wallet</th>
            <th className="table-cell w-[80px] md:w-[120px]">Total NFTs</th>
            <th className="table-cell w-[80px] md:w-[120px]">Claimable Rewards</th>
            <th className="table-cell w-[80px] md:w-[120px]">% Share of Shares</th>
            <th className="table-cell w-[80px] md:w-[120px]">Shares</th>
            <th className="table-cell w-[80px] md:w-[120px]">DAY8 Rewards</th>
            <th className="table-cell w-[80px] md:w-[120px]">DAY28 Rewards</th>
            <th className="table-cell w-[80px] md:w-[120px]">DAY90 Rewards</th>
            {ascendantTierOrder.map(tier => (
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
                {totalShares ? ((holder.shares || 0) / totalShares * 100).toFixed(2) : '0.00'}%
              </td>
              <td className="table-cell">
                {Math.floor(holder.shares || 0).toLocaleString()}
              </td>
              <td className="table-cell">
                {Math.floor(holder.pendingDay8 || 0).toLocaleString()}
              </td>
              <td className="table-cell">
                {Math.floor(holder.pendingDay28 || 0).toLocaleString()}
              </td>
              <td className="table-cell">
                {Math.floor(holder.pendingDay90 || 0).toLocaleString()}
              </td>
              {ascendantTierOrder.map(tier => (
                <td key={tier.tierId} className="table-cell">
                  {
                    (Array.isArray(holder.tiers) && holder.tiers[Number(tier.tierId)]) ||
                    (Array.isArray(holder.tiers) && holder.tiers[Number(tier.tierId) - 1]) ||
                    (holder.tiers && typeof holder.tiers === 'object' && holder.tiers[tier.tierId]) ||
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