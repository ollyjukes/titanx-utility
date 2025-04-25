import { NextResponse } from 'next/server';
import { client, log, batchMulticall, saveCacheState, loadCacheState } from '@/app/api/utils';
import { contractAddresses, element280MainAbi } from '@/app/nft-contracts';
import pLimit from 'p-limit';
import { parseAbiItem } from 'viem';
import NodeCache from 'node-cache';
import fs from 'fs/promises';

// force-dynamic
// This route is dynamic and should not be cached by Next.js
// This is important for streaming responses
export const dynamic = 'force-dynamic';

// Constants
const BURN_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEPLOYMENT_BLOCK = 20945304; // From nft-contracts.js
const MAX_BLOCK_RANGE = 2000; // Optimized for efficiency
const RECENT_BLOCK_CHECK = 10000; // Check last 10,000 blocks for new burns
const EVENT_CACHE_TTL = 24 * 60 * 60;
const BURNED_EVENTS_CACHE_KEY = 'element280_burned_events_detailed';
const METADATA_CACHE_KEY = 'element280_burned_metadata';
const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === 'true';

// Initialize node-cache
const cache = new NodeCache({ stdTTL: EVENT_CACHE_TTL });

// Initialize storage
function initStorage(contractAddress) {
  const cacheKey = `burned_storage_${contractAddress}`;
  let storage = cache.get(cacheKey);
  if (!storage) {
    storage = { burnedEventsDetailedCache: null, lastBurnBlock: 22326677 }; // Initialize with known last burn block
    cache.set(cacheKey, storage);
    log(`[element280] [INIT] Initialized node-cache for burned events: ${contractAddress}`);
  }
  return storage;
}

// Load metadata (last burn block)
async function loadMetadata(contractAddress) {
  const metadata = await loadCacheState(`burned_metadata_${contractAddress}`);
  return metadata ? metadata.lastBurnBlock : 22326677; // Default to known last burn block
}

// Save metadata
async function saveMetadata(contractAddress, lastBurnBlock) {
  await saveCacheState(`burned_metadata_${contractAddress}`, { lastBurnBlock });
}

// Retry utility
async function retry(fn, attempts = 5, delay = (retryCount) => Math.min(1000 * 2 ** retryCount, 10000)) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[element280] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) {
        log(`[element280] [ERROR] Retry failed after ${attempts} attempts: ${error.message}, stack: ${error.stack}`);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay(i)));
    }
  }
}

// Update last burn block by checking recent blocks
async function updateLastBurnBlock(contractAddress, currentLastBurnBlock, endBlock) {
  const fromBlock = Math.max(currentLastBurnBlock + 1, DEPLOYMENT_BLOCK);
  const toBlock = Math.min(fromBlock + RECENT_BLOCK_CHECK, Number(endBlock));
  if (fromBlock > toBlock) return currentLastBurnBlock;

  log(`[element280] [DEBUG] Checking recent blocks ${fromBlock}-${toBlock} for new burns`);
  const logs = await retry(() =>
    client.getLogs({
      address: contractAddress,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    })
  );
  const burnLogs = logs.filter(log => log.args.to.toLowerCase() === BURN_ADDRESS);
  if (burnLogs.length > 0) {
    const latestBurnBlock = Math.max(...burnLogs.map(log => Number(log.blockNumber)));
    log(`[element280] [DEBUG] Found new burns, updating lastBurnBlock to ${latestBurnBlock}`);
    return latestBurnBlock;
  }
  return currentLastBurnBlock;
}

