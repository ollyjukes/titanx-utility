// app/api/holders/Stax/route.js
import { NextResponse } from 'next/server';
import { client, retry, logger, getCache, setCache, saveCacheState, loadCacheState } from '@/app/api/utils';
import { mainnet } from 'viem/chains';
import pLimit from 'p-limit';
import config from '@/config.js';

const limit = pLimit(5);
let cacheState = { isPopulating: false, totalOwners: 0, progressState: { step: 'idle', processedNfts: 0, totalNfts: 0 }, lastUpdated: null };

async function saveStaxCacheState() {
  try {
    await saveCacheState('stax', cacheState, 'stax');
  } catch (error) {
    logger.error('Stax', `Failed to save cache state: ${error.message}`);
  }
}

async function loadStaxCacheState() {
  try {
    const savedState = await loadCacheState('stax', 'stax');
    if (savedState) cacheState = savedState;
  } catch (error) {
    logger.error('Stax', `Failed to load cache state: ${error.message}`);
  }
}

export async function getCacheState() {
  await loadStaxCacheState();
  return {
    cached: !!await getCache('stax_holders', 'stax'),
    holderCount: cacheState.totalOwners,
    lastUpdated: cacheState.lastUpdated,
    isPopulating: cacheState.isPopulating,
    progressState: cacheState.progressState,
  };
}

async function getHoldersMap() {
  const contractAddress = config.contractAddresses?.stax?.address;
  if (!contractAddress) {
    logger.error('Stax', 'Contract address is missing');
    throw new Error('Contract address is missing');
  }
  if (!config.abis?.stax?.main) {
    logger.error('Stax', 'Stax ABI is missing');
    throw new Error('Stax ABI is missing');
  }

  logger.info('Stax', `Using contract address: ${contractAddress}`);
  logger.info('Stax', `ABI functions: ${config.abis.stax.main.map(item => item.name || 'unnamed').join(', ')}`);

  const requiredFunctions = ['totalSupply', 'totalBurned', 'ownerOf', 'getNftTier'];
  const missingFunctions = requiredFunctions.filter(fn => !config.abis.stax.main.some(abi => abi.name === fn));
  if (missingFunctions.length > 0) {
    logger.error('Stax', `Missing required ABI functions: ${missingFunctions.join(', ')}`);
    throw new Error(`Missing required ABI functions: ${missingFunctions.join(', ')}`);
  }

  const holdersMap = new Map();
  let totalBurned = 0;

  try {
    cacheState.progressState.step = 'fetching_supply';
    await saveStaxCacheState();
    logger.info('Stax', 'Fetching total supply and burned count...');

    logger.debug('Stax', 'Calling totalSupply...');
    const totalSupply = await retry(
      async () => {
        try {
          const result = await client.readContract({
            address: contractAddress,
            abi: config.abis.stax.main,
            functionName: 'totalSupply',
          });
          logger.info('Stax', `Fetched totalSupply: ${result}`);
          return result;
        } catch (error) {
          logger.error('Stax', `Failed to fetch totalSupply: ${error.message}`, { stack: error.stack });
          throw error;
        }
      },
      { retries: config.alchemy.maxRetries }
    );

    logger.debug('Stax', 'Calling totalBurned...');
    const burnedCount = await retry(
      async () => {
        try {
          const result = await client.readContract({
            address: contractAddress,
            abi: config.abis.stax.main,
            functionName: 'totalBurned',
          });
          logger.info('Stax', `Fetched totalBurned: ${result}`);
          return result;
        } catch (error) {
          logger.error('Stax', `Failed to fetch totalBurned: ${error.message}`, { stack: error.stack });
          throw error;
        }
      },
      { retries: config.alchemy.maxRetries }
    );

    totalBurned = Number(burnedCount || 0);
    cacheState.progressState.totalNfts = Number(totalSupply || 0);
    await saveStaxCacheState();

    logger.info('Stax', `Total supply: ${totalSupply}, burned: ${totalBurned}`);
    cacheState.progressState.step = 'fetching_owners';
    await saveStaxCacheState();

    const batchSize = config.alchemy.batchSize;
    const tokenIds = Array.from({ length: Number(totalSupply) - 1 }, (_, i) => i + 1);
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batchTokenIds = tokenIds.slice(i, i + batchSize);
      const ownerPromises = batchTokenIds.map(tokenId =>
        limit(() =>
          retry(
            async () => {
              logger.debug('Stax', `Calling ownerOf for token ${tokenId}...`);
              try {
                const result = await client.readContract({
                  address: contractAddress,
                  abi: config.abis.stax.main,
                  functionName: 'ownerOf',
                  args: [tokenId],
                });
                logger.debug('Stax', `Fetched owner for token ${tokenId}: ${result}`);
                return result;
              } catch (error) {
                if (error.message.includes('OwnerQueryForNonexistentToken')) {
                  logger.debug('Stax', `Token ${tokenId} does not exist`);
                  return null;
                }
                logger.error('Stax', `Failed to fetch ownerOf for token ${tokenId}: ${error.message}`, { stack: error.stack });
                throw error;
              }
            },
            { retries: config.alchemy.maxRetries }
          )
        )
      );
      const owners = await Promise.all(ownerPromises);
      owners.forEach((owner, index) => {
        if (owner && owner !== '0x0000000000000000000000000000000000000000') {
          const current = holdersMap.get(owner) || { wallet: owner, tokenIds: [], tiers: Array(12).fill(0), total: 0, multiplierSum: 0 };
          current.tokenIds.push(batchTokenIds[index]);
          current.total += 1;
          holdersMap.set(owner, current);
        }
      });
      cacheState.progressState.processedNfts = i + batchSize;
      await saveStaxCacheState();
    }

    logger.info('Stax', 'Fetching tiers for holders...');
    cacheState.progressState.step = 'fetching_tiers';
    await saveStaxCacheState();

    for (const holder of holdersMap.values()) {
      const tierPromises = holder.tokenIds.map(tokenId =>
        limit(() =>
          retry(
            async () => {
              logger.debug('Stax', `Calling getNftTier for token ${tokenId}...`);
              try {
                const result = await client.readContract({
                  address: contractAddress,
                  abi: config.abis.stax.main,
                  functionName: 'getNftTier',
                  args: [tokenId],
                });
                logger.debug('Stax', `Fetched tier for token ${tokenId}: ${result}`);
                return Number(result);
              } catch (error) {
                if (error.message.includes('OwnerQueryForNonexistentToken')) {
                  logger.debug('Stax', `Token ${tokenId} does not exist`);
                  return null;
                }
                logger.error('Stax', `Failed to fetch getNftTier for token ${tokenId}: ${error.message}`, { stack: error.stack });
                throw error;
              }
            },
            { retries: config.alchemy.maxRetries }
          )
        )
      );
      const tiers = await Promise.all(tierPromises);
      tiers.forEach((tier, index) => {
        if (tier !== null && tier >= 1 && tier <= 12) {
          holder.tiers[tier - 1]++;
          if (!config.contractTiers?.stax?.[tier]) {
            logger.error('Stax', `Missing multiplier for tier ${tier}`);
            throw new Error(`Missing multiplier for tier ${tier}`);
          }
          holder.multiplierSum += config.contractTiers.stax[tier].multiplier;
        } else {
          logger.warn('Stax', `Skipping invalid or non-existent tier ${tier} for token ${holder.tokenIds[index]}`);
        }
      });
      cacheState.progressState.processedNfts += holder.tokenIds.length;
      await saveStaxCacheState();
    }

    cacheState.totalOwners = holdersMap.size;
    cacheState.progressState.step = 'completed';
    cacheState.progressState.processedNfts = cacheState.progressState.totalNfts;
    delete cacheState.progressState.error;
    await saveStaxCacheState();
    logger.info('Stax', `Completed fetching ${holdersMap.size} holders`);
    return { holdersMap, totalBurned };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Non-error thrown: ${JSON.stringify(error)}`;
    logger.error('Stax', `Error fetching holders: ${errorMessage}`, { error, stack: error?.stack });
    cacheState.progressState.step = 'error';
    cacheState.progressState.error = errorMessage;
    await saveStaxCacheState();
    throw new Error(errorMessage);
  }
}

async function populateHoldersMapCache() {
  await loadStaxCacheState();
  if (cacheState.isPopulating) {
    logger.info('Stax', 'Cache population already in progress');
    return;
  }

  cacheState.isPopulating = true;
  cacheState.progressState.step = 'starting';
  await saveStaxCacheState();

  try {
    const { holdersMap, totalBurned } = await getHoldersMap();
    const holders = Array.from(holdersMap.values());
    const cacheData = { holders, totalBurned, timestamp: Date.now() };
    cacheState.lastUpdated = Date.now();
    await setCache('stax_holders', cacheData, config.cache.nodeCache.stdTTL, 'stax');
    logger.info('Stax', `Cached ${holders.length} holders with ${totalBurned} burned`);
    return holders;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Non-error thrown: ${JSON.stringify(error)}`;
    logger.error('Stax', `Cache population failed: ${errorMessage}`);
    throw new Error(errorMessage);
  } finally {
    cacheState.isPopulating = false;
    cacheState.progressState.step = cacheState.progressState.step === 'error' ? 'error' : 'idle';
    await saveStaxCacheState();
  }
}

