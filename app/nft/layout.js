// app/nft/layout.js
'use client';
import { useState } from 'react';
import Link from 'next/link';

export default function NFTLayout({ children }) {
  const [selectedChain, setSelectedChain] = useState(null);
  const [showE280Message, setShowE280Message] = useState(false); // Track E280 click

  const chains = [
    { name: 'ETH', id: 'eth' },
    { name: 'BASE', id: 'base' },
  ];

  const ethNFTs = [
    { name: 'Element280', href: '/nft/ETH/Element280' },
    { name: 'Element369', href: '/nft/ETH/Element369' },
    { name: 'Stax', href: '/nft/ETH/Stax' },
    { name: 'Ascendant', href: '/nft/ETH/Ascendant' },
  ];

  const baseNFTs = [
    { name: 'E280', href: null }, // No href, we'll handle it with a message
  ];

  const handleChainClick = (chainId) => {
    setSelectedChain(chainId === selectedChain ? null : chainId);
    setShowE280Message(false); // Reset E280 message when changing chains
  };

  const handleE280Click = () => {
    setShowE280Message(true); // Show message instead of navigating
  };

  return (
    <div className="flex-1 p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-8">TitanX NFT Protocols</h1>
      <div className="flex space-x-4 mb-6">
        {chains.map((chain) => (
          <button
            key={chain.id}
            onClick={() => handleChainClick(chain.id)}
            className={`px-6 py-2 rounded-md font-semibold transition-colors ${
              selectedChain === chain.id
                ? 'bg-orange-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {chain.name}
          </button>
        ))}
      </div>
      {selectedChain === 'eth' && (
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0 w-full max-w-6xl">
          {ethNFTs.map((nft) => (
            <Link key={nft.name} href={nft.href} className="flex-1">
              <button className="w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-md font-semibold hover:bg-orange-500 hover:text-white transition-colors">
                {nft.name}
              </button>
            </Link>
          ))}
        </div>
      )}
      {selectedChain === 'base' && (
        <div className="flex flex-col md:flex-row md:space-x-4 space-y-4 md:space-y-0 w-full max-w-6xl">
          {baseNFTs.map((nft) => (
            nft.href ? (
              <Link key={nft.name} href={nft.href} className="flex-1">
                <button className="w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-md font-semibold hover:bg-orange-500 hover:text-white transition-colors">
                  {nft.name}
                </button>
              </Link>
            ) : (
              <button
                key={nft.name}
                onClick={handleE280Click}
                className="flex-1 w-full px-6 py-3 bg-gray-700 text-gray-300 rounded-md font-semibold hover:bg-orange-500 hover:text-white transition-colors"
              >
                {nft.name}
              </button>
            )
          ))}
        </div>
      )}
      {showE280Message && (
        <div className="mt-6 text-center text-white">
          <p className="text-lg">Contract not yet deployed. Coming soon...</p>
        </div>
      )}
      <div className="w-full max-w-6xl">{children}</div>
    </div>
  );
}