// Validate burned events
async function validateBurnedEvents(contractAddress) {
  const storage = initStorage(contractAddress);
  if (DISABLE_REDIS) {
    if (storage.burnedEventsDetailedCache) {
      log(`[element280] [DEBUG] Cache hit for burned events: ${storage.burnedEventsDetailedCache.burnedCount} events`);
      return storage.burnedEventsDetailedCache;
    }
    const persistedCache = await loadCacheState(`burned_${contractAddress}`);
    if (persistedCache) {
      storage.burnedEventsDetailedCache = persistedCache;
      log(`[element280] [DEBUG] Loaded persisted burned events: ${persistedCache.burnedCount} events`);
      return persistedCache;
    }
  }

  log(`[element280] [STAGE] Fetching burned events for ${contractAddress}`);
  const burnedEvents = [];
  let burnedCount = 0;
  const endBlock = await retry(() => client.getBlockNumber());
  let lastBurnBlock = await loadMetadata(contractAddress);
  lastBurnBlock = await updateLastBurnBlock(contractAddress, lastBurnBlock, endBlock);
  const ranges = [];
  for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= lastBurnBlock; fromBlock += MAX_BLOCK_RANGE) {
    const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, lastBurnBlock);
    ranges.push({ fromBlock, toBlock });
  }

  const limit = pLimit(2); // Reduced concurrency
  for (const [index, { fromBlock, toBlock }] of ranges.entries()) {
    try {
      log(`[element280] [PROGRESS] Processing blocks ${fromBlock}-${toBlock} for ${contractAddress} (${index + 1}/${ranges.length})`);
      const logs = await retry(() =>
        client.getLogs({
          address: contractAddress,
          event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
          fromBlock: BigInt(fromBlock),
          toBlock: BigInt(toBlock),
        })
      );
      const burnLogs = logs.filter(log => log.args.to.toLowerCase() === BURN_ADDRESS);
      if (burnLogs.length === 0) continue;

      const tokenIds = burnLogs.map(log => log.args.tokenId);
      const tierCalls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi: element280MainAbi,
        functionName: 'getNftTier',
        args: [tokenId],
      }));
      const tierResults = await batchMulticall(tierCalls, 50);
      const block = await retry(() => client.getBlock({ blockNumber: burnLogs[0]?.blockNumber }));

      burnLogs.forEach((log, i) => {
        const tier = tierResults[i].status === 'success' ? Number(tierResults[i].result) : 0;
        burnedEvents.push({
          tokenId: log.args.tokenId.toString(),
          tier,
          from: log.args.from.toLowerCase(),
          transactionHash: log.transactionHash.toLowerCase(),
          blockNumber: Number(log.blockNumber),
          blockTimestamp: Number(block.timestamp),
        });
        burnedCount++;
      });
    } catch (error) {
      log(`[element280] [ERROR] Failed to process blocks ${fromBlock}-${toBlock}: ${error.message}, stack: ${error.stack}`);
    }
  }

  const result = { burnedCount, events: burnedEvents, timestamp: Date.now() };
  if (DISABLE_REDIS) {
    storage.burnedEventsDetailedCache = result;
    storage.lastBurnBlock = lastBurnBlock;
    cache.set(`burned_storage_${contractAddress}`, storage);
    await saveCacheState(`burned_${contractAddress}`, result);
    await saveMetadata(contractAddress, lastBurnBlock);
  }
  log(`[element280] [STAGE] Completed burned events fetch: ${burnedCount} events, lastBurnBlock=${lastBurnBlock}`);
  return result;
}

// Stream burned events
export async function GET() {
  const address = contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          const storage = initStorage(address);
          if (DISABLE_REDIS && storage.burnedEventsDetailedCache) {
            controller.enqueue(JSON.stringify({
              complete: true,
              result: storage.burnedEventsDetailedCache,
            }) + '\n');
            controller.close();
            return;
          }

          const burnedEvents = [];
          let burnedCount = 0;
          const endBlock = await retry(() => client.getBlockNumber());
          let lastBurnBlock = await loadMetadata(address);
          lastBurnBlock = await updateLastBurnBlock(address, lastBurnBlock, endBlock);
          const ranges = [];
          for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= lastBurnBlock; fromBlock += MAX_BLOCK_RANGE) {
            const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, lastBurnBlock);
            ranges.push({ fromBlock, toBlock });
          }

          const limit = pLimit(2);
          for (const [index, { fromBlock, toBlock }] of ranges.entries()) {
            log(`[element280] [PROGRESS] Processing blocks ${fromBlock}-${toBlock} for ${address} (${index + 1}/${ranges.length})`);
            const logs = await retry(() =>
              client.getLogs({
                address,
                event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                fromBlock: BigInt(fromBlock),
                toBlock: BigInt(toBlock),
              })
            );
            const burnLogs = logs.filter(log => log.args.to.toLowerCase() === BURN_ADDRESS);
            if (burnLogs.length === 0) continue;

            const tokenIds = burnLogs.map(log => log.args.tokenId);
            const tierCalls = tokenIds.map(tokenId => ({
              address,
              abi: element280MainAbi,
              functionName: 'getNftTier',
              args: [tokenId],
            }));
            const tierResults = await batchMulticall(tierCalls, 50);
            const block = await retry(() => client.getBlock({ blockNumber: burnLogs[0]?.blockNumber }));

            burnLogs.forEach((log, i) => {
              const tier = tierResults[i].status === 'success' ? Number(tierResults[i].result) : 0;
              const event = {
                tokenId: log.args.tokenId.toString(),
                tier,
                from: log.args.from.toLowerCase(),
                transactionHash: log.transactionHash.toLowerCase(),
                blockNumber: Number(log.blockNumber),
                blockTimestamp: Number(block.timestamp),
              };
              burnedEvents.push(event);
              burnedCount++;
              controller.enqueue(JSON.stringify({ event, progress: { index: index + 1, total: ranges.length } }) + '\n');
            });
          }

          const result = { burnedCount, events: burnedEvents, timestamp: Date.now() };
          if (DISABLE_REDIS) {
            storage.burnedEventsDetailedCache = result;
            storage.lastBurnBlock = lastBurnBlock;
            cache.set(`burned_storage_${address}`, storage);
            await saveCacheState(`burned_${address}`, result);
            await saveMetadata(address, lastBurnBlock);
          }
          controller.enqueue(JSON.stringify({ complete: true, result }) + '\n');
          controller.close();
        } catch (error) {
          log(`[element280] [ERROR] Streaming error: ${error.message}, stack: ${error.stack}`);
          controller.enqueue(JSON.stringify({ error: `Server error: ${error.message}` }) + '\n');
          controller.close();
        }
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } }
  );
}