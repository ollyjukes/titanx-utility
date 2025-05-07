'use client';

import { memo } from 'react';
import { motion } from 'framer-motion';
import config from '@/contracts/config.js';

const rowVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const element369TierOrder = config.contractTiers.element369.tierOrder || [
  { tierId: '3', name: 'Legendary' },
  { tierId: '2', name: 'Rare' },
  { tierId: '1', name: 'Common' },
];

function HolderTable({ holders, loading, totalTokens, rewardToken }) {
  const safeHolders = Array.isArray(holders) ? holders.filter(h => h && h.wallet) : [];

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
                <th className="table-cell w-[80px] md:w-[120px]">Inferno Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">Flux Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">E280 Rewards</th>
                <th className="table-cell w-[80px] md:w-[120px]">Reward %</th>
                <th className="table-cell w-[80px] md:w-[120px]">Total Multiplier</th>
                {element369TierOrder.map(tier => (
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
                  {element369TierOrder.map(tier => (
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

  const tiers = config.contractTiers.element369;
  if (!tiers) {
    return <div className="text-error text-center py-4 w-full">Error: Contract tiers not found for Element369.</div>;
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
            <th className="reward-cell w-[80px] md:w-[120px]">Inferno Rewards</th>
            <th className="reward-cell w-[80px] md:w-[120px]">Flux Rewards</th>
            <th className="reward-cell w-[80px] md:w-[120px]">E280 Rewards</th>
            <th className="table-cell w-[80px] md:w-[120px]">Reward %</th>
            <th className="table-cell w-[80px] md:w-[120px]">Total Multiplier</th>
            {element369TierOrder.map(tier => (
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
              <td className="reward-cell">
                {(holder.infernoRewards || 0).toLocaleString()}
              </td>
              <td className="reward-cell">
                {(holder.fluxRewards || 0).toLocaleString()}
              </td>
              <td className="reward-cell">
                {(holder.e280Rewards || 0).toLocaleString()}
              </td>
              <td className="table-cell">
                {(holder.percentage || 0).toFixed(2)}%
              </td>
              <td className="table-cell">
                {(holder.multiplierSum || 0).toFixed(2)}
              </td>
              {element369TierOrder.map(tier => (
                <td key={tier.tierId} className="table-cell">
                  {Array.isArray(holder.tiers) ? holder.tiers[Number(tier.tierId) - 1] || 0 : 0}
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