// app/api/holders/utils/holders.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import config from '@/contracts/config';
import { getContractAbi, getRewardFunction, getTierFunction, getBatchTokenDataFunction, commonFunctions } from '@/contracts/abi';
import { logger } from '@/app/utils/logger';
import { cache, saveCacheState } from './cache';
import { alchemy } from '../../utils';

// Lock to prevent concurrent cache population
const populationLocks = new Map();

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`),
});

// Fetch burn events (Transfer to 0x0)
async function getBurnedCount(contractAddress, deploymentBlock, contractKey) {
  logger.debug('holders', `Fetching burn events for ${contractAddress}`, {}, 'eth', contractKey);
  try {
    const filter = {
      address: contractAddress,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event
        null, // from
        '0x0000000000000000000000000000000000000000', // to (zero address)
      ],
      fromBlock: deploymentBlock,
      toBlock: 'latest',
    };
    const logs = await client.getLogs({ ...filter });
    logger.info('holders', `Fetched ${logs.length} burn events for ${contractAddress}`, {}, 'eth', contractKey);
    return logs.length;
  } catch (error) {
    logger.error('holders', `Failed to fetch burn events for ${contractAddress}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    return 0;
  }
}

export async function getHoldersMap(contractKey, cacheState) {
  const cacheKey = `holders_${contractKey}`;
  logger.info('holders', `Starting getHoldersMap for ${contractKey}`, {}, 'eth', contractKey);

  try {
    // Check for existing lock
    if (populationLocks.get(contractKey)) {
      logger.warn('holders', `Cache population already in progress for ${contractKey}`, {}, 'eth', contractKey);
      return { status: 'error', error: 'Cache population in progress', holders: null };
    }
    populationLocks.set(contractKey, true);
    logger.debug('holders', `Acquired population lock for ${contractKey}`, {}, 'eth', contractKey);

    // Check cache
    const cachedData = cache.get(cacheKey);
    if (cachedData && !cacheState.error) {
      logger.info('holders', `Cache hit for ${contractKey}`, {}, 'eth', contractKey);
      populationLocks.delete(contractKey);
      return { status: 'success', ...cachedData };
    }
    logger.info('holders', `Cache miss for ${contractKey}, proceeding with population`, {}, 'eth', contractKey);

    // Validate contract configuration
    const contractConfig = config.nftContracts[contractKey];
    const contractAddress = config.contractAddresses[contractKey]?.address;
    const vaultAddress = config.vaultAddresses[contractKey]?.address;
    const deploymentBlock = config.deploymentBlocks[contractKey]?.block;
    if (!contractConfig || !contractAddress || (contractKey !== 'ascendant' && !vaultAddress)) {
      const errorMsg = `${contractKey} configuration missing: ${JSON.stringify({ contractConfig: !!contractConfig, contractAddress, vaultAddress })}`;
      logger.error('holders', errorMsg, {}, 'eth', contractKey);
      throw new Error(errorMsg);
    }
    logger.debug('holders', `Contract configuration: address=${contractAddress}, vault=${vaultAddress || 'none'}`, {}, 'eth', contractKey);

    // Update cache state
    cacheState.phase = 'Fetching Supply';
    cacheState.progressPercentage = '5.0';
    await saveCacheState(contractKey, cacheState);
    logger.debug('holders', `Updated cache state to Fetching Supply`, {}, 'eth', contractKey);

    // Get total live supply
    let totalSupply;
    if (contractKey === 'ascendant') {
      try {
        logger.debug('holders', `Fetching tokenId for ${contractKey}`, {}, 'eth', contractKey);
        totalSupply = await client.readContract({
          address: contractAddress,
          abi: getContractAbi(contractKey, 'nft'),
          functionName: commonFunctions.tokenId.name,
        });
        totalSupply = Number(totalSupply);
        if (totalSupply === 0) {
          logger.warn('holders', `Zero tokenId for ${contractKey}, possible contract issue`, {}, 'eth', contractKey);
        }
        logger.info('holders', `Fetched tokenId: ${totalSupply}`, {}, 'eth', contractKey);
      } catch (error) {
        logger.error('holders', `Failed to fetch tokenId: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
        throw new Error(`Failed to fetch tokenId: ${error.message}`);
      }
    } else {
      try {
        logger.debug('holders', `Fetching totalSupply for ${contractKey}`, {}, 'eth', contractKey);
        totalSupply = await client.readContract({
          address: contractAddress,
          abi: getContractAbi(contractKey, 'nft'),
          functionName: commonFunctions.totalSupply.name,
        });
        totalSupply = Number(totalSupply);
        logger.info('holders', `Fetched totalSupply: ${totalSupply}`, {}, 'eth', contractKey);
      } catch (error) {
        logger.error('holders', `Failed to fetch totalSupply: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
        throw new Error(`Failed to fetch totalSupply: ${error.message}`);
      }
    }

    // Get total burned supply
    let totalBurned = 0;
    if (contractKey === 'element280') {
      totalBurned = await getBurnedCount(contractAddress, deploymentBlock, contractKey);
      logger.info('holders', `Fetched burned count: ${totalBurned}`, {}, 'eth', contractKey);
    } else if (contractKey === 'stax') {
      try {
        logger.debug('holders', `Fetching totalBurned for ${contractKey}`, {}, 'eth', contractKey);
        totalBurned = await client.readContract({
          address: contractAddress,
          abi: getContractAbi(contractKey, 'nft'),
          functionName: commonFunctions.totalBurned.name,
        });
        totalBurned = Number(totalBurned);
        logger.info('holders', `Fetched totalBurned: ${totalBurned}`, {}, 'eth', contractKey);
      } catch (error) {
        logger.warn('holders', `totalBurned contract call failed, falling back to Transfer events`, {}, 'eth', contractKey);
        totalBurned = await getBurnedCount(contractAddress, deploymentBlock, contractKey);
      }
    }
    // Skip burns for Element369 and Ascendant

    // Use hardcoded totalMinted or estimate
    let totalMinted = contractConfig.totalMinted;
    if (!totalMinted) {
      totalMinted = totalSupply;
      logger.info('holders', `Estimated totalMinted: ${totalMinted}`, {}, 'eth', contractKey);
    }

    cacheState.totalNfts = totalMinted;
    cacheState.progressState.totalNfts = totalMinted;
    cacheState.phase = 'Fetching Owners';
    cacheState.progressPercentage = '10.0';
    await saveCacheState(contractKey, cacheState);
    logger.debug('holders', `Updated cache state to Fetching Owners`, {}, 'eth', contractKey);

    // Fetch owners via Alchemy
    let ownersResponse;
    try {
      logger.debug('holders', `Calling Alchemy getOwnersForContract for ${contractAddress}`, {}, 'eth', contractKey);
      ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, {
        block: 'latest',
        withTokenBalances: true,
      });
      logger.info('holders', `Fetched ${ownersResponse.owners.length} owners`, {}, 'eth', contractKey);
    } catch (error) {
      logger.error('holders', `Failed to fetch owners: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
      throw new Error(`Failed to fetch owners: ${error.message}`);
    }

    const burnAddresses = [config.burnAddress, '0x000000000000000000000000000000000000dead'];
    const holdersMap = new Map();
    const tierMap = new Map();
    let processedNfts = 0;

    for (const owner of ownersResponse.owners) {
      const wallet = owner.ownerAddress.toLowerCase();
      if (burnAddresses.includes(wallet)) continue;

      const tokenIds = owner.tokenBalances.map(tb => Number(tb.tokenId)).filter(id => id <= totalMinted);
      if (tokenIds.length === 0) continue;

      let batchTiers = [];
      const tierFunction = getTierFunction(contractKey);
      if (contractKey === 'ascendant') {
        logger.debug('holders', `Fetching tiers for ${tokenIds.length} tokens for wallet ${wallet}`, {}, 'eth', contractKey);
        batchTiers = await Promise.all(
          tokenIds.map(async (tokenId) => {
            try {
              const attr = await client.readContract({
                address: contractAddress,
                abi: getContractAbi(contractKey, 'nft'),
                functionName: tierFunction.name,
                args: [tokenId],
              });
              return attr[1]; // tier is in attributes[1]
            } catch (error) {
              logger.warn('holders', `Failed to fetch tier for tokenId ${tokenId}: ${error.message}`, {}, 'eth', contractKey);
              return 0; // Invalid token
            }
          })
        );
      } else {
        const batchTokenDataFunction = getBatchTokenDataFunction(contractKey);
        if (!batchTokenDataFunction) {
          logger.error('holders', `Batch token data function not supported for ${contractKey}`, {}, 'eth', contractKey);
          throw new Error(`Batch token data function not supported for ${contractKey}`);
        }
        try {
          logger.debug('holders', `Fetching batch token data for ${tokenIds.length} tokens`, {}, 'eth', contractKey);
          const tokenData = await client.readContract({
            address: contractAddress,
            abi: getContractAbi(contractKey, 'nft'),
            functionName: batchTokenDataFunction.name,
            args: contractKey === 'element280' ? [tokenIds, wallet] : [tokenIds],
          });
          batchTiers = contractKey === 'element280' ? tokenData[1] : tokenData[0]; // multipliers or tiers
        } catch (error) {
          logger.warn('holders', `Failed to fetch batch token data: ${error.message}`, {}, 'eth', contractKey);
          batchTiers = tokenIds.map(() => 0);
        }
      }

      let batchClaimable = [];
      const rewardFunction = getRewardFunction(contractKey);
      if (contractKey === 'ascendant') {
        try {
          logger.debug('holders', `Fetching claimable rewards for ${tokenIds.length} tokens`, {}, 'eth', contractKey);
          const claimable = await client.readContract({
            address: contractAddress,
            abi: getContractAbi(contractKey, 'nft'),
            functionName: rewardFunction.name,
            args: [tokenIds],
          });
          batchClaimable = tokenIds.map(() => Number(claimable) / tokenIds.length / 1e18);
        } catch (error) {
          logger.warn('holders', `Failed to fetch claimable rewards: ${error.message}`, {}, 'eth', contractKey);
          batchClaimable = tokenIds.map(() => 0);
        }
      } else {
        try {
          logger.debug('holders', `Fetching claimable rewards for ${tokenIds.length} tokens from vault`, {}, 'eth', contractKey);
          const rewards = await client.readContract({
            address: vaultAddress,
            abi: getContractAbi(contractKey, 'vault'),
            functionName: rewardFunction.name,
            args: contractKey === 'element369' ? [tokenIds, wallet, false] : [tokenIds, wallet],
          });
          const rewardIndex = contractKey === 'element369' ? 3 : 1; // e280Pool for element369
          batchClaimable = rewards[0].map((avail, idx) => (avail ? Number(rewards[rewardIndex]) / 1e18 : 0));
        } catch (error) {
          logger.warn('holders', `Failed to fetch claimable rewards: ${error.message}`, {}, 'eth', contractKey);
          batchClaimable = tokenIds.map(() => 0);
        }
      }

      const holderData = { tokens: [], tiers: new Map(), claimable: 0 };
      tokenIds.forEach((tokenId, idx) => {
        const tier = Number(batchTiers[idx]);
        const claimable = batchClaimable[idx] || 0;

        if (tier > 0) {
          holderData.tokens.push(tokenId);
          holderData.tiers.set(tier, (holderData.tiers.get(tier) || 0) + 1);
          holderData.claimable += claimable;

          tierMap.set(tier, (tierMap.get(tier) || 0) + 1);
        }
      });

      if (holderData.tokens.length > 0) {
        holdersMap.set(wallet, holderData);
      }

      processedNfts += tokenIds.length;
      cacheState.progressState.processedNfts = processedNfts;
      cacheState.progressPercentage = ((processedNfts / totalMinted) * 100).toFixed(1);
      cacheState.phase = 'Processing Holders';
      await saveCacheState(contractKey, cacheState);
      logger.debug('holders', `Processed ${processedNfts}/${totalMinted} NFTs, progress: ${cacheState.progressPercentage}%`, {}, 'eth', contractKey);
    }

    const holders = Array.from(holdersMap.entries()).map(([owner, data]) => ({
      owner,
      tokens: data.tokens,
      tiers: Object.fromEntries(data.tiers),
      claimable: data.claimable.toFixed(4),
    }));

    const result = {
      holders,
      totalMinted,
      totalLive: Number(totalSupply),
      totalBurned: ['element280', 'stax'].includes(contractKey) ? totalBurned : null, // Only for Element280 and Stax
      totalHolders: holdersMap.size,
      tierMap: Object.fromEntries(tierMap),
    };

    cache.set(cacheKey, result);
    cacheState.isPopulating = false;
    cacheState.phase = 'Completed';
    cacheState.progressPercentage = '100.0';
    cacheState.totalHolders = holdersMap.size;
    cacheState.totalLive = Number(totalSupply);
    await saveCacheState(contractKey, cacheState);
    logger.info('holders', `Completed cache population: ${holders.length} holders`, {}, 'eth', contractKey);
    populationLocks.delete(contractKey);
    return { status: 'success', ...result };
  } catch (error) {
    cacheState.error = error.message;
    cacheState.phase = 'Error';
    cacheState.progressState.error = error.message;
    cacheState.isPopulating = false;
    cacheState.errorLog = cacheState.errorLog ? [...cacheState.errorLog, error.message] : [error.message];
    await saveCacheState(contractKey, cacheState);
    logger.error('holders', `getHoldersMap failed: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    populationLocks.delete(contractKey);
    return { status: 'error', error: error.message, holders: null };
  }
}