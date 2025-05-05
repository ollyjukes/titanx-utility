// ./app/api/holders/[contract]/route.js
import { NextResponse } from 'next/server';
import { parseAbiItem, formatUnits, getAddress } from 'viem';
import pLimit from 'p-limit';
import config from '@/contracts/config.js';
import { client, retry, logger, getCache, setCache, saveCacheState, loadCacheState, batchMulticall, getOwnersForContract, validateContract } from '@/app/api/utils';
import { HoldersResponseSchema } from '@/app/lib/schemas';

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
    logger.debug('utils', `Starting getHoldersMap: contractKey=${contractKey}, forceUpdate=${forceUpdate}`, 'eth', contractKey);
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
  let totalLockedAscendant = 0;
  let totalShares = 0;
  let toDistributeDay8 = 0;
  let toDistributeDay28 = 0;
  let toDistributeDay90 = 0;
  let totalTokens = 0;
  let tokenOwnerMap = new Map();

  const contractTiers = config.nftContracts[contractKey]?.tiers || {};
  const maxTier = Math.max(...Object.keys(contractTiers).map(Number), 0);
  let rarityDistribution = contractKey === 'ascendant' ? Array(3).fill(0) : [];
  let tierDistribution = Array(maxTier + 1).fill(0); // 0 to maxTier inclusive

  cacheState.progressState.step = 'checking_cache';
  cacheState.progressState.progressPercentage = '0%';
  await saveCacheStateContract(contractKey, cacheState);

  let currentBlock;
  try {
    currentBlock = await client.getBlockNumber();
    cacheState.progressState.lastProcessedBlock = Number(currentBlock); // Save immediately
    cacheState.progressState.lastUpdated = Date.now();
    await saveCacheStateContract(contractKey, cacheState);
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Fetched current block: ${currentBlock}, saved to cacheState`, 'eth', contractKey);
    }
  } catch (error) {
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
    logger.error('utils', `Failed to fetch block number: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    throw error;
  }

  // Check cache validity
  const blockThreshold = contractKey === 'element280' ? (config.cache.blockThreshold || 7200) : (config.cache.blockThreshold || 100); // ~24 hours for element280
  const cacheValid = !forceUpdate &&
    cacheState.lastProcessedBlock &&
    cacheState.progressState.step === 'completed' &&
    !cacheState.isPopulating &&
    (Number(currentBlock) - cacheState.lastProcessedBlock < blockThreshold);

  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Cache validity check: cacheValid=${cacheValid}, forceUpdate=${forceUpdate}, lastProcessedBlock=${cacheState.lastProcessedBlock}, step=${cacheState.progressState.step}, isPopulating=${cacheState.isPopulating}, blockDiff=${Number(currentBlock) - cacheState.lastProcessedBlock}, blockThreshold=${blockThreshold}`, 'eth', contractKey);
  }

  let cachedTokenTiers = new Map();
  if (cacheValid && contractKey === 'element280') {
    try {
      const cachedHolders = await getCache(`${contractKey}_holders`, contractKey);
      if (cachedHolders?.holders && Array.isArray(cachedHolders.holders)) {
        holdersMap = new Map(cachedHolders.holders.map(h => [h.wallet, h]));
        totalBurned = cachedHolders.totalBurned || totalBurned;
        totalTokens = cacheState.progressState.totalNfts || 0;
        holdersMap.forEach(holder => {
          holder.tokenIds.forEach(tokenId => tokenOwnerMap.set(Number(tokenId), holder.wallet));
        });
        // Load cached tiers for element280
        const cachedTiers = await getCache(`${contractKey}_tiers`, contractKey) || {};
        Object.entries(cachedTiers).forEach(([tokenId, tierData]) => {
          if (tierData && typeof tierData.tier === 'number') {
            cachedTokenTiers.set(Number(tokenId), tierData);
          }
        });
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `Cache hit: holders=${holdersMap.size}, tiers=${cachedTokenTiers.size}, lastBlock=${cacheState.lastProcessedBlock}`, 'eth', contractKey);
        }
        // Fetch new Transfer events
        const fromBlock = BigInt(cacheState.lastProcessedBlock);
        const { burnedTokenIds, transferTokenIds, lastBlock } = await getNewEvents(contractKey, contractAddress, fromBlock, errorLog);
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `New events: burns=${burnedTokenIds.length}, transfers=${transferTokenIds.length}, fromBlock=${fromBlock}, toBlock=${lastBlock}`, 'eth', contractKey);
        }
        // Process burns
        const updatedTokenIds = new Set();
        burnedTokenIds.forEach(tokenId => {
          const wallet = tokenOwnerMap.get(tokenId);
          if (wallet) {
            const holder = holdersMap.get(wallet);
            if (holder) {
              holder.tokenIds = holder.tokenIds.filter(id => id !== tokenId);
              holder.total -= 1;
              const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
              holder.tiers[tier] -= 1;
              holder.multiplierSum -= contractTiers[tier + 1]?.multiplier || (tier + 1);
              if (holder.total === 0) holdersMap.delete(wallet);
              tokenOwnerMap.delete(tokenId);
              cachedTokenTiers.delete(tokenId);
              totalTokens -= 1;
              totalBurned += 1;
              tierDistribution[tier] -= 1;
            }
          }
        });
        // Process transfers
        transferTokenIds.forEach(({ tokenId, from, to }) => {
          updatedTokenIds.add(tokenId);
          const oldHolder = holdersMap.get(from);
          if (oldHolder) {
            oldHolder.tokenIds = oldHolder.tokenIds.filter(id => id !== tokenId);
            oldHolder.total -= 1;
            const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
            oldHolder.tiers[tier] -= 1;
            oldHolder.multiplierSum -= contractTiers[tier + 1]?.multiplier || (tier + 1);
            if (oldHolder.total === 0) holdersMap.delete(from);
          }
          let newHolder = holdersMap.get(to) || {
            wallet: to,
            tokenIds: [],
            tiers: Array(maxTier + 1).fill(0),
            total: 0,
            multiplierSum: 0,
            claimableRewards: 0,
          };
          newHolder.tokenIds.push(tokenId);
          newHolder.total += 1;
          const tier = cachedTokenTiers.get(tokenId)?.tier || 0;
          newHolder.tiers[tier] += 1;
          newHolder.multiplierSum += contractTiers[tier + 1]?.multiplier || (tier + 1);
          holdersMap.set(to, newHolder);
          tokenOwnerMap.set(tokenId, to);
        });
        // Fetch tiers for tokens without cached tiers
        const missingTierTokenIds = Array.from(updatedTokenIds).filter(tokenId => !cachedTokenTiers.has(tokenId));
        if (missingTierTokenIds.length > 0) {
          cacheState.progressState.step = 'fetching_updated_tiers';
          cacheState.progressState.processedTiers = 0;
          cacheState.progressState.totalTiers = missingTierTokenIds.length;
          cacheState.progressState.progressPercentage = '50%';
          await saveCacheStateContract(contractKey, cacheState);
          const tierCalls = missingTierTokenIds.map(tokenId => ({
            address: contractAddress,
            abi,
            functionName: 'getNftTier',
            args: [BigInt(tokenId)]
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
            cacheState.progressState.processedTiers = Math.min(i + chunkSize, tierCalls.length);
            cacheState.progressState.progressPercentage = `${Math.round(50 + (i / tierCalls.length) * 20)}%`;
            await saveCacheStateContract(contractKey, cacheState);
            if (!config.debug.suppressDebug) {
              logger.debug('utils', `Processed updated tiers for ${cacheState.progressState.processedTiers}/${tierCalls.length} tokens`, 'eth', contractKey);
            }
          }
          tierResults.forEach((result, i) => {
            const tokenId = missingTierTokenIds[i];
            if (result.status === 'success') {
              const tier = Number(result.result) || 0;
              cachedTokenTiers.set(tokenId, { tier, timestamp: Date.now() });
            } else {
              errorLog.push({
                timestamp: new Date().toISOString(),
                phase: 'fetch_updated_tier',
                tokenId,
                error: result.error || 'unknown error'
              });
            }
          });
          // Update holders with new tiers
          missingTierTokenIds.forEach(tokenId => {
            const wallet = tokenOwnerMap.get(tokenId);
            if (wallet) {
              const holder = holdersMap.get(wallet);
              if (holder) {
                const oldTierIndex = holder.tokenIds.indexOf(tokenId);
                if (oldTierIndex >= 0) {
                  const oldTier = holder.tiers.findIndex((count, i) => count > 0 && i !== oldTierIndex);
                  if (oldTier >= 0) {
                    holder.tiers[oldTier] -= 1;
                    holder.multiplierSum -= contractTiers[oldTier + 1]?.multiplier || (oldTier + 1);
                    tierDistribution[oldTier] -= 1;
                  }
                }
                const newTier = cachedTokenTiers.get(tokenId)?.tier || 0;
                holder.tiers[newTier] += 1;
                holder.multiplierSum += contractTiers[newTier + 1]?.multiplier || (newTier + 1);
                tierDistribution[newTier] += 1;
              }
            }
          });
          await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey); // 24 hours TTL
        }
        cacheState.progressState.totalNfts = totalTokens;
        cacheState.progressState.totalTiers = totalTokens;
        cacheState.progressState.totalLiveHolders = totalTokens;
        cacheState.globalMetrics = {
          totalMinted: totalTokens + totalBurned,
          totalLive: totalTokens,
          totalBurned,
          tierDistribution,
        };
        cacheState.progressState.isPopulating = false;
        cacheState.progressState.step = 'completed';
        cacheState.progressState.processedNfts = totalTokens;
        cacheState.progressState.processedTiers = missingTierTokenIds.length;
        cacheState.progressState.progressPercentage = '100%';
        cacheState.progressState.lastProcessedBlock = Number(currentBlock);
        cacheState.progressState.lastUpdated = Date.now();
        await saveCacheStateContract(contractKey, cacheState);
        const holderList = Array.from(holdersMap.values());
        holderList.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
        holderList.forEach((holder, index) => {
          holder.rank = index + 1;
          holder.percentage = (holder.total / totalTokens * 100) || 0;
          holder.displayMultiplierSum = holder.multiplierSum;
        });
        await setCache(`${contractKey}_holders`, { holders: holderList, totalBurned, timestamp: Date.now() }, 0, contractKey);
        logger.info('utils', `Updated cached holders for ${contractKey}, lastBlock=${cacheState.lastProcessedBlock}, updatedTokens=${missingTierTokenIds.length}`, 'eth', contractKey);
        return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog, rarityDistribution };
      } else {
        logger.warn('utils', `Invalid holders cache data for ${contractKey}`, 'eth', contractKey);
      }
    } catch (error) {
      logger.error('utils', `Failed to load cache for ${contractKey}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'load_cache', error: error.message });
    }
  } else if (cacheValid) {
    // Original cache logic for non-element280 contracts
    try {
      const cachedHolders = await getCache(`${contractKey}_holders`, contractKey);
      if (cachedHolders?.holders) {
        holdersMap = new Map(cachedHolders.holders.map(h => [h.wallet, h]));
        totalBurned = cachedHolders.totalBurned || totalBurned;
        rarityDistribution = cachedHolders.rarityDistribution || rarityDistribution;
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
        cacheState.progressState.isPopulating = false;
        cacheState.progressState.step = 'cached';
        cacheState.progressState.progressPercentage = '100%';
        await saveCacheStateContract(contractKey, cacheState);
        logger.info('utils', `Using cached holders for ${contractKey}, lastBlock=${cacheState.lastProcessedBlock}`, 'eth', contractKey);
        return { holdersMap, totalBurned, lastBlock: cacheState.lastProcessedBlock, errorLog, rarityDistribution };
      }
    } catch (error) {
      logger.error('utils', `Failed to load cache for ${contractKey}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    }
  }

  cacheState.progressState.step = 'fetching_supply';
  cacheState.progressState.isPopulating = true;
  cacheState.progressState.progressPercentage = '10%';
  await saveCacheStateContract(contractKey, cacheState);

  const isBurnContract = ['stax', 'element280', 'element369'].includes(contractKey);
  if (contractKey === 'ascendant') {
    try {
      const [totalSharesRaw, toDistributeDay8Raw, toDistributeDay28Raw, toDistributeDay90Raw] = await retry(
        () => Promise.all([
          client.readContract({ address: contractAddress, abi, functionName: 'totalShares' }),
          client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [0] }),
          client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [1] }),
          client.readContract({ address: contractAddress, abi, functionName: 'toDistribute', args: [2] })
        ]),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      totalShares = parseFloat(formatUnits(totalSharesRaw, 18));
      toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));
      toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));
      toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Ascendant metrics: totalShares=${totalShares}, toDistributeDay8=${toDistributeDay8}`, 'eth', contractKey);
      }
    } catch (error) {
      logger.error('utils', `Failed to fetch ascendant metrics: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_ascendant_metrics', error: error.message });
      throw error;
    }
  } else {
    try {
      const [totalSupply, burnedCount] = await retry(
        () => Promise.all([
          client.readContract({ address: contractAddress, abi, functionName: 'totalSupply' }),
          client.readContract({ address: contractAddress, abi, functionName: 'totalBurned' }).catch(() => 0)
        ]),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      totalTokens = Number(totalSupply);
      totalBurned = Number(burnedCount);
      if (!config.debug.suppressDebug) {
        logger.debug('utils', `Total tokens: ${totalTokens}, totalBurned: ${totalBurned}`, 'eth', contractKey);
      }
    } catch (error) {
      logger.error('utils', `Supply fetch error: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
      errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_supply', error: error.message });
      throw error;
    }
  }

  cacheState.progressState.step = 'fetching_holders';
  cacheState.progressState.progressPercentage = '20%';
  await saveCacheStateContract(contractKey, cacheState);

  try {
    const owners = await retry(
      () => getOwnersForContract(contractAddress, abi, { withTokenBalances: true, maxPages: 100 }),
      { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
    );

    const filteredOwners = owners.filter(
      owner => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() && owner.tokenBalances?.length > 0
    );
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Filtered owners: ${filteredOwners.length}`, 'eth', contractKey);
    }

    tokenOwnerMap.clear();
    totalTokens = 0;
    const seenTokenIds = new Set();

    filteredOwners.forEach(owner => {
      if (!owner.ownerAddress) return;
      let wallet;
      try {
        wallet = getAddress(owner.ownerAddress).toLowerCase();
      } catch (e) {
        logger.warn('utils', `Invalid wallet address: ${owner.ownerAddress}`, 'eth', contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'process_owner', ownerAddress: owner.ownerAddress, error: 'Invalid wallet address' });
        return;
      }
      owner.tokenBalances.forEach(tb => {
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

  cacheState.progressState.totalNfts = totalTokens;
  cacheState.progressState.totalTiers = totalTokens;
  cacheState.progressState.totalLiveHolders = totalTokens;
  cacheState.progressState.progressPercentage = '30%';
  await saveCacheStateContract(contractKey, cacheState);

  if (totalTokens === 0) {
    cacheState.progressState.step = 'completed';
    cacheState.progressState.progressPercentage = '100%';
    cacheState.globalMetrics = {
      ...(contractKey === 'element280' || contractKey === 'stax' || contractKey === 'ascendant' ? { totalMinted: totalTokens + totalBurned } : {}),
      totalLive: totalTokens,
      totalBurned,
      tierDistribution: Array(maxTier + 1).fill(0),
      ...(contractKey === 'ascendant' ? {
        totalLockedAscendant: 0,
        totalShares: 0,
        toDistributeDay8: 0,
        toDistributeDay28: 0,
        toDistributeDay90: 0,
        pendingRewards: 0,
        rarityDistribution: Array(3).fill(0)
      } : {})
    };
    await saveCacheStateContract(contractKey, cacheState);
    await setCache(`${contractKey}_tiers`, {}, config.cache.nodeCache.stdTTL || 86400, contractKey);
    logger.info('utils', `No tokens found, returning empty holdersMap`, 'eth', contractKey);
    return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog, rarityDistribution };
  }

  cacheState.progressState.step = 'fetching_records';
  cacheState.progressState.progressPercentage = '40%';
  await saveCacheStateContract(contractKey, cacheState);

  const tokenIds = Array.from(tokenOwnerMap.keys());
  const recordCalls = contractKey === 'ascendant' ? tokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: 'userRecords',
    args: [BigInt(tokenId)]
  })) : [];
  const recordResults = contractKey === 'ascendant' ? [] : tokenIds.map(() => ({ status: 'success', result: [] }));
  if (contractKey === 'ascendant') {
    const chunkSize = config.nftContracts[contractKey]?.maxTokensPerOwnerQuery || 1000;
    for (let i = 0; i < recordCalls.length; i += chunkSize) {
      const chunk = recordCalls.slice(i, i + chunkSize);
      const results = await retry(
        () => batchMulticall(chunk, config.alchemy.batchSize),
        { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
      );
      recordResults.push(...results);
      cacheState.progressState.progressPercentage = `${Math.round(40 + (i / recordCalls.length) * 10)}%`;
      await saveCacheStateContract(contractKey, cacheState);
    }
  }

  cacheState.progressState.step = 'fetching_tiers';
  cacheState.progressState.processedTiers = 0;
  cacheState.progressState.progressPercentage = '50%';
  await saveCacheStateContract(contractKey, cacheState);

  // Load cached tiers for element280
  if (contractKey === 'element280') {
    const cachedTiers = await getCache(`${contractKey}_tiers`, contractKey) || {};
    Object.entries(cachedTiers).forEach(([tokenId, tierData]) => {
      if (tierData && typeof tierData.tier === 'number') {
        cachedTokenTiers.set(Number(tokenId), tierData);
      }
    });
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Cached tiers loaded: ${cachedTokenTiers.size}, missing tiers for ${tokenIds.length - cachedTokenTiers.size} tokens`, 'eth', contractKey);
    }
  }

  const missingTierTokenIds = contractKey === 'element280' ? tokenIds.filter(tokenId => !cachedTokenTiers.has(tokenId)) : tokenIds;
  const tierCalls = missingTierTokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
    args: [BigInt(tokenId)]
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
    cacheState.progressState.processedTiers = Math.min(i + chunkSize, missingTierTokenIds.length);
    cacheState.progressState.progressPercentage = `${Math.round(50 + (i / tierCalls.length) * 20)}%`;
    await saveCacheStateContract(contractKey, cacheState);
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Processed tiers for ${cacheState.progressState.processedTiers}/${missingTierTokenIds.length} tokens`, 'eth', contractKey);
    }
  }

  // Cache new tier results for element280
  if (contractKey === 'element280') {
    tierResults.forEach((result, i) => {
      const tokenId = missingTierTokenIds[i];
      if (result.status === 'success') {
        const tier = Number(result.result) || 0;
        cachedTokenTiers.set(tokenId, { tier, timestamp: Date.now() });
      } else {
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId,
          error: result.error || 'unknown error'
        });
      }
    });
    await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey);
  }

  // Combine cached and new tier results for element280
  const allTierResults = contractKey === 'element280' ? tokenIds.map(tokenId => {
    if (cachedTokenTiers.has(tokenId)) {
      const tierData = cachedTokenTiers.get(tokenId);
      return { status: 'success', result: tierData.tier };
    }
    const index = missingTierTokenIds.indexOf(tokenId);
    return index >= 0 ? tierResults[index] : { status: 'failure', error: 'Missing tier data' };
  }) : tierResults;

  cacheState.progressState.step = 'fetching_rewards';
  cacheState.progressState.progressPercentage = '70%';
  await saveCacheStateContract(contractKey, cacheState);

  const rewardCalls = contractKey === 'ascendant' ? [{
    address: contractAddress,
    abi,
    functionName: 'batchClaimableAmount',
    args: [tokenIds.map(id => BigInt(id))]
  }, {
    address: contractAddress,
    abi,
    functionName: 'toDistribute',
    args: [0]
  }, {
    address: contractAddress,
    abi,
    functionName: 'toDistribute',
    args: [1]
  }, {
    address: contractAddress,
    abi,
    functionName: 'toDistribute',
    args: [2]
  }, {
    address: contractAddress,
    abi,
    functionName: 'totalShares',
    args: []
  }] : [];

  const rewardResults = contractKey === 'ascendant' ? await retry(
    () => batchMulticall(rewardCalls, config.alchemy.batchSize),
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  ) : [];

  if (contractKey === 'ascendant') {
    if (rewardResults[0].status === 'success') {
      const claimable = parseFloat(formatUnits(rewardResults[0].result || 0, 18));
      holdersMap.forEach(holder => {
        holder.claimableRewards = claimable / totalTokens * holder.total;
      });
    }
    toDistributeDay8 = rewardResults[1].status === 'success' ? parseFloat(formatUnits(rewardResults[1].result || 0, 18)) : toDistributeDay8;
    toDistributeDay28 = rewardResults[2].status === 'success' ? parseFloat(formatUnits(rewardResults[2].result || 0, 18)) : toDistributeDay28;
    toDistributeDay90 = rewardResults[3].status === 'success' ? parseFloat(formatUnits(rewardResults[3].result || 0, 18)) : toDistributeDay90;
    totalShares = rewardResults[4].status === 'success' ? parseFloat(formatUnits(rewardResults[4].result || 0, 18)) : totalShares;
  }

  cacheState.progressState.step = 'building_holders';
  cacheState.progressState.progressPercentage = '80%';
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
        totalLockedAscendant += lockedAscendant;
      } else {
        logger.error('utils', `Failed to fetch userRecords for token ${tokenId}: ${recordResult.error || 'unknown error'}`, 'eth', contractKey);
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId, wallet, error: recordResult.error || 'unknown error' });
        return;
      }
    }

    let tier = 0;
    let rarityNumber = 0;
    let rarity = 0;
    const tierResult = allTierResults[i];
    if (!config.debug.suppressDebug) {
      logger.debug('utils', `Raw tierResult for token ${tokenId}: status=${tierResult.status}, result=${safeStringify(tierResult.result)}`, 'eth', contractKey);
    }

    if (tierResult.status === 'success') {
      if (contractKey === 'ascendant') {
        const result = tierResult.result;
        let parsedResult;
        if (Array.isArray(result) && result.length >= 3) {
          parsedResult = {
            rarityNumber: Number(result[0]) || 0,
            tier: Number(result[1]) || 0,
            rarity: Number(result[2]) || 0
          };
        } else if (typeof result === 'object' && result !== null && 'rarityNumber' in result) {
          parsedResult = {
            rarityNumber: Number(result.rarityNumber) || 0,
            tier: Number(result.tier) || 0,
            rarity: Number(result.rarity) || 0
          };
        } else {
          logger.warn('utils', `Invalid getNFTAttribute result for token ${tokenId}: result=${safeStringify(result)}`, 'eth', contractKey);
          errorLog.push({
            timestamp: new Date().toISOString(),
            phase: 'fetch_tier',
            tokenId,
            wallet,
            error: `Invalid getNFTAttribute result: ${safeStringify(result)}`
          });
          return;
        }
        rarityNumber = parsedResult.rarityNumber;
        tier = parsedResult.tier;
        rarity = parsedResult.rarity;
        if (!config.debug.suppressDebug) {
          logger.debug('utils', `Parsed attributes for token ${tokenId} (ascendant): tier=${tier}, rarityNumber=${rarityNumber}, rarity=${rarity}`, 'eth', contractKey);
        }
      } else {
        tier = typeof tierResult.result === 'bigint' ? Number(tierResult.result) : Number(tierResult.result) || 0;
      }

      if (isNaN(tier) || tier < 0 || tier > maxTier) {
        logger.warn('utils', `Invalid tier for token ${tokenId} in ${contractKey}: tier=${tier}, maxTier=${maxTier}, defaulting to 0`, 'eth', contractKey);
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId,
          wallet,
          error: `Invalid tier ${tier}`,
          details: { rawResult: safeStringify(tierResult.result), maxTier, parsedTier: tier }
        });
        tier = 0;
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
      return;
    }

    if (contractKey === 'ascendant' && rarity >= 0 && rarity < rarityDistribution.length) {
      rarityDistribution[rarity] += 1;
    } else if (contractKey === 'ascendant') {
      logger.warn('utils', `Invalid rarity for token ${tokenId}: rarity=${rarity}, maxRarity=${rarityDistribution.length - 1}`, 'eth', contractKey);
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_rarity',
        tokenId,
        wallet,
        error: `Invalid rarity ${rarity}`
      });
    }

    const holder = holdersMap.get(wallet) || {
      wallet,
      tokenIds: [],
      tiers: Array(maxTier + 1).fill(0),
      total: 0,
      multiplierSum: 0,
      ...(contractKey === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
      ...(contractKey === 'element280' || contractKey === 'stax' ? { claimableRewards: 0 } : {}),
      ...(contractKey === 'ascendant' ? {
        shares: 0,
        lockedAscendant: 0,
        pendingDay8: toDistributeDay8 / totalTokens * 8 / 100,
        pendingDay28: toDistributeDay28 / totalTokens * 28 / 100,
        pendingDay90: toDistributeDay90 / totalTokens * 90 / 100,
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
    holder.tiers[tier] += 1;
    holder.multiplierSum += contractTiers[tier + 1]?.multiplier || (tier + 1);
    if (contractKey === 'ascendant') {
      holder.shares += shares;
      holder.lockedAscendant += lockedAscendant;
      holder.tokens.push({
        tokenId: Number(tokenId),
        tier: tier + 1,
        rawTier: tier,
        rarityNumber,
        rarity
      });
    }
    holdersMap.set(wallet, holder);
    tierDistribution[tier] += 1;
  });

  cacheState.progressState.step = 'finalizing';
  cacheState.progressState.progressPercentage = '90%';
  await saveCacheStateContract(contractKey, cacheState);

  const totalLiveHolders = holdersMap.size;
  cacheState.progressState.totalOwners = totalLiveHolders;
  let holderList = Array.from(holdersMap.values());
  holderList.forEach((holder, index) => {
    holder.rank = index + 1;
    holder.percentage = (holder.total / totalTokens * 100) || 0;
    holder.displayMultiplierSum = holder.multiplierSum;
  });

  holderList.sort((a, b) => {
    if (contractKey === 'ascendant') {
      return b.shares - a.shares || b.total - a.total;
    }
    return b.total - a.total || b.multiplierSum - a.multiplierSum;
  });
  holderList.forEach((holder, index) => {
    holder.rank = index + 1;
  });

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
      pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
      rarityDistribution
    } : {})
  };
  cacheState.progressState.isPopulating = false;
  cacheState.progressState.step = 'completed';
  cacheState.progressState.processedNfts = totalTokens;
  cacheState.progressState.processedTiers = missingTierTokenIds.length;
  cacheState.progressState.progressPercentage = '100%';
  cacheState.progressState.lastProcessedBlock = Number(currentBlock);
  cacheState.progressState.lastUpdated = Date.now();
  await saveCacheStateContract(contractKey, cacheState);

  await setCache(`${contractKey}_holders`, { holders: holderList, totalBurned, timestamp: Date.now(), rarityDistribution }, 0, contractKey);
  if (contractKey === 'element280') {
    await setCache(`${contractKey}_tiers`, Object.fromEntries(cachedTokenTiers), config.cache.nodeCache.stdTTL || 86400, contractKey);
  }
  logger.info('utils', `Completed holders map with ${holderList.length} holders, totalBurned=${totalBurned}, cachedTiers=${cachedTokenTiers.size}`, 'eth', contractKey);
  if (!config.debug.suppressDebug) {
    logger.debug('utils', `Tier distribution for ${contractKey}: ${tierDistribution}`, 'eth', contractKey);
    if (contractKey === 'ascendant') {
      logger.debug('utils', `Rarity distribution for ${contractKey}: ${rarityDistribution}`, 'eth', contractKey);
    }
  }

  return { holdersMap, totalBurned, lastBlock: Number(currentBlock), errorLog, rarityDistribution };
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
          h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
          return acc;
        }, Array(contractKey === 'ascendant' ? maxTier + 1 : maxTier).fill(0)), // 9 tiers for ascendant
        multiplierPool: cachedData.holders.reduce((sum, h) => sum + h.multiplierSum, 0),
        ...(contractKey === 'ascendant' ? {
          rarityDistribution: cacheState.globalMetrics.rarityDistribution || Array(3).fill(0)
        } : {})
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
        h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
        return acc;
      }, Array(contractKey === 'ascendant' ? maxTier + 1 : maxTier).fill(0)), // 9 tiers for ascendant
      multiplierPool: holders.reduce((sum, h) => sum + h.multiplierSum, 0),
      ...(contractKey === 'ascendant' ? {
        rarityDistribution: cacheState.globalMetrics.rarityDistribution || Array(3).fill(0)
      } : {})
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