// app/api/holders/element369/route.js
import { NextResponse } from 'next/server';
import { getAllHolders, getHolderData } from '@/app/api/holders/shared';
import { logger } from '@/app/lib/logger';
import config from '@/app/contracts_nft';
import { getContractAbi } from '@/app/contracts_nft';
import { HoldersResponseSchema } from '@/app/lib/schemas';

const contractKey = 'element369';
const contractConfig = config.nftContracts[contractKey];

async function preWarmCache() {
  logger.info('element369', 'Starting pre-warm cache', 'ETH', contractKey);
  try {
    if (!contractConfig?.contractAddress) throw new Error('Element369 contract address not found');
    await getAllHolders(
      contractKey,
      contractConfig.contractAddress,
      contractConfig.vaultAddress,
      getContractAbi(contractKey, 'vault'),
      config.contractTiers[contractKey].tierOrder.reduce((acc, t) => ({
        ...acc,
        [t.tierId]: { multiplier: contractConfig.tiers[t.tierId].multiplier },
      }), {}),
      0,
      1000
    );
    logger.info('element369', 'Pre-warm cache completed', 'ETH', contractKey);
  } catch (err) {
    logger.error('element369', `Pre-warm cache failed: ${err.message}`, { stack: err.stack }, 'ETH', contractKey);
  }
}

preWarmCache().catch(err => logger.error('element369', `Pre-warm cache init failed: ${err.message}`, { stack: err.stack }, 'ETH', contractKey));

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10));
  const pageSize = Math.max(1, Math.min(1000, parseInt(searchParams.get('pageSize') || '1000', 10)));

  if (!contractConfig?.contractAddress) {
    logger.error('element369', 'Contract address not found', {}, 'ETH', contractKey);
    return NextResponse.json({ error: 'Element369 contract address not found' }, { status: 400 });
  }

  try {
    if (wallet) {
      const holderData = await getHolderData(
        contractKey,
        contractConfig.contractAddress,
        wallet,
        config.contractTiers[contractKey].tierOrder.reduce((acc, t) => ({
          ...acc,
          [t.tierId]: { multiplier: contractConfig.tiers[t.tierId].multiplier },
        }), {}),
        contractConfig.vaultAddress,
        getContractAbi(contractKey, 'vault')
      );
      const response = { holders: holderData ? [holderData] : [], totalPages: 1, totalTokens: holderData?.total || 0, totalBurned: 0, summary: {}, contractKey };
      HoldersResponseSchema.parse(response);
      logger.info('element369', `GET wallet=${wallet} succeeded: ${holderData ? 1 : 0} holders`, 'ETH', contractKey);
      return NextResponse.json(response);
    }

    const result = await getAllHolders(
      contractKey,
      contractConfig.contractAddress,
      contractConfig.vaultAddress,
      getContractAbi(contractKey, 'vault'),
      config.contractTiers[contractKey].tierOrder.reduce((acc, t) => ({
        ...acc,
        [t.tierId]: { multiplier: contractConfig.tiers[t.tierId].multiplier },
      }), {}),
      page,
      pageSize
    );

    HoldersResponseSchema.parse(result);
    logger.info('element369', `GET succeeded: ${result.holders.length} holders`, 'ETH', contractKey);
    return NextResponse.json(result);
  } catch (error) {
    logger.error('element369', `GET failed: ${error.message}`, { stack: err.stack }, 'ETH', contractKey);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}