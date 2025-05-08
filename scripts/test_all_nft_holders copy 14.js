#!/usr/bin/env node

import { createPublicClient, http, getAddress, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

// Resolve project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(projectRoot, '.env.local') });

// Console logger
const logger = {
  info: (context, message) => console.log(`[${context}] [INFO] ${message}`),
  warn: (context, message) => console.warn(`[${context}] [WARN] ${message}`),
  error: (context, message, meta = {}) => console.error(`[${context}] [ERROR] ${message}`, meta),
  debug: (context, message) => {
    if (process.env.DEBUG === 'true') console.debug(`[${context}] [DEBUG] ${message}`);
  },
};

// Alchemy configuration
const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('test', 'ALCHEMY_API_KEY is not set');
  process.exit(1);
}

// Multicall3 contract address
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Provider configuration (Alchemy only)
const providers = [
  {
    name: 'Alchemy',
    url: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    rateLimit: 330, // CUPS for free tier
    requestCount: 0,
    lastRequestTime: 0,
  },
];

// Initialize client
const clients = [{
  client: createPublicClient({
    chain: mainnet,
    transport: http(providers[0].url, { timeout: 10000 }),
  }),
  providerIndex: 0,
}];

// Burn addresses
const burnAddresses = [
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
];

// Cache file path
const CACHE_FILE = path.join(projectRoot, 'tier_cache.json');

// Provider performance metrics
const providerMetrics = providers.reduce((acc, provider) => {
  acc[provider.name] = { totalTime: 0, requestCount: 0, averageLatency: 0 };
  return acc;
}, {});

