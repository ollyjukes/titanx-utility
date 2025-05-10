// app/components/HolderTable.js
'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function HolderTable({ holders, contract, loading }) {
  const [sortConfig, setSortConfig] = useState({ key: 'rank', direction: 'asc' });
  const [expandedRows, setExpandedRows] = useState({});

  const requestSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedHolders = [...holders].sort((a, b) => {
    if (sortConfig.key === 'wallet') {
      return sortConfig.direction === 'asc'
        ? a.wallet.localeCompare(b.wallet)
        : b.wallet.localeCompare(a.wallet);
    }
    const aValue = a[sortConfig.key] || 0;
    const bValue = b[sortConfig.key] || 0;
    return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
  });

  const toggleRow = (wallet) => {
    setExpandedRows(prev => ({
      ...prev,
      [wallet]: !prev[wallet],
    }));
  };

  const renderTransactionList = (nfts, type) => (
    <ul className="list-disc pl-6">
      {nfts.length === 0 ? (
        <li>No {type} NFTs</li>
      ) : (
        nfts.map((nft, index) => (
          <li key={index}>
            Token ID: {nft.tokenId} (
            <Link
              href={`https://etherscan.io/tx/${nft.transactionHash}`}
              target="_blank"
              className="text-blue-400 hover:underline"
            >
              View Tx
            </Link>
            ) - {new Date(nft.timestamp).toLocaleString()}
          </li>
        ))
      )}
    </ul>
  );

  if (loading) {
    return <p className="text-gray-400">Loading holders...</p>;
  }

  if (!holders || holders.length === 0) {
    return <p className="text-gray-400">No holders found for this contract.</p>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="min-w-full bg-gray-800 rounded-lg shadow">
        <thead>
          <tr className="text-left text-gray-300">
            <th className="p-4 cursor-pointer" onClick={() => requestSort('rank')}>
              Rank {sortConfig.key === 'rank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('wallet')}>
              Wallet {sortConfig.key === 'wallet' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('total')}>
              Total NFTs {sortConfig.key === 'total' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('multiplierSum')}>
              Multiplier {sortConfig.key === 'multiplierSum' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('percentage')}>
              % of Pool {sortConfig.key === 'percentage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('buyCount')}>
              Buys {sortConfig.key === 'buyCount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('sellCount')}>
              Sells {sortConfig.key === 'sellCount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4 cursor-pointer" onClick={() => requestSort('burnCount')}>
              Burns {sortConfig.key === 'burnCount' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </th>
            <th className="p-4">Details</th>
          </tr>
        </thead>
        <tbody>
          {sortedHolders.map((holder) => (
            <React.Fragment key={holder.wallet}>
              <tr className="border-t border-gray-700 hover:bg-gray-700">
                <td className="p-4">{holder.rank}</td>
                <td className="p-4">
                  <Link
                    href={`https://etherscan.io/address/${holder.wallet}`}
                    target="_blank"
                    className="text-blue-400 hover:underline"
                  >
                    {holder.wallet.slice(0, 6)}...{holder.wallet.slice(-4)}
                  </Link>
                </td>
                <td className="p-4">{holder.total}</td>
                <td className="p-4">{holder.displayMultiplierSum || (holder.multiplierSum / 10)}</td>
                <td className="p-4">{holder.percentage.toFixed(2)}%</td>
                <td className="p-4">{holder.buyCount}</td>
                <td className="p-4">{holder.sellCount}</td>
                <td className="p-4">{holder.burnCount}</td>
                <td className="p-4">
                  <button
                    onClick={() => toggleRow(holder.wallet)}
                    className="text-blue-400 hover:underline"
                  >
                    {expandedRows[holder.wallet] ? 'Hide' : 'Show'}
                  </button>
                </td>
              </tr>
              {expandedRows[holder.wallet] && (
                <tr>
                  <td colSpan="9" className="p-4 bg-gray-900">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <h4 className="font-semibold">Bought NFTs</h4>
                        {renderTransactionList(holder.boughtNfts, 'bought')}
                      </div>
                      <div>
                        <h4 className="font-semibold">Sold NFTs</h4>
                        {renderTransactionList(holder.soldNfts, 'sold')}
                      </div>
                      <div>
                        <h4 className="font-semibold">Burned NFTs</h4>
                        {renderTransactionList(holder.burnedNfts, 'burned')}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}