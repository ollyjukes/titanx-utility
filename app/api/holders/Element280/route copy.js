import { NextResponse } from 'next/server';
import { alchemy, client, CACHE_TTL, log } from '@/app/api/utils';
import { contractAddresses, contractTiers, vaultAddresses, element280MainAbi, element280VaultAbi } from '@/app/nft-contracts';
import pLimit from 'p-limit';

// In-memory cache
let cache = {};
let tokenCache = new Map();
let holdersMapCache = null;
let isCachePopulating = false;
let totalOwners = 0;

// Export cache state for /progress route
export function getCacheState() {
  return { isCachePopulating, holdersMapCache, totalOwners };
}

// Utility to serialize BigInt values
function serializeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )
  );
}

// Retry utility with increased timeout
async function retry(fn, attempts = 5, delay = (retryCount, error) => (error?.details?.code === 429 ? 4000 * 2 ** retryCount : 2000), strict = true) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) {
        if (strict) {
          log(`Failed after ${attempts} attempts: ${error.message}`);
          throw error;
        }
        log(`Non-strict retry failed after ${attempts} attempts: ${error.message}`);
        return null;
      }
      log(`Retry ${i + 1}/${attempts}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay(i, error)));
    }
  }
}

// Validate token ownership
async function validateTokenOwnership(contractAddress, wallet, tokenIds) {
  const cacheKey = `${contractAddress}-${wallet}-ownership-${tokenIds.join(',')}`;
  if (tokenCache.has(cacheKey)) {
    log(`validateTokenOwnership: Cache hit for ${cacheKey}`);
    return tokenCache.get(cacheKey);
  }

  const BATCH_SIZE = 50;
  const validTokenIds = [];
  for (let i = 0; i < tokenIds.length; i += BATCH_SIZE) {
    const batch = tokenIds.slice(i, i + BATCH_SIZE);
    const ownerOfCalls = batch.map(tokenId => ({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    }));

    try {
      const results = await retry(() => client.multicall({ contracts: ownerOfCalls }));
      batch.forEach((tokenId, index) => {
        const owner = results[index]?.status === 'success' && results[index].result?.toLowerCase();
        if (owner && owner === wallet.toLowerCase()) {
          validTokenIds.push(tokenId);
        }
      });
    } catch (error) {
      log(`validateTokenOwnership: Failed for batch ${batch.join(',')}: ${error.message}`);
      throw new Error(`Failed to validate token ownership: ${error.message}`);
    }
  }

  tokenCache.set(cacheKey, validTokenIds);
  log(`validateTokenOwnership: Cached ${cacheKey} with ${validTokenIds.length} valid tokenIds`);
  return validTokenIds;
}

// Populate holdersMapCache with deferred reward calculation
async function populateHoldersMapCache(contractAddress, tiers) {
  if (isCachePopulating) {
    log('populateHoldersMapCache: Cache population already in progress');
    return;
  }
  isCachePopulating = true;
  const contractName = 'element280';
  try {
    holdersMapCache = new Map();
    const burnAddress = '0x0000000000000000000000000000000000000000';
    let owners = [];

    console.log(`[${contractName}] Using contractAddress: ${contractAddress}`);

    // Fetch all owners
    try {
      const startTime = Date.now();
      const ownersResponse = await retry(() => alchemy.nft.getOwnersForContract(contractAddress));
      owners = ownersResponse.owners
        .filter(owner => owner.toLowerCase() !== burnAddress)
        .map(owner => owner.toLowerCase());
      totalOwners = owners.length;
      log(`${contractName} - Found ${totalOwners} owners in ${Date.now() - startTime}ms`);
    } catch (error) {
      log(`${contractName} - Failed to fetch owners: ${error.message}`);
      throw error;
    }

    let totalTokens = 0;
    try {
      const startTime = Date.now();
      const totalSupply = await retry(() =>
        client.readContract({
          address: contractAddress,
          abi: element280MainAbi,
          functionName: 'totalSupply',
        })
      );
      totalTokens = Number(totalSupply);
      log(`${contractName} - Total tokens: ${totalTokens} in ${Date.now() - startTime}ms`);
    } catch (error) {
      log(`${contractName} - Failed to fetch total supply: ${error.message}`);
      throw error;
    }

    // Phase 1: Fetch wallet data and NFTs (no rewards)
    const limit = pLimit(3);
    await Promise.all(
      owners.map((owner, index) =>
        limit(async () => {
          const startTime = Date.now();
          const holder = {
            wallet: owner,
            total: 0,
            totalLive: 0,
            multiplierSum: 0,
            displayMultiplierSum: 0,
            tiers: Array(6).fill(0),
            tokenIds: [],
            claimableRewards: 0,
            percentage: 0,
            rank: 0,
          };

          try {
            const balance = await retry(() =>
              client.readContract({
                address: contractAddress,
                abi: element280MainAbi,
                functionName: 'balanceOf',
                args: [owner],
              })
            );
            holder.total = Number(balance);
            holder.totalLive = Number(balance);
          } catch (error) {
            log(`${contractName} - Failed to fetch balance for ${owner}: ${error.message}`);
            throw error;
          }

          if (holder.total === 0) return;

          let nfts = [];
          const nftCacheKey = `${contractAddress}-${owner}-nfts`;
          if (tokenCache.has(nftCacheKey)) {
            nfts = tokenCache.get(nftCacheKey);
            log(`${contractName} - Cache hit for NFTs of ${owner}`);
          } else {
            try {
              const nftsResponse = await retry(() =>
                alchemy.nft.getNftsForOwner(owner, {
                  contractAddresses: [contractAddress],
                })
              );
              nfts = nftsResponse.ownedNfts.map(nft => ({
                tokenId: nft.tokenId,
                tier: 0,
              }));
              tokenCache.set(nftCacheKey, nfts);
              log(`${contractName} - Cached NFTs for ${owner}: ${nfts.length} tokens`);
            } catch (error) {
              log(`${contractName} - Failed to fetch NFTs for ${owner}: ${error.message}`);
              throw error;
            }
          }

          if (nfts.length === 0) return;

          const tokenIds = nfts.map(nft => nft.tokenId);
          const validTokenIds = await validateTokenOwnership(contractAddress, owner, tokenIds);
          const validNfts = nfts.filter(nft => validTokenIds.includes(nft.tokenId));

          if (validNfts.length === 0) return;

          const bigIntTokenIds = validNfts.map(nft => BigInt(nft.tokenId));
          const tierCalls = bigIntTokenIds.map(tokenId => ({
            address: contractAddress,
            abi: element280MainAbi,
            functionName: 'getNftTier',
            args: [tokenId],
          }));

          try {
            const tierResults = await retry(() => client.multicall({ contracts: tierCalls }));
            const finalTokenIds = [];
            validNfts.forEach((nft, index) => {
              if (tierResults[index].status === 'success') {
                const tier = Number(tierResults[index].result);
                if (tier >= 1 && tier <= 6) {
                  nft.tier = tier;
                  holder.tiers[tier - 1]++;
                  finalTokenIds.push(BigInt(nft.tokenId));
                  const cacheKey = `${contractAddress}-${nft.tokenId}-tier`;
                  tokenCache.set(cacheKey, tier);
                }
              }
            });
            holder.tokenIds = finalTokenIds;
          } catch (error) {
            log(`${contractName} - Failed to fetch tiers for ${owner}: ${error.message}`);
            throw error;
          }

          const multipliers = Object.values(tiers).map(t => t.multiplier);
          holder.multiplierSum = holder.tiers.reduce(
            (sum, count, index) => sum + count * (multipliers[index] || 0),
            0
          );
          holder.displayMultiplierSum = holder.multiplierSum / 10;

          if (holder.total > 0) {
            holdersMapCache.set(owner, holder);
            log(`${contractName} - Processed ${owner} (${index + 1}/${totalOwners}): total=${holder.total} in ${Date.now() - startTime}ms`);
          }
        })
      )
    );

    log(`${contractName} - Phase 1 complete: Populated holdersMapCache with ${holdersMapCache.size} holders`);

    // Phase 2: Calculate rewards for all holders
    const rewardLimit = pLimit(2);
    await Promise.all(
      Array.from(holdersMapCache.entries()).map(([owner, holder], index) =>
        rewardLimit(async () => {
          if (holder.tokenIds.length === 0) return;

          const startTime = Date.now();
          const rewardCacheKey = `${contractAddress}-${owner}-reward`;
          if (tokenCache.has(rewardCacheKey)) {
            holder.claimableRewards = tokenCache.get(rewardCacheKey);
            log(`${contractName} - Cache hit for rewards of ${owner}: ${holder.claimableRewards}`);
          } else {
            try {
              let rewards = await retry(
                () =>
                  client.readContract({
                    address: vaultAddresses.element280.address,
                    abi: element280VaultAbi,
                    functionName: 'getRewards',
                    args: [holder.tokenIds, owner],
                  }),
                5,
                2000,
                true
              );

              if (!rewards) {
                log(`${contractName} - getRewards returned null for ${owner}, falling back to single-token rewards`);
                let totalRewards = 0n;
                for (const tokenId of holder.tokenIds) {
                  const singleCacheKey = `${contractAddress}-${tokenId}-single-reward`;
                  if (tokenCache.has(singleCacheKey)) {
                    totalRewards += BigInt(tokenCache.get(singleCacheKey));
                    continue;
                  }
                  try {
                    const singleReward = await retry(
                      () =>
                        client.readContract({
                          address: vaultAddresses.element280.address,
                          abi: element280VaultAbi,
                          functionName: 'getRewards',
                          args: [[tokenId], owner],
                        }),
                      2,
                      2000,
                      true
                    );
                    const rewardValue = BigInt(singleReward[1] || 0);
                    tokenCache.set(singleCacheKey, rewardValue);
                    totalRewards += rewardValue;
                  } catch (error) {
                    log(`${contractName} - Failed to fetch reward for token ${tokenId} of ${owner}: ${error.message}`);
                    throw error;
                  }
                }
                rewards = [null, totalRewards];
              }

              const rewardValue = Number(rewards[1] || 0) / 1e18;
              if (isNaN(rewardValue)) {
                log(`${contractName} - Invalid reward value for ${owner}, setting to 0`);
                holder.claimableRewards = 0;
              } else {
                holder.claimableRewards = rewardValue;
                tokenCache.set(rewardCacheKey, holder.claimableRewards);
                log(`${contractName} - Cached rewards for ${owner}: ${holder.claimableRewards} in ${Date.now() - startTime}ms`);
              }
            } catch (error) {
              log(`${contractName} - Failed to fetch rewards for ${owner}: ${error.message}`);
              throw error;
            }
          }

          holdersMapCache.set(owner, holder);
          log(`${contractName} - Updated rewards for ${owner} (${index + 1}/${holdersMapCache.size}): claimableRewards=${holder.claimableRewards}`);
        })
      )
    );

    log(`${contractName} - Phase 2 complete: Calculated rewards for ${holdersMapCache.size} holders`);
  } catch (error) {
    log(`${contractName} - Failed to populate holdersMapCache: ${error.message}`);
    holdersMapCache = null;
    throw error;
  } finally {
    isCachePopulating = false;
    totalOwners = 0;
  }
}

async function getAllHolders(contractAddress, tiers, page = 0, pageSize = 100, refresh = false) {
  const contractName = 'element280';
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const now = Date.now();

  if (!refresh && cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    log(`getAllHolders: Returning cached data for ${cacheKey}`);
    return cache[cacheKey].data;
  }

  log(`getAllHolders start: ${contractName} at ${contractAddress}, page=${page}, pageSize=${pageSize}, refresh=${refresh}`);

  let holdersMap = holdersMapCache;
  let totalTokens = 0;

  if (refresh || !holdersMap || isCachePopulating) {
    while (isCachePopulating) {
      log(`${contractName} - Waiting for cache population to complete`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (refresh || !holdersMap) {
      await populateHoldersMapCache(contractAddress, tiers);
      holdersMap = holdersMapCache;
      if (!holdersMap) {
        throw new Error('Failed to populate holdersMapCache');
      }
    }
  }

  try {
    const totalSupply = await retry(() =>
      client.readContract({
        address: contractAddress,
        abi: element280MainAbi,
        functionName: 'totalSupply',
      })
    );
    totalTokens = Number(totalSupply);
    log(`${contractName} - Total tokens: ${totalTokens}`);
  } catch (error) {
    log(`${contractName} - Failed to fetch total supply: ${error.message}`);
    throw error;
  }

  const holders = Array.from(holdersMap.values());
  const start = page * pageSize;
  const end = Math.min(start + pageSize, holders.length);
  const paginatedHolders = holders.slice(start, end);

  const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
  paginatedHolders.forEach(holder => {
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
  });
  paginatedHolders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
  paginatedHolders.forEach((holder, index) => (holder.rank = start + index + 1));

  const result = {
    holders: paginatedHolders,
    totalTokens: holdersMap.size > 0 ? holders.reduce((sum, h) => sum + h.total, 0) : totalTokens,
    totalHolders: holders.length,
    page,
    pageSize,
    totalPages: Math.ceil(holders.length / pageSize),
    summary: {
      totalLive: totalTokens,
      multiplierPool: totalMultiplierSum,
      totalRewardPool: holders.reduce((sum, h) => sum + h.claimableRewards, 0),
    },
  };

  cache[cacheKey] = { timestamp: now, data: result };
  log(`${contractName} - Final holders count: ${paginatedHolders.length} for page ${page}, totalHolders: ${holders.length}, totalPages: ${result.totalPages}`);
  return serializeBigInt(result);
}

async function getHolderData(contractAddress, wallet, tiers) {
  const contractName = 'element280';
  const cacheKey = `${contractAddress}-${wallet}`;
  const now = Date.now();
  const walletLower = wallet.toLowerCase();

  if (cache[cacheKey] && (now - cache[cacheKey].timestamp) < CACHE_TTL) {
    log(`getHolderData: Returning cached data for ${cacheKey}`);
    return cache[cacheKey].data;
  }

  log(`getHolderData start: wallet=${walletLower}, contract=${contractAddress}`);

  while (isCachePopulating) {
    log(`${contractName} - Waiting for cache population to complete for ${walletLower}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (holdersMapCache?.has(walletLower)) {
    const startTime = Date.now();
    const holder = holdersMapCache.get(walletLower);
    log(`getHolderData: Cache hit for ${walletLower} in holdersMapCache`);

    const holders = Array.from(holdersMapCache.values());
    const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    const rankIndex = holders.findIndex(h => h.wallet === walletLower);
    holder.rank = rankIndex >= 0 ? rankIndex + 1 : holders.length + 1;

    cache[cacheKey] = { timestamp: now, data: holder };
    log(`${contractName} - Final data for ${walletLower} from cache in ${Date.now() - startTime}ms: total=${holder.total}, claimableRewards=${holder.claimableRewards}`);
    return serializeBigInt(holder);
  }

  log(`getHolderData: Cache miss for ${walletLower} in holdersMapCache`);

  const holder = {
    wallet: walletLower,
    total: 0,
    totalLive: 0,
    multiplierSum: 0,
    displayMultiplierSum: 0,
    tiers: Array(6).fill(0),
    tokenIds: [],
    claimableRewards: 0,
    percentage: 0,
    rank: 0,
  };

  // Fetch balance
  try {
    const startTime = Date.now();
    const balance = await retry(
      () =>
        client.readContract({
          address: contractAddress,
          abi: element280MainAbi,
          functionName: 'balanceOf',
          args: [walletLower],
        }),
      5,
      retryCount => Math.min(2000 * 2 ** retryCount, 10000)
    );
    holder.total = Number(balance);
    holder.totalLive = Number(balance);
    log(`${contractName} - Fetched balance for ${walletLower}: ${holder.total} in ${Date.now() - startTime}ms`);
  } catch (error) {
    log(`${contractName} - Failed to fetch balance for ${walletLower}: ${error.message}`);
    throw new Error(`Failed to fetch balance: ${error.message}`);
  }

  // Fetch NFTs
  let nfts = [];
  const nftCacheKey = `${contractAddress}-${walletLower}-nfts`;
  if (tokenCache.has(nftCacheKey)) {
    nfts = tokenCache.get(nftCacheKey);
    log(`${contractName} - Cache hit for NFTs of ${walletLower}`);
  } else {
    try {
      const startTime = Date.now();
      const nftsResponse = await retry(
        () =>
          alchemy.nft.getNftsForOwner(walletLower, {
            contractAddresses: [contractAddress],
          }),
        5,
        retryCount => Math.min(2000 * 2 ** retryCount, 10000)
      );
      nfts = nftsResponse.ownedNfts.map(nft => ({
        tokenId: nft.tokenId,
        tier: 0,
      }));
      tokenCache.set(nftCacheKey, nfts);
      log(`${contractName} - Cached NFTs for ${walletLower}: ${nfts.length} tokens in ${Date.now() - startTime}ms`);
    } catch (error) {
      log(`${contractName} - Failed to fetch NFTs for ${walletLower}: ${error.message}`);
      throw new Error(`Failed to fetch NFTs: ${error.message}`);
    }
  }

  // Validate token ownership
  const tokenIds = nfts.map(nft => nft.tokenId);
  let validNfts = nfts;
  if (tokenIds.length > 0) {
    try {
      const validTokenIds = await validateTokenOwnership(contractAddress, walletLower, tokenIds);
      validNfts = nfts.filter(nft => validTokenIds.includes(nft.tokenId));
    } catch (error) {
      log(`${contractName} - Failed to validate token ownership for ${walletLower}: ${error.message}`);
      throw new Error(`Failed to validate token ownership: ${error.message}`);
    }
  }

  // Fetch tiers
  let bigIntTokenIds = validNfts.map(nft => BigInt(nft.tokenId));
  if (bigIntTokenIds.length > 0) {
    const tierCalls = bigIntTokenIds.map(tokenId => ({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: 'getNftTier',
      args: [tokenId],
    }));

    try {
      const startTime = Date.now();
      const tierResults = await retry(
        () => client.multicall({ contracts: tierCalls }),
        5,
        retryCount => Math.min(2000 * 2 ** retryCount, 10000)
      );
      const finalTokenIds = [];
      validNfts.forEach((nft, index) => {
        if (tierResults[index].status === 'success') {
          const tier = Number(tierResults[index].result);
          if (tier >= 1 && tier <= 6) {
            nft.tier = tier;
            holder.tiers[tier - 1]++;
            finalTokenIds.push(BigInt(nft.tokenId));
            const cacheKey = `${contractAddress}-${nft.tokenId}-tier`;
            tokenCache.set(cacheKey, tier);
          }
        }
      });
      holder.tokenIds = finalTokenIds;
      log(`${contractName} - Fetched tiers for ${walletLower}: ${holder.tiers} in ${Date.now() - startTime}ms`);
    } catch (error) {
      log(`${contractName} - Failed to fetch tiers for ${walletLower}: ${error.message}`);
      throw new Error(`Failed to fetch tiers: ${error.message}`);
    }
  }

  // Calculate multipliers
  const multipliers = Object.values(tiers).map(t => t.multiplier);
  holder.multiplierSum = holder.tiers.reduce(
    (sum, count, index) => sum + count * (multipliers[index] || 0),
    0
  );
  holder.displayMultiplierSum = holder.multiplierSum / 10;

  // Fetch rewards
  if (holder.tokenIds.length > 0) {
    const rewardCacheKey = `${contractAddress}-${walletLower}-reward`;
    if (tokenCache.has(rewardCacheKey)) {
      holder.claimableRewards = tokenCache.get(rewardCacheKey);
      log(`${contractName} - Cache hit for rewards of ${walletLower}: ${holder.claimableRewards}`);
    } else {
      try {
        const startTime = Date.now();
        let rewards = await retry(
          () =>
            client.readContract({
              address: vaultAddresses.element280.address,
              abi: element280VaultAbi,
              functionName: 'getRewards',
              args: [holder.tokenIds, walletLower],
            }),
          5,
          retryCount => Math.min(2000 * 2 ** retryCount, 10000)
        );

        if (!rewards) {
          log(`${contractName} - getRewards returned null for ${walletLower}, falling back to single-token rewards`);
          let totalRewards = 0n;
          for (const tokenId of holder.tokenIds) {
            const singleCacheKey = `${contractAddress}-${tokenId}-single-reward`;
            if (tokenCache.has(singleCacheKey)) {
              totalRewards += BigInt(tokenCache.get(singleCacheKey));
              continue;
            }
            try {
              const singleReward = await retry(
                () =>
                  client.readContract({
                    address: vaultAddresses.element280.address,
                    abi: element280VaultAbi,
                    functionName: 'getRewards',
                    args: [[tokenId], walletLower],
                  }),
                2,
                retryCount => Math.min(2000 * 2 ** retryCount, 10000)
              );
              const rewardValue = BigInt(singleReward[1] || 0);
              tokenCache.set(singleCacheKey, rewardValue);
              totalRewards += rewardValue;
            } catch (error) {
              log(`${contractName} - Failed to fetch reward for token ${tokenId} of ${walletLower}: ${error.message}`);
              throw new Error(`Failed to fetch reward for token ${tokenId}: ${error.message}`);
            }
          }
          rewards = [null, totalRewards];
        }

        const rewardValue = Number(rewards[1] || 0) / 1e18;
        if (isNaN(rewardValue)) {
          log(`${contractName} - Invalid reward value for ${walletLower}, setting to 0`);
          holder.claimableRewards = 0;
        } else {
          holder.claimableRewards = rewardValue;
          tokenCache.set(rewardCacheKey, holder.claimableRewards);
          log(`${contractName} - Cached rewards for ${walletLower}: ${holder.claimableRewards} in ${Date.now() - startTime}ms`);
        }
      } catch (error) {
        log(`${contractName} - Failed to fetch rewards for ${walletLower}: ${error.message}`);
        throw new Error(`Failed to fetch rewards: ${error.message}`);
      }
    }
  }

  // Calculate percentage and rank
  if (holdersMapCache) {
    const holders = Array.from(holdersMapCache.values());
    const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    const rankIndex = holders.findIndex(h => h.wallet === walletLower);
    holder.rank = rankIndex >= 0 ? rankIndex + 1 : holders.length + 1;
  } else {
    try {
      const allHolders = await getAllHolders(contractAddress, tiers, 0, 100);
      const totalMultiplierSum = allHolders.holders.reduce((sum, h) => sum + h.multiplierSum, 0);
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      const existingHolder = allHolders.holders.find(h => h.wallet === walletLower);
      holder.rank = existingHolder ? existingHolder.rank : allHolders.holders.length + 1;
    } catch (error) {
      log(`${contractName} - Failed to fetch all holders for ranking: ${error.message}`);
      holder.rank = 1; // Fallback rank
    }
  }

  // Only cache and return if all data is available
  if (holder.total > 0) {
    holdersMapCache?.set(walletLower, holder);
    cache[cacheKey] = { timestamp: now, data: holder };
    log(`${contractName} - Final data for ${walletLower}: total=${holder.total}, multiplierSum=${holder.multiplierSum}, claimableRewards=${holder.claimableRewards}`);
    return serializeBigInt(holder);
  } else {
    log(`${contractName} - No valid NFTs found for ${walletLower}`);
    return null; // Return null only if wallet holds no NFTs
  }
}

