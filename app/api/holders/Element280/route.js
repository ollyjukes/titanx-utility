// app/api/holders/element280/route.js
import { NextResponse } from 'next/server';
import pino from 'pino';
import { populateHoldersMapCache } from '@/app/api/holders/cache/holders';
import { getHolderData, getAllHolders } from '@/app/api/holders/shared';
import config from '@/app/contracts_nft';
import { getContractAbi } from '@/app/contracts_nft';
import { HoldersResponseSchema } from '@/app/lib/schemas';

const logger = pino({ level: 'info', base: { context: 'element280' } });
const contractKey = 'element280';
const contractConfig = config.nftContracts[contractKey];

async function preWarmCache() {
  logger.info(`[element280] Starting pre-warm cache`, 'ETH', contractKey);
  try {
    if (!contractConfig?.contractAddress) throw new Error('Element280 contract address not found');
    await populateHoldersMapCache(
      contractKey,
      contractConfig.contractAddress,
      getContractAbi(contractKey, 'nft'),
      contractConfig.vaultAddress,
      getContractAbi(contractKey, 'vault')
    );
    logger.info('[element280] Pre-warm cache completed', 'ETH', contractKey);
  } catch (err) {
    logger.error(`[element280] Pre-warm cache failed: ${err.message}`, { stack: err.stack }, 'ETH', contractKey);
  }
}

preWarmCache().catch(err => logger.error(`[element280] Pre-warm cache init failed: ${err.message}`, { stack: err.stack }, 'ETH', contractKey));

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10));
  const pageSize = Math.max(1, Math.min(1000, parseInt(searchParams.get('pageSize') || '1000', 10)));

  if (!contractConfig?.contractAddress) {
    logger.error('[element280] Contract address not found', {}, 'ETH', contractKey);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
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
      logger.info(`[element280] GET wallet=${wallet} succeeded: ${holderData ? 1 : 0} holders`, 'ETH', contractKey);
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
    logger.info(`[element280] GET succeeded: ${result.holders.length} holders`, 'ETH', contractKey);
    return NextResponse.json(result);
  } catch (error) {
    logger.error(`[element280] GET failed: ${error.message}`, { stack: error.stack }, 'ETH', contractKey);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}