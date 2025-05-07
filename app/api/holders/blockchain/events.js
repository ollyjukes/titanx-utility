// app/api/holders/blockchain/events.js
import { parseAbiItem } from 'viem';
import pLimit from 'p-limit';
import config from '@/contracts/config';
import { client } from '@/app/api/utils/client';
import { retry } from '@/app/api/utils/retry';
import { getCache, setCache } from '@/app/api/utils/cache';
import { logger } from '@/app/lib/logger';
import { getCacheState, saveCacheStateContract } from '@/app/api/holders/cache/state';

const concurrencyLimit = pLimit(2); // Reduced for Alchemy Free Tier

export async function getNewEvents(contractKey, contractAddress, fromBlock, errorLog) {
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const prefix = contractKey.toLowerCase();
  const chain = config.nftContracts[prefix]?.chain || 'eth';
  const cacheKey = `${prefix}_events_${contractAddress}_${fromBlock}`;
  let cachedEvents = await getCache(cacheKey, prefix);

  if (cachedEvents) {
    logger.info(
      'utils',
      `Events cache hit: ${cacheKey}, burns: ${cachedEvents.burnedTokenIds.length}, transfers: ${cachedEvents.transferTokenIds?.length || 0}`,
      chain,
      contractKey
    );
    return cachedEvents;
  }

  let burnedTokenIds = [];
  let transferTokenIds = [];
  let endBlock;
  try {
    endBlock = await retry(
      () => client.getBlockNumber(),
      { retries: 3, delay: 1000, backoff: true }
    );
  } catch (error) {
    logger.error('utils', `Failed to fetch block number: ${error.message}`, { stack: error.stack }, chain, contractKey);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    throw error;
  }

  if (fromBlock >= endBlock) {
    logger.info('utils', `No new blocks: fromBlock ${fromBlock} >= endBlock ${endBlock}`, chain, contractKey);
    return { burnedTokenIds, transferTokenIds, lastBlock: Number(endBlock), timestamp: Date.now() };
  }

  const maxBlockRange = 200; // Reduced for Alchemy Free Tier
  const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
  const blockRanges = [];
  let currentFromBlock = BigInt(fromBlock);

  // Generate block ranges
  while (currentFromBlock <= endBlock) {
    const toBlock = BigInt(Math.min(Number(currentFromBlock) + maxBlockRange, Number(endBlock)));
    blockRanges.push({ fromBlock: currentFromBlock, toBlock });
    currentFromBlock = toBlock + 1n;
  }

  logger.info('utils', `Processing ${blockRanges.length} block ranges from ${fromBlock} to ${endBlock}`, chain, contractKey);

  // Load cache state for lastProcessedBlock updates
  let cacheState = await getCacheState(contractKey);

  // Process block ranges sequentially to avoid rate limits
  for (const range of blockRanges) {
    const rangeCacheKey = `${prefix}_events_${contractAddress}_${range.fromBlock}_${range.toBlock}`;
    let rangeEvents = await getCache(rangeCacheKey, prefix);

    if (rangeEvents) {
      logger.debug(
        'utils',
        `Range cache hit: ${rangeCacheKey}, burns: ${rangeEvents.burnedTokenIds.length}, transfers: ${rangeEvents.transferTokenIds?.length || 0}`,
        chain,
        contractKey
      );
      burnedTokenIds.push(...rangeEvents.burnedTokenIds);
      transferTokenIds.push(...rangeEvents.transferTokenIds);
      cacheState.lastProcessedBlock = Number(range.toBlock);
      cacheState.progressState.lastProcessedBlock = Number(range.toBlock);
      cacheState.progressState.lastUpdated = Date.now();
      await saveCacheStateContract(contractKey, cacheState);
      logger.debug('utils', `Updated lastProcessedBlock to ${range.toBlock} for range ${rangeCacheKey}`, chain, contractKey);
      continue;
    }

    let attempt = 0;
    const maxAttempts = 2;
    let currentToBlock = range.toBlock;
    let dynamicRange = maxBlockRange;

    while (attempt < maxAttempts) {
      try {
        logger.debug(
          'utils',
          `Fetching logs from block ${range.fromBlock} to ${currentToBlock} (attempt ${attempt + 1}/${maxAttempts})`,
          chain,
          contractKey
        );
        const logs = await retry(
          () =>
            client.getLogs({
              address: contractAddress,
              event: transferEvent,
              fromBlock: range.fromBlock,
              toBlock: currentToBlock,
            }),
          { retries: 2, delay: 1000, backoff: true }
        );

        const newBurned = logs
          .filter(log => log.args.to.toLowerCase() === burnAddress.toLowerCase())
          .map(log => Number(log.args.tokenId));
        const newTransfers = logs
          .filter(log => log.args.to.toLowerCase() !== burnAddress.toLowerCase())
          .map(log => ({
            tokenId: Number(log.args.tokenId),
            from: log.args.from.toLowerCase(),
            to: log.args.to.toLowerCase(),
          }));

        rangeEvents = {
          burnedTokenIds: newBurned,
          transferTokenIds: newTransfers,
          lastBlock: Number(currentToBlock),
          timestamp: Date.now(),
        };
        await setCache(rangeCacheKey, rangeEvents, config.cache.nodeCache.stdTTL || 86400, prefix);
        burnedTokenIds.push(...newBurned);
        transferTokenIds.push(...newTransfers);
        logger.info(
          'utils',
          `Fetched ${newBurned.length} burn events and ${newTransfers.length} transfer events for blocks ${range.fromBlock} to ${currentToBlock}`,
          chain,
          contractKey
        );

        // Update lastProcessedBlock
        cacheState.lastProcessedBlock = Number(currentToBlock);
        cacheState.progressState.lastProcessedBlock = Number(currentToBlock);
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        logger.debug('utils', `Updated lastProcessedBlock to ${currentToBlock} for range ${rangeCacheKey}`, chain, contractKey);
        break;
      } catch (error) {
        attempt++;
        logger.warn(
          'utils',
          `Attempt ${attempt}/${maxAttempts} failed for blocks ${range.fromBlock} to ${currentToBlock}: ${error.message}`,
          chain,
          contractKey
        );

        // Parse error for suggested block range
        const suggestedRangeMatch = error.message.match(/this block range should work: \[(0x[a-fA-F0-9]+), (0x[a-fA-F0-9]+)\]/);
        if (suggestedRangeMatch && attempt < maxAttempts) {
          const [, , suggestedTo] = suggestedRangeMatch;
          currentToBlock = BigInt(parseInt(suggestedTo, 16));
          dynamicRange = Number(currentToBlock - range.fromBlock);
          logger.info(
            'utils',
            `Adjusted to suggested block range: ${range.fromBlock} to ${currentToBlock} (${dynamicRange} blocks)`,
            chain,
            contractKey
          );
          continue;
        }

        // Reduce range size if error persists
        if (error.message.includes('Log response size exceeded') && dynamicRange > 50) {
          dynamicRange = Math.max(50, Math.floor(dynamicRange / 2));
          currentToBlock = range.fromBlock + BigInt(dynamicRange);
          logger.info(
            'utils',
            `Reduced block range to ${dynamicRange} blocks: ${range.fromBlock} to ${currentToBlock}`,
            chain,
            contractKey
          );
          continue;
        }

        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_events',
          fromBlock: Number(range.fromBlock),
          toBlock: Number(currentToBlock),
          error: error.message,
        });

        if (attempt >= maxAttempts) {
          logger.error(
            'utils',
            `Max attempts reached for blocks ${range.fromBlock} to ${currentToBlock}: ${error.message}`,
            { stack: error.stack },
            chain,
            contractKey
          );
          rangeEvents = {
            burnedTokenIds: [],
            transferTokenIds: [],
            lastBlock: Number(range.fromBlock),
            timestamp: Date.now(),
          };
          await setCache(rangeCacheKey, rangeEvents, config.cache.nodeCache.stdTTL || 86400, prefix);
          cacheState.lastProcessedBlock = Number(range.fromBlock);
          cacheState.progressState.lastProcessedBlock = Number(range.fromBlock);
          cacheState.progressState.lastUpdated = Date.now();
          await saveCacheStateContract(contractKey, cacheState);
          logger.debug('utils', `Updated lastProcessedBlock to ${range.fromBlock} on failure for range ${rangeCacheKey}`, chain, contractKey);
          break;
        }
      }
    }
  }

  const lastBlock = Number(endBlock);
  const cacheData = { burnedTokenIds, transferTokenIds, lastBlock, timestamp: Date.now() };
  await setCache(cacheKey, cacheData, config.cache.nodeCache.stdTTL || 86400, prefix);
  logger.info(
    'utils',
    `Cached events: ${cacheKey}, burns: ${burnedTokenIds.length}, transfers: ${transferTokenIds.length}, lastBlock: ${lastBlock}`,
    chain,
    contractKey
  );

  return cacheData;
}