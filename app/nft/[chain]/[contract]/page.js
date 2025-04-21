// app/nft/[chain]/[contract]/page.js
import { notFound } from 'next/navigation';
import NFTPage from '@/components/NFTPage';
import { supportedChains, contractDetails } from '@/app/nft-contracts';

export default function Page({ params }) {
  const { chain, contract } = params;
  console.log('[Page] Received params:', params); // Debug params

  // Validate chain and contract
  const supportedContracts = Object.keys(contractDetails).map(key => key.toLowerCase());
  if (!supportedChains.includes(chain) || !supportedContracts.includes(contract.toLowerCase())) {
    notFound(); // Render 404 for invalid chain or contract
  }

  return <NFTPage chain={chain} contract={contract} />;
}

// Define static paths for SSG
export async function generateStaticParams() {
  // Generate paths from contractDetails
  return Object.entries(contractDetails).map(([contractId, details]) => ({
    chain: details.chain,
    contract: contractId.charAt(0).toUpperCase() + contractId.slice(1), // Capitalize first letter (e.g., 'element280' -> 'Element280')
  }));
}

// Enable Incremental Static Regeneration (ISR)
export const revalidate = 60; // Revalidate every 60 seconds