export async function GET(request) {
  try {
    await loadStaxCacheState();
    if (cacheState.isPopulating) {
      logger.info('Stax', 'Returning cache populating status');
      return NextResponse.json({
        message: 'Cache is populating',
        isCachePopulating: true,
        totalOwners: cacheState.totalOwners,
        progressState: cacheState.progressState,
        debugId: `state-${Math.random().toString(36).slice(2)}`,
      }, { status: 202 });
    }

    const cachedData = await getCache('stax_holders', 'stax');
    if (cachedData) {
      logger.info('Stax', `Cache hit for stax_holders: ${cachedData.holders.length} holders`);
      return NextResponse.json({
        holders: cachedData.holders,
        totalTokens: cachedData.holders.reduce((sum, h) => sum + h.total, 0),
        totalBurned: cachedData.totalBurned,
      });
    }

    logger.info('Stax', 'Cache miss, triggering population...');
    const holders = await populateHoldersMapCache();
    return NextResponse.json({
      holders,
      totalTokens: holders.reduce((sum, h) => sum + h.total, 0),
      totalBurned: (await getCache('stax_holders', 'stax'))?.totalBurned || 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Non-error thrown: ${JSON.stringify(error)}`;
    logger.error('Stax', `GET Error: ${errorMessage}`);
    return NextResponse.json({ error: 'Failed to fetch Stax holders', details: errorMessage }, { status: 500 });
  }
}

export async function POST(_request) {
  try {
    await populateHoldersMapCache();
    return NextResponse.json({ message: 'Stax cache population triggered' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Non-error thrown: ${JSON.stringify(error)}`;
    logger.error('Stax', `POST Error: ${errorMessage}`);
    return NextResponse.json({ error: 'Failed to populate Stax cache', details: errorMessage }, { status: 500 });
  }
}