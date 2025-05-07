import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy } from 'alchemy-sdk';
import config from '@/contracts/config';
import { logger } from '@/app/lib/logger';

const alchemyApiKey = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('utils/client', 'Alchemy API key is missing', {}, 'eth', 'general');
  throw new Error('Alchemy API key is missing');
}

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
});

export const alchemy = new Alchemy({
  apiKey: config.alchemy.apiKey,
  network: 'eth-mainnet',
});