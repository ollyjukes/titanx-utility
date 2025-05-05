// app/api/holders/utils/events.js
import { parseAbiItem } from 'viem';
import config from '@/contracts/config';
import { client, retry, logger, getCache, setCache } from '@/app/api new code/utils';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';

const localCache = new NodeCache({ stdTTL: 86400 }); // 24-hour TTL for node-cache
const useRedis = process.env.USE_REDIS === 'true'; // Set USE_REDIS=true to enable Redis

async function getLocalFileCache(key, contractKey) {
  if (useRedis) return getCache(key, contractKey);
  const cachePath = path.join(__dirname, '..', '..', '..', 'cache', `${key}.json`);
  try {
    const data = await fs.readFile(cachePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

async function setLocalFileCache(key, value, ttl, contractKey) {
  if (useRedis) return setCache(key, value, ttl, contractKey);
  const cachePath = path.join(__dirname, '..', '..', '..', 'cache', `${key}.json`);
  await fs.writeFile(cachePath, JSON.stringify(value, null, 2));
  localCache.set(key, value, ttl);
}

export async function getNewEvents(contractKey, contractAddress, fromBlock, errorLog) {
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const cacheKey = `${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}`;
  let cachedEvents = await getLocalFileCache(cacheKey, contractKey.toLowerCase());

  if (cachedEvents) {
    logger.info('utils', `Events cache hit: ${cacheKey}, burns: ${cachedEvents.burnedTokenIds.length}, transfers: ${cachedEvents.transferTokenIds?.length || 0}`, 'eth', contractKey);
    return cachedEvents;
  }

  let burnedTokenIds = [];
  let transferTokenIds = [];
  let endBlock;
  try {
    endBlock = await client.getBlockNumber();
  } catch (error) {
    logger.error('utils', `Failed to fetch block number: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    throw error;
  }

  const effectiveFromBlock = contractKey.toLowerCase() === 'element280' ? Math.max(fromBlock, 20945304) : fromBlock;
  if (BigInt(effectiveFromBlock) >= endBlock) {
    logger.info('utils', `No new blocks: fromBlock ${effectiveFromBlock} >= endBlock ${endBlock}`, 'eth', contractKey);
    return { burnedTokenIds, transferTokenIds, lastBlock: Number(endBlock) };
  }

  const maxBlockRange = 500; // Strict 500-block limit for free tier
  const maxBlocksToScan = 50000; // Limit to 50,000 blocks per run
  const concurrencyLimit = 5; // Process 5 ranges concurrently
  let currentFromBlock = BigInt(effectiveFromBlock);
  const toBlock = BigInt(Math.min(Number(currentFromBlock) + maxBlocksToScan, Number(endBlock)));
  const totalBlocks = Number(toBlock) - Number(currentFromBlock);
  let processedBlocks = 0;
  let startTime = Date.now();
  let rangeCount = 0;
  let apiCallCount = 0;

  logger.info('utils', `Starting event fetch for ${contractKey}: fromBlock ${currentFromBlock} to ${toBlock} (endBlock: ${endBlock}, total blocks: ${totalBlocks})`, 'eth', contractKey);

  // Check recent blocks to skip empty ranges
  const recentBlockCheck = BigInt(Math.max(Number(toBlock) - 50000, Number(currentFromBlock)));
  let hasRecentEvents = false;
  try {
    const recentLogs = await retry(
      async () => {
        apiCallCount++;
        return await client.getLogs({
          address: contractAddress,
          event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
          fromBlock: recentBlockCheck,
          toBlock: toBlock,
        });
      },
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    hasRecentEvents = recentLogs.length > 0;
    logger.info('utils', `Checked recent blocks ${recentBlockCheck}-${toBlock}: ${recentLogs.length} events found, API calls: ${apiCallCount}`, 'eth', contractKey);
  } catch (error) {
    logger.warn('utils', `Failed to check recent blocks: ${error.message}`, 'eth', contractKey);
  }

  if (!hasRecentEvents && Number(toBlock) - Number(currentFromBlock) > 50000) {
    logger.info('utils', `No recent events found, fast-forwarding to ${recentBlockCheck}`, 'eth', contractKey);
    currentFromBlock = recentBlockCheck;
    processedBlocks = Number(recentBlockCheck) - Number(effectiveFromBlock);
  }

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  while (currentFromBlock <= toBlock) {
    const ranges = [];
    for (let i = 0; i < concurrencyLimit && currentFromBlock <= toBlock; i++) {
      const currentToBlock = BigInt(Math.min(Number(currentFromBlock) + maxBlockRange - 1, Number(toBlock)));
      ranges.push({ fromBlock: currentFromBlock, toBlock: currentToBlock });
      currentFromBlock = currentToBlock + BigInt(1);
    }

    const rangeResults = await Promise.all(
      ranges.map(async ({ fromBlock, toBlock }) => {
        const rangeCacheKey = `${cacheKey}_range_${fromBlock}_${toBlock}`;
        let rangeCachedEvents = await getLocalFileCache(rangeCacheKey, contractKey.toLowerCase());

        if (rangeCachedEvents) {
          logger.info('utils', `Range cache hit: ${rangeCacheKey}, burns: ${rangeCachedEvents.burnedTokenIds.length}, transfers: ${rangeCachedEvents.transferTokenIds.length}`, 'eth', contractKey);
          return rangeCachedEvents;
        }

        try {
          logger.info('utils', `Fetching events from block ${fromBlock} to ${toBlock}`, 'eth', contractKey);
          const logs = await retry(
            async () => {
              apiCallCount++;
              return await client.getLogs({
                address: contractAddress,
                event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                fromBlock,
                toBlock,
              });
            },
            {
              retries: config.alchemy.maxRetries,
              delay: config.alchemy.batchDelayMs,
              onError: (error, attempt) => {
                if (error.message.includes('Log response size exceeded')) {
                  const match = error.message.match(/this block range should work: \[0x([0-9a-f]+), 0x([0-9a-f]+)\]/i);
                  if (match) {
                    const suggestedFromBlock = parseInt(match[1], 16);
                    const suggestedToBlock = parseInt(match[2], 16);
                    logger.warn('utils', `Log response size exceeded, retrying with suggested range: ${suggestedFromBlock}-${suggestedToBlock}`, 'eth', contractKey);
                    return new Error(`Retry with suggested range: ${suggestedFromBlock}-${suggestedToBlock}`);
                  }
                }
                return true; // Continue retrying
              },
            }
          );

          const rangeBurnedTokenIds = logs
            .filter(log => log.args.to.toLowerCase() === burnAddress.toLowerCase())
            .map(log => Number(log.args.tokenId));
          const rangeTransferTokenIds = logs
            .filter(log => log.args.to.toLowerCase() !== burnAddress.toLowerCase())
            .map(log => ({
              tokenId: Number(log.args.tokenId),
              from: log.args.from.toLowerCase(),
              to: log.args.to.toLowerCase(),
            }));

          logger.info('utils', `Fetched ${logs.length} events for block range ${fromBlock}-${toBlock}, API calls: ${apiCallCount}`, 'eth', contractKey);

          const rangeCacheData = {
            burnedTokenIds: rangeBurnedTokenIds,
            transferTokenIds: rangeTransferTokenIds,
            lastBlock: Number(toBlock),
            timestamp: Date.now(),
          };
          await setLocalFileCache(rangeCacheKey, rangeCacheData, 86400, contractKey.toLowerCase());
          logger.info('utils', `Cached range events: ${rangeCacheKey}, burns: ${rangeBurnedTokenIds.length}, transfers: ${rangeTransferTokenIds.length}`, 'eth', contractKey);

          return rangeCacheData;
        } catch (error) {
          logger.error('utils', `Failed to fetch events for block range ${fromBlock}-${toBlock}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_events', fromBlock: Number(fromBlock), toBlock: Number(toBlock), error: error.message });
          throw error;
        }
      })
    );

    for (const result of rangeResults) {
      burnedTokenIds.push(...result.burnedTokenIds);
      transferTokenIds.push(...result.transferTokenIds);
      processedBlocks += maxBlockRange;
      rangeCount++;
    }

    const progressPercentage = Math.min(((processedBlocks / totalBlocks) * 100).toFixed(2), 100);
    const elapsedTime = (Date.now() - startTime) / 1000; // seconds
    const avgTimePerRange = rangeCount > 0 ? elapsedTime / rangeCount : 0;
    const remainingRanges = Math.ceil((Number(toBlock) - Number(currentFromBlock)) / maxBlockRange);
    const estimatedTimeRemaining = (avgTimePerRange * remainingRanges).toFixed(2);

    logger.info('utils', `Progress for ${contractKey}: ${progressPercentage}% (${processedBlocks}/${totalBlocks} blocks), ETA: ${estimatedTimeRemaining}s, API calls: ${apiCallCount}`, 'eth', contractKey);

    // Throttle to avoid Alchemy rate limits
    await delay(100);
  }

  const cacheData = { burnedTokenIds, transferTokenIds, lastBlock: Number(toBlock), timestamp: Date.now() };
  await setLocalFileCache(cacheKey, cacheData, 86400, contractKey.toLowerCase());
  logger.info('utils', `Cached events: ${cacheKey}, burns: ${burnedTokenIds.length}, transfers: ${transferTokenIds.length}, API calls: ${apiCallCount}`, 'eth', contractKey);
  return cacheData;
}