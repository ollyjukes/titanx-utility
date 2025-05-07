// app/api/holders/[contract]/route.js
import { NextResponse } from 'next/server';
import config from '@/contracts/config.js';
import { logger } from '@/app/lib/logger';
import { HoldersResponseSchema } from '@/app/lib/schemas';
import { getCacheState, saveCacheStateContract } from '@/app/api/holders/cache/state';
import { populateHoldersMapCache } from '@/app/api/holders/cache/holders';
import { validateContract, getCache } from '@/app/api/utils/cache.js';
import { sanitizeBigInt } from '@/app/api/holders/cache/holders';

export async function GET(request, { params }) {
  const { contract } = await params;
  const contractKey = contract.toLowerCase();

  if (!config.nftContracts[contractKey]) {
    logger.error('holders', `Invalid contract: ${contractKey}`, 'eth', contractKey);
    return NextResponse.json({ error: 'Invalid contract' }, { status: 400 });
  }

  const { contractAddress, abi } = config.nftContracts[contractKey];
  const cacheState = await getCacheState(contractKey);

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails[contractKey].pageSize, 10);

  const cachedData = await getCache(`${contractKey}_holders`, contractKey);
  const isBurnContract = ['stax', 'element280', 'element369'].includes(contractKey);

  if (cachedData) {
    const holders = cachedData.holders.slice(page * pageSize, (page + 1) * pageSize);
    const totalPages = Math.ceil(cachedData.holders.length / pageSize);
    const totalTokens = cachedData.holders.reduce((sum, h) => sum + h.total, 0);
    const totalBurned = isBurnContract ? Number(cachedData.totalBurned) || 0 : 0;
    const maxTier = Math.max(...Object.keys(config.nftContracts[contractKey]?.tiers || {}).map(Number), 0);
    const response = {
      holders: sanitizeBigInt(holders),
      totalPages,
      totalTokens,
      totalBurned,
      summary: {
        totalLive: totalTokens,
        totalBurned,
        totalMinted: totalTokens + totalBurned,
        tierDistribution: cachedData.holders.reduce((acc, h) => {
          h.tiers.forEach((count, i) => (acc[i] = (acc[i] || 0) + count));
          return acc;
        }, Array(contractKey === 'ascendant' ? maxTier + 1 : maxTier).fill(0)),
        multiplierPool: cachedData.holders.reduce((sum, h) => sum + h.multiplierSum, 0),
        ...(contractKey === 'ascendant' ? { rarityDistribution: cacheState.globalMetrics.rarityDistribution || Array(3).fill(0) } : {}),
      },
      globalMetrics: cacheState.globalMetrics || {},
    };
    logger.debug('holders', `GET response: holders=${holders.length}, totalPages=${totalPages}`, 'eth', contractKey);
    return NextResponse.json(response);
  }

  const { status, holders } = await populateHoldersMapCache(contractKey, contractAddress, abi, null, null);
  if (status === 'error') {
    logger.error('holders', `Cache population failed for ${contractKey}`, 'eth', contractKey);
    return NextResponse.json({ error: 'Cache population failed' }, { status: 500 });
  }

  const paginatedHolders = holders.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(holders.length / pageSize);
  const cachedDataAfterPopulation = await getCache(`${contractKey}_holders`, contractKey);
  const totalBurned = isBurnContract ? Number(cachedDataAfterPopulation?.totalBurned) || 0 : 0;
  const totalTokens = holders.reduce((sum, h) => sum + h.total, 0);
  const maxTier = Math.max(...Object.keys(config.nftContracts[contractKey]?.tiers || {}).map(Number), 0);
  const response = {
    holders: sanitizeBigInt(paginatedHolders),
    totalPages,
    totalTokens,
    totalBurned,
    summary: {
      totalLive: totalTokens,
      totalBurned,
      totalMinted: totalTokens + totalBurned,
      tierDistribution: holders.reduce((acc, h) => {
        h.tiers.forEach((count, i) => (acc[i] = (acc[i] || 0) + count));
        return acc;
      }, Array(contractKey === 'ascendant' ? maxTier + 1 : maxTier).fill(0)),
      multiplierPool: holders.reduce((sum, h) => sum + h.multiplierSum, 0),
      ...(contractKey === 'ascendant' ? { rarityDistribution: cacheState.globalMetrics.rarityDistribution || Array(3).fill(0) } : {}),
    },
    globalMetrics: cacheState.globalMetrics || {},
  };
  logger.debug('holders', `GET response: holders=${paginatedHolders.length}, totalPages=${totalPages}`, 'eth', contractKey);
  return NextResponse.json(response);
}

