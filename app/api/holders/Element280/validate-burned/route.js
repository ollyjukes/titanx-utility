// /app/api/holders/Element280/validate-burned/route.js
import { NextResponse } from "next/server";
import { client, log, getCache, setCache } from "@/app/api/utils";
import { contractAddresses, element280MainAbi } from "@/app/nft-contracts";
import pLimit from "p-limit";
import { parseAbiItem } from "viem";

const DISABLE_REDIS = process.env.DISABLE_ELEMENT280_REDIS === "true";
const BURNED_EVENTS_CACHE_KEY = "element280_burned_events_detailed";
const EVENT_CACHE_TTL = 24 * 60 * 60;
const DEPLOYMENT_BLOCK = 17435629;
const MAX_BLOCK_RANGE = 5000;
const BURN_ADDRESS = "0x0000000000000000000000000000000000000000";

// In-memory storage, keyed by contract address
const inMemoryStorage = new Map();

// Initialize storage
function initStorage(contractAddress) {
  if (!inMemoryStorage.has(contractAddress)) {
    inMemoryStorage.set(contractAddress, {
      burnedEventsDetailedCache: null,
    });
    log(`[element280] [INIT] Initialized validate-burned storage for ${contractAddress}`);
  }
  return inMemoryStorage.get(contractAddress);
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

// Validate burned NFTs
async function validateBurnedEvents(contractAddress) {
  const storage = initStorage(contractAddress);
  let cachedData = null;
  if (DISABLE_REDIS) {
    if (storage.burnedEventsDetailedCache) {
      cachedData = storage.burnedEventsDetailedCache;
      log(`[element280] [DEBUG] Using in-memory detailed burned events cache for ${contractAddress}: ${cachedData.burnedCount} burned NFTs`);
    }
  } else {
    try {
      cachedData = await getCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`);
      if (cachedData) {
        log(`[element280] [DEBUG] Using Redis detailed burned events cache for ${contractAddress}: ${cachedData.burnedCount} burned NFTs`);
      }
    } catch (cacheError) {
      log(`[element280] [ERROR] Cache read error for detailed burned events: ${cacheError.message}`);
    }
  }

  if (cachedData) {
    return cachedData;
  }

  log(`[element280] [STAGE] Validating burned NFTs via Transfer events for ${contractAddress}`);
  const burnedEvents = [];
  let burnedCount = 0;
  const endBlock = await retry(() => client.getBlockNumber());
  const limit = pLimit(3);
  const ranges = [];
  for (let fromBlock = DEPLOYMENT_BLOCK; fromBlock <= endBlock; fromBlock += MAX_BLOCK_RANGE) {
    const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, Number(endBlock));
    ranges.push({ fromBlock, toBlock });
  }

  try {
    await Promise.all(
      ranges.map(({ fromBlock, toBlock }, index) =>
        limit(async () => {
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
            for (const log of logs) {
              if (log.args.to.toLowerCase() === BURN_ADDRESS) {
                let tier = 0;
                try {
                  const tierResult = await retry(() =>
                    client.readContract({
                      address: contractAddress,
                      abi: element280MainAbi,
                      functionName: "getNftTier",
                      args: [log.args.tokenId],
                      blockNumber: log.blockNumber,
                    })
                  );
                  tier = Number(tierResult);
                } catch (error) {
                  log(`[element280] [WARN] Failed to fetch tier for burned token ${log.args.tokenId}: ${error.message}`);
                }
                const block = await retry(() => client.getBlock({ blockNumber: log.blockNumber }));
                burnedEvents.push({
                  tokenId: log.args.tokenId.toString(),
                  tier,
                  from: log.args.from.toLowerCase(),
                  transactionHash: log.transactionHash.toLowerCase(),
                  blockNumber: Number(log.blockNumber),
                  blockTimestamp: Number(block.timestamp),
                });
                burnedCount++;
              }
            }
          } catch (error) {
            log(`[element280] [ERROR] Failed to fetch Transfer events for blocks ${fromBlock}-${toBlock}: ${error.message}`);
          }
        })
      )
    );

    log(`[element280] [STAGE] Validated ${burnedCount} burned NFTs with ${burnedEvents.length} events for ${contractAddress}`);
    const result = { burnedCount, events: burnedEvents, timestamp: Date.now() };

    if (DISABLE_REDIS) {
      storage.burnedEventsDetailedCache = result;
    } else {
      await setCache(`${BURNED_EVENTS_CACHE_KEY}_${contractAddress}`, result, EVENT_CACHE_TTL);
    }

    return result;
  } catch (error) {
    log(`[element280] [ERROR] Failed to validate burned events for ${contractAddress}: ${error.message}, stack: ${error.stack}`);
    return { burnedCount: 0, events: [], timestamp: Date.now() };
  }
}

export async function GET() {
  const address = contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: "Element280 contract address not found" }, { status: 400 });
  }

  try {
    const result = await validateBurnedEvents(address);
    return NextResponse.json({
      burnedCount: result.burnedCount,
      events: result.events,
      cachedAt: new Date(result.timestamp).toISOString(),
    });
  } catch (error) {
    log(`[element280] [ERROR] Error in GET /api/holders/Element280/validate-burned: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}