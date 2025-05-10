// app/api/utils/client.js
import { Alchemy, Network } from 'alchemy-sdk';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config from '@/app/contracts_nft';

export const alchemy = new Alchemy({
  apiKey: config.alchemy.apiKey,
  network: Network.ETH_MAINNET,
});

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`),
});