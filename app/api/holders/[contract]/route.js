// ./app/api/holders/[contract]/route.js
import { NextResponse } from 'next/server';
import { parseAbiItem, formatUnits, getAddress } from 'viem';
import pLimit from 'p-limit';
import config from '@/contracts/config.js';
import { client, retry, logger, getCache, setCache, saveCacheState, loadCacheState, batchMulticall, getOwnersForContract, validateContract } from '@/app/api/utils';
import { HoldersResponseSchema } from '@/client/lib/schemas';

const limit = pLimit(5);

// Utility to sanitize BigInt values
function sanitizeBigInt(obj) {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(item => sanitizeBigInt(item));
  if (typeof obj === 'object' && obj !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeBigInt(value);
    }
    return sanitized;
  }
  return obj;
}

// Get cache state for a contract
async function getCacheState(contractKey) {
  const cacheState = {
    isPopulating: false,
    totalOwners: 0,
    totalLiveHolders: 0,
    progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
    lastUpdated: null,
    lastProcessedBlock: null,
    globalMetrics: {},
  };
  try {
    const savedState = await loadCacheState(contractKey, contractKey.toLowerCase());
    if (savedState && typeof savedState === 'object') {
      Object.assign(cacheState, {
        isPopulating: savedState.isPopulating ?? false,
        totalOwners: savedState.totalOwners ?? 0,
        totalLiveHolders: savedState.totalLiveHolders ?? 0,
        progressState: {
          step: savedState.progressState?.step ?? 'idle',
          processedNfts: savedState.progressState?.processedNfts ?? 0,
          totalNfts: savedState.progressState?.totalNfts ?? 0,
          processedTiers: savedState.progressState?.processedTiers ?? 0,
          totalTiers: savedState.progressState?.totalTiers ?? 0,
          error: savedState.progressState?.error ?? null,
          errorLog: savedState.progressState?.errorLog ?? [],
        },
        lastUpdated: savedState.lastUpdated ?? null,
        lastProcessedBlock: savedState.lastProcessedBlock ?? null,
        globalMetrics: savedState.globalMetrics ?? {},
      });
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Loaded cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`, 'eth', contractKey);
      }
    }
  } catch (error) {
    logger.error('utils', `Failed to load cache state: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
  }
  return cacheState;
}

// Save cache state for a contract
async function saveCacheStateContract(contractKey, cacheState) {
  try {
    await saveCacheState(contractKey, cacheState, contractKey.toLowerCase());
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Saved cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`, 'eth', contractKey);
    }
  } catch (error) {
    logger.error('utils', `Failed to save cache state: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
  }
}

// Fetch new Transfer events (burns and transfers)
async function getNewEvents(contractKey, contractAddress, fromBlock, errorLog) {
  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  const cacheKey = `${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}`;
  let cachedEvents = await getCache(cacheKey, contractKey.toLowerCase());

  if (cachedEvents) {
    logger.info('utils', `Events cache hit: ${cacheKey}, count: ${cachedEvents.burnedTokenIds.length + (cachedEvents.transferTokenIds?.length || 0)}`, 'eth', contractKey);
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

  if (fromBlock >= endBlock) {
    logger.info('utils', `No new blocks: fromBlock ${fromBlock} >= endBlock ${endBlock}`, 'eth', contractKey);
    return { burnedTokenIds, transferTokenIds, lastBlock: Number(endBlock) };
  }

  try {
    const logs = await client.getLogs({
      address: contractAddress,
      event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
      fromBlock: BigInt(fromBlock),
      toBlock: endBlock,
    });
    burnedTokenIds = logs
      .filter(log => log.args.to.toLowerCase() === burnAddress.toLowerCase())
      .map(log => Number(log.args.tokenId));
    transferTokenIds = logs
      .filter(log => log.args.to.toLowerCase() !== burnAddress.toLowerCase())
      .map(log => ({ tokenId: Number(log.args.tokenId), from: log.args.from.toLowerCase(), to: log.args.to.toLowerCase() }));
    const cacheData = { burnedTokenIds, transferTokenIds, lastBlock: Number(endBlock), timestamp: Date.now() };
    await setCache(cacheKey, cacheData, config.cache.nodeCache.stdTTL, contractKey.toLowerCase());
    logger.info('utils', `Cached events: ${cacheKey}, burns: ${burnedTokenIds.length}, transfers: ${transferTokenIds.length}`, 'eth', contractKey);
    return cacheData;
  } catch (error) {
    logger.error('utils', `Failed to fetch events: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_events', error: error.message });
    throw error;
  }
}

// Utility function to safely serialize objects with BigInt
function safeStringify(obj) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

async function getHoldersMap(contractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState, forceUpdate = false) {
  if (!contractAddress) throw new Error('Contract address missing');
  if (!abi) throw new Error(`${contractKey} ABI missing`);

  contractKey = contractKey.toLowerCase();
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Normalized contractKey: ${contractKey}, forceUpdate: ${forceUpdate}`, 'eth', contractKey);
  }

  const requiredFunctions = contractKey === 'ascendant'
    ? ['getNFTAttribute', 'userRecords', 'totalShares', 'toDistribute', 'batchClaimableAmount']
    : ['totalSupply', 'totalBurned', 'ownerOf', 'getNftTier'];
  const missingFunctions = requiredFunctions.filter(fn => !abi.some(item => item.name === fn && item.type === 'function'));
  if (missingFunctions.length > 0) throw new Error(`Missing ABI functions: ${missingFunctions.join(', ')}`);

  const burnAddress = config.burnAddress || '0x0000000000000000000000000000000000000000';
  let holdersMap = new Map();
  let totalBurned = cacheState.totalBurned || 0;
  let errorLog = cacheState.progressState.errorLog || [];

  cacheState.progressState.step = 'checking_cache';
  await saveCacheStateContract(contractKey, cacheState);

  let currentBlock;
  try {
    currentBlock = await client.getBlockNumber();
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Fetched current block: ${currentBlock}`, 'eth', contractKey);
    }
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    logger.error('utils', `Failed to fetch block number: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    throw error;
  }

  const contractTiers = config.nftContracts[contractKey]?.tiers || {};
  const maxTier = Math.max(...Object.keys(contractTiers).map(Number), 0);
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Max tier for ${contractKey}: ${maxTier}, tiers: ${safeStringify(contractTiers)}`, 'eth', contractKey);
  }
  if (maxTier === 0) {
    logger.error('utils', `Invalid maxTier=0 for ${contractKey}, config.nftContracts: ${safeStringify(config.nftContracts[contractKey])}`, 'eth', contractKey);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'config', error: `Invalid maxTier=0`, details: { contractTiers: safeStringify(contractTiers) } });
  }

  // Check cache validity
  const cacheValid = !forceUpdate &&
    cacheState.lastProcessedBlock &&
    cacheState.progressState.step === 'completed' &&
    !cacheState.isPopulating &&
    (Number(currentBlock) - cacheState.lastProcessedBlock < config.cache.blockThreshold);

  let tokenOwnerMap = new Map();
  let totalTokens = 0;
  let totalLockedAscendant = 0;
  let totalShares = 0;
  let toDistributeDay8 = 0;
  let toDistributeDay28 = 0;
  let toDistributeDay90 = 0;

  if (cacheValid) {
    logger.info('utils', `Using existing cache for ${contractKey}, lastProcessedBlock: ${cacheState.lastProcessedBlock}`, 'eth', contractKey);
    try {
      const cachedHolders = await getCache(`${contractKey}_holders`, contractKey);
      if (cachedHolders?.holders) {
        holdersMap = new Map(cachedHolders.holders.map(h => [h.wallet, h]));
        totalBurned = cachedHolders.totalBurned || totalBurned;
        totalTokens = cacheState.progressState.totalNfts || 0;
        holdersMap.forEach(holder => {
          holder.tokenIds.forEach(tokenId => tokenOwnerMap.set(Number(tokenId), holder.wallet));
        });
        if (contractKey === 'ascendant') {
          totalLockedAscendant = cacheState.globalMetrics.totalLockedAscendant || 0;
          totalShares = cacheState.globalMetrics.totalShares || 0;
          toDistributeDay8 = cacheState.globalMetrics.toDistributeDay8 || 0;
          toDistributeDay28 = cacheState.globalMetrics.toDistributeDay28 || 0;
          toDistributeDay90 = cacheState.globalMetrics.toDistributeDay90 || 0;
        }
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `Loaded ${holdersMap.size} holders from cache, totalTokens: ${totalTokens}`, 'eth', contractKey);
        }
      } else {
        logger.warn('utils', `Cache valid but no holder data found for ${contractKey}`, 'eth', contractKey);
        cacheValid = false; // Fallback to full rebuild
      }
    } catch (error) {
      logger.error('utils', `Failed to load cache for ${contractKey}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
      cacheValid = false;
    }
  }

  if (!cacheValid) {
    cacheState.progressState.step = 'fetching_supply';
    await saveCacheStateContract(contractKey, cacheState);

    if (contractKey === 'ascendant') {
      const totalSharesRaw = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalShares' });
          if (result === null || result === undefined) throw new Error('totalShares returned null');
          return result;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      totalShares = parseFloat(formatUnits(totalSharesRaw, 18));
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Total shares: ${totalShares}`, 'eth', contractKey);
      }

      const toDistributeDay8Raw = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] });
          if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
          return result;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));

      const toDistributeDay28Raw = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] });
          if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
          return result;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));

      const toDistributeDay90Raw = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] });
          if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
          return result;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));
    } else {
      const totalSupply = await retry(
        async () => {
          const result = await client.readContract({ address: contractAddress, abi, functionName: 'totalSupply' });
          if (result === null || result === undefined) throw new Error('totalSupply returned null');
          return Number(result);
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Total supply: ${totalSupply}`, 'eth', contractKey);
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
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `Burned count from contract: ${burnedCountContract}`, 'eth', contractKey);
        }
      } catch (error) {
        logger.error('utils', `Failed to fetch totalBurned: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned', error: error.message });
      }
      totalBurned = burnedCountContract;
      totalTokens = totalSupply - totalBurned; // Initialize with live tokens
    }

    cacheState.progressState.step = 'fetching_holders';
    await saveCacheStateContract(contractKey, cacheState);

    try {
      const owners = await retry(
        () => getOwnersForContract(contractAddress, abi, { withTokenBalances: true, maxPages: 100 }),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );

      const filteredOwners = owners.filter(
        (owner) => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() && owner.tokenBalances?.length > 0
      );
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Filtered owners: ${filteredOwners.length}`, 'eth', contractKey);
      }

      // Reset tokenOwnerMap and totalTokens to avoid stale data
      tokenOwnerMap.clear();
      totalTokens = 0;
      const seenTokenIds = new Set();

      filteredOwners.forEach((owner) => {
        if (!owner.ownerAddress) return;
        let wallet;
        try {
          wallet = getAddress(owner.ownerAddress).toLowerCase();
        } catch (e) {
          logger.warn('utils', `Invalid wallet address: ${owner.ownerAddress}`, 'eth', contractKey);
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_owner', ownerAddress: owner.ownerAddress, error: 'Invalid wallet address' });
          return;
        }
        owner.tokenBalances.forEach((tb) => {
          if (!tb.tokenId) return;
          const tokenId = Number(tb.tokenId);
          if (seenTokenIds.has(tokenId)) {
            logger.warn('utils', `Duplicate tokenId ${tokenId} for wallet ${wallet}`, 'eth', contractKey);
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_token', tokenId, wallet, error: 'Duplicate tokenId' });
            return;
          }
          seenTokenIds.add(tokenId);
          tokenOwnerMap.set(tokenId, wallet);
          totalTokens++;
        });
      });
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Total tokens (Alchemy): ${totalTokens}, unique tokenIds: ${seenTokenIds.size}`, 'eth', contractKey);
      }
    } catch (error) {
      logger.warn('utils', `Failed to fetch owners via getOwnersForContract: ${error.message}, falling back to Transfer events`, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_owners_alchemy', error: error.message });

      const fromBlock = BigInt(config.getDeploymentBlocks()[contractKey]?.block || 0);
      const toBlock = currentBlock;
      tokenOwnerMap.clear();
      totalTokens = 0;
      const seenTokenIds = new Set();

      const transferLogs = await retry(
        async () => {
          const logs = await client.getLogs({
            address: contractAddress,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
            fromBlock,
            toBlock,
          });
          return logs;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );

      for (const log of transferLogs) {
        const from = log.args.from.toLowerCase();
        const to = log.args.to.toLowerCase();
        const tokenId = Number(log.args.tokenId);

        if (to === burnAddress.toLowerCase()) {
          totalBurned += 1;
          tokenOwnerMap.delete(tokenId);
          seenTokenIds.delete(tokenId);
          continue;
        }

        if (from === '0x0000000000000000000000000000000000000000') {
          if (!seenTokenIds.has(tokenId)) {
            tokenOwnerMap.set(tokenId, to);
            seenTokenIds.add(tokenId);
            totalTokens++;
          }
        } else {
          tokenOwnerMap.set(tokenId, to);
          seenTokenIds.add(tokenId);
        }
      }
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Total tokens (Transfer events): ${totalTokens}, unique tokenIds: ${seenTokenIds.size}`, 'eth', contractKey);
      }
    }
  } else {
    // Incremental update: Fetch new Transfer events since lastProcessedBlock
    const fromBlock = BigInt(cacheState.lastProcessedBlock || config.getDeploymentBlocks()[contractKey]?.block || 0);
    const toBlock = currentBlock;
    if (fromBlock < toBlock) {
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Fetching new Transfer events from block ${fromBlock} to ${toBlock}`, 'eth', contractKey);
      }
      const transferLogs = await retry(
        async () => {
          const logs = await client.getLogs({
            address: contractAddress,
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
            fromBlock,
            toBlock,
          });
          return logs;
        },
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );

      const seenTokenIds = new Set();
      for (const log of transferLogs) {
        const from = log.args.from.toLowerCase();
        const to = log.args.to.toLowerCase();
        const tokenId = Number(log.args.tokenId);

        if (to === burnAddress.toLowerCase()) {
          totalBurned += 1;
          tokenOwnerMap.delete(tokenId);
          seenTokenIds.delete(tokenId);
          const wallet = tokenOwnerMap.get(tokenId);
          if (wallet) {
            const holder = holdersMap.get(wallet);
            if (holder) {
              holder.tokenIds = holder.tokenIds.filter(id => id !== tokenId);
              holder.total -= 1;
              if (holder.total === 0) holdersMap.delete(wallet);
            }
          }
          continue;
        }

        if (from === '0x0000000000000000000000000000000000000000') {
          if (!seenTokenIds.has(tokenId)) {
            tokenOwnerMap.set(tokenId, to);
            seenTokenIds.add(tokenId);
            totalTokens++;
          }
        } else {
          tokenOwnerMap.set(tokenId, to);
          seenTokenIds.add(tokenId);
        }

        const toHolder = holdersMap.get(to) || {
          wallet: to,
          tokenIds: [],
          tiers: Array(maxTier || 1).fill(0),
          total: 0,
          multiplierSum: 0,
          ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
          ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
          ...(contractKey === 'ascendant' ? {
            shares: 0,
            lockedAscendant: 0,
            pendingDay8: 0,
            pendingDay28: 0,
            pendingDay90: 0,
            claimableRewards: 0,
            tokens: []
          } : {})
        };
        if (!toHolder.tokenIds.includes(tokenId)) {
          toHolder.tokenIds.push(tokenId);
          toHolder.total += 1;
          holdersMap.set(to, toHolder);
        }

        if (from !== '0x0000000000000000000000000000000000000000') {
          const fromHolder = holdersMap.get(from);
          if (fromHolder) {
            fromHolder.tokenIds = fromHolder.tokenIds.filter(id => id !== tokenId);
            fromHolder.total -= 1;
            if (fromHolder.total === 0) holdersMap.delete(from);
            else holdersMap.set(from, fromHolder);
          }
        }
      }
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Processed ${transferLogs.length} new Transfer events, totalTokens: ${totalTokens}`, 'eth', contractKey);
      }
    }
  }

  cacheState.progressState.totalNfts = totalTokens;
  cacheState.progressState.totalTiers = totalTokens;
  cacheState.lastProcessedBlock = Number(currentBlock);
  await saveCacheStateContract(contractKey, cacheState);

  if (totalTokens === 0) {
    cacheState.progressState.step = 'completed';
    cacheState.globalMetrics = {
      ...(contractKey === 'element280' || contractKey === 'stax' || contractKey === 'ascendant' ? { totalMinted: 0 } : {}),
      totalLive: 0,
      totalBurned,
      tierDistribution: Array(maxTier || 1).fill(0),
      ...(contractKey === 'ascendant' ? {
        totalLockedAscendant: 0,
        totalShares: 0,
        toDistributeDay8: 0,
        toDistributeDay28: 0,
        toDistributeDay90: 0,
        pendingRewards: 0
      } : {})
    };
    await saveCacheStateContract(contractKey, cacheState);
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `No tokens found, returning empty holdersMap`, 'eth', contractKey);
    }
    return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
  }

  cacheState.progressState.step = contractKey === 'ascendant' ? 'fetching_records' : 'fetching_tiers';
  cacheState.progressState.processedNfts = 0;
  await saveCacheStateContract(contractKey, cacheState);

  const tokenIds = Array.from(tokenOwnerMap.keys());
  let recordResults = [];
  if (contractKey === 'ascendant') {
    const recordCalls = tokenIds.map((tokenId) => ({
      address: contractAddress,
      abi,
      functionName: 'userRecords',
      args: [BigInt(tokenId)],
    }));

    const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 1000;
    for (let i = 0; i < recordCalls.length; i += chunkSize) {
      const chunk = recordCalls.slice(i, i + chunkSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      recordResults.push(...results);
      cacheState.progressState.processedNfts = Math.min(i + chunkSize, tokenIds.length);
      await saveCacheStateContract(contractKey, cacheState);
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Processed userRecords for ${cacheState.progressState.processedNfts}/${tokenIds.length} tokens`, 'eth', contractKey);
      }
    }
  }

  cacheState.progressState.step = 'fetching_tiers';
  cacheState.progressState.processedTiers = 0;
  await saveCacheStateContract(contractKey, cacheState);

  const tierCalls = tokenIds.map((tokenId) => ({
    address: contractAddress,
    abi,
    functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
    args: [BigInt(tokenId)],
  }));

  const tierResults = [];
  const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 1000;
  for (let i = 0; i < tierCalls.length; i += chunkSize) {
    const chunk = tierCalls.slice(i, i + chunkSize);
    const results = await retry(
      () => batchMulticall(chunk, config.alchemy.batchSize),
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );
    tierResults.push(...results);
    cacheState.progressState.processedTiers = Math.min(i + chunkSize, tokenIds.length);
    await saveCacheStateContract(contractKey, cacheState);
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Processed tiers for ${cacheState.progressState.processedTiers}/${tokenIds.length} tokens`, 'eth', contractKey);
    }
  }

  const walletTokenIds = new Map();
  tokenIds.forEach((tokenId) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) return;
    if (!walletTokenIds.has(wallet)) {
      walletTokenIds.set(wallet, []);
    }
    walletTokenIds.get(wallet).push(tokenId);
  });

  if (contractKey === 'ascendant') {
    cacheState.progressState.step = 'fetching_claimable';
    await saveCacheStateContract(contractKey, cacheState);

    const claimableCalls = Array.from(walletTokenIds.entries()).map(([wallet, tokenIds]) => ({
      address: contractAddress,
      abi,
      functionName: 'batchClaimableAmount',
      args: [tokenIds.map((id) => BigInt(id))],
    }));

    const claimableResults = [];
    for (let i = 0; i < claimableCalls.length; i += chunkSize) {
      const chunk = claimableCalls.slice(i, i + chunkSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      claimableResults.push(...results);
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Processed claimable amounts for ${i + chunk.length}/${claimableCalls.length} wallets`, 'eth', contractKey);
      }
    }

    let claimableIndex = 0;
    for (const [wallet, tokenIds] of walletTokenIds.entries()) {
      const holder = holdersMap.get(wallet);
      if (!holder) {
        claimableIndex++;
        continue;
      }
      const claimableResult = claimableResults[claimableIndex];
      if (claimableResult?.status === 'success') {
        holder.claimableRewards = parseFloat(formatUnits(claimableResult.result || 0, 18));
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `Claimable rewards for wallet ${wallet}: ${holder.claimableRewards}`, 'eth', contractKey);
        }
      } else {
        logger.error('utils', `Failed to fetch claimableRewards for wallet ${wallet}: ${claimableResult?.error || 'unknown error'}`, 'eth', contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet, error: claimableResult?.error || 'unknown error' });
      }
      claimableIndex++;
    }
  }

  cacheState.progressState.step = 'building_holders';
  await saveCacheStateContract(contractKey, cacheState);

  tokenIds.forEach((tokenId, i) => {
    const wallet = tokenOwnerMap.get(tokenId);
    if (!wallet) {
      logger.warn('utils', `No owner found for token ${tokenId}`, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_token', tokenId, error: 'No owner found' });
      return;
    }

    let shares = 0;
    let lockedAscendant = 0;
    if (contractKey === 'ascendant') {
      const recordResult = recordResults[i];
      if (recordResult.status === 'success' && Array.isArray(recordResult.result)) {
        shares = parseFloat(formatUnits(recordResult.result[0] || 0, 18));
        lockedAscendant = parseFloat(formatUnits(recordResult.result[1] || 0, 18));
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `userRecords for token ${tokenId}: shares=${shares}, lockedAscendant=${lockedAscendant}`, 'eth', contractKey);
        }
      } else {
        logger.error('utils', `Failed to fetch userRecords for token ${tokenId}: ${recordResult.error || 'unknown error'}`, 'eth', contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId, wallet, error: recordResult.error || 'unknown error' });
        return;
      }
      totalLockedAscendant += lockedAscendant;
    }

    let tier = 1;
    let rarityNumber = 0;
    let rarity = 0;
    const tierResult = tierResults[i];
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Raw tierResult for token ${tokenId}: status=${tierResult.status}, result=${safeStringify(tierResult.result)}`, 'eth', contractKey);
    }

    if (tierResult.status === 'success') {
      if (contractKey === 'ascendant') {
        const result = tierResult.result;
        if (Array.isArray(result) && result.length >= 3) {
          rarityNumber = Number(result[0]) || 0; // rarityNumber from attributes[0]
          tier = Number(result[1]) || 1; // tier from attributes[1]
          rarity = Number(result[2]) || 0; // rarity from attributes[2]
          if (!config.debug.suppressDebug) {
            logger.debug('utils', `Parsed attributes for token ${tokenId} (ascendant): tier=${tier}, rarityNumber=${rarityNumber}, rarity=${rarity}, result=${safeStringify(result)}`, 'eth', contractKey);
          }
        } else {
          logger.warn('utils', `Invalid getNFTAttribute result for token ${tokenId}: result=${safeStringify(result)}`, 'eth', contractKey);
          errorLog.push({
            timestamp: new Date().toISOString(),
            phase: 'fetch_tier',
            tokenId,
            wallet,
            error: `Invalid getNFTAttribute result: ${safeStringify(result)}`
          });
          tier = 1;
          rarityNumber = 0;
          rarity = 0;
        }
      } else {
        tier = typeof tierResult.result === 'bigint' ? Number(tierResult.result) : Number(tierResult.result);
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `Parsed tier for token ${tokenId} (non-ascendant): tier=${tier}, resultType=${typeof tierResult.result}, resultValue=${safeStringify(tierResult.result)}`, 'eth', contractKey);
        }
      }

      if (isNaN(tier) || tier < 1 || tier > maxTier) {
        logger.warn('utils', `Invalid tier for token ${tokenId} in ${contractKey}: tier=${tier}, maxTier=${maxTier}, defaulting to 1`, 'eth', contractKey);
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId,
          wallet,
          error: `Invalid tier ${tier}`,
          details: { rawResult: safeStringify(tierResult.result), maxTier, parsedTier: tier }
        });
        tier = 1;
        if (contractKey === 'ascendant') {
          rarityNumber = 0;
          rarity = 0;
        }
      }
    } else {
      logger.error('utils', `Failed to fetch tier for token ${tokenId}: ${tierResult.error || 'unknown error'}`, 'eth', contractKey);
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_tier',
        tokenId,
        wallet,
        error: tierResult.error || 'unknown error',
        details: { rawResult: safeStringify(tierResult.result) }
      });
      tier = 1;
      if (contractKey === 'ascendant') {
        rarityNumber = 0;
        rarity = 0;
      }
    }

    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Tier validation for token ${tokenId}: tier=${tier}, maxTier=${maxTier}, isValid=${tier >= 1 && tier <= maxTier}`, 'eth', contractKey);
    }

    const holder = holdersMap.get(wallet) || {
      wallet,
      tokenIds: [],
      tiers: Array(maxTier || 1).fill(0),
      total: 0,
      multiplierSum: 0,
      ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
      ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
      ...(contractKey === 'ascendant' ? {
        shares: 0,
        lockedAscendant: 0,
        pendingDay8: 0,
        pendingDay28: 0,
        pendingDay90: 0,
        claimableRewards: 0,
        tokens: []
      } : {})
    };

    if (holder.tokenIds.includes(tokenId)) {
      logger.warn('utils', `Duplicate tokenId ${tokenId} for wallet ${wallet} in holdersMap`, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'build_holders', tokenId, wallet, error: 'Duplicate tokenId in holdersMap' });
      return;
    }

    holder.tokenIds.push(tokenId);
    holder.total += 1;
    holder.tiers[tier - 1] += 1;
    holder.multiplierSum += config.nftContracts[contractKey]?.tiers?.[tier]?.multiplier || tier;
    if (contractKey === 'ascendant') {
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      holder.tokens.push({
        tokenId: Number(tokenId),
        tier,
        rarityNumber,
        rarity
      });
    }
    holdersMap.set(wallet, holder);
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Assigned tier ${tier} to token ${tokenId}, wallet ${wallet}, multiplier=${config.nftContracts[contractKey]?.tiers?.[tier]?.multiplier || tier}`, 'eth', contractKey);
    }
  });

  cacheState.progressState.step = 'calculating_metrics';
  await saveCacheStateContract(contractKey, cacheState);

  const holderList = Array.from(holdersMap.values());
  const totalMultiplierSum = holderList.reduce((sum, h) => sum + h.multiplierSum, 0);

  if (contractKey === 'ascendant') {
    const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
    const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
    const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

    holderList.forEach((holder) => {
      holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
      holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
      holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.displayMultiplierSum = holder.multiplierSum;
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Calculated metrics for wallet ${holder.wallet}: percentage=${holder.percentage}, shares=${holder.shares}`, 'eth', contractKey);
      }
    });
  } else {
    holderList.forEach(holder => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.displayMultiplierSum = holder.multiplierSum / (contractKey === 'element280' ? 10 : 1);
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Calculated metrics for wallet ${holder.wallet}: percentage=${holder.percentage}, displayMultiplierSum=${holder.displayMultiplierSum}`, 'eth', contractKey);
      }
    });
  }

  const tierDistribution = Array(maxTier || 1).fill(0);
  holderList.forEach(holder => {
    holder.tiers.forEach((count, i) => {
      tierDistribution[i] = (tierDistribution[i] || 0) + count;
    });
  });
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Tier distribution for ${contractKey}: ${safeStringify(tierDistribution)}`, 'eth', contractKey);
  }

  holderList.sort((a, b) => (contractKey === 'ascendant' ? b.shares - a.shares : b.multiplierSum - a.multiplierSum) || b.total - a.total);
  holderList.forEach((holder, index) => (holder.rank = index + 1));
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Sorted holders: count=${holderList.length}, topHolder=${safeStringify(holderList[0])}`, 'eth', contractKey);
  }

  cacheState.totalOwners = holderList.length;
  cacheState.totalLiveHolders = holderList.length;
  cacheState.progressState.step = 'completed';
  cacheState.progressState.processedNfts = cacheState.progressState.totalNfts;
  cacheState.progressState.processedTiers = cacheState.progressState.totalTiers;
  cacheState.progressState.error = null;
  cacheState.progressState.errorLog = []; // Clear errorLog on success
  cacheState.globalMetrics = {
    ...(contractKey === 'element280' || contractKey === 'stax' || contractKey === 'ascendant' ? { totalMinted: totalTokens + totalBurned } : {}),
    totalLive: totalTokens,
    totalBurned,
    tierDistribution,
    ...(contractKey === 'ascendant' ? {
      totalLockedAscendant,
      totalShares,
      toDistributeDay8,
      toDistributeDay28,
      toDistributeDay90,
      pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90
    } : {})
  };
  await saveCacheStateContract(contractKey, cacheState);
  await setCache(`${contractKey}_holders`, { holders: holderList, totalBurned, timestamp: Date.now() }, 0, contractKey);
  logger.info('utils', `Completed holders map with ${holderList.length} holders, totalBurned=${totalBurned}`, 'eth', contractKey);

  return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog };
}

