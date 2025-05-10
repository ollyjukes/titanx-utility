// app/lib/serverInit.js
import { logger } from '@/app/lib/logger';
import { initializeCache } from '@/app/api/utils/cache';
import { populateHoldersMapCache } from '@/app/api/holders/cache/holders';
import config from '@/app/contracts_nft';
import { getContractAbi } from '@/app/contracts/abi_nft';
import chalk from 'chalk';



export async function initializeServer() {
  logger.info('serverInit', `Server initialization started in ${process.env.NODE_ENV} mode`);
  if (!config.alchemy.apiKey) {
    logger.error('serverInit', 'Alchemy API key is missing');
    throw new Error('Alchemy API key is missing');
  }
  await initializeCache();
  const contracts = Object.keys(config.nftContracts);
  for (const contractKey of contracts) {
    const contractConfig = config.nftContracts[contractKey.toLowerCase()];
    if (!contractConfig) continue;
    await populateHoldersMapCache(
      contractKey,
      contractConfig.contractAddress,
      getContractAbi(contractKey, 'nft'),
      contractConfig.vaultAddress,
      getContractAbi(contractKey, 'vault')
    );
  }
  logger.info('serverInit', chalk.green('Server initialized'));
}