// app/api/holders/shared.js
import { alchemy } from '@/app/api/utils/client';
import { getCache, setCache } from '@/app/api/utils/cache';
import { logger } from '@/app/lib/logger';
import { getHoldersMap } from '@/app/api/holders/cache/holders';
import { HoldersResponseSchema } from '@/app/lib/schemas';
import { CACHE_TTL } from '@/app/lib/constants';
import config from '@/app/contracts_nft';
import { getContractAbi, commonFunctions } from '@/app/contracts_nft';
import { batchMulticall } from '@/app/api/holders/blockchain/multicall';
import { getCacheState } from '@/app/api/holders/cache/state';
import { sanitizeBigInt } from '@/app/api/holders/cache/holders';
import { createPublicClient, http, getAddress } from 'viem';
import { mainnet } from 'viem/chains';
import pLimit from 'p-limit';

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`, { timeout: 60000 }),
});

export async function fetchContractState(contractKey, contractAddress, vaultAddress, vaultAbi) {
  const calls = [
    { address: contractAddress, abi: getContractAbi(contractKey, 'nft'), functionName: commonFunctions.totalSupply.name },
    { address: contractAddress, abi: getContractAbi(contractKey, 'nft'), functionName: commonFunctions.totalBurned.name },
    ...(vaultAddress && vaultAbi ? [
      { address: vaultAddress, abi: vaultAbi, functionName: 'totalE280Burned' },
      { address: vaultAddress, abi: vaultAbi, functionName: 'totalRewardsPaid' },
      { address: vaultAddress, abi: vaultAbi, functionName: 'totalRewardPool' },
    ] : []),
  ];

  const results = await batchMulticall(calls);
  logger.debug('holders', `fetchContractState results for ${contractKey}: ${JSON.stringify(sanitizeBigInt(results))}`, 'ETH', contractKey);

  return sanitizeBigInt({
    totalSupply: results[0]?.status === 'success' && results[0].result != null ? Number(results[0].result) : 0,
    totalBurned: results[1]?.status === 'success' && results[1].result != null ? Number(results[1].result) : 0,
    totalE280Burned: vaultAddress && results[2]?.status === 'success' ? Number(results[2].result) / 1e18 : 0,
    totalRewardsPaid: vaultAddress && results[3]?.status === 'success' ? Number(results[3].result) / 1e18 : 0,
    totalRewardPool: vaultAddress && results[4]?.status === 'success' ? Number(results[4].result) / 1e18 : 0,
  });
}

export async function getAllHolders(contractKey, contractAddress, vaultAddress, vaultAbi, tiers, page = 0, pageSize = 1000) {
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();
  const cacheData = await getCache(cacheKey, contractKey, 'holders');

  if (cacheData && now - cacheData.timestamp < CACHE_TTL) {
    logger.info('holders', `Cache hit: ${cacheKey}`, 'ETH', contractKey);
    return cacheData.data;
  }

  const state = await fetchContractState(contractKey, contractAddress, vaultAddress, vaultAbi);
  const cacheState = await getCacheState(contractKey.toLowerCase());
  const { holders, totalBurned, lastBlock, errorLog } = await getHoldersMap(
    contractKey,
    contractAddress,
    getContractAbi(contractKey, 'nft'),
    vaultAddress,
    vaultAbi,
    cacheState
  );

  const safeLastBlock = typeof lastBlock === 'number' && !isNaN(lastBlock) && lastBlock >= 0 ? lastBlock : 0;
  const totalBurnedSafe = typeof totalBurned === 'number' && !isNaN(totalBurned) && totalBurned >= 0 ? totalBurned : state.totalBurned || 0;
  const transferData = await getCache(`${contractAddress}-transfers`, contractKey, 'transfers') || { buys: [], sells: [], burns: [] };
  const totalTokens = state.totalSupply || 0;
  const totalMinted = totalTokens + totalBurnedSafe;
  const maxTier = Math.max(...Object.keys(tiers).map(Number), 0);
  const tierDistribution = Array(maxTier + 1).fill(0);

  const validHolders = holders.filter(holder => holder && typeof holder.wallet === 'string' && /^0x[a-fA-F0-9]{40}$/.test(holder.wallet));
  validHolders.forEach(holder => {
    holder.tiers = holder.tiers || Array(maxTier + 1).fill(0);
    holder.tiers.forEach((count, tier) => tierDistribution[tier] += count);
    holder.boughtNfts = transferData.buys
      .filter(t => t.to.toLowerCase() === holder.wallet.toLowerCase())
      .map(t => ({ tokenId: t.tokenId, transactionHash: t.transactionHash || '', timestamp: t.timestamp || 0 }));
    holder.soldNfts = transferData.sells
      .filter(t => t.from.toLowerCase() === holder.wallet.toLowerCase())
      .map(t => ({ tokenId: t.tokenId, transactionHash: t.transactionHash || '', timestamp: t.timestamp || 0 }));
    holder.burnedNfts = transferData.burns
      .filter(t => t.from.toLowerCase() === holder.wallet.toLowerCase())
      .map(t => ({ tokenId: t.tokenId, transactionHash: t.transactionHash || '', timestamp: t.timestamp || 0 }));
    holder.buyCount = holder.boughtNfts.length;
    holder.sellCount = holder.soldNfts.length;
    holder.burnCount = holder.burnedNfts.length;
    holder.rank = holder.rank || 0;
    holder.percentage = holder.percentage || 0;
    holder.multiplierSum = holder.multiplierSum || 0;
    holder.displayMultiplierSum = holder.displayMultiplierSum || holder.multiplierSum;
    holder.claimableRewards = holder.claimableRewards || 0;
  });

  const totalMultiplierSum = validHolders.reduce((sum, h) => sum + h.multiplierSum, 0);
  validHolders.forEach((holder, index) => {
    holder.rank = index + 1;
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
  });

  const startPage = page * pageSize;
  const paginatedHolders = validHolders.slice(startPage, startPage + pageSize);
  const totalPages = Math.ceil(validHolders.length / pageSize) || 1;

  const result = {
    status: 'success',
    holders: paginatedHolders,
    totalPages,
    totalTokens,
    totalBurned: totalBurnedSafe,
    lastBlock: safeLastBlock,
    errorLog: errorLog || cacheState.progressState.errorLog || [],
    contractKey,
    summary: {
      totalLive: totalTokens,
      totalBurned: totalBurnedSafe,
      totalMinted,
      totalE280Burned: state.totalE280Burned || 0,
      totalRewardsPaid: state.totalRewardsPaid || 0,
      totalRewardPool: state.totalRewardPool || 0,
      tierDistribution,
      multiplierPool: totalMultiplierSum,
    },
    transferSummary: {
      buyCount: transferData.buys?.length || 0,
      sellCount: transferData.sells?.length || 0,
      burnCount: transferData.burns?.length || 0,
    },
    globalMetrics: cacheState.globalMetrics || { totalMinted, totalLive: totalTokens, totalBurned: totalBurnedSafe, tierDistribution },
  };

  const sanitizedResult = sanitizeBigInt(result);
  HoldersResponseSchema.parse(sanitizedResult);
  await setCache(cacheKey, { timestamp: now, data: sanitizedResult }, CACHE_TTL, contractKey, 'holders');
  await setCache('summary', { timestamp: now, data: sanitizedResult.summary }, CACHE_TTL, contractKey, 'summary');
  logger.info('holders', `getAllHolders completed: ${paginatedHolders.length} holders, totalPages=${totalPages}`, 'ETH', contractKey);
  return sanitizedResult;
}

export async function getHolderData(contractKey, contractAddress, wallet, tiers, vaultAddress, vaultAbi) {
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();
  const cacheData = await getCache(cacheKey, contractKey, 'holders');

  if (cacheData && now - cacheData.timestamp < CACHE_TTL) {
    logger.info('holders', `Cache hit: ${cacheKey}`, 'ETH', contractKey);
    return cacheData.data;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid wallet address');
  if (!vaultAddress || !vaultAbi) throw new Error('Vault configuration missing');

  const walletLower = getAddress(wallet).toLowerCase();
  const client = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`, { timeout: 60000 }),
  });

  const ownerCacheKey = `${contractAddress}-owner-${walletLower}`;
  const ownerCache = await getCache(ownerCacheKey, contractKey, 'owners');
  let nfts;
  if (ownerCache && now - ownerCache.timestamp < CACHE_TTL) {
    nfts = ownerCache.data;
    logger.info('holders', `Owner cache hit: ${ownerCacheKey}`, 'ETH', contractKey);
  } else {
    logger.debug('holders', `Fetching NFTs for wallet=${walletLower}`, 'ETH', contractKey);
    nfts = await alchemy.nft.getNftsForOwner(walletLower, { contractAddresses: [contractAddress] });
    await setCache(ownerCacheKey, { timestamp: now, data: nfts }, CACHE_TTL, contractKey, 'owners');
    logger.debug('holders', `Fetched ${nfts.totalCount} NFTs for wallet=${walletLower}`, 'ETH', contractKey);
  }

  if (nfts.totalCount === 0) {
    logger.info('holders', `No NFTs found for wallet=${walletLower}`, 'ETH', contractKey);
    return null;
  }

  const tokenIds = nfts.ownedNfts.map(nft => Number(nft.tokenId));
  const isAscendant = contractKey.toLowerCase() === 'ascendant';
  const tierFunction = isAscendant ? 'getNFTAttribute' : 'getNftTier';

  logger.debug('holders', `Starting tier fetching for wallet=${walletLower}, tokenIds=${tokenIds.join(',')}`, 'ETH', contractKey);
  let decimals = 18;
  try {
    const e280Result = await client.multicall({
      contracts: [{ address: vaultAddress, abi: vaultAbi, functionName: 'E280' }],
      multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
      allowFailure: true,
    });
    const e280Address = e280Result[0]?.status === 'success' ? e280Result[0].result : null;
    if (e280Address && /^0x[a-fA-F0-9]{40}$/.test(e280Address)) {
      const decimalsResult = await client.multicall({
        contracts: [
          { address: e280Address, abi: [{ inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' }], functionName: 'decimals' },
        ],
        multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
        allowFailure: true,
      });
      decimals = decimalsResult[0]?.status === 'success' ? Number(decimalsResult[0].result) : 18;
      logger.debug('holders', `E280 token decimals: ${decimals}`, 'ETH', contractKey);
    }
  } catch (error) {
    logger.error('holders', `Failed to fetch E280 decimals: ${error.message}`, { stack: error.stack }, 'ETH', contractKey);
  }

  const calls = [];
  tokenIds.forEach(tokenId => {
    calls.push({ address: contractAddress, abi: getContractAbi(contractKey, 'nft'), functionName: 'ownerOf', args: [BigInt(tokenId)] });
    calls.push({ address: contractAddress, abi: getContractAbi(contractKey, 'nft'), functionName: tierFunction, args: [BigInt(tokenId)] });
    calls.push({ address: vaultAddress, abi: vaultAbi, functionName: 'claimedCycles', args: [BigInt(tokenId)] });
  });
  calls.push({ address: vaultAddress, abi: vaultAbi, functionName: 'currentCycle' });
  calls.push({ address: vaultAddress, abi: vaultAbi, functionName: 'totalRewardPool' });

  const results = await client.multicall({
    contracts: calls,
    multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
    allowFailure: true,
  });
  let resultIndex = 0;

  const validTokenIds = [];
  for (let i = 0; i < tokenIds.length; i++) {
    const ownerResult = results[resultIndex++];
    if (ownerResult?.status === 'success' && ownerResult.result.toLowerCase() === walletLower) {
      validTokenIds.push(tokenIds[i]);
    }
  }

  if (validTokenIds.length === 0) {
    logger.info('holders', `No valid NFTs owned by wallet=${walletLower}`, 'ETH', contractKey);
    return null;
  }

  const maxTier = Math.max(...Object.keys(tiers).map(Number), 0);
  const tiersArray = Array(maxTier + 1).fill(0);
  let total = 0;
  let multiplierSum = 0;
  const tokens = [];
  for (let i = 0; i < tokenIds.length; i++) {
    const tierResult = results[resultIndex++];
    const tokenId = tokenIds[i];
    if (validTokenIds.includes(tokenId) && tierResult?.status === 'success') {
      let tier = isAscendant ? Number(tierResult.result[1]) : Number(tierResult.result);
      if (tier >= 1 && tier <= maxTier) {
        tiersArray[tier] += 1;
        total += 1;
        multiplierSum += tiers[tier]?.multiplier || 0;
        tokens.push({ tokenId, tier, rarityNumber: tiers[tier]?.multiplier || 0, rarity: tier });
        logger.debug('holders', `Fetched tier for tokenId=${tokenId}: tier=${tier}, multiplier=${tiers[tier]?.multiplier || 0}`, 'ETH', contractKey);
      }
    }
  }
  logger.debug('holders', `Completed tier fetching for wallet=${walletLower}: totalTokens=${total}, tiers=${JSON.stringify(tiersArray)}`, 'ETH', contractKey);

  const claimedCycles = [];
  for (let i = 0; i < tokenIds.length; i++) {
    const cycleResult = results[resultIndex++];
    claimedCycles.push(cycleResult?.status === 'success' ? Number(cycleResult.result) : 0);
  }

  const currentCycle = results[resultIndex++]?.status === 'success' ? Number(results[resultIndex - 1].result) : 0;
  const totalRewardPool = results[resultIndex++]?.status === 'success' ? Number(results[resultIndex - 1].result) / 10 ** decimals : 0;

  const eligibleTokens = validTokenIds.filter((tokenId, i) => claimedCycles[i] < currentCycle);
  logger.debug('holders', `Starting claimable rewards calculation for wallet=${walletLower}, eligibleTokens=${eligibleTokens.length}`, 'ETH', contractKey);

  let claimableRewards = 0;
  const tokenChunks = eligibleTokens.reduce((chunks, id, idx) => {
    if (idx % 100 === 0) chunks.push([]);
    chunks[chunks.length - 1].push(BigInt(id));
    return chunks;
  }, []);

  const tokenCacheKeys = tokenIds.map(id => `${contractAddress}-token-${id}`);
  const tokenCaches = await Promise.all(tokenCacheKeys.map(key => getCache(key, contractKey, 'tokens')));
  const cachedRewards = tokenCaches.map(cache => cache?.data?.reward || 0);
  claimableRewards += cachedRewards.reduce((sum, reward) => sum + reward, 0);
  logger.debug('holders', `Cached rewards for wallet=${walletLower}: ${claimableRewards} ELMNT`, 'ETH', contractKey);

  const uncachedChunks = tokenChunks.filter((chunk, i) => !tokenCaches[i] || !tokenCaches[i].data?.reward);
  const limit = pLimit(50);
  const rewardPromises = uncachedChunks.map((chunk, i) => limit(async () => {
    const rewardCall = {
      address: vaultAddress,
      abi: vaultAbi,
      functionName: 'getRewards',
      args: [chunk, walletLower],
    };
    try {
      const rewardResult = await client.multicall({
        contracts: [rewardCall],
        multicallAddress: '0xcA11bde05977b3631167028862bE2a173976CA11',
        allowFailure: true,
      });
      if (rewardResult[0]?.status === 'success' && rewardResult[0].result) {
        const [, totalReward] = rewardResult[0].result;
        const rewardEth = Number(totalReward) / 10 ** decimals;
        logger.debug('holders', `Chunk ${i + 1}: ${chunk.length} tokens, totalReward=${rewardEth} ELMNT, tokenIds=${chunk.join(',')}`, 'ETH', contractKey);
        chunk.forEach(tokenId => {
          const tokenIndex = tokenIds.indexOf(Number(tokenId));
          if (tokenIndex !== -1) {
            setCache(`${contractAddress}-token-${tokenId}`, {
              timestamp: now,
              data: { claimedCycles: claimedCycles[tokenIndex], reward: rewardEth / chunk.length },
            }, CACHE_TTL, contractKey, 'tokens');
          }
        });
        return rewardEth;
      }
      logger.warn('holders', `getRewards failed for chunk ${i + 1}`, 'ETH', contractKey);
      return 0;
    } catch (error) {
      logger.error('holders', `Error fetching getRewards for chunk ${i + 1}: ${error.message}`, { stack: error.stack }, 'ETH', contractKey);
      return 0;
    }
  }));
  const rewardResults = await Promise.all(rewardPromises);
  claimableRewards += rewardResults.reduce((sum, reward) => sum + reward, 0);
  logger.debug('holders', `Completed claimable rewards calculation for wallet=${walletLower}: totalRewards=${claimableRewards} ELMNT`, 'ETH', contractKey);

  const transferData = await getCache(`${contractAddress}-transfers`, contractKey, 'transfers') || { buys: [], sells: [], burns: [] };
  const boughtNfts = transferData.buys.filter(t => t.to.toLowerCase() === walletLower).map(t => ({ tokenId: t.tokenId, transactionHash: t.transactionHash || '', timestamp: t.timestamp || 0 }));
  const soldNfts = transferData.sells.filter(t => t.from.toLowerCase() === walletLower).map(t => ({ tokenId: t.tokenId, transactionHash: t.transactionHash || '', timestamp: t.timestamp || 0 }));
  const burnedNfts = transferData.burns.filter(t => t.from.toLowerCase() === walletLower).map(t => ({ tokenId: t.tokenId, transactionHash: t.transactionHash || '', timestamp: t.timestamp || 0 }));

  const summaryCache = await getCache(`${contractAddress}-summary`, contractKey, 'summary');
  const totalMultiplierSum = summaryCache?.data?.multiplierPool || 1000;
  const percentage = totalMultiplierSum > 0 ? (multiplierSum / totalMultiplierSum) * 100 : 0;
  const rank = summaryCache?.data?.holders?.find(h => h.wallet === walletLower)?.rank || 1;

  const result = {
    wallet: walletLower,
    rank,
    total,
    multiplierSum,
    displayMultiplierSum: multiplierSum / (contractKey.toLowerCase() === 'ascendant' ? 1 : 10),
    percentage,
    tiers: tiersArray,
    claimableRewards,
    buyCount: boughtNfts.length,
    sellCount: soldNfts.length,
    burnCount: burnedNfts.length,
    boughtNfts,
    soldNfts,
    burnedNfts,
    tokens,
  };

  HoldersResponseSchema.parse({
    status: 'success',
    holders: [result],
    totalPages: 1,
    totalTokens: total,
    totalBurned: summaryCache?.data?.totalBurned || 0,
    lastBlock: summaryCache?.data?.lastBlock || 0,
    errorLog: [],
    contractKey,
    summary: summaryCache?.data || { totalLive: total, totalBurned: 0, totalMinted: total, tierDistribution: tiersArray, multiplierPool: totalMultiplierSum },
    globalMetrics: summaryCache?.data?.globalMetrics || {},
  });

  await setCache(cacheKey, { timestamp: now, data: result }, CACHE_TTL, contractKey, 'holders');
  logger.info('holders', `getHolderData completed for wallet=${walletLower}, claimableRewards=${claimableRewards}, totalTokens=${total}`, 'ETH', contractKey);
  return result;
}