// This is a client component that wraps the ClientHome component with WagmiSetup
// and uses dynamic import to prevent server-side rendering. It imports WagmiSetup
// from the WagmiProvider.js file, which sets up the Wagmi provider and query client.

// app/ClientWrapper.js
'use client';
import dynamic from 'next/dynamic';
import WagmiSetup from './WagmiProvider';

const ClientHomeContent = dynamic(() => import('./ClientHome'), { ssr: false });

export default function ClientWrapper() {
  return (
    <WagmiSetup>
      <ClientHomeContent />
    </WagmiSetup>
  );
}
