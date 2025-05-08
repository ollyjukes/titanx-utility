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

// Load environment variables from .env.local
dotenv.config({ path: path.join(projectRoot, '.env.local') });

// Console logger
const logger = {
  info: (context, message, ...args) => console.log(`[${context}] [INFO] ${message}`, ...args),
  warn: (context, message, ...args) => console.warn(`[${context}] [WARN] ${message}`, ...args),
  error: (context, message, meta = {}, ...args) => console.error(`[${context}] [ERROR] ${message}`, meta, ...args),
  debug: (context, message, ...args) => console.debug(`[${context}] [DEBUG] ${message}`, ...args),
};

// Alchemy and Infura configuration
const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const infuraApiKey = process.env.INFURA_API_KEY;
if (!alchemyApiKey) {
  logger.error('test', 'ALCHEMY_API_KEY is not set in environment variables', {}, 'eth', 'nft');
  process.exit(1);
}
if (!infuraApiKey) {
  logger.warn('test', 'INFURA_API_KEY is not set, falling back to Alchemy only', {}, 'eth', 'nft');
}

// Multicall3 contract address
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Multiple providers for load balancing
const providers = [
  { name: 'Alchemy', url: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}` },
];
if (infuraApiKey) {
  providers.push({ name: 'Infura', url: `https://mainnet.infura.io/v3/${infuraApiKey}` });
}

// Initialize multiple clients
const clients = providers.map(provider =>
  createPublicClient({
    chain: mainnet,
    transport: http(provider.url),
  })
);

// Initialize Viem client (default to first provider)
const client = clients[0];

// Initialize NFT API client
const nftClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}`),
});

// Burn address
const burnAddress = '0x0000000000000000000000000000000000000000';

// Cache file path
const CACHE_FILE = path.join(projectRoot, 'tier_cache.json');

// Helper function to serialize BigInt for logging
const serializeForLogging = (obj) => {
  if (typeof obj === 'bigint') {
    return obj.toString();
  } else if (Array.isArray(obj)) {
    return obj.map(serializeForLogging);
  } else if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, serializeForLogging(value)])
    );
  }
  return obj;
};

// Reset cache
async function resetCache() {
  try {
    await fs.unlink(CACHE_FILE);
    logger.info('test', `Cache file ${CACHE_FILE} deleted successfully`, 'eth', 'nft');
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('test', `Cache file ${CACHE_FILE} does not exist, no need to delete`, 'eth', 'nft');
    } else {
      logger.error('test', `Failed to delete cache file ${CACHE_FILE}: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
      throw error;
    }
  }
  // Create an empty cache file
  await fs.writeFile(CACHE_FILE, JSON.stringify({}));
  logger.info('test', `Initialized empty cache file ${CACHE_FILE}`, 'eth', 'nft');
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
  const serializeBigInt = (obj) => {
    if (typeof obj === 'bigint') {
      return obj.toString();
    } else if (Array.isArray(obj)) {
      return obj.map(serializeBigInt);
    } else if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)])
      );
    }
    return obj;
  };

  const serializedCache = serializeBigInt(cache);
  await fs.writeFile(CACHE_FILE, JSON.stringify(serializedCache, null, 2));
}

