
// app/api/utils/holders.js
import { formatUnits } from 'viem';
import config from '@/config';
import { client, retry, logger, getCache, setCache, batchMulticall, getHoldersMap, getNewEvents } from './index.js';

// Helper: Process tiers for a list of token IDs
async function processHolderTiers(contractKey, contractAddress, abi, tokenIds, holder, errorLog) {
  const tierCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: contractKey === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
    args: [BigInt(tokenId)],
  }));
  const tierResults = await retry(
    () => batchMulticall(tierCalls, config.alchemy.batchSize),
    {
      retries: config.alchemy.maxRetries,
      delay: config.alchemy.batchDelayMs,
    }
  );
  tierResults.forEach((result, index) => {
    if (result.status === 'success' && result.result) {
      const tier = contractKey === 'ascendant' ? Number(result.result.tier || 0) : Number(result.result);
      const maxTier = Object.keys(config.contractTiers[contractKey]).length;
      if (tier >= 1 && tier <= maxTier) {
        holder.tiers[tier - 1]++;
        holder.multiplierSum += config.contractTiers[contractKey][tier]?.multiplier || 0;
        logger.debug(
          'holders',
          `Tier ${tier} for token ${tokenIds[index]} assigned to wallet ${holder.wallet}`,
          'eth',
          contractKey
        );
      } else {
        logger.warn(
          'holders',
          `Invalid tier ${tier} for token ${tokenIds[index]}, wallet ${holder.wallet}`,
          'eth',
          contractKey
        );
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_tier',
          tokenId: tokenIds[index],
          error: `Invalid tier ${tier}`,
        });
      }
    } else {
      logger.warn(
        'holders',
        `Failed to fetch tier for token ${tokenIds[index]}: ${result.error || 'unknown error'}`,
        'eth',
        contractKey
      );
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_tier',
        tokenId: tokenIds[index],
        error: result.error || 'unknown error',
      });
    }
  });
}

// Helper: Process user records and rewards for ascendant contract
async function processAscendantRecordsAndRewards(contractKey, contractAddress, abi, tokenIds, holder, errorLog) {
  const recordCalls = tokenIds.map(tokenId => ({
    address: contractAddress,
    abi,
    functionName: 'userRecords',
    args: [BigInt(tokenId)],
  }));
  const recordResults = await retry(
    () => batchMulticall(recordCalls, config.alchemy.batchSize),
    {
      retries: config.alchemy.maxRetries,
      delay: config.alchemy.batchDelayMs,
    }
  );
  recordResults.forEach((result, index) => {
    if (result.status === 'success' && Array.isArray(result.result)) {
      holder.shares += parseFloat(formatUnits(result.result[0] || 0, 18));
      holder.lockedAscendant += parseFloat(formatUnits(result.result[1] || 0, 18));
      logger.debug(
        'holders',
        `userRecords for token ${tokenIds[index]}: shares=${holder.shares}, lockedAscendant=${holder.lockedAscendant}`,
        'eth',
        contractKey
      );
    } else {
      logger.error(
        'holders',
        `Failed to fetch userRecords for token ${tokenIds[index]}: ${result.error || 'unknown error'}`,
        'eth',
        contractKey
      );
      errorLog.push({
        timestamp: new Date().toISOString(),
        phase: 'fetch_records',
        tokenId: tokenIds[index],
        error: result.error || 'unknown error',
      });
    }
  });

  const claimableCall = [
    {
      address: contractAddress,
      abi,
      functionName: 'batchClaimableAmount',
      args: [tokenIds.map(id => BigInt(id))],
    },
  ];
  const claimableResults = await retry(
    () => batchMulticall(claimableCall, config.alchemy.batchSize),
    {
      retries: config.alchemy.maxRetries,
      delay: config.alchemy.batchDelayMs,
    }
  );
  if (claimableResults[0]?.status === 'success') {
    holder.claimableRewards = parseFloat(formatUnits(claimableResults[0].result || 0, 18));
    logger.debug(
      'holders',
      `Claimable rewards for wallet ${holder.wallet}: ${holder.claimableRewards}`,
      'eth',
      contractKey
    );
  } else {
    logger.error(
      'holders',
      `Failed to fetch claimableRewards for wallet ${holder.wallet}: ${claimableResults[0]?.error || 'unknown error'}`,
      'eth',
      contractKey
    );
    errorLog.push({
      timestamp: new Date().toISOString(),
      phase: 'fetch_claimable',
      wallet: holder.wallet,
      error: claimableResults[0]?.error || 'unknown error',
    });
  }

  const totalSharesRaw = await retry(
    async () => {
      const result = await client.readContract({
        address: contractAddress,
        abi,
        functionName: 'totalShares',
      });
      if (result === null || result === undefined) throw new Error('totalShares returned null');
      return result;
    },
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  );
  const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

  const toDistributeDay8Raw = await retry(
    async () => {
      const result = await client.readContract({
        address: contractAddress,
        abi,
        functionName: 'toDistribute',
        args: [0],
      });
      if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
      return result;
    },
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  );
  const toDistributeDay8 = parseFloat(formatUnits(toDistributeDay8Raw, 18));

  const toDistributeDay28Raw = await retry(
    async () => {
      const result = await client.readContract({
        address: contractAddress,
        abi,
        functionName: 'toDistribute',
        args: [1],
      });
      if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
      return result;
    },
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  );
  const toDistributeDay28 = parseFloat(formatUnits(toDistributeDay28Raw, 18));

  const toDistributeDay90Raw = await retry(
    async () => {
      const result = await client.readContract({
        address: contractAddress,
        abi,
        functionName: 'toDistribute',
        args: [2],
      });
      if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
      return result;
    },
    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
  );
  const toDistributeDay90 = parseFloat(formatUnits(toDistributeDay90Raw, 18));

  const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
  const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
  const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

  holder.pendingDay8 = holder.shares * pendingRewardPerShareDay8;
  holder.pendingDay28 = holder.shares * pendingRewardPerShareDay28;
  holder.pendingDay90 = holder.shares * pendingRewardPerShareDay90;

  return { totalShares, toDistributeDay8, toDistributeDay28, toDistributeDay90 };
}

