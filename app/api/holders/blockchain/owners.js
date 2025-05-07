import { Alchemy } from 'alchemy-sdk';
import { logger } from '@/app/lib/logger';
import config from '@/contracts/config';

const alchemy = new Alchemy({
  apiKey: config.alchemy.apiKey,
  network: 'eth-mainnet',
});

export async function getOwnersForContract(contractAddress, abi, options = {}) {
  let owners = [];
  let pageKey = options.pageKey || null;
  const maxPages = options.maxPages || 10;
  let pageCount = 0;

  logger.debug(
    'utils',
    `Fetching owners for contract: ${contractAddress} with options: ${JSON.stringify(options)}`,
    'eth',
    'general'
  );

  do {
    try {
      const response = await alchemy.nft.getOwnersForContract(contractAddress, {
        withTokenBalances: options.withTokenBalances || false,
        pageKey,
      });

      logger.debug(
        'utils',
        `Raw Alchemy response: ownersExists=${!!response.owners}, isArray=${Array.isArray(response.owners)}, ownersLength=${
          response.owners?.length || 0
        }, pageKey=${response.pageKey || null}, responseKeys=${Object.keys(response)}, sampleOwners=${JSON.stringify(
          response.owners?.slice(0, 2) || []
        )}`,
        'eth',
        'general'
      );

      if (!response.owners || !Array.isArray(response.owners)) {
        logger.error('utils', `Invalid Alchemy response for ${contractAddress}: ${JSON.stringify(response)}`, {}, 'eth', 'general');
        throw new Error('Invalid owners response from Alchemy API');
      }

      for (const owner of response.owners) {
        const tokenBalances = owner.tokenBalances || [];
        logger.debug(
          'utils',
          `Processing owner: ${owner.ownerAddress}, tokenBalancesCount=${tokenBalances.length}`,
          'eth',
          'general'
        );

        if (tokenBalances.length > 0) {
          const validBalances = tokenBalances.filter(tb => tb.tokenId && Number(tb.balance) > 0);
          if (validBalances.length > 0) {
            owners.push({
              ownerAddress: owner.ownerAddress.toLowerCase(),
              tokenBalances: validBalances.map(tb => ({
                tokenId: Number(tb.tokenId),
                balance: Number(tb.balance),
              })),
            });
          }
        }
      }

      pageKey = response.pageKey || null;
      pageCount++;
      logger.debug('utils', `Fetched page ${pageCount}, owners: ${owners.length}, pageKey: ${pageKey}`, 'eth', 'general');

      if (pageCount >= maxPages) {
        logger.warn('utils', `Reached max pages (${maxPages}) for owner fetching`, 'eth', 'general');
        break;
      }
    } catch (error) {
      logger.error('utils', `Failed to fetch owners for ${contractAddress}: ${error.message}`, { stack: error.stack }, 'eth', 'general');
      throw error;
    }
  } while (pageKey);

  logger.debug('utils', `Processed owners: count=${owners.length}, sample=${JSON.stringify(owners.slice(0, 2))}`, 'eth', 'general');
  logger.info('utils', `Fetched ${owners.length} owners for contract: ${contractAddress}`, 'eth', 'general');
  return owners;
}