'use client';

import { notFound } from 'next/navigation';
import { motion } from 'framer-motion';
import NFTPage from '@/components/NFTPage';
import config from '@/config';

export default function Page({ params }) {
  const { chain, contract } = params;
  console.log('[Page] Received params:', params);

  const supportedContracts = Object.keys(config.contractDetails).map((key) => key.toLowerCase());
  if (!config.supportedChains.includes(chain) || !supportedContracts.includes(contract.toLowerCase())) {
    notFound();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="container page-content"
    >
      <NFTPage chain={chain} contract={contract} />
    </motion.div>
  );
}

export async function generateStaticParams() {
  return Object.entries(config.contractDetails).map(([contractId, details]) => ({
    chain: details.chain,
    contract: contractId.charAt(0).toUpperCase() + contractId.slice(1),
  }));
}

export const revalidate = 60;