// Populate holders map cache
export async function populateHoldersMapCache(
  contractKey,
  contractAddress,
  abi,
  vaultAddress,
  vaultAbi,
  forceUpdate = false,
  addressFilter = null
) {
  const { getCacheState, saveCacheStateContract } = await import('./cache.js');
  let cacheState = await getCacheState(contractKey);
  if (cacheState.isPopulating && !forceUpdate) {
    logger.info('holders', 'Cache population already in progress', 'eth', contractKey);
    return { status: 'in_progress', holders: null };
  }

  cacheState.isPopulating = true;
  cacheState.progressState.step = 'starting';
  cacheState.progressState.error = null;
  cacheState.progressState.errorLog = [];
  await saveCacheStateContract(contractKey, cacheState);

  const errorLog = [];

  try {
    const cachedData = await getCache(`${contractKey.toLowerCase()}_holders`, contractKey.toLowerCase());
    const isCacheValid =
      cachedData &&
      Array.isArray(cachedData.holders) &&
      Number.isInteger(cachedData.totalBurned) &&
      !forceUpdate &&
      !addressFilter;

    if (isCacheValid) {
      const fromBlock = cacheState.lastProcessedBlock || config.deploymentBlocks[contractKey].block;
      const { burnedTokenIds, transferTokenIds, lastBlock } = await getNewEvents(
        contractKey,
        contractAddress,
        fromBlock,
        errorLog
      );

      let currentBlock;
      try {
        currentBlock = await client.getBlockNumber();
      } catch (error) {
        errorLog.push({
          timestamp: new Date().toISOString(),
          phase: 'fetch_block_number',
          error: error.message,
        });
        throw error;
      }

      if (burnedTokenIds.length > 0 || transferTokenIds.length > 0) {
        const holdersMap = new Map();
        let totalBurned = cachedData.totalBurned || 0;
        logger.debug('holders', `Initial totalBurned from cache: ${totalBurned}`, 'eth', contractKey);

        for (const holder of cachedData.holders) {
          const updatedTokenIds = holder.tokenIds.filter(id => !burnedTokenIds.includes(id));
          if (updatedTokenIds.length > 0) {
            const updatedHolder = {
              ...holder,
              tokenIds: updatedTokenIds,
              total: updatedTokenIds.length,
              tiers: Array(Object.keys(config.contractTiers[contractKey]).length).fill(0),
              multiplierSum: 0,
              ...(contractKey === 'element369'
                ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 }
                : {}),
              ...(contractKey === 'element280' || contractKey === 'stax'
                ? { claimableRewards: 0 }
                : {}),
              ...(contractKey === 'ascendant'
                ? {
                    shares: 0,
                    lockedAscendant: 0,
                    pendingDay8: 0,
                    pendingDay28: 0,
                    pendingDay90: 0,
                    claimableRewards: 0,
                  }
                : {}),
            };

            await processHolderTiers(contractKey, contractAddress, abi, updatedTokenIds, updatedHolder, errorLog);

            let totalShares, toDistributeDay8, toDistributeDay28, toDistributeDay90;
            if (contractKey === 'ascendant') {
              const result = await processAscendantRecordsAndRewards(
                contractKey,
                contractAddress,
                abi,
                updatedTokenIds,
                updatedHolder,
                errorLog
              );
              totalShares = result.totalShares;
              toDistributeDay8 = result.toDistributeDay8;
              toDistributeDay28 = result.toDistributeDay28;
              toDistributeDay90 = result.toDistributeDay90;
            }

            holdersMap.set(holder.wallet, updatedHolder);
          } else {
            totalBurned += holder.total;
            logger.debug(
              'holders',
              `Incremented totalBurned by ${holder.total} for wallet ${holder.wallet}`,
              'eth',
              contractKey
            );
          }
        }

        for (const transfer of transferTokenIds) {
          const fromHolder = holdersMap.get(transfer.from);
          if (fromHolder) {
            fromHolder.tokenIds = fromHolder.tokenIds.filter(id => id !== transfer.tokenId);
            fromHolder.total = fromHolder.tokenIds.length;
            if (fromHolder.total === 0) {
              holdersMap.delete(transfer.from);
              logger.debug('holders', `Removed empty holder: ${transfer.from}`, 'eth', contractKey);
            } else {
              fromHolder.tiers = Array(Object.keys(config.contractTiers[contractKey]).length).fill(0);
              fromHolder.multiplierSum = 0;
              await processHolderTiers(contractKey, contractAddress, abi, [transfer.tokenId], fromHolder, errorLog);
              if (contractKey === 'ascendant') {
                await processAscendantRecordsAndRewards(
                  contractKey,
                  contractAddress,
                  abi,
                  fromHolder.tokenIds,
                  fromHolder,
                  errorLog
                );
              }
              holdersMap.set(transfer.from, fromHolder);
            }
          }

          const toHolder =
            holdersMap.get(transfer.to) ||
            {
              wallet: transfer.to,
              tokenIds: [],
              tiers: Array(Object.keys(config.contractTiers[contractKey]).length).fill(0),
              total: 0,
              multiplierSum: 0,
              ...(contractKey === 'element369'
                ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 }
                : {}),
              ...(contractKey === 'element280' || contractKey === 'stax'
                ? { claimableRewards: 0 }
                : {}),
              ...(contractKey === 'ascendant'
                ? {
                    shares: 0,
                    lockedAscendant: 0,
                    pendingDay8: 0,
                    pendingDay28: 0,
                    pendingDay90: 0,
                    claimableRewards: 0,
                  }
                : {}),
            };
          toHolder.tokenIds.push(transfer.tokenId);
          toHolder.total = toHolder.tokenIds.length;
          await processHolderTiers(contractKey, contractAddress, abi, [transfer.tokenId], toHolder, errorLog);
          if (contractKey === 'ascendant') {
            const result = await processAscendantRecordsAndRewards(
              contractKey,
              contractAddress,
              abi,
              toHolder.tokenIds,
              toHolder,
              errorLog
            );
            totalShares = result.totalShares;
            toDistributeDay8 = result.toDistributeDay8;
            toDistributeDay28 = result.toDistributeDay28;
            toDistributeDay90 = result.toDistributeDay90;
          }
          holdersMap.set(transfer.to, toHolder);
        }

        const holderList = Array.from(holdersMap.values());
        const totalMultiplierSum = holderList.reduce((sum, h) => sum + h.multiplierSum, 0);
        holderList.forEach(holder => {
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
          holder.displayMultiplierSum = holder.multiplierSum / (contractKey === 'element280' ? 10 : 1);
          logger.debug(
            'holders',
            `Calculated metrics for wallet ${holder.wallet}: percentage=${holder.percentage}, displayMultiplierSum=${holder.displayMultiplierSum}`,
            'eth',
            contractKey
          );
        });

        holderList.sort((a, b) =>
          contractKey === 'ascendant'
            ? b.shares - a.shares || b.multiplierSum - a.multiplierSum || b.total - a.total
            : b.multiplierSum - a.multiplierSum || b.total - a.total
        );
        holderList.forEach((holder, index) => (holder.rank = index + 1));

        let burnedCountContract;
        try {
          burnedCountContract = await retry(
            async () => {
              const result = await client.readContract({
                address: contractAddress,
                abi,
                functionName: 'totalBurned',
              });
              return Number(result);
            },
            { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
          );
          logger.debug(
            'holders',
            `Fetched burnedCountContract: ${burnedCountContract}`,
            'eth',
            contractKey
          );
        } catch (error) {
          logger.error(
            'holders',
            `Failed to fetch totalBurned: ${error.message}`,
            { stack: error.stack },
            'eth',
            contractKey
          );
          burnedCountContract = 0;
        }
        totalBurned = burnedCountContract || totalBurned;
        logger.debug('holders', `Final totalBurned: ${totalBurned}`, 'eth', contractKey);

        const cacheData = { holders: holderList, totalBurned, timestamp: Date.now() };
        await setCache(`${contractKey.toLowerCase()}_holders`, cacheData, 0, contractKey.toLowerCase());
        cacheState.lastUpdated = Date.now();
        cacheState.totalOwners = holderList.length;
        cacheState.totalLiveHolders = holderList.length;
        cacheState.lastProcessedBlock = lastBlock;
        cacheState.progressState = {
          step: 'completed',
          processedNfts: cacheState.progressState.totalNfts,
          totalNfts: cacheState.progressState.totalNfts,
          processedTiers: cacheState.progressState.totalTiers,
          totalTiers: cacheState.progressState.totalTiers,
          error: null,
          errorLog,
        };
        if (contractKey === 'ascendant') {
          cacheState.globalMetrics = {
            totalTokens: holderList.reduce((sum, h) => sum + h.total, 0),
            totalLockedAscendant: holderList.reduce((sum, h) => sum + h.lockedAscendant, 0),
            totalShares,
            toDistributeDay8,
            toDistributeDay28,
            toDistributeDay90,
            pendingRewards: toDistributeDay8 + toDistributeDay28 + toDistributeDay90,
          };
        }
        await saveCacheStateContract(contractKey, cacheState);
        logger.info(
          'holders',
          `Cache updated: ${holderList.length} holders, totalBurned: ${totalBurned}`,
          'eth',
          contractKey
        );
        return { status: 'updated', holders: holderList };
      } else {
        cacheState.isPopulating = false;
        cacheState.progressState.step = 'completed';
        cacheState.lastProcessedBlock = Number(currentBlock);
        await saveCacheStateContract(contractKey, cacheState);
        logger.info('holders', 'Cache is up to date', 'eth', contractKey);
        return { status: 'up_to_date', holders: cachedData.holders };
      }
    }

    const result = await getHoldersMap(
      contractKey,
      contractAddress,
      abi,
      vaultAddress,
      vaultAbi,
      cacheState,
      addressFilter
    );
    const holderList = Array.from(result.holdersMap.values());
    const totalBurned = result.totalBurned || 0;
    logger.debug('holders', `getHoldersMap returned totalBurned: ${totalBurned}`, 'eth', contractKey);
    const cacheData = { holders: holderList, totalBurned, timestamp: Date.now() };
    await setCache(`${contractKey.toLowerCase()}_holders`, cacheData, 0, contractKey.toLowerCase());
    cacheState.lastUpdated = Date.now();
    cacheState.totalOwners = holderList.length;
    cacheState.totalLiveHolders = holderList.length;
    cacheState.lastProcessedBlock = result.lastBlock;
    cacheState.progressState = {
      step: 'completed',
      processedNfts: cacheState.progressState.totalNfts,
      totalNfts: cacheState.progressState.totalNfts,
      processedTiers: cacheState.progressState.totalTiers,
      totalTiers: cacheState.progressState.totalTiers,
      error: null,
      errorLog: result.errorLog || [],
    };
    if (contractKey === 'ascendant') {
      cacheState.globalMetrics = cacheState.globalMetrics || {};
    }
    await saveCacheStateContract(contractKey, cacheState);
    logger.info(
      'holders',
      `Cache populated: ${holderList.length} holders, totalBurned: ${totalBurned}`,
      'eth',
      contractKey
    );
    return { status: 'populated', holders: holderList };
  } catch (error) {
    cacheState.isPopulating = false;
    cacheState.progressState.error = error.message;
    cacheState.progressState.errorLog.push({
      timestamp: new Date().toISOString(),
      error: error.message,
    });
    await saveCacheStateContract(contractKey, cacheState);
    logger.error(
      'holders',
      `Failed to populate cache: ${error.message}`,
      { stack: error.stack },
      'eth',
      contractKey
    );
    throw error;
  }
}

export { populateHoldersMapCache, processHolderTiers, processAscendantRecordsAndRewards };