// Select provider with optimized rate limit handling
async function selectProvider(context, operationType) {
  const now = Date.now();
  const provider = providers[0];
  const client = clients[0].client;
  const requestCost = operationType === 'batch' ? 25 : operationType === 'multicall' ? 26 : 1;

  const timeSinceLast = (now - provider.lastRequestTime) / 1000;
  if (timeSinceLast >= 1) {
    provider.requestCount = 0;
    logger.debug(context, `Reset Alchemy requestCount (elapsed: ${timeSinceLast.toFixed(2)}s)`);
  }

  if (provider.requestCount + requestCost > provider.rateLimit) {
    const waitTime = Math.max(1000 - timeSinceLast * 1000, 1000);
    logger.warn(context, `Rate limit near (${provider.requestCount}/${provider.rateLimit} CUs), waiting ${waitTime}ms...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return selectProvider(context, operationType);
  }

  provider.requestCount += requestCost;
  provider.lastRequestTime = now;
  return { provider, client };
}

// Retry function with timeout
async function retry(operation, { retries = 3, delay = 1000, backoff = true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), 10000)),
      ]);
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt === retries) {
        logger.error('test/retry', `Rate limit exceeded after ${retries} attempts`);
        throw new Error('Rate limit exceeded');
      }
      logger.warn('test/retry', `Retry ${attempt}/${retries} failed: ${error.message}`);
      const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay;
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 5000)));
    }
  }
  throw lastError;
}

// Fetch owners using Alchemy SDK
async function fetchOwnersOnChain(contractAddress, totalSupply, abi, contractKey, client) {
  const owners = [];
  const tokenBalancesMap = new Map();
  const chunkSize = 100;
  const context = `test/${contractKey}`;
  let burnedTokens = 0;
  let nonExistentTokens = 0;
  const nonExistentTokenIds = [];
  let lastProcessedBlock = null;

  // Load cache
  const cache = await loadCache();
  const contractCache = cache[contractAddress] || { owners: {}, tiers: {}, nonExistent: [] };
  cache[contractAddress] = contractCache;

  try {
    logger.info(context, `Fetching owners for ${contractAddress} (${totalSupply} tokens)`);

    // Process chunks
    const chunks = [];
    for (let start = 1; start <= totalSupply; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, totalSupply);
      const tokenIds = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));
      const uncachedTokenIds = tokenIds.filter(id => !contractCache.owners[Number(id)] && !contractCache.nonExistent.includes(Number(id)));
      if (uncachedTokenIds.length > 0) {
        chunks.push({ start, end, tokenIds: uncachedTokenIds });
      }
    }

    const concurrencyLimit = 2;
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const chunkBatch = chunks.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        chunkBatch.map(async ({ start, end, tokenIds }, idx) => {
          const calls = tokenIds.map(tokenId => ({
            address: contractAddress,
            abi,
            functionName: 'ownerOf',
            args: [tokenId],
          }));

          const { provider, client } = await selectProvider(context, 'multicall');
          const startTime = process.hrtime.bigint();

          try {
            const results = await retry(async () => {
              const multicallResult = await client.multicall({
                contracts: calls,
                multicallAddress: MULTICALL3_ADDRESS,
                allowFailure: true,
                blockNumber: null,
              });
              if (!multicallResult) {
                throw new Error('Multicall returned undefined result');
              }
              const blockNumber = await client.getBlockNumber();
              lastProcessedBlock = blockNumber;
              return multicallResult.map((result, idx) => {
                try {
                  return {
                    tokenId: Number(tokenIds[idx]),
                    owner: result && result.status === 'success' && isAddress(result.result) ? result.result : null,
                  };
                } catch (error) {
                  logger.warn(context, `Error processing multicall result for token ${tokenIds[idx]}: ${error.message}`, {
                    result,
                    index: idx,
                  });
                  return { tokenId: Number(tokenIds[idx]), owner: null, error: error.message };
                }
              });
            }, { retries: 3, delay: 1000 });

            // Cache results
            results.forEach(({ tokenId, owner }) => {
              if (owner && isAddress(owner)) {
                contractCache.owners[tokenId] = owner;
              } else {
                contractCache.nonExistent.push(tokenId);
              }
            });

            const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
            providerMetrics[provider.name].totalTime += duration;
            providerMetrics[provider.name].requestCount += 1;
            providerMetrics[provider.name].averageLatency =
              providerMetrics[provider.name].totalTime / providerMetrics[provider.name].requestCount;

            logger.debug(context, `Processed token IDs ${start} to ${end} (${duration.toFixed(2)} ms)`);
            if (idx < chunkBatch.length - 1) await new Promise(resolve => setTimeout(resolve, 200));
            return results;
          } catch (error) {
            logger.error(context, `Failed to process chunk ${start}-${end}: ${error.message}`, { stack: error.stack });
            return tokenIds.map(tokenId => ({
              tokenId: Number(tokenId),
              owner: null,
              error: error.message,
            }));
          }
        })
      );

      batchResults.flat().forEach(({ tokenId, owner, error }) => {
        if (error) {
          nonExistentTokens++;
          nonExistentTokenIds.push(tokenId);
          return;
        }
        if (owner && !burnAddresses.map(addr => addr.toLowerCase()).includes(owner.toLowerCase()) && isAddress(owner)) {
          if (!tokenBalancesMap.has(owner)) tokenBalancesMap.set(owner, []);
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        } else if (owner && burnAddresses.map(addr => addr.toLowerCase()).includes(owner.toLowerCase())) {
          burnedTokens++;
          tokenBalancesMap.set(owner, tokenBalancesMap.get(owner) || []);
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        } else {
          nonExistentTokens++;
          nonExistentTokenIds.push(tokenId);
        }
      });

      if ((i + concurrencyLimit) % 10 === 0 || i + concurrencyLimit >= chunks.length) {
        await saveCache(cache);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      logger.info(context, `Progress: ${Math.min(((i + concurrencyLimit) / chunks.length * 100).toFixed(2), 100)}%`);
    }

    await saveCache(cache);

    // Add cached owners
    for (let tokenId = 1; tokenId <= totalSupply; tokenId++) {
      const owner = contractCache.owners[tokenId];
      if (owner && !tokenBalancesMap.has(owner) && isAddress(owner)) {
        if (!burnAddresses.map(addr => addr.toLowerCase()).includes(owner.toLowerCase())) {
          tokenBalancesMap.set(owner, [{ tokenId: tokenId.toString() }]);
        } else {
          burnedTokens++;
          tokenBalancesMap.set(owner, tokenBalancesMap.get(owner) || []);
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        }
      }
    }

    tokenBalancesMap.forEach((tokenBalances, ownerAddress) => {
      owners.push({ ownerAddress, tokenBalances });
    });

    logger.info(context, `Fetched ${owners.length} owners, ${burnedTokens} burned, ${nonExistentTokens} non-existent`);
    return { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds, lastProcessedBlock };
  } catch (error) {
    logger.error(context, `Failed to fetch owners: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

// Reset cache
async function resetCache() {
  try {
    await fs.unlink(CACHE_FILE).catch(() => {});
    await fs.writeFile(CACHE_FILE, JSON.stringify({}));
    logger.info('test', `Initialized cache`);
  } catch (error) {
    logger.error('test', `Failed to reset cache: ${error.message}`);
    throw error;
  }
}

// Load cache
async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Save cache with BigInt serialization
async function saveCache(cache) {
  try {
    const serializeBigInt = (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    };
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, serializeBigInt, 2));
  } catch (error) {
    logger.error('test', `Failed to save cache: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

// NFT contract configurations
const nftContracts = {
  stax: {
    name: 'Stax',
    symbol: 'STAX',
    chain: 'ETH',
    contractAddress: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
    totalMinted: 503,
    deploymentBlock: 21452667,
    tiers: {
      1: { name: 'Common', multiplier: 1 },
      2: { name: 'Common Amped', multiplier: 1.2 },
      3: { name: 'Common Super', multiplier: 1.4 },
      4: { name: 'Common LFG', multiplier: 2 },
      5: { name: 'Rare', multiplier: 10 },
      6: { name: 'Rare Amped', multiplier: 12 },
      7: { name: 'Rare Super', multiplier: 14 },
      8: { name: 'Rare LFG', multiplier: 20 },
      9: { name: 'Legendary', multiplier: 100 },
      10: { name: 'Legendary Amped', multiplier: 120 },
      11: { name: 'Legendary Super', multiplier: 140 },
      12: { name: 'Legendary LFG', multiplier: 200 },
    },
  },
  element280: {
    name: 'Element 280',
    symbol: 'ELMNT',
    chain: 'ETH',
    contractAddress: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
    totalMinted: 16883,
    deploymentBlock: 20945304,
    tiers: {
      1: { name: 'Common', multiplier: 10 },
      2: { name: 'Common Amped', multiplier: 12 },
      3: { name: 'Rare', multiplier: 100 },
      4: { name: 'Rare Amped', multiplier: 120 },
      5: { name: 'Legendary', multiplier: 1000 },
      6: { name: 'Legendary Amped', multiplier: 1200 },
    },
  },
  element369: {
    name: 'Element 369',
    symbol: 'E369',
    chain: 'ETH',
    contractAddress: '0x024d64e2f65747d8bb02dfb852702d588a062575',
    totalMinted: 448,
    deploymentBlock: 21224418,
    tiers: {
      1: { name: 'Common', multiplier: 1 },
      2: { name: 'Rare', multiplier: 10 },
      3: { name: 'Legendary', multiplier: 100 },
    },
  },
  ascendant: {
    name: 'Ascendant',
    symbol: 'ASCNFT',
    chain: 'ETH',
    contractAddress: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f',
    deploymentBlock: 21112535,
    tiers: {
      1: { name: 'Tier 1', multiplier: 1.01 },
      2: { name: 'Tier 2', multiplier: 1.02 },
      3: { name: 'Tier 3', multiplier: 1.03 },
      4: { name: 'Tier 4', multiplier: 1.04 },
      5: { name: 'Tier 5', multiplier: 1.05 },
      6: { name: 'Tier 6', multiplier: 1.06 },
      7: { name: 'Tier 7', multiplier: 1.07 },
      8: { name: 'Tier 8', multiplier: 1.08 },
    },
  },
};

// Contract ABIs
const contractAbis = {
  stax: [
    {
      type: 'function',
      name: 'totalSupply',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'totalBurned',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'ownerOf',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'owner', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'getNftTier',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'tier', type: 'uint8' }],
      stateMutability: 'view',
    },
  ],
  element280: [
    {
      type: 'function',
      name: 'totalSupply',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'totalBurned',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'ownerOf',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'owner', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'getNftTier',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'tier', type: 'uint8' }],
      stateMutability: 'view',
    },
  ],
  element369: [
    {
      type: 'function',
      name: 'totalSupply',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'totalBurned',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'ownerOf',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'owner', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'getNftTier',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'tier', type: 'uint8' }],
      stateMutability: 'view',
    },
  ],
  ascendant: [
    {
      type: 'function',
      name: 'tokenId',
      inputs: [],
      outputs: [{ name: 'result', type: 'uint256' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'ownerOf',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [{ name: 'owner', type: 'address' }],
      stateMutability: 'view',
    },
    {
      type: 'function',
      name: 'getNFTAttribute',
      inputs: [{ name: 'tokenId', type: 'uint256' }],
      outputs: [
        {
          name: '',
          type: 'tuple',
          components: [
            { name: 'rarityNumber', type: 'uint256' },
            { name: 'tier', type: 'uint8' },
            { name: 'rarity', type: 'uint8' },
          ],
        },
      ],
      stateMutability: 'view',
    },
  ],
};

// Tier function definitions
const tierFunctions = {
  stax: { name: 'getNftTier', contract: 'nft', inputs: ['tokenId'], outputs: ['tier'] },
  element280: { name: 'getNftTier', contract: 'nft', inputs: ['tokenId'], outputs: ['tier'] },
  element369: { name: 'getNftTier', contract: 'nft', inputs: ['tokenId'], outputs: ['tier'] },
  ascendant: { name: 'getNFTAttribute', contract: 'nft', inputs: ['tokenId'], outputs: ['attributes'] },
};

// Rarity mapping for Ascendant
const ascendantRarityMap = {
  0: 'Common',
  1: 'Rare',
  2: 'Legendary',
};

// Test function for a single NFT collection
async function testNFTHolders(contractKey) {
  const contractConfig = nftContracts[contractKey];
  if (!contractConfig) {
    logger.warn('test', `Skipping ${contractKey}: not found`);
    return null;
  }

  const contractAddress = contractConfig.contractAddress;
  const contractName = contractConfig.name;
  const context = `test/${contractKey}`;
  const abi = contractAbis[contractKey];

  if (!isAddress(contractAddress)) {
    logger.error(context, `${contractName}: Invalid contract address`);
    return null;
  }

  let summary = {
    contractKey,
    contractName,
    totalLiveSupply: 0,
    totalBurned: 0,
    totalMinted: 0,
    uniqueHolders: 0,
    liveTokens: 0,
    burnedTokens: 0,
    nonExistentTokens: 0,
    nonExistentTokenIds: [],
    beginningBlock: null,
    lastProcessedBlock: null,
    tierCounts: {},
    status: 'Failed',
    mismatch: null,
    timings: {
      totalSupply: 0,
      fetchOwners: 0,
      buildHolders: 0,
      fetchTiers: 0,
      logResults: 0,
      totalExecution: 0,
    },
  };

  const totalStart = process.hrtime.bigint();

  try {
    // Step 1: Fetch totalSupply and beginning block
    let stepStart = process.hrtime.bigint();
    logger.info(context, `Fetching state for ${contractName}`);
    let totalSupply;
    let totalBurned = 0n;
    let totalMinted;

    const { client } = await selectProvider(context, 'single');
    summary.beginningBlock = await client.getBlockNumber();

    if (contractKey === 'ascendant') {
      totalSupply = await retry(() =>
        client.readContract({
          address: contractAddress,
          abi,
          functionName: 'tokenId',
        })
      );
      totalMinted = Number(totalSupply);
      summary.totalLiveSupply = totalMinted;
      summary.totalMinted = 'N/A';
      logger.info(context, `State: totalMinted=${totalMinted}`);
    } else {
      totalSupply = await retry(() =>
        client.readContract({
          address: contractAddress,
          abi,
          functionName: 'totalSupply',
        })
      );
      totalBurned = await retry(() =>
        client.readContract({
          address: contractAddress,
          abi,
          functionName: 'totalBurned',
        })
      ).catch(() => 0n);

      const totalTokens = Number(totalSupply);
      totalBurned = Number(totalBurned);
      totalMinted = totalTokens + totalBurned;
      summary.totalLiveSupply = totalTokens;
      summary.totalBurned = totalBurned;
      summary.totalMinted = totalMinted;
      logger.info(context, `State: live=${totalTokens}, burned=${totalBurned}, minted=${totalMinted}`);
    }

    const totalTokens = Number(totalSupply);
    summary.timings.totalSupply = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 2: Fetch owners
    stepStart = process.hrtime.bigint();
    const { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds, lastProcessedBlock } = await fetchOwnersOnChain(
      contractAddress,
      totalTokens,
      abi,
      contractKey,
      client
    );
    summary.burnedTokens = burnedTokens;
    summary.nonExistentTokens = nonExistentTokens;
    summary.nonExistentTokenIds = nonExistentTokenIds;
    summary.lastProcessedBlock = lastProcessedBlock;
    summary.timings.fetchOwners = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 3: Build holders
    stepStart = process.hrtime.bigint();
    const filteredOwners = owners.filter(
      owner =>
        owner?.ownerAddress &&
        !burnAddresses.map(addr => addr.toLowerCase()).includes(owner.ownerAddress.toLowerCase()) &&
        owner.tokenBalances?.length > 0
    );

    const holdersMap = new Map();
    const tokenOwnerMap = new Map();
    let tokenCount = 0;
    const seenTokenIds = new Set();
    const maxTier = Math.max(...Object.keys(contractConfig.tiers).map(Number));

    for (const owner of filteredOwners) {
      if (!owner.ownerAddress) continue;
      let wallet;
      try {
        wallet = getAddress(owner.ownerAddress).toLowerCase();
      } catch {
        continue;
      }

      const tokenIds = [];
      const tiers = Array(maxTier + 1).fill(0);
      let total = 0;

      for (const tb of owner.tokenBalances) {
        if (!tb.tokenId) continue;
        const tokenId = Number(tb.tokenId);
        if (seenTokenIds.has(tokenId)) continue;
        seenTokenIds.add(tokenId);
        tokenIds.push(tokenId);
        tokenOwnerMap.set(tokenId, wallet);
        total++;
        tokenCount++;
      }

      if (total > 0) {
        holdersMap.set(wallet, { wallet, tokenIds, tiers, total });
      }
    }

    summary.uniqueHolders = holdersMap.size;
    summary.liveTokens = tokenCount;
    logger.info(context, `Processed ${holdersMap.size} holders, ${tokenCount} tokens`);
    summary.timings.buildHolders = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 4: Fetch tiers
    stepStart = process.hrtime.bigint();
    const tokenIds = Array.from(tokenOwnerMap.keys()).filter(id => !nonExistentTokenIds.includes(id));
    if (tokenIds.length > 0) {
      logger.info(context, `Fetching tiers for ${tokenIds.length} tokens`);

      const cache = await loadCache();
      const contractCache = cache[contractAddress] || { owners: {}, tiers: {}, nonExistent: [] };
      const tierResults = [];
      const uncachedTokenIds = tokenIds.filter(id => !contractCache.tiers[id]);

      if (uncachedTokenIds.length > 0) {
        const tierCalls = uncachedTokenIds.map(tokenId => ({
          address: contractAddress,
          abi,
          functionName: tierFunctions[contractKey].name,
          args: [BigInt(tokenId)],
        }));

        const chunkSize = contractKey === 'ascendant' ? 50 : 100;
        const concurrencyLimit = 2;
        for (let i = 0; i < tierCalls.length; i += chunkSize * concurrencyLimit) {
          const batch = [];
          for (let j = 0; j < concurrencyLimit && i + j * chunkSize < tierCalls.length; j++) {
            const start = i + j * chunkSize;
            const chunk = tierCalls.slice(start, start + chunkSize);
            const tokenIdsChunk = uncachedTokenIds.slice(start, start + chunkSize);
            batch.push({ chunk, tokenIdsChunk });
          }
          await Promise.all(
            batch.map(async ({ chunk, tokenIdsChunk }, idx) => {
              const { client, provider } = await selectProvider(context, 'multicall');
              try {
                const results = await retry(async () => {
                  const multicallResult = await client.multicall({
                    contracts: chunk,
                    multicallAddress: MULTICALL3_ADDRESS,
                    allowFailure: true,
                    blockNumber: null,
                  });
                  const blockNumber = await client.getBlockNumber();
                  summary.lastProcessedBlock = blockNumber;
                  return multicallResult.map((result, idx) => ({
                    status: result.status,
                    result: result.status === 'success' ? result.result : null,
                    tokenId: tokenIdsChunk[idx],
                    error: result.error,
                  }));
                }, { retries: 2, delay: 1000 });
                if (idx < batch.length - 1) await new Promise(resolve => setTimeout(resolve, 200));
                return results;
              } catch (error) {
                logger.error(context, `Failed tier chunk ${i / chunkSize + 1}: ${error.message}`);
                return chunk.map((_, idx) => ({
                  status: 'failure',
                  tokenId: tokenIdsChunk[idx],
                  error: error.message,
                }));
              }
            })
          ).then(results => tierResults.push(...results.flat()));
          logger.info(context, `Tiers progress: ${Math.min(((i + chunkSize * concurrencyLimit) / tierCalls.length * 100).toFixed(2), 100)}%`);
        }

        // Update cache
        tierResults.forEach(result => {
          if (result.status === 'success' && result.result !== null && result.tokenId) {
            try {
              if (contractKey === 'ascendant') {
                let parsedResult;
                if (Array.isArray(result.result) && result.result.length === 3) {
                  parsedResult = {
                    rarityNumber: typeof result.result[0] === 'string' ? BigInt(result.result[0]) : result.result[0],
                    tier: Number(result.result[1]),
                    rarity: Number(result.result[2]),
                  };
                } else {
                  logger.warn(context, `Invalid tier format for token ${result.tokenId}: ${JSON.stringify(result.result)}`);
                  return;
                }
                if (
                  typeof parsedResult.rarityNumber === 'bigint' &&
                  parsedResult.rarityNumber >= 0n &&
                  !isNaN(parsedResult.tier) &&
                  !isNaN(parsedResult.rarity) &&
                  parsedResult.tier >= 1 &&
                  parsedResult.tier <= 8
                ) {
                  contractCache.tiers[result.tokenId] = parsedResult;
                } else {
                  logger.warn(context, `Invalid tier values for token ${result.tokenId}: ${JSON.stringify(parsedResult)}`);
                }
              } else {
                const tier = Number(result.result);
                if (!isNaN(tier) && tier >= 1 && tier <= maxTier) {
                  contractCache.tiers[result.tokenId] = tier;
                } else {
                  logger.warn(context, `Invalid tier ${tier} for token ${result.tokenId}`);
                }
              }
            } catch (error) {
              logger.warn(context, `Error caching tier for token ${result.tokenId}: ${error.message}`);
            }
          }
        });
        cache[contractAddress] = contractCache;
        await saveCache(cache);
      }

      // Add cached results with validation
      tokenIds.forEach(tokenId => {
        if (contractCache.tiers[tokenId]) {
          const cachedTier = contractCache.tiers[tokenId];
          try {
            if (contractKey === 'ascendant') {
              if (
                cachedTier &&
                typeof cachedTier === 'object' &&
                'tier' in cachedTier &&
                typeof cachedTier.tier === 'number' &&
                cachedTier.tier >= 1 &&
                cachedTier.tier <= 8 &&
                'rarityNumber' in cachedTier &&
                'rarity' in cachedTier
              ) {
                tierResults.push({
                  status: 'success',
                  result: cachedTier,
                  tokenId,
                });
              } else {
                logger.warn(context, `Invalid cached tier for token ${tokenId}: ${JSON.stringify(cachedTier)}`);
              }
            } else {
              if (typeof cachedTier === 'number' && !isNaN(cachedTier) && cachedTier >= 1 && cachedTier <= maxTier) {
                tierResults.push({
                  status: 'success',
                  result: cachedTier,
                  tokenId,
                });
              } else {
                logger.warn(context, `Invalid cached tier ${cachedTier} for token ${tokenId}`);
              }
            }
          } catch (error) {
            logger.warn(context, `Error processing cached tier for token ${tokenId}: ${error.message}`);
          }
        }
      });

      // Initialize tier counts
      summary.tierCounts = Object.keys(contractConfig.tiers).reduce((acc, tier) => {
        acc[tier] = { count: 0, name: contractConfig.tiers[tier].name };
        if (contractKey === 'ascendant') acc[tier].rarityCounts = {};
        return acc;
      }, {});

      // Update holders and tier counts
      tierResults.forEach(result => {
        if (result.status !== 'success' || result.result === null || !result.tokenId) {
          logger.warn(context, `Failed tier for token ${result.tokenId || 'unknown'}: ${result.error || 'Unknown error'}`);
          return;
        }

        const tokenId = result.tokenId;
        let tier;

        try {
          if (contractKey === 'ascendant') {
            let parsedResult;
            if (typeof result.result === 'object' && result.result !== null && 'tier' in result.result) {
              parsedResult = result.result;
            } else if (Array.isArray(result.result) && result.result.length === 3) {
              parsedResult = {
                rarityNumber: typeof result.result[0] === 'string' ? BigInt(result.result[0]) : result.result[0],
                tier: Number(result.result[1]),
                rarity: Number(result.result[2]),
              };
            } else {
              logger.warn(context, `Invalid tier format for token ${tokenId}: ${JSON.stringify(result.result)}`);
              return;
            }

            if (
              typeof parsedResult.rarityNumber !== 'bigint' ||
              parsedResult.rarityNumber < 0n ||
              isNaN(parsedResult.tier) ||
              isNaN(parsedResult.rarity)
            ) {
              logger.warn(context, `Invalid tier values for token ${tokenId}: ${JSON.stringify(parsedResult)}`);
              return;
            }

            tier = parsedResult.tier;
            if (tier < 1 || tier > 8) {
              logger.warn(context, `Invalid tier ${tier} for token ${tokenId}`);
              return;
            }

            if (summary.tierCounts[tier]) {
              summary.tierCounts[tier].count += 1;
              const rarity = parsedResult.rarity;
              summary.tierCounts[tier].rarityCounts[rarity] = (summary.tierCounts[tier].rarityCounts[rarity] || 0) + 1;
            } else {
              logger.warn(context, `Tier ${tier} not found in tierCounts for token ${tokenId}`);
            }
          } else {
            tier = Number(result.result);
            if (isNaN(tier) || tier < 1 || tier > maxTier) {
              logger.warn(context, `Invalid tier ${tier} for token ${tokenId}`);
              return;
            }
            if (summary.tierCounts[tier]) {
              summary.tierCounts[tier].count += 1;
            } else {
              logger.warn(context, `Tier ${tier} not found in tierCounts for token ${tokenId}`);
            }
          }

          const wallet = tokenOwnerMap.get(tokenId);
          if (wallet) {
            const holder = holdersMap.get(wallet);
            if (holder) {
              holder.tiers[tier] = (holder.tiers[tier] || 0) + 1;
            } else {
              logger.warn(context, `Holder not found for wallet ${wallet} and token ${tokenId}`);
            }
          } else {
            logger.warn(context, `Wallet not found for token ${tokenId}`);
          }
        } catch (error) {
          logger.warn(context, `Error processing tier for token ${tokenId}: ${error.message}`, {
            result: result.result,
            stack: error.stack,
          });
        }
      });
    }
    summary.timings.fetchTiers = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 5: Log results
    stepStart = process.hrtime.bigint();
    logger.info(context, `=== ${contractName} Holders ===`);
    if (process.env.LOG_WALLETS === 'true') {
      const holderList = Array.from(holdersMap.values());
      holderList.forEach(holder => {
        logger.info(context, `Wallet: ${holder.wallet}, Tokens: ${holder.total}, Tiers: ${JSON.stringify(holder.tiers)}`);
      });
    }

    logger.info(context, `Summary: ${holdersMap.size} holders, ${tokenCount} tokens, live=${totalTokens}, minted=${summary.totalMinted}`);

    // Validate
    if (contractKey !== 'ascendant') {
      const expectedLiveTokens = totalTokens;
      const missingTokens = expectedLiveTokens - tokenCount;
      if (tokenCount < expectedLiveTokens) {
        summary.mismatch = `Processed ${tokenCount} tokens, expected ${expectedLiveTokens}. Missing ${missingTokens} (likely ${burnedTokens} burned, ${nonExistentTokens} non-existent).`;
        logger.warn(context, summary.mismatch);
      } else if (tokenCount > expectedLiveTokens) {
        summary.mismatch = `Processed ${tokenCount} tokens, exceeding ${expectedLiveTokens}.`;
        logger.warn(context, summary.mismatch);
      } else {
        summary.status = 'Success';
      }
    } else {
      summary.status = 'Success';
    }
    summary.timings.logResults = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    summary.timings.totalExecution = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    return summary;
  } catch (error) {
    logger.error(context, `Test failed: ${error.message}`, { stack: error.stack });
    summary.error = error.message;
    summary.timings.totalExecution = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    return summary;
  }
}

// Main test function
async function testAllNFTHolders() {
  const contractKeys = ['stax', 'element280', 'element369', 'ascendant'];
  const summaries = [];

  for (const contractKey of contractKeys) {
    const summary = await testNFTHolders(contractKey);
    if (summary) summaries.push(summary);
  }

  return summaries;
}


// Run the test
async function main() {
  try {
    await resetCache();
    const summaries = await testAllNFTHolders();

    // Log summary
    logger.info('test', '=== NFT Collections Summary ===');
    console.table(
      summaries.map(summary => ({
        Contract: summary.contractName,
        TotalMinted: summary.totalMinted,
        TotalLiveSupply: summary.totalLiveSupply,
        TotalBurned: summary.totalBurned || 'N/A',
        UniqueHolders: summary.uniqueHolders,
        LiveTokens: summary.liveTokens,
        BurnedTokens: summary.burnedTokens,
        NonExistentTokens: summary.nonExistentTokens,
        BeginningBlock: summary.beginningBlock?.toString() || 'N/A',
        LastProcessedBlock: summary.lastProcessedBlock?.toString() || 'N/A',
        Status: summary.status,
        Mismatch: summary.mismatch || 'None',
        TierMismatch: summary.tierMismatch || 'None',
        Error: summary.error || 'None',
      }))
    );

    // Log timings
    logger.info('test', '=== Timings (ms) ===');
    console.table(
      summaries.map(summary => ({
        Contract: summary.contractName,
        TotalSupply: summary.timings.totalSupply.toFixed(2),
        FetchOwners: summary.timings.fetchOwners.toFixed(2),
        BuildHolders: summary.timings.buildHolders.toFixed(2),
        FetchTiers: summary.timings.fetchTiers.toFixed(2),
        TotalExecution: summary.timings.totalExecution.toFixed(2),
      }))
    );

    // Log tier counts summary
    logger.info('test', '=== NFT Tier Counts Summary ===');
    summaries.forEach(summary => {
      logger.info('test', `Tier Counts for ${summary.contractName}:`);
      const tierTable = Object.entries(summary.tierCounts).map(([tier, data]) => {
        if (summary.contractKey === 'ascendant') {
          const rarityCounts = data.rarityCounts || {};
          const raritySummary = Object.entries(rarityCounts)
            .map(([rarity, count]) => `${ascendantRarityMap[rarity] || `Rarity ${rarity}`}: ${count}`)
            .join(', ');
          return {
            Tier: tier,
            Name: data.name,
            Count: data.count,
            RarityCounts: raritySummary || 'None',
          };
        } else {
          return {
            Tier: tier,
            Name: data.name,
            Count: data.count,
          };
        }
      });
      console.table(tierTable);
    });

    const failedTests = summaries.filter(s => s.error);
    const mismatchedTests = summaries.filter(s => s.mismatch || s.tierMismatch);

    if (failedTests.length > 0) {
      logger.error('test', `Tests failed for: ${failedTests.map(s => s.contractName).join(', ')}`);
      process.exit(1);
    } else if (mismatchedTests.length > 0) {
      logger.warn('test', `Tests completed with mismatches for: ${mismatchedTests.map(s => s.contractName).join(', ')}`);
      process.exit(0);
    } else {
      logger.info('test', 'All tests completed successfully');
      process.exit(0);
    }
  } catch (error) {
    logger.error('test', `Tests failed: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
}

main();