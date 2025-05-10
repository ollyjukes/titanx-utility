import { mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/app/lib/logger';
import config from '@/app/contracts_nft';
import { Alchemy, Network } from 'alchemy-sdk';

export const alchemy = new Alchemy({
  apiKey: config.alchemy.apiKey || (() => { throw new Error('Alchemy API key missing'); })(),
  network: Network.ETH_MAINNET,
});

export const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`),
});

export async function ensureCacheDirectory() {
  const cacheDir = join(process.cwd(), 'cache');
  const chain = 'eth';
  const collection = 'general';
  try {
    logger.debug('holders', `Ensuring cache directory at: ${cacheDir}`, chain, collection);
    await mkdir(cacheDir, { recursive: true });
    logger.info('holders', `Cache directory created or exists: ${cacheDir}`, chain, collection);
  } catch (error) {
    logger.error('holders', `Failed to create cache directory: ${error.message}`, { stack: error.stack }, chain, collection);
    throw new Error(`Cache directory creation failed: ${error.message}`);
  }
}

export function sanitizeBigInt(obj) {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(item => sanitizeBigInt(item));
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBigInt(value);
    }
    return sanitized;
  }
  return obj;
}