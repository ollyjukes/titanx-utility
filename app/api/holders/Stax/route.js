// app/api/holders/Stax/route.js
import { NextResponse } from 'next/server';
import { client, retry, logger, getCache, setCache, saveCacheState, loadCacheState } from '@/app/api/utils';
import { parseAbiItem } from 'viem';
import pLimit from 'p-limit';
import config from '@/config.js';

const limit = pLimit(5);
let cacheState = {
  isPopulating: false,
  totalOwners: 0,
  progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
  lastUpdated: null,
  lastProcessedBlock: null
};

async function saveStaxCacheState() {
  try {
    await saveCacheState('Stax', cacheState, 'stax');
    logger.debug('Stax', `Saved cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}, lastProcessedBlock=${cacheState.lastProcessedBlock}`);
  } catch (error) {
    logger.error('Stax', `Failed to save cache state: ${error.message}`, { stack: error.stack });
  }
}

async function loadStaxCacheState() {
  try {
    const savedState = await loadCacheState('Stax', 'stax');
    if (savedState && typeof savedState === 'object') {
      cacheState = {
        isPopulating: savedState.isPopulating ?? savedState.isCachePopulating ?? false,
        totalOwners: savedState.totalOwners ?? 0,
        progressState: {
          step: savedState.progressState?.step ?? 'idle',
          processedNfts: savedState.progressState?.processedNfts ?? 0,
          totalNfts: savedState.progressState?.totalNfts ?? 0,
          processedTiers: savedState.progressState?.processedTiers ?? 0,
          totalTiers: savedState.progressState?.totalTiers ?? 0,
          error: savedState.progressState?.error ?? null,
          errorLog: savedState.progressState?.errorLog ?? []
        },
        lastUpdated: savedState.lastUpdated ?? null,
        lastProcessedBlock: savedState.lastProcessedBlock ?? null
      };
      logger.debug('Stax', `Loaded cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}, lastProcessedBlock=${cacheState.lastProcessedBlock}`);
    } else {
      logger.info('Stax', 'No valid saved cache state, using defaults');
    }
  } catch (error) {
    logger.error('Stax', `Failed to load cache state: ${error.message}`, { stack: error.stack });
    cacheState = {
      isPopulating: false,
      totalOwners: 0,
      progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
      lastUpdated: null,
      lastProcessedBlock: null
    };
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
    lastProcessedBlock: cacheState.lastProcessedBlock
  };
}

async function getNewBurnEvents(contractAddress, fromBlock, errorLog) {
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const cacheKey = `stax_burned_events_${contractAddress}_${fromBlock}`;
  let cachedBurned = await getCache(cacheKey, 'stax');

  if (cachedBurned) {
    logger.info('Stax', `Burn events cache hit: ${cacheKey}, count: ${cachedBurned.burnedTokenIds.length}`);
    return cachedBurned;
  }

  logger.info('Stax', `Checking burn events from block ${fromBlock}`);
  let burnedTokenIds = [];
  let endBlock;
  try {
    endBlock = await client.getBlockNumber();
  } catch (error) {
    logger.error('Stax', `Failed to fetch current block number: ${error.message}`, { stack: error.stack });
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    throw error;
  }

  if (fromBlock >= endBlock) {
    logger.info('Stax', `No new blocks: fromBlock ${fromBlock} >= endBlock ${endBlock}`);
    return { burnedTokenIds, lastBlock: Number(endBlock) };
  }

  try {
    const logs = await client.getLogs({
      address: contractAddress,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
      fromBlock: BigInt(fromBlock),
      toBlock: endBlock,
    });
    burnedTokenIds = logs
      .filter(log => log.args.to.toLowerCase() === burnAddress)
      .map(log => Number(log.args.tokenId));
    const cacheData = { burnedTokenIds, lastBlock: Number(endBlock), timestamp: Date.now() };
    await setCache(cacheKey, cacheData, config.cache.nodeCache.stdTTL || 3600, 'stax');
    logger.info('Stax', `Cached burn events: ${cacheKey}, count: ${burnedTokenIds.length}, endBlock: ${endBlock}`);
    return cacheData;
  } catch (error) {
    logger.error('Stax', `Failed to fetch burn events from ${fromBlock} to ${endBlock}: ${error.message}`, { stack: error.stack });
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burn_events', error: error.message });
    throw error;
  }
}

