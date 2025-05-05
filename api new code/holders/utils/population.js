// app/api/holders/utils/population.js
import config from '@/contracts/config';
import { formatUnits } from 'viem';
import { client, retry, logger, getCache, setCache, saveCacheState } from '@/app/api new code/utils';
import { getCacheState } from './cache';
import { getNewEvents } from './events';
import { getHoldersMap } from './holders';
import { sanitizeBigInt } from './serialization';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import path from 'path';

const localCache = new NodeCache({ stdTTL: 86400 }); // 24-hour TTL
const useRedis = process.env.USE_REDIS === 'true';

async function getLocalFileCache(key, contractKey) {
  logger.debug('population', `Attempting to load cache: ${key}`, {}, 'eth', contractKey);
  if (useRedis) return getCache(key, contractKey);
  const cachePath = path.join(process.cwd(), 'cache', `${key}.json`);
  try {
    const data = await fs.readFile(cachePath, 'utf8');
    logger.debug('population', `Loaded local cache file: ${cachePath}`, {}, 'eth', contractKey);
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.debug('population', `No local cache file found: ${cachePath}`, {}, 'eth', contractKey);
    } else {
      logger.error('population', `Failed to load local cache file ${cachePath}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    }
    return null;
  }
}

async function setLocalFileCache(key, value, ttl, contractKey) {
  logger.debug('population', `Saving cache: ${key}, holders: ${value.holders?.length || 'unknown'}`, {}, 'eth', contractKey);
  if (useRedis) return setCache(key, value, ttl, contractKey);
  const cachePath = path.join(process.cwd(), 'cache', `${key}.json`);
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(value, null, 2));
    await fs.chmod(cachePath, 0o644);
    localCache.set(key, value, ttl);
    logger.info('population', `Saved local cache file: ${cachePath}`, {}, 'eth', contractKey);
  } catch (error) {
    logger.error('population', `Failed to save local cache file ${cachePath}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    throw error;
  }
}

export async function populateHoldersMapCache(contractKey, forceUpdate = false) {
  const contractKeyLower = contractKey.toLowerCase();
  logger.info('population', `Starting cache population for ${contractKeyLower}, forceUpdate=${forceUpdate}`, {}, 'eth', contractKeyLower);

  let cacheState = await getCacheState(contractKeyLower);
  if (cacheState.isPopulating && !forceUpdate) {
    logger.info('population', `Cache population already in progress for ${contractKeyLower}`, {}, 'eth', contractKeyLower);
    return { status: 'in_progress', holders: null };
  }

  cacheState.isPopulating = true;
  cacheState.phase = 'Starting';
  cacheState.error = null;
  cacheState.errorLog = [];
  cacheState.progressPercentage = '0.0';
  const startTime = Date.now();
  await saveCacheState(contractKeyLower, cacheState);
  logger.debug('population', `Initialized cache state: ${JSON.stringify(cacheState)}`, {}, 'eth', contractKeyLower);

  const errorLog = [];

  try {
    // Validate contract configuration
    logger.debug('population', `Validating contract configuration for ${contractKeyLower}`, {}, 'eth', contractKeyLower);
    const contractConfig = config.nftContracts[contractKeyLower];
    const contractAddress = config.contractAddresses[contractKeyLower]?.address;
    const vaultAddress = config.vaultAddresses[contractKeyLower]?.address;
    if (!contractConfig || !contractAddress || (contractKeyLower !== 'ascendant' && !vaultAddress)) {
      const errorMsg = `${contractKeyLower} configuration missing: ${JSON.stringify({ contractConfig: !!contractConfig, contractAddress, vaultAddress })}`;
      logger.error('population', errorMsg, {}, 'eth', contractKeyLower);
      throw new Error(errorMsg);
    }
    if (config.contractDetails[contractKeyLower]?.disabled) {
      const errorMsg = `${contractKeyLower} is disabled`;
      logger.error('population', errorMsg, {}, 'eth', contractKeyLower);
      throw new Error(errorMsg);
    }
    logger.info('population', `Contract configuration validated for ${contractKeyLower}`, {}, 'eth', contractKeyLower);

    // Check for cached data
    logger.debug('population', `Checking for cached data: ${contractKeyLower}_holders`, {}, 'eth', contractKeyLower);
    const cachedData = await getLocalFileCache(`${contractKeyLower}_holders`, contractKeyLower);
    const isCacheValid = cachedData && Array.isArray(cachedData.holders) && Number.isInteger(cachedData.totalBurned) && !forceUpdate;

    if (isCacheValid) {
      logger.info('population', `Valid cache found for ${contractKeyLower}, checking for new events`, {}, 'eth', contractKeyLower);
      const fromBlock = cacheState.lastProcessedBlock && cacheState.lastProcessedBlock >= config.deploymentBlocks[contractKeyLower]?.block
        ? cacheState.lastProcessedBlock
        : config.deploymentBlocks[contractKeyLower]?.block || 0;
      logger.debug('population', `Fetching events from block ${fromBlock}`, {}, 'eth', contractKeyLower);
      cacheState.phase = 'Fetching Events';
      cacheState.progressPercentage = '10.0';
      await saveCacheState(contractKeyLower, cacheState);

      const { burnedTokenIds, transferTokenIds, lastBlock } = await getNewEvents(contractKeyLower, contractAddress, fromBlock, errorLog);
      cacheState.lastProcessedBlock = lastBlock;
      cacheState.progressPercentage = '20.0';
      await saveCacheState(contractKeyLower, cacheState);
      logger.info('population', `Fetched ${burnedTokenIds.length} burn events, ${transferTokenIds.length} transfer events, lastBlock=${lastBlock}`, {}, 'eth', contractKeyLower);

      let currentBlock;
      try {
        currentBlock = await client.getBlockNumber();
        logger.debug('population', `Current block number: ${currentBlock}`, {}, 'eth', contractKeyLower);
      } catch (error) {
        errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_block_number', error: error.message });
        logger.error('population', `Failed to fetch block number: ${error.message}`, { stack: error.stack }, 'eth', contractKeyLower);
        throw error;
      }

      if (burnedTokenIds.length > 0 || transferTokenIds.length > 0) {
        logger.info('population', `Processing new events for ${contractKeyLower}`, {}, 'eth', contractKeyLower);
        cacheState.phase = 'Processing Events';
        cacheState.progressPercentage = '30.0';
        await saveCacheState(contractKeyLower, cacheState);

        const holdersMap = new Map();
        let totalBurned = cachedData.totalBurned || 0;
        let processedHolders = 0;
        const totalHolders = cachedData.holders.length;

        for (const holder of cachedData.holders) {
          const updatedTokenIds = holder.tokenIds.filter(id => !burnedTokenIds.includes(id));
          if (updatedTokenIds.length > 0) {
            const updatedHolder = {
              ...holder,
              tokenIds: updatedTokenIds,
              total: updatedTokenIds.length,
              tiers: Array(Object.keys(config.nftContracts[contractKeyLower].tiers).length).fill(0),
              multiplierSum: 0,
              ...(contractKeyLower === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
              ...(contractKeyLower === 'element280' || contractKeyLower === 'stax' ? { claimableRewards: 0 } : {}),
              ...(contractKeyLower === 'ascendant' ? {
                shares: 0,
                lockedAscendant: 0,
                pendingDay8: 0,
                pendingDay28: 0,
                pendingDay90: 0,
                claimableRewards: 0,
              } : {}),
            };

            // Sequential tier queries
            for (const tokenId of updatedTokenIds) {
              try {
                const tierResult = await retry(
                  () => client.readContract({
                    address: contractAddress,
                    abi: getContractAbi(contractKeyLower, 'nft'),
                    functionName: contractKeyLower === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
                    args: [BigInt(tokenId)],
                  }),
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const tier = contractKeyLower === 'ascendant' ? Number(tierResult[1] || 0) : Number(tierResult);
                const maxTier = Object.keys(config.nftContracts[contractKeyLower].tiers).length;
                if (tier >= 1 && tier <= maxTier) {
                  updatedHolder.tiers[tier - 1]++;
                  updatedHolder.multiplierSum += config.nftContracts[contractKeyLower].tiers[tier]?.multiplier || 0;
                } else {
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, error: `Invalid tier ${tier}` });
                }
              } catch (error) {
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId, error: error.message });
                logger.warn('population', `Failed to fetch tier for tokenId ${tokenId}: ${error.message}`, {}, 'eth', contractKeyLower);
              }
            }

            // Handle claimable rewards and Ascendant-specific logic
            if (contractKeyLower === 'element280' || contractKeyLower === 'stax') {
              try {
                const claimableResult = await retry(
                  () => client.readContract({
                    address: contractAddress,
                    abi: getContractAbi(contractKeyLower, 'nft'),
                    functionName: 'batchClaimableAmount',
                    args: [updatedTokenIds.map(id => BigInt(id))],
                  }),
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                updatedHolder.claimableRewards = parseFloat(formatUnits(claimableResult || 0, 18));
              } catch (error) {
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet: holder.owner, error: error.message });
                logger.warn('population', `Failed to fetch claimable rewards for ${holder.owner}: ${error.message}`, {}, 'eth', contractKeyLower);
              }
            }

            if (contractKeyLower === 'ascendant') {
              for (const tokenId of updatedTokenIds) {
                try {
                  const recordResult = await retry(
                    () => client.readContract({
                      address: contractAddress,
                      abi: getContractAbi(contractKeyLower, 'nft'),
                      functionName: 'userRecords',
                      args: [BigInt(tokenId)],
                    }),
                    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                  );
                  if (Array.isArray(recordResult)) {
                    updatedHolder.shares += parseFloat(formatUnits(recordResult[0] || 0, 18));
                    updatedHolder.lockedAscendant += parseFloat(formatUnits(recordResult[1] || 0, 18));
                  }
                } catch (error) {
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId, error: error.message });
                  logger.warn('population', `Failed to fetch records for tokenId ${tokenId}: ${error.message}`, {}, 'eth', contractKeyLower);
                }
              }

              try {
                const claimableResult = await retry(
                  () => client.readContract({
                    address: contractAddress,
                    abi: getContractAbi(contractKeyLower, 'nft'),
                    functionName: 'batchClaimableAmount',
                    args: [updatedTokenIds.map(id => BigInt(id))],
                  }),
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                updatedHolder.claimableRewards = parseFloat(formatUnits(claimableResult || 0, 18));
              } catch (error) {
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet: holder.owner, error: error.message });
                logger.warn('population', `Failed to fetch claimable rewards for ${holder.owner}: ${error.message}`, {}, 'eth', contractKeyLower);
              }

              const totalSharesRaw = await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'totalShares' });
                  if (result === null || result === undefined) throw new Error('totalShares returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

              const toDistributeDay8 = parseFloat(formatUnits(await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [0] });
                  if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              ), 18));

              const toDistributeDay28 = parseFloat(formatUnits(await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [1] });
                  if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              ), 18));

              const toDistributeDay90 = parseFloat(formatUnits(await retry(
                async () => {
                  const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [2] });
                  if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
                  return result;
                },
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              ), 18));

              const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
              const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
              const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

              updatedHolder.pendingDay8 = updatedHolder.shares * pendingRewardPerShareDay8;
              updatedHolder.pendingDay28 = updatedHolder.shares * pendingRewardPerShareDay28;
              updatedHolder.pendingDay90 = updatedHolder.shares * pendingRewardPerShareDay90;
            }

            holdersMap.set(holder.owner, updatedHolder);
          } else {
            totalBurned += holder.total;
          }

          processedHolders++;
          const holderProgress = ((processedHolders / totalHolders) * 100).toFixed(2);
          cacheState.progressPercentage = (30 + (holderProgress * 0.5)).toFixed(2); // 30% to 80% for holder processing
          await saveCacheState(contractKeyLower, cacheState);
          logger.debug('population', `Processed ${processedHolders}/${totalHolders} holders, progress: ${cacheState.progressPercentage}%`, {}, 'eth', contractKeyLower);
        }

        cacheState.phase = 'Processing Transfers';
        cacheState.progressPercentage = '80.0';
        await saveCacheState(contractKeyLower, cacheState);
        logger.debug('population', `Processing transfer events`, {}, 'eth', contractKeyLower);

        for (const transfer of transferTokenIds) {
          const fromHolder = holdersMap.get(transfer.from);
          if (fromHolder) {
            fromHolder.tokenIds = fromHolder.tokenIds.filter(id => id !== transfer.tokenId);
            fromHolder.total = fromHolder.tokenIds.length;
            if (fromHolder.total === 0) {
              holdersMap.delete(transfer.from);
            } else {
              fromHolder.tiers = Array(Object.keys(config.nftContracts[contractKeyLower].tiers).length).fill(0);
              fromHolder.multiplierSum = 0;
              try {
                const tierResult = await retry(
                  () => client.readContract({
                    address: contractAddress,
                    abi: getContractAbi(contractKeyLower, 'nft'),
                    functionName: contractKeyLower === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
                    args: [BigInt(transfer.tokenId)],
                  }),
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const tier = contractKeyLower === 'ascendant' ? Number(tierResult[1] || 0) : Number(tierResult);
                if (tier >= 1 && tier <= Object.keys(config.nftContracts[contractKeyLower].tiers).length) {
                  fromHolder.tiers[tier - 1]++;
                  fromHolder.multiplierSum += config.nftContracts[contractKeyLower].tiers[tier]?.multiplier || 0;
                }
              } catch (error) {
                errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId: transfer.tokenId, error: error.message });
                logger.warn('population', `Failed to fetch tier for transfer tokenId ${transfer.tokenId}: ${error.message}`, {}, 'eth', contractKeyLower);
              }

              if (contractKeyLower === 'ascendant') {
                fromHolder.shares = 0;
                fromHolder.lockedAscendant = 0;
                fromHolder.pendingDay8 = 0;
                fromHolder.pendingDay28 = 0;
                fromHolder.pendingDay90 = 0;
                fromHolder.claimableRewards = 0;

                try {
                  const recordResult = await retry(
                    () => client.readContract({
                      address: contractAddress,
                      abi: getContractAbi(contractKeyLower, 'nft'),
                      functionName: 'userRecords',
                      args: [BigInt(transfer.tokenId)],
                    }),
                    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                  );
                  if (Array.isArray(recordResult)) {
                    fromHolder.shares += parseFloat(formatUnits(recordResult[0] || 0, 18));
                    fromHolder.lockedAscendant += parseFloat(formatUnits(recordResult[1] || 0, 18));
                  }
                } catch (error) {
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId: transfer.tokenId, error: error.message });
                  logger.warn('population', `Failed to fetch records for transfer tokenId ${transfer.tokenId}: ${error.message}`, {}, 'eth', contractKeyLower);
                }

                try {
                  const claimableResult = await retry(
                    () => client.readContract({
                      address: contractAddress,
                      abi: getContractAbi(contractKeyLower, 'nft'),
                      functionName: 'batchClaimableAmount',
                      args: [fromHolder.tokenIds.map(id => BigInt(id))],
                    }),
                    { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                  );
                  fromHolder.claimableRewards = parseFloat(formatUnits(claimableResult || 0, 18));
                } catch (error) {
                  errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet: fromHolder.owner, error: error.message });
                  logger.warn('population', `Failed to fetch claimable rewards for ${fromHolder.owner}: ${error.message}`, {}, 'eth', contractKeyLower);
                }

                const totalSharesRaw = await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'totalShares' });
                    if (result === null || result === undefined) throw new Error('totalShares returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                );
                const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

                const toDistributeDay8 = parseFloat(formatUnits(await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [0] });
                    if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                ), 18));

                const toDistributeDay28 = parseFloat(formatUnits(await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [1] });
                    if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                ), 18));

                const toDistributeDay90 = parseFloat(formatUnits(await retry(
                  async () => {
                    const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [2] });
                    if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
                    return result;
                  },
                  { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
                ), 18));

                const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
                const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
                const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

                fromHolder.pendingDay8 = fromHolder.shares * pendingRewardPerShareDay8;
                fromHolder.pendingDay28 = fromHolder.shares * pendingRewardPerShareDay28;
                fromHolder.pendingDay90 = fromHolder.shares * pendingRewardPerShareDay90;
              }
              holdersMap.set(transfer.from, fromHolder);
            }
          }

          const toHolder = holdersMap.get(transfer.to) || {
            owner: transfer.to,
            tokenIds: [],
            tiers: Array(Object.keys(config.nftContracts[contractKeyLower].tiers).length).fill(0),
            total: 0,
            multiplierSum: 0,
            ...(contractKeyLower === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
            ...(contractKeyLower === 'element280' || contractKeyLower === 'stax' ? { claimableRewards: 0 } : {}),
            ...(contractKeyLower === 'ascendant' ? {
              shares: 0,
              lockedAscendant: 0,
              pendingDay8: 0,
              pendingDay28: 0,
              pendingDay90: 0,
              claimableRewards: 0,
            } : {}),
          };
          toHolder.tokenIds.push(transfer.tokenId);
          toHolder.total = toHolder.tokenIds.length;
          try {
            const tierResult = await retry(
              () => client.readContract({
                address: contractAddress,
                abi: getContractAbi(contractKeyLower, 'nft'),
                functionName: contractKeyLower === 'ascendant' ? 'getNFTAttribute' : 'getNftTier',
                args: [BigInt(transfer.tokenId)],
              }),
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            const tier = contractKeyLower === 'ascendant' ? Number(tierResult[1] || 0) : Number(tierResult);
            if (tier >= 1 && tier <= Object.keys(config.nftContracts[contractKeyLower].tiers).length) {
              toHolder.tiers[tier - 1]++;
              toHolder.multiplierSum += config.nftContracts[contractKeyLower].tiers[tier]?.multiplier || 0;
            }
          } catch (error) {
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_tier', tokenId: transfer.tokenId, error: error.message });
            logger.warn('population', `Failed to fetch tier for transfer tokenId ${transfer.tokenId}: ${error.message}`, {}, 'eth', contractKeyLower);
          }

          if (contractKeyLower === 'element280' || contractKeyLower === 'stax') {
            try {
              const claimableResult = await retry(
                () => client.readContract({
                  address: contractAddress,
                  abi: getContractAbi(contractKeyLower, 'nft'),
                  functionName: 'batchClaimableAmount',
                  args: [toHolder.tokenIds.map(id => BigInt(id))],
                }),
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              toHolder.claimableRewards = parseFloat(formatUnits(claimableResult || 0, 18));
            } catch (error) {
              errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet: toHolder.owner, error: error.message });
              logger.warn('population', `Failed to fetch claimable rewards for ${toHolder.owner}: ${error.message}`, {}, 'eth', contractKeyLower);
            }
          }

          if (contractKeyLower === 'ascendant') {
            try {
              const recordResult = await retry(
                () => client.readContract({
                  address: contractAddress,
                  abi: getContractAbi(contractKeyLower, 'nft'),
                  functionName: 'userRecords',
                  args: [BigInt(transfer.tokenId)],
                }),
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              if (Array.isArray(recordResult)) {
                toHolder.shares += parseFloat(formatUnits(recordResult[0] || 0, 18));
                toHolder.lockedAscendant += parseFloat(formatUnits(recordResult[1] || 0, 18));
              }
            } catch (error) {
              errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_records', tokenId: transfer.tokenId, error: error.message });
              logger.warn('population', `Failed to fetch records for transfer tokenId ${transfer.tokenId}: ${error.message}`, {}, 'eth', contractKeyLower);
            }

            try {
              const claimableResult = await retry(
                () => client.readContract({
                  address: contractAddress,
                  abi: getContractAbi(contractKeyLower, 'nft'),
                  functionName: 'batchClaimableAmount',
                  args: [toHolder.tokenIds.map(id => BigInt(id))],
                }),
                { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
              );
              toHolder.claimableRewards = parseFloat(formatUnits(claimableResult || 0, 18));
            } catch (error) {
              errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_claimable', wallet: toHolder.owner, error: error.message });
              logger.warn('population', `Failed to fetch claimable rewards for ${toHolder.owner}: ${error.message}`, {}, 'eth', contractKeyLower);
            }

            const totalSharesRaw = await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'totalShares' });
                if (result === null || result === undefined) throw new Error('totalShares returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            );
            const totalShares = parseFloat(formatUnits(totalSharesRaw, 18));

            const toDistributeDay8 = parseFloat(formatUnits(await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [0] });
                if (result === null || result === undefined) throw new Error('toDistribute day8 returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            ), 18));

            const toDistributeDay28 = parseFloat(formatUnits(await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [1] });
                if (result === null || result === undefined) throw new Error('toDistribute day28 returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            ), 18));

            const toDistributeDay90 = parseFloat(formatUnits(await retry(
              async () => {
                const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'toDistribute', args: [2] });
                if (result === null || result === undefined) throw new Error('toDistribute day90 returned null');
                return result;
              },
              { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
            ), 18));

            const pendingRewardPerShareDay8 = totalShares > 0 ? toDistributeDay8 / totalShares : 0;
            const pendingRewardPerShareDay28 = totalShares > 0 ? toDistributeDay28 / totalShares : 0;
            const pendingRewardPerShareDay90 = totalShares > 0 ? toDistributeDay90 / totalShares : 0;

            toHolder.pendingDay8 = toHolder.shares * pendingRewardPerShareDay8;
            toHolder.pendingDay28 = toHolder.shares * pendingRewardPerShareDay28;
            toHolder.pendingDay90 = toHolder.shares * pendingRewardPerShareDay90;
          }
          holdersMap.set(transfer.to, toHolder);
        }

        const holderList = Array.from(holdersMap.values());
        const totalMultiplierSum = holderList.reduce((sum, h) => sum + h.multiplierSum, 0);
        holderList.forEach(holder => {
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
          holder.displayMultiplierSum = holder.multiplierSum / (contractKeyLower === 'element280' ? 10 : 1);
          holder.rank = holderList.indexOf(holder) + 1;
        });

        let burnedCountContract;
        try {
          burnedCountContract = await retry(
            async () => {
              const result = await client.readContract({ address: contractAddress, abi: getContractAbi(contractKeyLower, 'nft'), functionName: 'totalBurned' });
              return Number(result);
            },
            { retries: config.alchemy.maxRetries, delay: config.alchemy.batchDelayMs }
          );
        } catch (error) {
          errorLog.push({ timestamp: new Date().toISOString(), phase: 'fetch_burned', error: error.message });
          logger.warn('population', `Failed to fetch totalBurned: ${error.message}`, {}, 'eth', contractKeyLower);
          burnedCountContract = 0;
        }
        totalBurned = burnedCountContract || totalBurned;

        cacheState.phase = 'Finalizing Cache';
        cacheState.progressPercentage = '90.0';
        await saveCacheState(contractKeyLower, cacheState);
        logger.debug('population', `Finalizing cache for ${contractKeyLower}`, {}, 'eth', contractKeyLower);

        const cacheData = {
          holders: sanitizeBigInt(holderList),
          totalBurned,
          totalTokens: holderList.reduce((sum, h) => sum + h.total, 0),
          totalPages: Math.ceil(holderList.length / config.contractDetails[contractKeyLower].pageSize),
          summary: {
            totalLive: holderList.reduce((sum, h) => sum + h.total, 0),
            totalBurned,
            totalMinted: config.nftContracts[contractKeyLower].expectedTotalSupply + config.nftContracts[contractKeyLower].expectedBurned,
            tierDistribution: holderList.reduce((acc, h) => {
              h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
              return acc;
            }, Array(Object.keys(config.nftContracts[contractKeyLower].tiers).length).fill(0)),
            multiplierPool: totalMultiplierSum,
          },
          globalMetrics: contractKeyLower === 'ascendant' ? cacheState.globalMetrics : { totalTokens: holderList.reduce((sum, h) => sum + h.total, 0) },
          timestamp: Date.now(),
        };
        await setLocalFileCache(`${contractKeyLower}_holders`, cacheData, 86400, contractKeyLower);
        cacheState.lastUpdated = Date.now();
        cacheState.totalOwners = holderList.length;
        cacheState.totalLiveHolders = holderList.length;
        cacheState.lastProcessedBlock = lastBlock;
        cacheState.phase = 'Completed';
        cacheState.progressPercentage = '100.0';
        cacheState.progressState = {
          step: 'completed',
          processedNfts: cacheState.progressState.totalNfts,
          totalNfts: cacheState.progressState.totalNfts,
          processedTiers: cacheState.progressState.totalTiers,
          totalTiers: cacheState.progressState.totalTiers,
          error: null,
          errorLog,
        };
        await saveCacheState(contractKeyLower, cacheState);
        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.info('population', `Cache population completed for ${contractKeyLower}: ${holderList.length} holders, ${totalBurned} burned, took ${elapsedTime}s`, {}, 'eth', contractKeyLower);
        return { status: 'updated', holders: holderList };
      } else {
        cacheState.isPopulating = false;
        cacheState.phase = 'Completed';
        cacheState.progressPercentage = '100.0';
        cacheState.lastProcessedBlock = Number(currentBlock);
        await saveCacheState(contractKeyLower, cacheState);
        logger.info('population', `Cache up to date for ${contractKeyLower}, no new events`, {}, 'eth', contractKeyLower);
        return { status: 'up_to_date', holders: cachedData.holders };
      }
    }

    logger.info('population', `No valid cache, performing full population for ${contractKeyLower}`, {}, 'eth', contractKeyLower);
    cacheState.phase = 'Full Population';
    cacheState.progressPercentage = '50.0';
    await saveCacheState(contractKeyLower, cacheState);

    const result = await getHoldersMap(contractKeyLower, cacheState);
    if (result.status === 'error') {
      logger.error('population', `getHoldersMap failed: ${result.error || 'Unknown error'}`, {}, 'eth', contractKeyLower);
      throw new Error(result.error || 'Failed to populate holders map');
    }

    const holderList = Array.from(result.holdersMap?.values() || []);
    const totalBurned = result.totalBurned || 0;

    cacheState.phase = 'Finalizing Cache';
    cacheState.progressPercentage = '90.0';
    await saveCacheState(contractKeyLower, cacheState);

    const cacheData = {
      holders: sanitizeBigInt(holderList),
      totalBurned,
      totalTokens: holderList.reduce((sum, h) => sum + h.total, 0),
      totalPages: Math.ceil(holderList.length / config.contractDetails[contractKeyLower].pageSize),
      summary: {
        totalLive: holderList.reduce((sum, h) => sum + h.total, 0),
        totalBurned,
        totalMinted: config.nftContracts[contractKeyLower].expectedTotalSupply + config.nftContracts[contractKeyLower].expectedBurned,
        tierDistribution: holderList.reduce((acc, h) => {
          h.tiers.forEach((count, i) => acc[i] = (acc[i] || 0) + count);
          return acc;
        }, Array(Object.keys(config.nftContracts[contractKeyLower].tiers).length).fill(0)),
        multiplierPool: holderList.reduce((sum, h) => sum + h.multiplierSum, 0),
      },
      globalMetrics: result.globalMetrics || {},
      timestamp: Date.now(),
    };
    await setLocalFileCache(`${contractKeyLower}_holders`, cacheData, 86400, contractKeyLower);
    cacheState.lastUpdated = Date.now();
    cacheState.totalOwners = holderList.length;
    cacheState.totalLiveHolders = holderList.length;
    cacheState.lastProcessedBlock = result.lastProcessedBlock || cacheState.lastProcessedBlock;
    cacheState.phase = 'Completed';
    cacheState.progressPercentage = '100.0';
    cacheState.progressState = {
      step: 'completed',
      processedNfts: cacheState.progressState.totalNfts,
      totalNfts: cacheState.progressState.totalNfts,
      processedTiers: cacheState.progressState.totalTiers,
      totalTiers: cacheState.progressState.totalTiers,
      error: null,
      errorLog,
    };
    await saveCacheState(contractKeyLower, cacheState);
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info('population', `Full cache population completed for ${contractKeyLower}: ${holderList.length} holders, ${totalBurned} burned, took ${elapsedTime}s`, {}, 'eth', contractKeyLower);
    return { status: 'updated', holders: holderList };
  } catch (error) {
    cacheState.isPopulating = false;
    cacheState.error = error.message;
    cacheState.errorLog = errorLog.length > 0 ? errorLog : [error.message];
    cacheState.phase = 'Error';
    cacheState.progressPercentage = cacheState.progressPercentage || '0.0';
    await saveCacheState(contractKeyLower, cacheState);
    logger.error('population', `Cache population failed for ${contractKeyLower}: ${error.message}`, { stack: error.stack }, 'eth', contractKeyLower);
    return { status: 'error', error: error.message, holders: null };
  }
}