export async function POST(request, { params }) {
  const { contract } = await params;
  const contractKey = contract.toLowerCase();
  const chain = config.nftContracts[contractKey]?.chain || 'eth';
  const { forceUpdate = false } = await request.json().catch(() => ({}));

  logger.debug('holders', `POST request received for ${contractKey}, forceUpdate=${forceUpdate}`, chain, contractKey);

  if (!config.nftContracts[contractKey]) {
    logger.error('holders', `Invalid contract: ${contractKey}. Available: ${Object.keys(config.nftContracts).join(', ')}`, chain, contractKey);
    return NextResponse.json({ message: `Invalid contract: ${contractKey}`, status: 'error' }, { status: 400 });
  }

  let contractAddress, abi, vaultAddress, vaultAbi;
  try {
    const contractConfig = config.nftContracts[contractKey];
    ({ contractAddress, abi, vaultAddress, vaultAbi } = contractConfig);
    logger.debug('holders', `Calling validateContract for ${contractKey}`, chain, contractKey);
    const isValid = await validateContract(contractKey);
    if (!isValid) {
      logger.error('holders', `Contract validation failed for ${contractKey}`, chain, contractKey);
      throw new Error(`Invalid contract address for ${contractKey}`);
    }
  } catch (error) {
    logger.error('holders', `Validation error for ${contractKey}: ${error.message}`, { stack: error.stack }, chain, contractKey);
    return NextResponse.json({ message: `Validation error: ${error.message}`, status: 'error' }, { status: 400 });
  }

  let cacheState = await getCacheState(contractKey);
  try {
    logger.debug('holders', `Triggering cache population for ${contractKey}`, chain, contractKey);
    const result = await populateHoldersMapCache(contractKey, contractAddress, abi, vaultAddress, vaultAbi, forceUpdate);

    if (result.status === 'pending') {
      logger.info('holders', `Cache population in progress for ${contractKey}`, chain, contractKey);
      cacheState = await getCacheState(contractKey);
      return NextResponse.json(
        { message: 'Cache population in progress', status: 'pending', cacheState: sanitizeBigInt(cacheState) },
        { status: 202 }
      );
    }

    logger.info('holders', `Cache population completed for ${contractKey}: ${result.holders.length} holders`, chain, contractKey);
    cacheState = await getCacheState(contractKey);
    return NextResponse.json(
      {
        message: 'Cache population completed',
        status: 'success',
        cacheState: sanitizeBigInt(cacheState),
        holders: sanitizeBigInt(result.holders),
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('holders', `Failed to populate cache for ${contractKey}: ${error.message}`, { stack: error.stack }, chain, contractKey);
    cacheState.isPopulating = false;
    cacheState.progressState.step = 'error';
    cacheState.progressState.error = error.message;
    cacheState.progressState.errorLog = cacheState.progressState.errorLog || [];
    cacheState.progressState.errorLog.push({
      timestamp: new Date().toISOString(),
      phase: 'post_handler',
      error: error.message,
    });
    await saveCacheStateContract(contractKey, cacheState);
    return NextResponse.json(
      { message: `Failed to populate cache: ${error.message}`, status: 'error' },
      { status: 500 }
    );
  }
}