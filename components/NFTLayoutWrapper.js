// File: components/NFTLayoutWrapper.js

'use client';

import dynamic from 'next/dynamic';

// Dynamically import NFTLayout
const NFTLayout = dynamic(() => import('@/components/NFTLayout'), { ssr: false });

export default function NFTLayoutWrapper({ children }) {
  return <NFTLayout>{children}</NFTLayout>;
}