// app/api/holders/ascendant/route.js
import { NextResponse } from 'next/server';
import { getAllHolders, getHolderData } from '@/app/api/holders/shared';
import { logger } from '@/app/lib/logger';
import config from '@/app/contracts_nft';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10));
  const pageSize = Math.max(1, Math.min(1000, parseInt(searchParams.get('pageSize') || '1000', 10)));

  const contractKey = 'ascendant';
  const contractConfig = config.nftContracts[contractKey];
  if (!contractConfig?.contractAddress) {
    return NextResponse.json({ error: 'Ascendant contract address not found' }, { status: 400 });
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
        null, // No vault
        null // No vault ABI
      );
      return NextResponse.json({ holders: holderData ? [holderData] : [] });
    }

    const result = await getAllHolders(
      contractKey,
      contractConfig.contractAddress,
      null, // No vault
      null, // No vault ABI
      config.contractTiers[contractKey].tierOrder.reduce((acc, t) => ({
        ...acc,
        [t.tierId]: { multiplier: contractConfig.tiers[t.tierId].multiplier },
      }), {}),
      page,
      pageSize
    );
    return NextResponse.json(result);
  } catch (error) {
    logger.error('holders', `Error in Ascendant GET: ${error.message}`, { stack: error.stack }, 'ETH', contractKey);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

async function preWarmCache() {
  logger.info('ascendant', 'Starting pre-warm cache', 'ETH', 'ascendant');
  try {
    const contractConfig = config.nftContracts['ascendant'];
    if (!contractConfig?.contractAddress) {
      logger.error('ascendant', 'Contract address not found', {}, 'ETH', 'ascendant');
      return;
    }
    await getAllHolders(
      'ascendant',
      contractConfig.contractAddress,
      null,
      null,
      config.contractTiers['ascendant'].tierOrder.reduce((acc, t) => ({
        ...acc,
        [t.tierId]: { multiplier: contractConfig.tiers[t.tierId].multiplier },
      }), {}),
      0,
      1000
    );
    logger.info('ascendant', 'Pre-warm cache completed', 'ETH', 'ascendant');
  } catch (err) {
    logger.error('ascendant', `Pre-warm cache failed: ${err.message}`, { stack: err.stack }, 'ETH', 'ascendant');
  }
}

preWarmCache().catch(err => logger.error('ascendant', `Pre-warm cache init failed: ${err.message}`, { stack: err.stack }, 'ETH', 'ascendant'));