import { parseAbiItem, formatUnits, getAddress } from 'viem';
import pLimit from 'p-limit';
import config from '@/config';
import { client, alchemy } from './blockchain.js';
import { retry, batchMulticall, logger, saveCacheState } from './index.js';

const concurrencyLimit = pLimit(4);

async function getOwnersForContract(contractAddress, abi, options = {}) {
  let owners = [];
  let pageKey = options.pageKey || null;
  const maxPages = options.maxPages || 10;
  let pageCount = 0;

  logger.debug('contracts', `Fetching owners for contract: ${contractAddress}`, 'eth', 'general');

  do {
    try {
      const response = await alchemy.nft.getOwnersForContract(contractAddress, {
        withTokenBalances: options.withTokenBalances || false,
        pageKey,
      });

      if (!response?.owners || !Array.isArray(response.owners)) {
        logger.warn('contracts', `Invalid Alchemy response for ${contractAddress}`, {}, 'eth', 'general');
        return owners;
      }

      for (const owner of response.owners) {
        const tokenBalances = owner.tokenBalances || [];
        if (tokenBalances.length > 0) {
          const validBalances = tokenBalances.filter(tb => tb.tokenId && Number(tb.balance) > 0);
          if (validBalances.length > 0) {
            owners.push({
              ownerAddress: owner.ownerAddress.toLowerCase(),
              tokenBalances: validBalances.map(tb => ({
                tokenId: Number(tb.tokenId),
                balance: Number(tb.balance),
              })),
            });
          }
        }
      }

      pageKey = response.pageKey || null;
      pageCount++;
    } catch (error) {
      logger.error('contracts', `Failed to fetch owners for ${contractAddress}: ${error.message}`, {}, 'eth', 'general');
      return owners;
    }
  } while (pageKey && pageCount < maxPages);

  logger.info('contracts', `Fetched ${owners.length} owners for contract: ${contractAddress}`, 'eth', 'general');
  return owners;
}

