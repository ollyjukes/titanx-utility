import { Alchemy, Network } from 'alchemy-sdk';
import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet } from 'viem/chains';
import pino from 'pino';
import { getCache, setCache } from '@/app/api/utils/cache';
import { retry } from '@/app/api/utils/retry';
import config from '@/app/contracts_nft';

const logger = pino({ level: 'info', base: { context: 'events' } });



const alchemyApiKey = config.alchemy.apiKey;
if (!alchemyApiKey) throw new Error('ALCHEMY_API_KEY is not set');
const alchemy = new Alchemy({
  apiKey: alchemyApiKey,
  network: Network.ETH_MAINNET,
});

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`, { timeout: 60000 }),
});

const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
const MAX_BLOCK_RANGE = 2000; // Reduced from 10000 to prevent rate limits
const MIN_BLOCK_RANGE = 1000;
const BATCH_SIZE = 25;
const BATCH_DELAY_MS = 1000;

// Contracts using getLogs
const LOG_CONTRACTS = ['element280', 'element369', 'stax'];

export async function getNewEvents(
  contractKey,
  contractAddress,
  startBlock,
  endBlock,
  config,
  chain = 'ETH',
  forceUpdate = false
) {
  const context = `events/${contractKey}`;
  const cacheKey = `${contractKey}_transfers`;
  const cachedTransfers = await getCache(cacheKey, contractKey, 'transfers');
  const now = Date.now();

  // Determine start block from cache
  let effectiveStartBlock = startBlock;
  if (!forceUpdate && cachedTransfers && cachedTransfers.lastBlock) {
    effectiveStartBlock = Math.max(startBlock, cachedTransfers.lastBlock + 1);
    logger.info(`[${context}] Using cached lastBlock: ${cachedTransfers.lastBlock}, starting from ${effectiveStartBlock}`, chain, contractKey);
  }

  if (effectiveStartBlock > endBlock) {
    logger.info(`[${context}] No new blocks to process (start: ${effectiveStartBlock}, end: ${endBlock})`, chain, contractKey);
    return cachedTransfers || { buys: [], sells: [], burns: [], lastBlock: Number(endBlock), timestamp: now, errorLog: [] };
  }

  const buys = cachedTransfers?.buys || [];
  const sells = cachedTransfers?.sells || [];
  const burns = cachedTransfers?.burns || [];
  const errorLog = cachedTransfers?.errorLog || [];
  let lastProcessedBlock = cachedTransfers?.lastBlock || effectiveStartBlock - 1;

  if (LOG_CONTRACTS.includes(contractKey)) {
    logger.info(`[${context}] Fetching transfers from block ${effectiveStartBlock} to ${endBlock} using getLogs`, chain, contractKey);
    const blockRanges = [];
    let currentFromBlock = Number(effectiveStartBlock);
    const endBlockNumber = Number(endBlock);

    for (let block = currentFromBlock; block <= endBlockNumber; block += MAX_BLOCK_RANGE) {
      const toBlock = Math.min(block + MAX_BLOCK_RANGE - 1, endBlockNumber);
      blockRanges.push({ fromBlock: block, toBlock });
    }

    const concurrencyLimit = 8;
    for (let i = 0; i < blockRanges.length; i += concurrencyLimit) {
      const batch = blockRanges.slice(i, i + concurrencyLimit);
      await Promise.all(
        batch.map(async ({ fromBlock, toBlock }) => {
          let currentMaxBlockRange = MAX_BLOCK_RANGE;
          let currentFromBlock = fromBlock;
          while (currentFromBlock <= toBlock) {
            const currentToBlock = Math.min(currentFromBlock + currentMaxBlockRange - 1, toBlock);
            try {
              const logs = await retry(
                () =>
                  client.getLogs({
                    address: contractAddress,
                    event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
                    fromBlock: BigInt(currentFromBlock),
                    toBlock: BigInt(currentToBlock),
                  }),
                { retries: 5, delay: 500, backoff: true, timeout: 60000 }
              );
              logger.debug(`[${context}] Fetched ${logs.length} transfers for blocks ${currentFromBlock}-${currentToBlock}`, chain, contractKey);

              logs.forEach((log) => {
                const fromAddr = log.args.from.toLowerCase();
                const toAddr = log.args.to.toLowerCase();
                const tokenId = Number(log.args.tokenId);
                const blockNumber = Number(log.blockNumber);
                const timestamp = now;

                if (toAddr === burnAddress.toLowerCase()) {
                  burns.push({ from: fromAddr, to: toAddr, tokenId, blockNumber, timestamp });
                } else if (fromAddr === '0x0000000000000000000000000000000000000000') {
                  buys.push({ from: fromAddr, to: toAddr, tokenId, blockNumber, timestamp });
                } else {
                  sells.push({ from: fromAddr, to: toAddr, tokenId, blockNumber, timestamp });
                }
              });

              if (currentToBlock > lastProcessedBlock) {
                lastProcessedBlock = currentToBlock;
              }
            } catch (error) {
              logger.error(`[${context}] Failed to fetch transfers for blocks ${currentFromBlock}-${currentToBlock}: ${error.message}`, { stack: error.stack }, chain, contractKey);
              errorLog.push({
                timestamp: new Date().toISOString(),
                phase: 'fetch_transfers',
                fromBlock: currentFromBlock,
                toBlock: currentToBlock,
                error: error.message,
              });

              if (error.message.includes('Log response size exceeded') && currentMaxBlockRange > MIN_BLOCK_RANGE) {
                currentMaxBlockRange = Math.floor(currentMaxBlockRange / 2);
                logger.info(`[${context}] Reducing block range to ${currentMaxBlockRange} due to log size limit`, chain, contractKey);
                continue;
              }

              currentFromBlock = currentToBlock + 1;
              if (currentToBlock > lastProcessedBlock) {
                lastProcessedBlock = currentToBlock;
              }
            }
            currentFromBlock = currentToBlock + 1;
          }
        })
      );

      const progress = Math.min(((i + batch.length) / blockRanges.length) * 100, 100).toFixed(2);
      logger.info(`[${context}] Transfers progress: ${progress}%`, chain, contractKey);
      if (i + concurrencyLimit < blockRanges.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
  } else {
    logger.info(`[${context}] Fetching transfers from block ${effectiveStartBlock} to ${endBlock} using getAssetTransfers`, chain, contractKey);
    const blockRanges = [];
    let currentFromBlock = BigInt(effectiveStartBlock);
    const endBlockNumber = BigInt(endBlock);

    while (currentFromBlock <= endBlockNumber) {
      const toBlock = BigInt(Math.min(Number(currentFromBlock) + MAX_BLOCK_RANGE - 1, Number(endBlockNumber)));
      blockRanges.push({ fromBlock: currentFromBlock, toBlock });
      currentFromBlock = toBlock + 1n;
    }

    for (const range of blockRanges) {
      try {
        const transfers = await retry(() =>
          alchemy.core.getAssetTransfers({
            fromBlock: `0x${range.fromBlock.toString(16)}`,
            toBlock: `0x${range.toBlock.toString(16)}`,
            contractAddresses: [contractAddress],
            category: ['erc721', 'erc1155'],
            withMetadata: true,
          })
        );

        for (const transfer of transfers.transfers) {
          const fromAddr = transfer.from.toLowerCase();
          const toAddr = transfer.to.toLowerCase();
          const tokenId = Number(transfer.tokenId);
          if (!tokenId) {
            logger.warn(`[${context}] Skipping transfer with missing tokenId: ${JSON.stringify(transfer)}`, chain, contractKey);
            continue;
          }

          const blockNumber = Number(transfer.blockNum);
          const timestamp = new Date(transfer.metadata.blockTimestamp).getTime();

          if (toAddr === burnAddress.toLowerCase()) {
            burns.push({ from: fromAddr, to: toAddr, tokenId, blockNumber, timestamp });
          } else if (fromAddr === '0x0000000000000000000000000000000000000000') {
            buys.push({ from: fromAddr, to: toAddr, tokenId, blockNumber, timestamp });
          } else {
            sells.push({ from: fromAddr, to: toAddr, tokenId, blockNumber, timestamp });
          }
        }

        if (Number(range.toBlock) > lastProcessedBlock) {
          lastProcessedBlock = Number(range.toBlock);
        }
      } catch (error) {
        logger.error(`[${context}] Failed to fetch transfers for blocks ${range.fromBlock}-${range.toBlock}: ${error.message}`, { stack: error.stack }, chain, contractKey);
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_transfers',
          fromBlock: Number(range.fromBlock),
          toBlock: Number(range.toBlock),
          error: error.message,
        });
      }
    }
  }

  const result = {
    buys,
    sells,
    burns,
    lastBlock: lastProcessedBlock,
    timestamp: now,
    errorLog,
  };

  if (typeof result.lastBlock !== 'number') {
    logger.error(`[${context}] Invalid lastBlock in result: ${result.lastBlock}`, {}, chain, contractKey);
    throw new Error('lastBlock is not defined in events result');
  }

  await setCache(cacheKey, result, config.cache.nodeCache.stdTTL, contractKey, 'transfers');
  logger.info(
    `[${context}] Transfers completed: ${buys.length} buys, ${sells.length} sells, ${burns.length} burns, lastBlock: ${result.lastBlock}`,
    chain,
    contractKey
  );
  return result;
}