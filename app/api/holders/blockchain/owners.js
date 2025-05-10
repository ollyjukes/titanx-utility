import { alchemy } from '@/app/api/utils/client';
import { logger } from '@/app/lib/logger';
import { retry } from '@/app/api/utils/retry';

export async function fetchOwnersAlchemy(contractAddress, contractKey, chain = 'eth') {
  logger.debug(
    'owners',
    `Fetching owners for contract: ${contractAddress} (contractKey: ${contractKey})`,
    chain,
    contractKey
  );

  try {
    const response = await retry(() =>
      alchemy.nft.getOwnersForContract(contractAddress, {
        withTokenBalances: true,
        pageSize: 1000,
      })
    );

    logger.debug(
      'owners',
      `Raw Alchemy response: ownersExists=${!!response.owners}, isArray=${Array.isArray(response.owners)}, ownersLength=${
        response.owners?.length || 0
      }, pageKey=${response.pageKey || null}, responseKeys=${Object.keys(response)}, sampleOwners=${JSON.stringify(
        response.owners?.slice(0, 2) || []
      )}`,
      chain,
      contractKey
    );

    if (!response.owners || !Array.isArray(response.owners)) {
      logger.error('owners', `Invalid Alchemy response for ${contractAddress}: ${JSON.stringify(response)}`, {}, chain, contractKey);
      throw new Error('Invalid owners response from Alchemy API');
    }

    const owners = response.owners
      .filter(owner => owner?.ownerAddress && owner.tokenBalances?.length > 0)
      .map(owner => ({
        ownerAddress: owner.ownerAddress.toLowerCase(),
        tokenBalances: owner.tokenBalances
          .filter(tb => tb.tokenId && Number(tb.balance) > 0)
          .map(tb => ({
            tokenId: Number(tb.tokenId),
            balance: Number(tb.balance),
          })),
      }));

    logger.debug('owners', `Processed owners: count=${owners.length}, sample=${JSON.stringify(owners.slice(0, 2))}`, chain, contractKey);
    logger.info('owners', `Fetched ${owners.length} owners for contract: ${contractAddress}`, chain, contractKey);
    return owners;
  } catch (error) {
    logger.error('owners', `Failed to fetch owners for ${contractAddress}: ${error.message}`, { stack: error.stack }, chain, contractKey);
    throw error;
  }
}