export async function GET(request) {
  log('Request object:', {
    url: request.url,
    nextUrl: request.nextUrl ? request.nextUrl.toString() : 'undefined',
    headers: Object.fromEntries(request.headers.entries()),
    method: request.method,
  });

  let url = request.url;
  if (!url && request.nextUrl) {
    url = request.nextUrl.toString();
    log('Using request.nextUrl as fallback:', url);
  }

  if (!url) {
    log('Error: Both request.url and request.nextUrl are undefined');
    return NextResponse.json({ error: 'Invalid request: URL is undefined' }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(url);
    const contractName = 'element280';

    log(`API GET request: URL=${url}`);

    const wallet = searchParams.get('wallet');
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
    const refresh = searchParams.get('refresh') === 'true';

    const address = contractAddresses.element280.address;
    console.log(`[${contractName}] GET handler using contractAddress: ${address}`);
    if (!address) {
      log(`Error: Element280 contract address not found`);
      return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
    }

    if (wallet) {
      const startTime = Date.now();
      const holderData = await getHolderData(address, wallet, contractTiers.element280);
      log(`GET /api/holders/Element280?wallet=${wallet} completed in ${Date.now() - startTime}ms`);
      return NextResponse.json(serializeBigInt({ holders: holderData ? [holderData] : [] }));
    } else {
      const startTime = Date.now();
      const result = await getAllHolders(address, contractTiers.element280, page, pageSize, refresh);
      log(`GET /api/holders/Element280?page=${page}&pageSize=${pageSize} completed in ${Date.now() - startTime}ms`);
      return NextResponse.json(serializeBigInt(result));
    }
  } catch (error) {
    log(`Error in GET /api/holders/Element280: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}

export async function POST() {
  const contractName = 'element280';
  const address = contractAddresses.element280.address;
  console.log(`[${contractName}] POST handler using contractAddress: ${address}`);
  if (!address) {
    log(`Error: Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    log('POST /api/holders/Element280: Starting cache preload');
    await populateHoldersMapCache(address, contractTiers.element280);
    return NextResponse.json({ message: 'Cache preload completed', totalHolders: holdersMapCache?.size || 0 });
  } catch (error) {
    log(`Error in POST /api/holders/Element280: ${error.message}`);
    return NextResponse.json({ error: `Cache preload failed: ${error.message}` }, { status: 500 });
  }
}