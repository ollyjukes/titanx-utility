// app/api/utils/config.js
import config from '@/config';
import { logger } from '@/lib/logger.js';

export function validateContractConfig(contractKey) {
  const normalizedKey = contractKey.toLowerCase();
  if (!config.nftContracts[normalizedKey]) {
    logger.error('config', `Invalid contract: ${normalizedKey}`, {}, 'eth', normalizedKey);
    throw new Error(`Invalid contract: ${normalizedKey}`, { cause: { status: 400 } });
  }

  const { address: contractAddress, vaultAddress, disabled } = config.nftContracts[normalizedKey];
  const abi = config.abis[normalizedKey]?.main || [];
  const vaultAbi = config.abis[normalizedKey]?.vault || [];

  if (disabled) {
    logger.warn('config', `Contract ${normalizedKey} is disabled`, {}, 'eth', normalizedKey);
    throw new Error(`Contract ${normalizedKey} is disabled`, { cause: { status: 403 } });
  }

  if (!contractAddress || !abi) {
    logger.error(
      'config',
      `Configuration missing for ${normalizedKey}: address=${contractAddress}, abi=${!!abi}`,
      {},
      'eth',
      normalizedKey
    );
    throw new Error(`Configuration missing for ${normalizedKey}`, { cause: { status: 400 } });
  }

  return { contractAddress, vaultAddress, abi, vaultAbi };
}