// Populate holders map cache
async function populateHoldersMapCache(contractKey, contractAddress, abi, vaultAddress, vaultAbi, forceUpdate = false) {
  try {
    const cacheState = await getCacheState(contractKey.toLowerCase());
    if (!forceUpdate && cacheState.isPopulating) {
      logger.info('utils', `Cache population already in progress for ${contractKey}`, 'eth', contractKey);
      return { status: 'pending', holders: [] };
    }

    cacheState.isPopulating = true;
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);

    const { holdersMap, totalBurned } = await getHoldersMap(
      contractKey,
      contractAddress,
      abi,
      vaultAddress,
      vaultAbi,
      cacheState,
      forceUpdate
    );

    const holderList = [];
    for (const [wallet, data] of holdersMap) {
      holderList.push({
        wallet,
        total: data.total,
        tokenIds: data.tokenIds,
        tiers: data.tiers,
        multiplierSum: data.multiplierSum,
        shares: data.shares || 0,
        lockedAscendant: data.lockedAscendant || 0,
        claimableRewards: data.claimableRewards || 0,
        pendingDay8: data.pendingDay8 || 0,
        pendingDay28: data.pendingDay28 || 0,
        pendingDay90: data.pendingDay90 || 0,
        infernoRewards: data.infernoRewards || 0,
        fluxRewards: data.fluxRewards || 0,
        e280Rewards: data.e280Rewards || 0,
        percentage: data.percentage || 0,
        displayMultiplierSum: data.displayMultiplierSum || data.multiplierSum,
        rank: 0, // Will be set later
        ...(contractKey === 'ascendant' ? { tokens: data.tokens || [] } : {}) // Include tokens for ascendant
      });
    }

    // Sort and set ranks
    holderList.sort((a, b) => (contractKey === 'ascendant' ? b.shares - a.shares : b.multiplierSum - a.multiplierSum) || b.total - a.total);
    holderList.forEach((holder, index) => {
      holder.rank = index + 1;
    });

    const isBurnContract = ['stax', 'element280', 'element369'].includes(contractKey.toLowerCase());
    const cacheTotalBurned = isBurnContract ? totalBurned : 0; // 0 for ascendant
    const cacheData = {
      holders: holderList,
      totalBurned: cacheTotalBurned,
      timestamp: Date.now(),
    };

    // Validate cache data
    if (!Array.isArray(cacheData.holders) || (isBurnContract && typeof cacheData.totalBurned !== 'number')) {
      logger.error('utils', `Invalid cache data for ${contractKey}: ${JSON.stringify(cacheData)}`, 'eth', contractKey);
      throw new Error('Invalid cache data');
    }

    logger.info('utils', `Saving cache for ${contractKey}: totalBurned=${cacheTotalBurned}, holders=${holderList.length}`, 'eth', contractKey);
    await setCache(`${contractKey.toLowerCase()}_holders`, cacheData, 0, contractKey.toLowerCase());

    cacheState.isPopulating = false;
    cacheState.phase = 'Completed';
    cacheState.progressPercentage = '100.0';
    cacheState.totalLiveHolders = holderList.length;
    cacheState.totalOwners = holderList.length;
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);

    logger.info('utils', `Cache populated: ${holderList.length} holders, totalBurned: ${cacheTotalBurned}`, 'eth', contractKey);
    return { status: 'success', holders: holderList };
  } catch (error) {
    logger.error('utils', `Failed to populate holders cache for ${contractKey}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    cacheState.isPopulating = false;
    cacheState.error = error.message;
    await saveCacheStateContract(contractKey.toLowerCase(), cacheState);
    return { status: 'error', holders: [] };
  }
}

// GET handler
export async function GET(request, { params }) {
  const { contract } = await params;
  const contractKey = contract.toLowerCase();

  // Validate contract
  if (!config.nftContracts[contractKey]) {
    logger.error('utils', `Invalid contract: ${contractKey}`, 'eth', contractKey);
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
          h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
          return acc;
        }, []),
        multiplierPool: cachedData.holders.reduce((sum, h) => sum + h.multiplierSum, 0),
      },
      globalMetrics: cacheState.globalMetrics || {},
    };
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `GET response for ${contractKey}: holders=${holders.length}, totalPages=${totalPages}`, 'eth', contractKey);
    }
    return NextResponse.json(response);
  }

  const { status, holders } = await populateHoldersMapCache(contractKey, contractAddress, abi, null, null);
  if (status === 'error') {
    logger.error('utils', `Cache population failed for ${contractKey}`, 'eth', contractKey);
    throw new Error('Cache population failed');
  }

  const paginatedHolders = holders.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(holders.length / pageSize);
  const cachedDataAfterPopulation = await getCache(`${contractKey}_holders`, contractKey);
  const totalBurned = isBurnContract ? Number(cachedDataAfterPopulation?.totalBurned) || 0 : 0;
  const totalTokens = holders.reduce((sum, h) => sum + h.total, 0);
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
        h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
        return acc;
      }, []),
      multiplierPool: holders.reduce((sum, h) => sum + h.multiplierSum, 0),
    },
    globalMetrics: cacheState.globalMetrics || {},
  };
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `GET response for ${contractKey}: holders=${paginatedHolders.length}, totalPages=${totalPages}`, 'eth', contractKey);
  }
  return NextResponse.json(response);
}

// POST handler
export async function POST(request, { params }) {
  const resolvedParams = await params; // Await params for Next.js App Router
  const { contract: contractKey } = resolvedParams;
  const normalizedContractKey = contractKey.toLowerCase();

  const { forceUpdate = false } = await request.json().catch(() => ({}));

  // Early validation of contractKey
  if (!config.nftContracts[normalizedContractKey]) {
    logger.error('utils', `Invalid contract: ${normalizedContractKey}`, 'eth', normalizedContractKey);
    return NextResponse.json({ message: `Invalid contract: ${normalizedContractKey}`, status: 'error' }, { status: 400 });
  }

  let contractAddress, abi, vaultAddress, vaultAbi;
  try {
    const contractConfig = config.nftContracts[normalizedContractKey];
    ({ contractAddress, abi, vaultAddress, vaultAbi } = contractConfig);
    logger.info('utils', `POST for ${normalizedContractKey}: abiType=${Array.isArray(abi) ? 'array' : typeof abi}, abiLength=${Array.isArray(abi) ? abi.length : 'N/A'}`, 'eth', normalizedContractKey);
    if (!contractAddress) {
      throw new Error(`Contract address not configured for ${normalizedContractKey}`);
    }
    if (!Array.isArray(abi) && !contractConfig.disabled) {
      throw new Error(`Invalid ABI for ${normalizedContractKey}: expected array, got ${typeof abi}`);
    }
    if (validateContract) {
      try {
        await validateContract(normalizedContractKey);
      } catch (error) {
        logger.warn('utils', `validateContract failed for ${normalizedContractKey}: ${error.message}. Proceeding without validation.`, 'eth', normalizedContractKey);
      }
    }
  } catch (error) {
    logger.error('utils', `Validation error for ${normalizedContractKey}: ${error.message}`, { stack: error.stack }, 'eth', normalizedContractKey);
    return NextResponse.json({ message: error.message, status: 'error' }, { status: 400 });
  }

  const cacheState = await getCacheState(normalizedContractKey);
  if (cacheState.isPopulating) {
    logger.info('utils', `Cache population already in progress for ${normalizedContractKey}`, 'eth', normalizedContractKey);
    return NextResponse.json({ message: `${normalizedContractKey} cache population already in progress`, status: 'in_progress' }, { status: 202 });
  }

  if (forceUpdate) {
    await setCache(`${normalizedContractKey}_holders`, null, 0, normalizedContractKey);
    cacheState.progressState = { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] };
    logger.info('utils', `Cleared cache for ${normalizedContractKey} due to forceUpdate`, 'eth', normalizedContractKey);
  }

  cacheState.isPopulating = true;
  await saveCacheStateContract(normalizedContractKey, cacheState);

  setTimeout(async () => {
    try {
      await getHoldersMap(normalizedContractKey, contractAddress, abi, vaultAddress, vaultAbi, cacheState, forceUpdate);
      logger.info('utils', `Cache population completed for ${normalizedContractKey}: ${cacheState.totalOwners} holders`, 'eth', normalizedContractKey);
    } catch (error) {
      cacheState.progressState.error = error.message;
      cacheState.progressState.errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'cache_update',
        error: error.message,
      });
      logger.error('utils', `Cache population failed for ${normalizedContractKey}: ${error.message}`, { stack: error.stack }, 'eth', normalizedContractKey);
    } finally {
      cacheState.isPopulating = false;
      cacheState.lastUpdated = new Date().toISOString();
      await saveCacheStateContract(normalizedContractKey, cacheState);
    }
  }, 0);

  logger.info('utils', `Cache population triggered for ${normalizedContractKey}`, 'eth', normalizedContractKey);
  return NextResponse.json({ message: `${normalizedContractKey} cache population triggered`, status: 'success' }, { status: 202 });
}