async function getHoldersMap() {
  const contractAddress = config.contractAddresses?.stax?.address;
  if (!contractAddress) {
    logger.error('Stax', 'Contract address missing');
    throw new Error('Contract address missing');
  }
  if (!config.abis?.stax?.main) {
    logger.error('Stax', 'Stax ABI missing');
    throw new Error('Stax ABI missing');
  }

  logger.info('Stax', `Fetching holders for contract: ${contractAddress}`);
  const requiredFunctions = ['totalSupply', 'totalBurned', 'ownerOf', 'getNftTier'];
  const missingFunctions = requiredFunctions.filter(fn => !config.abis.stax.main.some(abi => abi.name === fn));
  if (missingFunctions.length > 0) {
    logger.error('Stax', `Missing ABI functions: ${missingFunctions.join(', ')}`);
    throw new Error(`Missing ABI functions: ${missingFunctions.join(', ')}`);
  }

  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const holdersMap = new Map();
  let totalBurned = 0;
  let nonExistentCount = 0;
  let burnedCount = 0;
  const errorLog = [];

  try {
    cacheState.progressState.step = 'fetching_supply';
    await saveStaxCacheState();
    logger.info('Stax', 'Fetching supply and burned count');

    let currentBlock;
    try {
      currentBlock = await client.getBlockNumber();
    } catch (error) {
      logger.error('Stax', `Failed to fetch current block number: ${error.message}`, { stack: error.stack });
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
      throw error;
    }

    const totalSupply = await retry(
      async () => {
        const result = await client.readContract({
          address: contractAddress,
          abi: config.abis.stax.main,
          functionName: 'totalSupply',
        });
        if (result === null || result === undefined) {
          throw new Error('totalSupply returned null or undefined');
        }
        logger.debug('Stax', `Fetched totalSupply: ${result}`);
        return Number(result);
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );

    const burnedCountContract = await retry(
      async () => {
        const result = await client.readContract({
          address: contractAddress,
          abi: config.abis.stax.main,
          functionName: 'totalBurned',
        });
        if (result === null || result === undefined) {
          throw new Error('totalBurned returned null or undefined');
        }
        logger.debug('Stax', `Fetched totalBurned: ${result}`);
        return Number(result);
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );

    totalBurned = burnedCountContract || 0;
    cacheState.progressState.totalNfts = totalSupply || 0;
    cacheState.progressState.totalTiers = totalSupply || 0;
    cacheState.lastProcessedBlock = Number(currentBlock);
    await saveStaxCacheState();

    if (totalSupply === 0) {
      logger.warn('Stax', 'Total supply is 0, no NFTs to process');
      cacheState.progressState.step = 'completed';
      await saveStaxCacheState();
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock) };
    }

    logger.info('Stax', `Total supply: ${totalSupply}, burned: ${totalBurned}, block: ${currentBlock}`);
    cacheState.progressState.step = 'fetching_owners';
    await saveStaxCacheState();

    const batchSize = config.alchemy.batchSize;
    const tokenIds = Array.from({ length: totalSupply }, (_, i) => i + 1);
    for (let i = 0; i < tokenIds.length; i += batchSize) {
      const batchTokenIds = tokenIds.slice(i, i + batchSize);
      const ownerPromises = batchTokenIds.map(tokenId =>
        limit(() =>
          retry(
            async () => {
              logger.trace('Stax', `Calling ownerOf for token ${tokenId}`);
              try {
                const result = await client.readContract({
                  address: contractAddress,
                  abi: config.abis.stax.main,
                  functionName: 'ownerOf',
                  args: [tokenId],
                });
                if (!result || result === '0x0000000000000000000000000000000000000000') {
                  logger.debug('Stax', `Token ${tokenId} has no valid owner`);
                  return null;
                }
                logger.trace('Stax', `Fetched owner for token ${tokenId}: ${result}`);
                return result;
              } catch (error) {
                if (error.message.includes('OwnerQueryForNonexistentToken')) {
                  logger.debug('Stax', `Token ${tokenId} does not exist`);
                  nonExistentCount++;
                  return null;
                }
                logger.error('Stax', `Failed to fetch ownerOf for token ${tokenId}: ${error.message}`, { stack: error.stack });
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owner', tokenId, error: error.message });
                throw error;
              }
            },
            { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
          )
        )
      );
      const owners = await Promise.all(ownerPromises);
      owners.forEach((owner, index) => {
        if (owner === burnAddress) {
          logger.debug('Stax', `Token ${batchTokenIds[index]} burned`);
          burnedCount++;
        } else if (owner) {
          const current = holdersMap.get(owner) || { wallet: owner, tokenIds: [], tiers: Array(12).fill(0), total: 0, multiplierSum: 0 };
          current.tokenIds.push(batchTokenIds[index]);
          current.total += 1;
          holdersMap.set(owner, current);
        }
      });
      cacheState.progressState.processedNfts = i + batchSize;
      await setCache('stax_holders_partial', { holders: Array.from(holdersMap.values()), totalBurned, timestamp: Date.now() }, 0, 'stax');
      await saveStaxCacheState();
      logger.info('Stax', `Processed batch ${i / batchSize + 1}: ${holdersMap.size} holders, ${nonExistentCount} non-existent, ${burnedCount} burned`);
    }

    logger.info('Stax', 'Fetching tiers');
    cacheState.progressState.step = 'fetching_tiers';
    cacheState.progressState.processedTiers = 0;
    await saveStaxCacheState();

    for (const holder of holdersMap.values()) {
      const tierPromises = holder.tokenIds.map(tokenId =>
        limit(() =>
          retry(
            async () => {
              logger.trace('Stax', `Calling getNftTier for token ${tokenId}`);
              try {
                const result = await client.readContract({
                  address: contractAddress,
                  abi: config.abis.stax.main,
                  functionName: 'getNftTier',
                  args: [tokenId],
                });
                if (result === null || result === undefined) {
                  logger.warn('Stax', `Invalid tier for token ${tokenId}: ${result}`);
                  return null;
                }
                logger.trace('Stax', `Fetched tier for token ${tokenId}: ${result}`);
                return Number(result);
              } catch (error) {
                if (error.message.includes('OwnerQueryForNonexistentToken')) {
                  logger.debug('Stax', `Token ${tokenId} does not exist`);
                  return null;
                }
                logger.error('Stax', `Failed to fetch getNftTier for token ${tokenId}: ${error.message}`, { stack: error.stack });
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, error: error.message });
                throw error;
              }
            },
            { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
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
          logger.warn('Stax', `Invalid tier ${tier} for token ${holder.tokenIds[index]}`);
        }
      });
      cacheState.progressState.processedTiers += holder.tokenIds.length;
      await saveStaxCacheState();
    }

    cacheState.totalOwners = holdersMap.size;
    cacheState.progressState.step = 'completed';
    cacheState.progressState.processedNfts = cacheState.progressState.totalNfts;
    cacheState.progressState.processedTiers = cacheState.progressState.totalTiers;
    cacheState.progressState.error = null;
    cacheState.progressState.errorLog = [];
    await saveStaxCacheState();
    logger.info('Stax', `Fetched ${holdersMap.size} holders, ${nonExistentCount} non-existent, ${burnedCount} burned, block ${currentBlock}`);
    return { holdersMap, totalBurned, lastBlock: Number(currentBlock) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Unknown error: ${JSON.stringify(error)}`;
    logger.error('Stax', `Error fetching holders: ${errorMessage}`, { stack: error.stack, errors: errorLog });
    cacheState.progressState.step = 'error';
    cacheState.progressState.error = errorMessage;
    cacheState.progressState.errorLog = errorLog;
    await saveStaxCacheState();
    throw new Error(errorMessage);
  }
}

async function populateHoldersMapCache(forceUpdate = false) {
  await loadStaxCacheState();
  if (cacheState.isPopulating && !forceUpdate) {
    logger.info('Stax', 'Cache population already in progress');
    return { status: 'in_progress', holders: null };
  }

  cacheState.isPopulating = true;
  cacheState.progressState.step = 'starting';
  cacheState.progressState.error = null;
  cacheState.progressState.errorLog = [];
  await saveStaxCacheState();

  const contractAddress = config.contractAddresses?.stax?.address;
  const errorLog = [];

  try {
    const cachedData = await getCache('stax_holders', 'stax');
    const partialData = await getCache('stax_holders_partial', 'stax');
    const isCacheValid = cachedData && Array.isArray(cachedData.holders) && Number.isInteger(cachedData.totalBurned) && !forceUpdate;
    logger.info('Stax', `Cache check: ${isCacheValid ? 'hit' : 'miss'}, forceUpdate: ${forceUpdate}, holders: ${cachedData?.holders?.length || 'none'}`);

    if (isCacheValid) {
      logger.info('Stax', `Cache hit: ${cachedData.holders.length} holders, totalBurned: ${cachedData.totalBurned}`);
      const fromBlock = cacheState.lastProcessedBlock || config.deploymentBlocks.stax.block;
      logger.info('Stax', `Checking burn events from block ${fromBlock}`);
      const { burnedTokenIds, lastBlock } = await getNewBurnEvents(contractAddress, fromBlock, errorLog);

      let currentBlock;
      try {
        currentBlock = await client.getBlockNumber();
      } catch (error) {
        logger.error('Stax', `Failed to fetch current block number: ${error.message}`, { stack: error.stack });
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
        throw error;
      }

      if (burnedTokenIds.length > 0) {
        logger.info('Stax', `Found ${burnedTokenIds.length} burn events since block ${fromBlock}`);
        const holdersMap = new Map();
        for (const holder of cachedData.holders) {
          const updatedTokenIds = holder.tokenIds.filter(id => !burnedTokenIds.includes(id));
          if (updatedTokenIds.length > 0) {
            const updatedHolder = {
              ...holder,
              tokenIds: updatedTokenIds,
              total: updatedTokenIds.length,
              tiers: Array(12).fill(0),
              multiplierSum: 0
            };
            const tierPromises = updatedTokenIds.map(tokenId =>
              limit(() =>
                retry(
                  async () => {
                    logger.trace('Stax', `Calling getNftTier for token ${tokenId}`);
                    try {
                      const result = await client.readContract({
                        address: contractAddress,
                        abi: config.abis.stax.main,
                        functionName: 'getNftTier',
                        args: [tokenId],
                      });
                      if (result === null || result === undefined) {
                        logger.warn('Stax', `Invalid tier for token ${tokenId}: ${result}`);
                        return null;
                      }
                      logger.trace('Stax', `Fetched tier for token ${tokenId}: ${result}`);
                      return Number(result);
                    } catch (error) {
                      if (error.message.includes('OwnerQueryForNonexistentToken')) {
                        logger.debug('Stax', `Token ${tokenId} does not exist`);
                        return null;
                      }
                      logger.error('Stax', `Failed to fetch getNftTier for token ${tokenId}: ${error.message}`, { stack: error.stack });
                      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier_update', tokenId, error: error.message });
                      throw error;
                    }
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                )
              )
            );
            const tiers = await Promise.all(tierPromises);
            tiers.forEach((tier, _index) => {
              if (tier !== null && tier >= 1 && tier <= 12) {
                updatedHolder.tiers[tier - 1]++;
                updatedHolder.multiplierSum += config.contractTiers.stax[tier].multiplier;
              }
            });
            holdersMap.set(holder.wallet, updatedHolder);
          }
        }

        const burnedCountContract = await retry(
          async () => {
            const result = await client.readContract({
              address: contractAddress,
              abi: config.abis.stax.main,
              functionName: 'totalBurned',
            });
            if (result === null || result === undefined) {
              throw new Error('totalBurned returned null or undefined');
            }
            logger.debug('Stax', `Fetched totalBurned: ${result}`);
            return Number(result);
          },
          { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
        );
        const totalBurned = burnedCountContract || 0;

        const holders = Array.from(holdersMap.values());
        const cacheData = { holders, totalBurned, timestamp: Date.now() };
        await setCache('stax_holders', cacheData, 0, 'stax');
        logger.info('Stax', `Updated cache: ${holders.length} holders, totalBurned: ${totalBurned}`);
        cacheState.lastUpdated = Date.now();
        cacheState.totalOwners = holders.length;
        cacheState.lastProcessedBlock = lastBlock;
        cacheState.progressState = {
          step: 'completed',
          processedNfts: cacheState.progressState.totalNfts,
          totalNfts: cacheState.progressState.totalNfts,
          processedTiers: cacheState.progressState.totalTiers,
          totalTiers: cacheState.progressState.totalTiers,
          error: null,
          errorLog: []
        };
        await saveStaxCacheState();
        logger.info('Stax', `Cache updated: ${holders.length} holders, ${totalBurned} burned, block ${lastBlock}`);
        return { status: 'updated', holders };
      } else {
        cacheState.isPopulating = false;
        cacheState.progressState.step = 'completed';
        cacheState.lastProcessedBlock = Number(currentBlock);
        await saveStaxCacheState();
        logger.info('Stax', `No new burn events, using cache: ${cachedData.holders.length} holders`);
        return { status: 'up_to_date', holders: cachedData.holders };
      }
    }

    logger.info('Stax', `Cache miss or partial data, fetching holders`);
    let holdersMap;
    let totalBurned;
    let lastBlock;
    if (partialData && Array.isArray(partialData.holders)) {
      logger.info('Stax', `Resuming from partial cache: ${partialData.holders.length} holders`);
      holdersMap = new Map(partialData.holders.map(h => [h.wallet, h]));
      totalBurned = partialData.totalBurned;
      const lastProcessed = cacheState.progressState.processedNfts;
      const totalSupply = cacheState.progressState.totalNfts || await retry(
        async () => {
          const result = await client.readContract({
            address: contractAddress,
            abi: config.abis.stax.main,
            functionName: 'totalSupply',
          });
          if (result === null || result === undefined) {
            throw new Error('totalSupply returned null or undefined');
          }
          logger.debug('Stax', `Fetched totalSupply: ${result}`);
          return Number(result);
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      cacheState.progressState.totalNfts = totalSupply;
      cacheState.progressState.totalTiers = totalSupply;
      const tokenIds = Array.from({ length: totalSupply }, (_, i) => i + 1).slice(lastProcessed);
      cacheState.progressState.step = 'fetching_owners';
      await saveStaxCacheState();

      let currentBlock;
      try {
        currentBlock = await client.getBlockNumber();
      } catch (error) {
        logger.error('Stax', `Failed to fetch current block number: ${error.message}`, { stack: error.stack });
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
        throw error;
      }

      const batchSize = config.alchemy.batchSize;
      let nonExistentCount = 0;
      let burnedCount = 0;
      for (let i = 0; i < tokenIds.length; i += batchSize) {
        const batchTokenIds = tokenIds.slice(i, i + batchSize);
        const ownerPromises = batchTokenIds.map(tokenId =>
          limit(() =>
            retry(
              async () => {
                logger.trace('Stax', `Calling ownerOf for token ${tokenId}`);
                try {
                  const result = await client.readContract({
                    address: contractAddress,
                    abi: config.abis.stax.main,
                    functionName: 'ownerOf',
                    args: [tokenId],
                  });
                  if (!result || result === '0x0000000000000000000000000000000000000000') {
                    logger.debug('Stax', `Token ${tokenId} has no valid owner`);
                    return null;
                  }
                  logger.trace('Stax', `Fetched owner for token ${tokenId}: ${result}`);
                  return result;
                } catch (error) {
                  if (error.message.includes('OwnerQueryForNonexistentToken')) {
                    logger.debug('Stax', `Token ${tokenId} does not exist`);
                    nonExistentCount++;
                    return null;
                  }
                  logger.error('Stax', `Failed to fetch ownerOf for token ${tokenId}: ${error.message}`, { stack: error.stack });
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owner_resume', tokenId, error: error.message });
                  throw error;
                }
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            )
          )
        );
        const owners = await Promise.all(ownerPromises);
        owners.forEach((owner, index) => {
          if (owner === burnAddress) {
            logger.debug('Stax', `Token ${batchTokenIds[index]} burned`);
            burnedCount++;
          } else if (owner) {
            const current = holdersMap.get(owner) || { wallet: owner, tokenIds: [], tiers: Array(12).fill(0), total: 0, multiplierSum: 0 };
            current.tokenIds.push(batchTokenIds[index]);
            current.total += 1;
            holdersMap.set(owner, current);
          }
        });
        cacheState.progressState.processedNfts = lastProcessed + i + batchSize;
        await setCache('stax_holders_partial', { holders: Array.from(holdersMap.values()), totalBurned, timestamp: Date.now() }, 0, 'stax');
        await saveStaxCacheState();
        logger.info('Stax', `Processed batch ${i / batchSize + 1}: ${holdersMap.size} holders, ${nonExistentCount} non-existent, ${burnedCount} burned`);
      }

      logger.info('Stax', 'Fetching tiers for resumed data');
      cacheState.progressState.step = 'fetching_tiers';
      cacheState.progressState.processedTiers = 0;
      await saveStaxCacheState();

      for (const holder of holdersMap.values()) {
        const tierPromises = holder.tokenIds.map(tokenId =>
          limit(() =>
            retry(
              async () => {
                logger.trace('Stax', `Calling getNftTier for token ${tokenId}`);
                try {
                  const result = await client.readContract({
                    address: contractAddress,
                    abi: config.abis.stax.main,
                    functionName: 'getNftTier',
                    args: [tokenId],
                  });
                  if (result === null || result === undefined) {
                    logger.warn('Stax', `Invalid tier for token ${tokenId}: ${result}`);
                    return null;
                  }
                  logger.trace('Stax', `Fetched tier for token ${tokenId}: ${result}`);
                  return Number(result);
                } catch (error) {
                  if (error.message.includes('OwnerQueryForNonexistentToken')) {
                    logger.debug('Stax', `Token ${tokenId} does not exist`);
                    return null;
                  }
                  logger.error('Stax', `Failed to fetch getNftTier for token ${tokenId}: ${error.message}`, { stack: error.stack });
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier_resume', tokenId, error: error.message });
                  throw error;
                }
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            )
          )
        );
        const tiers = await Promise.all(tierPromises);
        tiers.forEach((tier, index) => {
          if (tier !== null && tier >= 1 && tier <= 12) {
            holder.tiers[tier - 1]++;
            holder.multiplierSum += config.contractTiers.stax[tier].multiplier;
          } else {
            logger.warn('Stax', `Invalid tier ${tier} for token ${holder.tokenIds[index]}`);
          }
        });
        cacheState.progressState.processedTiers += holder.tokenIds.length;
        await saveStaxCacheState();
      }
      lastBlock = Number(currentBlock);
    } else {
      const result = await getHoldersMap();
      holdersMap = result.holdersMap;
      totalBurned = result.totalBurned;
      lastBlock = result.lastBlock;
    }

    const holders = Array.from(holdersMap.values());
    const cacheData = { holders, totalBurned, timestamp: Date.now() };
    await setCache('stax_holders', cacheData, 0, 'stax');
    logger.info('Stax', `Set cache: ${holders.length} holders, totalBurned: ${totalBurned}`);
    cacheState.lastUpdated = Date.now();
    cacheState.totalOwners = holders.length;
    cacheState.lastProcessedBlock = lastBlock;
    cacheState.progressState = {
      step: 'completed',
      processedNfts: cacheState.progressState.totalNfts,
      totalNfts: cacheState.progressState.totalNfts,
      processedTiers: cacheState.progressState.totalTiers,
      totalTiers: cacheState.progressState.totalTiers,
      error: null,
      errorLog: []
    };
    await saveStaxCacheState();
    logger.info('Stax', `Cached: ${holders.length} holders, ${totalBurned} burned, block ${lastBlock}`);
    return { status: 'completed', holders };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Unknown error: ${JSON.stringify(error)}`;
    logger.error('Stax', `Cache population failed: ${errorMessage}`, { stack: error.stack, errors: errorLog });
    cacheState.progressState.step = 'error';
    cacheState.progressState.error = errorMessage;
    cacheState.progressState.errorLog = errorLog;
    await saveStaxCacheState();
    return { status: 'error', holders: null, error: errorMessage };
  } finally {
    cacheState.isPopulating = false;
    await saveStaxCacheState();
  }
}

export async function GET(_request) {
  try {
    await loadStaxCacheState();
    if (cacheState.isPopulating) {
      logger.info('Stax', 'Cache populating');
      return NextResponse.json({
        message: 'Cache is populating',
        isCachePopulating: true,
        totalOwners: cacheState.totalOwners,
        progressState: cacheState.progressState,
        lastProcessedBlock: cacheState.lastProcessedBlock,
        debugId: `state-${Math.random().toString(36).slice(2)}`,
      }, { status: 202 });
    }

    const cachedData = await getCache('stax_holders', 'stax');
    if (cachedData) {
      logger.info('Stax', `Cache hit: ${cachedData.holders.length} holders`);
      return NextResponse.json({
        holders: cachedData.holders,
        totalTokens: cachedData.holders.reduce((sum, h) => sum + h.total, 0),
        totalBurned: cachedData.totalBurned,
      });
    }

    logger.info('Stax', 'Cache miss, populating');
    const { status, holders } = await populateHoldersMapCache();
    if (status === 'error') {
      throw new Error('Cache population failed');
    }
    return NextResponse.json({
      holders,
      totalTokens: holders.reduce((sum, h) => sum + h.total, 0),
      totalBurned: (await getCache('stax_holders', 'stax'))?.totalBurned || 0,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Unknown error: ${JSON.stringify(error)}`;
    logger.error('Stax', `GET error: ${errorMessage}`, { stack: error.stack });
    return NextResponse.json({ error: 'Failed to fetch Stax holders', details: errorMessage }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { forceUpdate } = await request.json().catch(() => ({}));
    logger.info('Stax', `POST received, forceUpdate: ${forceUpdate}`);
    await loadStaxCacheState();
    if (cacheState.isPopulating && !forceUpdate) {
      logger.info('Stax', 'Cache population already in progress');
      return NextResponse.json({ message: 'Cache population already in progress', status: 'in_progress' }, { status: 202 });
    }
    const { status, error } = await populateHoldersMapCache(forceUpdate === true);
    if (status === 'error') {
      throw new Error(error || 'Cache population failed');
    }
    return NextResponse.json({ 
      message: status === 'up_to_date' ? 'Cache is up to date' : 'Stax cache population triggered', 
      status 
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : `Unknown error: ${JSON.stringify(error)}`;
    logger.error('Stax', `POST error: ${errorMessage}`, { stack: error.stack });
    return NextResponse.json({ error: 'Failed to populate Stax cache', details: errorMessage }, { status: 500 });
  }
}