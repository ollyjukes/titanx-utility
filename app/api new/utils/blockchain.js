// File: app/api/utils/blockchain.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy } from 'alchemy-sdk';
import config from '@/config';
import { logger } from '@/lib/logger.js';
import chalk from 'chalk';

const alchemyApiKey = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('blockchain', 'Alchemy API key is missing', {}, 'eth', 'general');
  throw new Error('Alchemy API key is missing');
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
});

const alchemy = new Alchemy({
  apiKey: config.alchemy.apiKey,
  network: 'eth-mainnet',
});

logger.info('blockchain', 'Blockchain clients initialized', 'eth', 'general');

export { client, alchemy };