'use client';
import { WagmiProvider as WagmiProviderCore, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { http } from 'viem';
import { injected, walletConnect } from '@wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_KEY}`),
  },
  connectors: [
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || '',
    }),
  ],
});

export default function WagmiSetup({ children }) {
  console.log('WagmiSetup: Provider mounting');
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProviderCore config={config}>
        {console.log('WagmiSetup: WagmiProviderCore rendered')}
        {children}
      </WagmiProviderCore>
    </QueryClientProvider>
  );
}