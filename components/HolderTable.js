// app/components/HolderTable.js
import { contractTiers } from "@/app/nft-contracts";

export default function HolderTable({ holders, contract, loading }) {
  // Ensure holders is an array
  const safeHolders = Array.isArray(holders) ? holders : [];

  if (!safeHolders || safeHolders.length === 0) {
    if (loading) {
      return (
        <div className="overflow-x-auto w-full rounded-lg shadow-lg">
          <table className="w-full bg-gray-800 text-white table-auto md:table-fixed">
            <thead>
              <tr className="bg-gradient-to-r from-blue-600 to-blue-800 text-sm md:text-base">
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[120px] md:w-[200px]">Wallet</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total NFTs</th>
                <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
                {Array.from({ length: 4 }, (_, i) => 4 - i).map((tier) => (
                  <th key={tier} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[100px]">
                    Tier {tier}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-gray-300 text-xs md:text-sm">
              {Array(5).fill().map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                  <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700"><div className="h-4 bg-gray-600 rounded w-3/4"></div></td>
                </tr>
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
    return <div className="text-center text-red-500 py-4 w-full">Error: Contract tiers not found.</div>;
  }
  const maxTier = Math.max(...Object.keys(tiers).map(Number));
  const sortedHolders = [...safeHolders].sort((a, b) => a.rank - b.rank);

  return (
    <div className="overflow-x-auto w-full rounded-lg shadow-lg">
      <table className="w-full bg-gray-800 text-white table-auto md:table-fixed">
        <thead>
          <tr className="bg-gradient-to-r from-blue-600 to-blue-800 text-sm md:text-base">
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[60px] md:w-[80px] rounded-tl-lg">Rank</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[120px] md:w-[200px]">Wallet</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Total NFTs</th>
            <th className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[120px]">Reward %</th>
            {Array.from({ length: maxTier }, (_, i) => maxTier - i).map((tier) => (
              <th key={tier} className="py-2 px-2 md:py-4 md:px-6 text-left font-semibold w-[80px] md:w-[100px]">
                {tiers[tier].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-gray-300 text-xs md:text-sm">
          {sortedHolders.map((holder, index) => (
            <tr
              key={holder.wallet}
              className={`transition-colors ${index % 2 === 0 ? "bg-gray-800" : "bg-gray-900"} hover:bg-blue-700`}
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
              <td className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">{holder.percentage.toFixed(2)}%</td>
              {holder.tiers.slice(1, maxTier + 1).reverse().map((count, i) => (
                <td key={maxTier - i} className="py-2 px-2 md:py-4 md:px-6 border-b border-gray-700">
                  {count}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}