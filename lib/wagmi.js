// @/lib/wagmi.js
import { http, createConfig } from 'wagmi';
import { mainnet } from 'wagmi/chains';

export const config = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`),
  },
});