// NFT contract configurations
const nftContracts = {
  stax: {
    name: 'Stax',
    symbol: 'STAX',
    chain: 'ETH',
    contractAddress: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
    totalMinted: 503,
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

// Retry function
async function retry(operation, { retries = 3, delay = 3000, backoff = true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt === retries) {
        logger.error('test/retry', `Circuit breaker: Rate limit exceeded after ${retries} attempts`, {}, 'eth', 'nft');
        throw new Error('Rate limit exceeded');
      }
      logger.warn('test/retry', `Retry attempt ${attempt}/${retries} failed: ${error.message}`, 'eth', 'nft');
      const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay * Math.min(attempt, 3);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}

// Fetch owners using Alchemy NFT API
async function fetchOwnersWithNFTApi(contractAddress, contractKey, options = {}) {
  const { withTokenBalances = true, maxPages = 100 } = options;
  const owners = [];
  let pageKey = null;
  let pageCount = 0;
  const context = `test/${contractKey}`;

  try {
    logger.info(context, `Fetching owners for contract ${contractAddress} using NFT API`, 'eth', 'nft');
    do {
      const params = {
        contractAddress,
        withTokenBalances,
        pageSize: 100,
      };
      if (pageKey) params.pageKey = pageKey;

      const response = await retry(
        async () => {
          const result = await nftClient.request({
            method: 'alchemy_getOwnersForCollection',
            params: [params],
          });
          return { status: 'success', result };
        },
        { retries: 3, delay: 1000, backoff: true }
      );

      if (response.result.ownerAddresses) {
        owners.push(...response.result.ownerAddresses);
      }
      pageKey = response.result.pageKey || null;
      pageCount++;

      if (pageCount >= maxPages) {
        logger.warn(context, `Reached max pages (${maxPages}), stopping pagination`, 'eth', 'nft');
        break;
      }
    } while (pageKey);

    logger.info(context, `Fetched ${owners.length} owners via NFT API`, 'eth', 'nft');
    return owners;
  } catch (error) {
    logger.error(context, `Failed to fetch owners via NFT API: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
    throw error;
  }
}

// Fetch owners using on-chain ownerOf calls
async function fetchOwnersOnChain(contractAddress, totalSupply, abi, contractKey) {
  const owners = [];
  const tokenBalancesMap = new Map();
  const chunkSize = 100;
  const context = `test/${contractKey}`;
  let burnedTokens = 0;
  let nonExistentTokens = 0;
  const nonExistentTokenIds = [];

  try {
    logger.info(context, `Fetching owners on-chain for contract ${contractAddress}`, 'eth', 'nft');
    for (let start = 1; start <= totalSupply; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, totalSupply);
      const tokenIds = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));

      const calls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi,
        functionName: 'ownerOf',
        args: [tokenId],
      }));

      const results = await retry(
        async () => {
          const responses = await Promise.all(
            calls.map(call =>
              client
                .readContract({
                  address: call.address,
                  abi: call.abi,
                  functionName: call.functionName,
                  args: call.args,
                })
                .catch(error => {
                  if (process.env.DEBUG_NON_EXISTENT === 'true') {
                    logger.debug(
                      context,
                      `ownerOf failed for token ${call.args[0]}: ${error.message}`,
                      'eth',
                      'nft'
                    );
                  }
                  return null;
                })
            )
          );
          return responses.map((result, idx) => ({
            tokenId: Number(tokenIds[idx]),
            owner: result,
          }));
        },
        { retries: 3, delay: 3000, backoff: true }
      );

      results.forEach(({ tokenId, owner }) => {
        if (owner && owner.toLowerCase() !== burnAddress.toLowerCase()) {
          if (!tokenBalancesMap.has(owner)) {
            tokenBalancesMap.set(owner, []);
          }
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        } else if (owner && owner.toLowerCase() === burnAddress.toLowerCase()) {
          burnedTokens++;
          tokenBalancesMap.set(owner, tokenBalancesMap.get(owner) || []);
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        } else {
          nonExistentTokens++;
          nonExistentTokenIds.push(tokenId);
          if (process.env.DEBUG_NON_EXISTENT === 'true') {
            logger.debug(
              context,
              `Token ${tokenId} is non-existent (owner: ${owner || 'null'})`,
              'eth',
              'nft'
            );
          }
        }
      });

      logger.debug(context, `Processed token IDs ${start} to ${end}`, 'eth', 'nft');
    }

    tokenBalancesMap.forEach((tokenBalances, ownerAddress) => {
      owners.push({
        ownerAddress,
        tokenBalances,
      });
    });

    if (process.env.DEBUG_NON_EXISTENT === 'true') {
      logger.info(
        context,
        `Raw owners before filtering: ${owners.length} (${owners.map(o => `${o.ownerAddress} [${o.tokenBalances.length} tokens]`).join(', ')})`,
        'eth',
        'nft'
      );
    } else {
      logger.info(context, `Raw owners before filtering: ${owners.length} owners`, 'eth', 'nft');
    }

    logger.info(
      context,
      `Fetched ${owners.length} owners on-chain, ${burnedTokens} burned tokens, ${nonExistentTokens} non-existent tokens, nonExistentTokenIds: [${nonExistentTokenIds.join(', ')}]`,
      'eth',
      'nft'
    );
    return { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds };
  } catch (error) {
    logger.error(context, `Failed to fetch owners on-chain: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
    throw error;
  }
}

// Test function for a single NFT collection
// ... (previous imports and setup remain unchanged)

// Test function for a single NFT collection
async function testNFTHolders(contractKey) {
  const contractConfig = nftContracts[contractKey];
  if (!contractConfig) {
    logger.warn('test', `Skipping ${contractKey}: not found`, 'eth', 'nft');
    return null;
  }

  const contractAddress = contractConfig.contractAddress;
  const contractName = contractConfig.name;
  const context = `test/${contractKey}`;
  const abi = contractAbis[contractKey];

  if (!isAddress(contractAddress)) {
    logger.error(context, `${contractName}: Invalid contract address: ${contractAddress}`, 'eth', 'nft');
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
    // Step 1: Fetch totalSupply
    let stepStart = process.hrtime.bigint();
    logger.info(context, `Fetching contract state for ${contractName} (${contractAddress})`, 'eth', 'nft');
    let totalSupply;
    let totalBurned = 0n;
    let totalMinted;

    if (contractKey === 'ascendant') {
      totalSupply = await retry(
        () =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: 'tokenId',
          }),
        { retries: 3, delay: 3000, backoff: true }
      );
      totalMinted = Number(totalSupply);
      summary.totalMinted = totalMinted;
      logger.info(context, `Contract state: totalMinted=${totalMinted}`, 'eth', 'nft');
    } else {
      const supplyFunction = 'totalSupply';
      totalSupply = await retry(
        () =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: supplyFunction,
          }),
        { retries: 3, delay: 3000, backoff: true }
      );

      totalBurned = await retry(
        () =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: 'totalBurned',
          }),
        { retries: 3, delay: 3000, backoff: true }
      ).catch(() => 0n);

      const totalTokens = Number(totalSupply);
      totalBurned = Number(totalBurned);
      totalMinted = totalTokens + totalBurned;
      summary.totalLiveSupply = totalTokens;
      summary.totalBurned = totalBurned;
      summary.totalMinted = totalMinted;
      logger.info(
        context,
        `Contract state: totalLiveSupply=${totalTokens}, totalBurned=${totalBurned}, totalMinted=${totalMinted}`,
        'eth',
        'nft'
      );
    }

    const totalTokens = Number(totalSupply);
    summary.timings.totalSupply = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 2: Fetch owners using on-chain ownerOf
    stepStart = process.hrtime.bigint();
    const { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds } = await fetchOwnersOnChain(
      contractAddress,
      totalTokens,
      abi,
      contractKey
    );
    summary.burnedTokens = burnedTokens;
    summary.nonExistentTokens = nonExistentTokens;
    summary.nonExistentTokenIds = nonExistentTokenIds;
    summary.timings.fetchOwners = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Log invalid owners
    stepStart = process.hrtime.bigint();
    const invalidOwners = owners.filter(owner => !owner?.ownerAddress || owner.tokenBalances?.length === 0);
    if (invalidOwners.length > 0) {
      logger.warn(
        context,
        `Found ${invalidOwners.length} invalid owners: ${invalidOwners.map(o => o.ownerAddress || 'null').join(', ')}`,
        'eth',
        'nft'
      );
    }

    const filteredOwners = owners.filter(
      owner =>
        owner?.ownerAddress &&
        owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() &&
        owner.tokenBalances?.length > 0
    );

    logger.info(context, `Filtered ${filteredOwners.length} valid owners`, 'eth', 'nft');

    // Step 3: Build holders data
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
      } catch (e) {
        logger.warn(context, `Invalid wallet address: ${owner.ownerAddress}`, 'eth', 'nft');
        continue;
      }

      const tokenIds = [];
      const tiers = Array(maxTier + 1).fill(0);
      let total = 0;

      for (const tb of owner.tokenBalances) {
        if (!tb.tokenId) continue;
        const tokenId = Number(tb.tokenId);
        if (seenTokenIds.has(tokenId)) {
          logger.warn(context, `Duplicate tokenId ${tokenId} for wallet ${wallet}`, 'eth', 'nft');
          continue;
        }
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
    logger.info(context, `Processed ${holdersMap.size} unique holders, ${tokenCount} tokens`, 'eth', 'nft');
    summary.timings.buildHolders = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 4: Fetch tiers for all tokens
    stepStart = process.hrtime.bigint();
    const tokenIds = Array.from(tokenOwnerMap.keys()).filter(id => !nonExistentTokenIds.includes(id));
    if (tokenIds.length > 0) {
      logger.info(context, `Fetching tiers for ${tokenIds.length} valid tokens`, 'eth', 'nft');

      // Load cache
      const cache = await loadCache();
      const contractCache = cache[contractAddress] || {};
      const tierResults = [];
      const uncachedTokenIds = tokenIds.filter(id => !contractCache[id]);

      if (uncachedTokenIds.length > 0) {
        const tierCalls = uncachedTokenIds.map(tokenId => ({
          address: contractAddress,
          abi,
          functionName: tierFunctions[contractKey].name,
          args: [BigInt(tokenId)],
        }));

        const chunkSize = 100;
        for (let i = 0; i < tierCalls.length; i += chunkSize) {
          const chunk = tierCalls.slice(i, i + chunkSize);
          const tokenIdsChunk = uncachedTokenIds.slice(i, i + chunkSize);

          const clientIndex = Math.floor(i / chunkSize) % clients.length;
          const currentClient = clients[clientIndex];
          logger.debug(context, `Using provider ${providers[clientIndex].name} for tier chunk ${Math.floor(i / chunkSize) + 1}`, 'eth', 'nft');

          try {
            const results = await retry(
              async () => {
                const multicallResult = await currentClient.multicall({
                  contracts: chunk,
                  multicallAddress: MULTICALL3_ADDRESS,
                  allowFailure: true,
                });
                return multicallResult.map((result, idx) => {
                  if (result.status === 'success' && result.result !== undefined) {
                    return {
                      status: 'success',
                      result: result.result,
                      tokenId: tokenIdsChunk[idx],
                    };
                  }
                  return {
                    status: 'failure',
                    tokenId: tokenIdsChunk[idx],
                    error: result.error || 'Multicall failed',
                  };
                });
              },
              { retries: 3, delay: 1000, backoff: true }
            );
            tierResults.push(...results);
            logger.debug(context, `Processed tier chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(tierCalls.length / chunkSize)}`, 'eth', 'nft');
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            logger.error(context, `Failed to fetch tier chunk ${i / chunkSize + 1}: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
            tierResults.push(...chunk.map((_, idx) => ({
              status: 'failure',
              tokenId: tokenIdsChunk[idx],
              error: error.message,
            })));
          }
        }

        // Update cache
        tierResults.forEach(result => {
          if (result.status === 'success' && result.result !== null) {
            let cacheValue;
            if (contractKey === 'ascendant' && typeof result.result === 'string') {
              try {
                cacheValue = JSON.parse(result.result);
              } catch {
                return;
              }
            } else {
              cacheValue = result.result;
            }
            contractCache[result.tokenId] = cacheValue;
          }
        });
        cache[contractAddress] = contractCache;
        await saveCache(cache);
      }

      // Add cached results
      tokenIds.forEach(tokenId => {
        if (contractCache[tokenId]) {
          tierResults.push({
            status: 'success',
            result: contractCache[tokenId],
            tokenId,
          });
        }
      });

      // Update holders with tier data
      tierResults.forEach(result => {
        if (result.status === 'success' && result.result !== null) {
          const tokenId = result.tokenId;
          let tier;
          let parsedResult;

          if (contractKey === 'ascendant') {
            if (process.env.DEBUG_TIERS === 'true') {
              logger.debug(context, `Raw getNFTAttribute result for token ${tokenId}: ${JSON.stringify(result.result)}`, 'eth', 'nft');
            }

            if (typeof result.result === 'string') {
              try {
                parsedResult = JSON.parse(result.result);
              } catch (e) {
                logger.error(context, `Failed to parse JSON for token ${tokenId}: ${result.result}`, { error: e.message }, 'eth', 'nft');
                return;
              }
            } else if (Array.isArray(result.result) && result.result.length === 3) {
              parsedResult = {
                rarityNumber: result.result[0],
                tier: result.result[1],
                rarity: result.result[2],
              };
            } else if (typeof result.result === 'object' && result.result !== null) {
              parsedResult = result.result; // Accept JSON object directly
            } else {
              logger.error(context, `Invalid tuple format for token ${tokenId}: ${JSON.stringify(result.result)}`, 'eth', 'nft');
              return;
            }

            // Validate and convert types
            if (
              typeof parsedResult.rarityNumber !== 'undefined' &&
              typeof parsedResult.tier !== 'undefined' &&
              typeof parsedResult.rarity !== 'undefined'
            ) {
              // Convert string values to numbers
              parsedResult.rarityNumber = Number(parsedResult.rarityNumber);
              parsedResult.tier = Number(parsedResult.tier);
              parsedResult.rarity = Number(parsedResult.rarity);

              if (
                isNaN(parsedResult.rarityNumber) ||
                isNaN(parsedResult.tier) ||
                isNaN(parsedResult.rarity)
              ) {
                logger.error(context, `Invalid numeric values for token ${tokenId}: ${JSON.stringify(parsedResult)}`, 'eth', 'nft');
                return;
              }

              tier = parsedResult.tier;

              // Handle edge cases (e.g., rarity: 0)
              if (parsedResult.rarity === 0) {
                logger.warn(context, `Token ${tokenId} has rarity=0, full result: ${JSON.stringify(parsedResult)}`, 'eth', 'nft');
              }
            } else {
              logger.error(context, `Invalid JSON structure for token ${tokenId}: ${JSON.stringify(parsedResult)}`, 'eth', 'nft');
              return;
            }

            if (tier < 1 || tier > 8) {
              logger.warn(context, `Invalid tier ${tier} for token ${tokenId}, full result: ${JSON.stringify(parsedResult)}`, 'eth', 'nft');
              return;
            }
          } else {
            tier = Number(result.result);
            if (tier < 1 || tier > maxTier) {
              logger.warn(context, `Invalid tier ${tier} for token ${tokenId}`, 'eth', 'nft');
              return;
            }
          }

          const wallet = tokenOwnerMap.get(tokenId);
          if (wallet) {
            const holder = holdersMap.get(wallet);
            if (holder) {
              holder.tiers[tier] += 1;
            } else {
              logger.warn(context, `No holder found for wallet ${wallet} and token ${tokenId}`, 'eth', 'nft');
            }
          } else {
            logger.warn(context, `No wallet found for token ${tokenId}`, 'eth', 'nft');
          }
        } else {
          logger.error(context, `Failed to fetch tier for token ${result.tokenId}: ${result.error || 'Unknown error'}`, 'eth', 'nft');
        }
      });
    }
    summary.timings.fetchTiers = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 5: Log results
    stepStart = process.hrtime.bigint();
    logger.info(context, `=== ${contractName} Holders Data ===`, 'eth', 'nft');
    const holderList = Array.from(holdersMap.values());
    holderList.forEach(holder => {
      logger.info(
        context,
        `Wallet: ${holder.wallet}, Tokens: ${holder.total}, Token IDs: [${holder.tokenIds.join(', ')}], Tiers: ${holder.tiers}`,
        'eth',
        'nft'
      );
    });

    // Summary
    logger.info(
      context,
      `Summary: ${holderList.length} unique holders, ${tokenCount} live tokens, totalLiveSupply=${totalTokens}, totalMinted=${totalMinted}`,
      'eth',
      'nft'
    );

    // Validate against totalSupply
    if (contractKey !== 'ascendant') {
      const expectedLiveTokens = totalTokens;
      const missingTokens = expectedLiveTokens - tokenCount;
      if (tokenCount < expectedLiveTokens) {
        summary.mismatch = `Processed ${tokenCount} tokens, but totalLiveSupply=${expectedLiveTokens}. Missing ${missingTokens} tokens (likely ${burnedTokens} burned, ${nonExistentTokens} non-existent).`;
        logger.warn(context, summary.mismatch, 'eth', 'nft');
      } else if (tokenCount > expectedLiveTokens) {
        summary.mismatch = `Processed ${tokenCount} tokens, exceeding totalLiveSupply=${expectedLiveTokens}. Possible duplicate tokens.`;
        logger.warn(context, summary.mismatch, 'eth', 'nft');
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
    logger.error(context, `Test failed: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
    summary.error = error.message;
    summary.timings.totalExecution = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    return summary;
  }
}

// ... (rest of the script remains unchanged: testAllNFTHolders, main)

// Main test function for all NFT collections
async function testAllNFTHolders() {
  const contractKeys = ['stax', 'element280', 'element369', 'ascendant'];
  const summaries = [];

  for (const contractKey of contractKeys) {
    const summary = await testNFTHolders(contractKey);
    if (summary) {
      summaries.push(summary);
    }
  }

  return summaries;
}

// Run the test
async function main() {
  try {
    // Reset cache before running tests
    await resetCache();

    const summaries = await testAllNFTHolders();

    // Log collection summary
    logger.info('test', '=== NFT Collections Summary ===', 'eth', 'nft');
    console.table(
      summaries.map(summary => ({
        Contract: summary.contractName,
        TotalMinted: summary.totalMinted,
        TotalLiveSupply: summary.totalLiveSupply || 'N/A',
        TotalBurned: summary.totalBurned || 'N/A',
        UniqueHolders: summary.uniqueHolders,
        LiveTokens: summary.liveTokens,
        BurnedTokens: summary.burnedTokens,
        Status: summary.status,
        Mismatch: summary.mismatch || 'None',
        Error: summary.error || 'None',
      })),
      [
        'Contract',
        'TotalMinted',
        'TotalLiveSupply',
        'TotalBurned',
        'UniqueHolders',
        'LiveTokens',
        'BurnedTokens',
        'Status',
        'Mismatch',
        'Error',
      ]
    );

    // Log timings summary
    logger.info('test', '=== NFT Collections Timings (ms) ===', 'eth', 'nft');
    console.table(
      summaries.map(summary => ({
        Contract: summary.contractName,
        TotalSupply: summary.timings.totalSupply.toFixed(2),
        FetchOwners: summary.timings.fetchOwners.toFixed(2),
        BuildHolders: summary.timings.buildHolders.toFixed(2),
        FetchTiers: summary.timings.fetchTiers.toFixed(2),
        LogResults: summary.timings.logResults.toFixed(2),
        TotalExecution: summary.timings.totalExecution.toFixed(2),
      })),
      ['Contract', 'TotalSupply', 'FetchOwners', 'BuildHolders', 'FetchTiers', 'LogResults', 'TotalExecution']
    );

    const hasErrors = summaries.some(s => s.error);
    const hasMismatches = summaries.some(s => s.mismatch);

    if (hasErrors) {
      logger.error('test', 'Some tests failed. Check errors in summary.', 'eth', 'nft');
      process.exit(1);
    } else if (hasMismatches) {
      logger.warn('test', 'All tests completed, but some mismatches were found.', 'eth', 'nft');
      process.exit(0);
    } else {
      logger.info('test', 'All tests completed successfully with no mismatches.', 'eth', 'nft');
      process.exit(0);
    }
  } catch (error) {
    logger.error('test', 'Tests failed', { stack: error.stack }, 'eth', 'nft');
    process.exit(1);
  }
}

main();