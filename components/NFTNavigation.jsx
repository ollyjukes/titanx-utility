// components/NFTNavigation.jsx
import Link from 'next/link';

export default function NFTNavigation() {
  const nftCollections = [
    { name: 'Element280', href: '/nft/ETH/Element280' },
    { name: 'Element369', href: '/nft/ETH/Element369' },
    { name: 'Stax', href: '/nft/ETH/Stax' },
    { name: 'Ascendant', href: '/nft/ETH/Ascendant' },
    { name: 'E280 (Base)', href: '/nft/BASE/E280' },
  ];

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-md w-full max-w-6xl mb-6">
      <h2 className="text-2xl font-semibold text-white mb-4">TitanX NFT Protocols</h2>
      <div className="flex flex-wrap gap-4">
        {nftCollections.map((collection) => (
          <Link
            key={collection.name}
            href={collection.href}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            {collection.name}
          </Link>
        ))}
      </div>
    </div>
  );
}