async function getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState, addressFilter = null) {
  if (!contractAddress || !abi) {
    throw new Error('Contract address or ABI missing');
  }

  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const holdersMap = new Map();
  let totalBurned = 0;
  const errorLog = [];

  cacheState.progressState.step = 'fetching_supply';
  await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());

  let currentBlock;
  try {
    currentBlock = await client.getBlockNumber();
    logger.debug('contracts', `Fetched current block: ${currentBlock}`, 'eth', contractKey);
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    throw error;
  }

  if (contractKey === 'ascendant') {
    let transferLogs = [];
    try {
      transferLogs = await retry(
        async () => {
          const logs = await client.getLogs({
            address: contractAddress,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
            fromBlock: BigInt(config.deploymentBlocks[contractKey]?.block || 0),
            toBlock: currentBlock,
          });
          return logs;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
    } catch (error) {
      logger.error('contracts', `Failed to fetch transfer logs for ${contractAddress}: ${error.message}`, {}, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_logs', error: error.message });
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    if (!Array.isArray(transferLogs)) {
      logger.warn('contracts', `No valid transfer logs for ${contractAddress}`, {}, 'eth', contractKey);
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    for (const log of transferLogs) {
      const from = log.args.from.toLowerCase();
      const to = log.args.to.toLowerCase();
      const tokenId = Number(log.args.tokenId);

      if (to === burnAddress.toLowerCase()) {
        totalBurned += 1;
        holdersMap.delete(tokenId);
        logger.debug('contracts', `Token ${tokenId} burned`, 'eth', contractKey);
        continue;
      }

      if (addressFilter && to !== addressFilter.toLowerCase()) {
        continue;
      }

      holdersMap.set(tokenId, { owner: to, balance: 1 });
      logger.debug('contracts', `Token ${tokenId} assigned to ${to}`, 'eth', contractKey);
    }

    cacheState.progressState.totalNfts = holdersMap.size;
    cacheState.progressState.totalTiers = holdersMap.size;
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());

    if (holdersMap.size === 0) {
      cacheState.progressState.step = 'completed';
      await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
  } else {
    let totalSupply = 0;
    try {
      totalSupply = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalSupply' });
          if (result === null || result === undefined) throw new Error('totalSupply returned null');
          return Number(result);
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      logger.debug('contracts', `Total supply: ${totalSupply}`, 'eth', contractKey);
    } catch (error) {
      logger.error('contracts', `Failed to fetch totalSupply: ${error.message}`, {}, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_supply', error: error.message });
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    let burnedCountContract = 0;
    try {
      burnedCountContract = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalBurned' });
          if (result === null || result === undefined) throw new Error('totalBurned returned null');
          return Number(result);
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      logger.debug('contracts', `Burned count from contract: ${burnedCountContract}`, 'eth', contractKey);
    } catch (error) {
      logger.error('contracts', `Failed to fetch totalBurned: ${error.message}`, {}, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned', error: error.message });
    }
    totalBurned = burnedCountContract;

    cacheState.progressState.totalNfts = totalSupply;
    cacheState.progressState.totalTiers = totalSupply;
    cacheState.lastProcessedBlock = Number(currentBlock);
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());

    if (totalSupply === 0) {
      cacheState.progressState.step = 'completed';
      await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());
      logger.debug('contracts', `No NFTs (totalSupply=0) for ${contractAddress}`, 'eth', contractKey);
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    cacheState.progressState.step = 'fetching_owners';
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());

    let owners = [];
    try {
      owners = await retry(
        () => getOwnersForContract(contractAddress, abi, { withTokenBalances: true }),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
    } catch (error) {
      logger.error('contracts', `Failed to fetch owners: ${error.message}`, {}, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owners', error: error.message });
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    if (!Array.isArray(owners)) {
      logger.warn('contracts', `No valid owners found for ${contractAddress}`, {}, 'eth', contractKey);
      return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
    }

    logger.debug('contracts', `Fetched owners: count=${owners.length}`, 'eth', contractKey);

    let processedTokens = 0;
    for (const owner of owners) {
      const wallet = owner.ownerAddress.toLowerCase();
      if (addressFilter && wallet !== addressFilter.toLowerCase()) {
        continue;
      }

      const tokenIds = owner.tokenBalances
        .map(tb => Number(tb.tokenId))
        .filter(id => !isNaN(id) && id >= 0);

      if (tokenIds.length === 0) {
        logger.debug('contracts', `No valid token IDs for wallet ${wallet}`, 'eth', contractKey);
        continue;
      }

      if (wallet === burnAddress.toLowerCase()) {
        totalBurned += owner.tokenBalances.reduce((sum, tb) => sum + Number(tb.balance), 0);
        logger.debug('contracts', `Burned tokens: ${owner.tokenBalances.reduce((sum, tb) => sum + Number(tb.balance), 0)}`, 'eth', contractKey);
        continue;
      }

      processedTokens += tokenIds.length;

      const holder = holdersMap.get(wallet) || {
        wallet,
        tokenIds: [],
        tiers: Array(Object.keys(config.contractTiers[contractKey]).length).fill(0),
        total: 0,
        multiplierSum: 0,
      };
      holder.tokenIds.push(...tokenIds);
      holder.total += tokenIds.length;
      holdersMap.set(wallet, holder);
      logger.debug('contracts', `Added wallet ${wallet} with ${tokenIds.length} tokens`, 'eth', contractKey);

      cacheState.progressState.processedNfts = processedTokens;
      if (processedTokens % 1000 === 0) {
        await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());
      }
    }

    cacheState.progressState.step = 'completed';
    cacheState.progressState.processedNfts = processedTokens;
    cacheState.progressState.processedTiers = processedTokens;
    cacheState.totalOwners = holdersMap.size;
    cacheState.totalLiveHolders = holdersMap.size;
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());

    return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
  }
}

export { getHoldersMap, getOwnersForContract };