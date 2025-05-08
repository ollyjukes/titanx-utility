#!/usr/bin/env node

import { createPublicClient, http, getAddress, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import pino from 'pino';

// Resolve project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(projectRoot, '.env.local') });

// Pino logger configuration
const logger = pino({
  level: 'info', // Show INFO and ERROR only
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

// Alchemy configuration
const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error({ context: 'test' }, 'ALCHEMY_API_KEY is not set');
  process.exit(1);
}

const alchemy = new Alchemy({
  apiKey: alchemyApiKey,
  network: Network.ETH_MAINNET,
});

// Multicall3 contract address
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

// Provider configuration
const providers = [
  {
    name: 'Alchemy',
    url: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    rateLimit: 10000, // Paid tier's 10,000 CUPS
    requestCount: 0,
    lastRequestTime: 0,
  },
];

// Initialize client
const clients = [
  {
    client: createPublicClient({
      chain: mainnet,
      transport: http(providers[0].url, { timeout: 30000 }), // 30s timeout
    }),
    providerIndex: 0,
  },
];

// Cache configuration
const burnAddress = '0x0000000000000000000000000000000000000000';
const CACHE_FILE = path.join(projectRoot, 'tier_cache.json');
const CACHE_TTL = 1000 * 60 * 60; // 1 hour TTL
let inMemoryCache = {};

// Select provider with rate limit checks
async function selectProvider(context, operationType) {
  const now = Date.now();
  const provider = providers[0];
  const client = clients[0].client;
  const requestCost = operationType === 'batch' ? 25 : operationType === 'multicall' ? 26 : 1;

  const timeSinceLast = (now - provider.lastRequestTime) / 1000;
  if (timeSinceLast >= 1) {
    provider.requestCount = 0;
  }

  if (provider.requestCount + requestCost > provider.rateLimit) {
    logger.info({ context }, `Rate limit near (${provider.requestCount}/${provider.rateLimit} CUs), waiting 300ms...`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return selectProvider(context, operationType);
  }

  provider.requestCount += requestCost;
  provider.lastRequestTime = now;
  return { provider, client };
}

// Retry function
async function retry(operation, { retries = 5, delay = 300, backoff = true, timeout = 30000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await Promise.race([
        operation(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout')), timeout)),
      ]);
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt === retries) {
        logger.error({ context: 'test/retry' }, `Rate limit exceeded after ${retries} attempts`);
        throw new Error('Rate limit exceeded');
      }
      logger.info({ context: 'test/retry' }, `Retry ${attempt}/${retries} failed: ${error.message}`);
      const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay;
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 5000)));
    }
  }
  throw lastError;
}

// Fetch burned and transferred tokens
async function fetchDispositionEvents(context, client, contractAddress, startBlock, endBlock, batchSize = 10000) {
  const cacheKey = `${contractAddress}-dispositions`;
  const now = Date.now();
  if (inMemoryCache[cacheKey] && now - inMemoryCache[cacheKey].timestamp < CACHE_TTL) {
    logger.info({ context }, `Returning cached disposition data for ${cacheKey}`);
    return inMemoryCache[cacheKey].data;
  }

  logger.info({ context }, `Fetching disposition events from block ${startBlock} to ${endBlock}`);
  const burnedAddresses = new Set();
  const transferredAddresses = new Set();
  const endBlockNumber = Number(endBlock);
  if (Number.isNaN(endBlockNumber) || endBlockNumber < startBlock) {
    throw new Error(`Invalid endBlock: ${endBlock}`);
  }

  const blockRanges = [];
  for (let fromBlock = startBlock; fromBlock <= endBlockNumber; fromBlock += batchSize) {
    const toBlock = Math.min(fromBlock + batchSize - 1, endBlockNumber);
    blockRanges.push({ fromBlock, toBlock });
  }

  const concurrencyLimit = 5;
  for (let i = 0; i < blockRanges.length; i += concurrencyLimit) {
    const batch = blockRanges.slice(i, i + concurrencyLimit);
    await Promise.all(
      batch.map(async ({ fromBlock, toBlock }) => {
        try {
          const logs = await retry(() =>
            client.getLogs({
              address: contractAddress,
              event: {
                type: 'event',
                name: 'Transfer',
                inputs: [
                  { type: 'address', indexed: true, name: 'from' },
                  { type: 'address', indexed: true, name: 'to' },
                  { type: 'uint256', indexed: true, name: 'tokenId' },
                ],
              },
              fromBlock: BigInt(fromBlock),
              toBlock: BigInt(toBlock),
            })
          );
          logs.forEach((log) => {
            const fromAddr = log.args.from.toLowerCase();
            const toAddr = log.args.to.toLowerCase();
            if (toAddr === burnAddress.toLowerCase()) {
              burnedAddresses.add(fromAddr);
            } else if (fromAddr !== '0x0000000000000000000000000000000000000000') {
              transferredAddresses.add(fromAddr);
            }
          });
          logger.info({ context }, `Processed ${logs.length} transfers from ${fromBlock} to ${toBlock}`);
        } catch (error) {
          logger.error({ context }, `Failed to fetch transfers for blocks ${fromBlock}-${toBlock}: ${error.message}`);
          if (error.message.includes('Log response size exceeded')) {
            const smallerBatchSize = Math.floor(batchSize / 2);
            if (smallerBatchSize < 1000) {
              logger.error({ context }, `Block range too small: ${smallerBatchSize}`);
              return;
            }
            const subResult = await fetchDispositionEvents(
              context,
              client,
              contractAddress,
              fromBlock,
              BigInt(Math.min(fromBlock + smallerBatchSize - 1, endBlockNumber)),
              smallerBatchSize
            );
            subResult.burnedAddresses.forEach((addr) => burnedAddresses.add(addr));
            subResult.transferredAddresses.forEach((addr) => transferredAddresses.add(addr));
          }
        }
      })
    );
  }

  const result = { burnedAddresses, transferredAddresses };
  inMemoryCache[cacheKey] = { timestamp: now, data: result };
  const cache = await loadCache();
  cache[cacheKey] = {
    timestamp: now,
    burnedCount: burnedAddresses.size,
    transferredCount: transferredAddresses.size,
  };
  await saveCache(cache);
  return result;
}

// Fetch owners using Alchemy SDK
async function fetchOwnersAlchemy(contractAddress, contractKey) {
  const context = `test/${contractKey}`;
  try {
    logger.info({ context }, `Fetching owners for ${contractAddress} using Alchemy SDK`);
    const ownersResponse = await alchemy.nft.getOwnersForContract(contractAddress, { withTokenBalances: true });
    logger.info({ context }, `Raw owners count: ${ownersResponse.owners.length}`);

    const owners = [];
    const tokenBalancesMap = new Map();
    let burnedTokens = 0;
    const nonExistentTokens = 0;
    const nonExistentTokenIds = [];

    const filteredOwners = ownersResponse.owners.filter(
      (owner) => owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances.length > 0
    );
    logger.info({ context }, `Filtered live owners count: ${filteredOwners.length}`);

    filteredOwners.forEach((owner) => {
      const ownerAddress = owner.ownerAddress.toLowerCase();
      const tokenBalances = owner.tokenBalances.map((tb) => ({
        tokenId: tb.tokenId.toString(),
      }));
      if (ownerAddress === burnAddress.toLowerCase()) {
        burnedTokens += tokenBalances.length;
      }
      tokenBalancesMap.set(ownerAddress, tokenBalances);
      owners.push({ ownerAddress, tokenBalances });
    });

    logger.info({ context }, `Fetched ${owners.length} owners, ${burnedTokens} burned, ${nonExistentTokens} non-existent`);
    return { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds, lastProcessedBlock: null };
  } catch (error) {
    logger.error({ context }, `Failed to fetch owners: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

// Cache functions
async function resetCache() {
  try {
    await fs.unlink(CACHE_FILE).catch(() => {});
    await fs.writeFile(CACHE_FILE, JSON.stringify({}));
    inMemoryCache = {};
    logger.info({ context: 'test' }, `Initialized cache`);
  } catch (error) {
    logger.error({ context: 'test' }, `Failed to reset cache: ${error.message}`);
    throw error;
  }
}

async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  const serializeBigInt = (obj) => {
    if (typeof obj === 'bigint') return obj.toString();
    if (Array.isArray(obj)) return obj.map(serializeBigInt);
    if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, serializeBigInt(value)]));
    }
    return obj;
  };
  await fs.writeFile(CACHE_FILE, JSON.stringify(serializeBigInt(cache), null, 2));
}

// NFT contract configuration
const nftContracts = {
  element280: {
    name: 'Element 280',
    symbol: 'ELMNT',
    chain: 'ETH',
    contractAddress: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
    deploymentBlock: 20945304,
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
};

// Contract ABI
const contractAbis = {
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
};

// Vault ABI
const element280VaultAbi = [
  {
    inputs: [
      { internalType: 'address', name: '_E280', type: 'address' },
      { internalType: 'address', name: '_E280_NFT', type: 'address' },
      { internalType: 'address', name: '_owner', type: 'address' },
      { internalType: 'address', name: '_devWallet', type: 'address' },
      { internalType: 'address', name: '_treasury', type: 'address' },
      { internalType: 'uint256', name: '_minCyclePool', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  { inputs: [{ internalType: 'address', name: 'target', type: 'address' }], name: 'AddressEmptyCode', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'AddressInsufficientBalance',
    type: 'error',
  },
  { inputs: [], name: 'FailedInnerCall', type: 'error' },
  { inputs: [{ internalType: 'address', name: 'owner', type: 'address' }], name: 'OwnableInvalidOwner', type: 'error' },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
    type: 'error',
  },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }], name: 'SafeERC20FailedOperation', type: 'error' },
  { anonymous: false, inputs: [], name: 'CycleUpdated', type: 'event' },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'previousOwner', type: 'address' },
      { indexed: true, internalType: 'address', name: 'newOwner', type: 'address' },
    ],
    name: 'OwnershipTransferStarted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'previousOwner', type: 'address' },
      { indexed: true, internalType: 'address', name: 'newOwner', type: 'address' },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    inputs: [],
    name: 'E280',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'E280_NFT',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [], name: 'acceptOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  {
    inputs: [{ internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' }],
    name: 'claimRewards',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'claimed',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'claimedCycles',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'currentCycle',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'id', type: 'uint256' }],
    name: 'cycles',
    outputs: [
      { internalType: 'uint256', name: 'timestamp', type: 'uint256' },
      { internalType: 'uint256', name: 'tokensPerMultiplier', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'devWallet',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getNextCyclePool',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getNextCycleTime',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256[]', name: 'tokenIds', type: 'uint256[]' },
      { internalType: 'address', name: 'account', type: 'address' },
    ],
    name: 'getRewards',
    outputs: [
      { internalType: 'bool[]', name: 'availability', type: 'bool[]' },
      { internalType: 'uint256', name: 'totalReward', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'minCyclePool',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pendingOwner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [], name: 'renounceOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  {
    inputs: [{ internalType: 'uint256', name: 'limit', type: 'uint256' }],
    name: 'setMinCyclePool',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '_address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalE280Burned',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalRewadsPaid',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalRewardPool',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'treasury',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [], name: 'updateCycle', outputs: [], stateMutability: 'nonpayable', type: 'function' },
];

// Vault address
const vaultAddresses = {
  element280: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97',
};

// Tier function definition
const tierFunctions = {
  element280: { name: 'getNftTier', contract: 'nft', inputs: ['tokenId'], outputs: ['tier'] },
};

// Test function
async function testNFTHolders() {
  const contractKey = 'element280';
  const contractConfig = nftContracts[contractKey];
  const contractAddress = contractConfig.contractAddress;
  const contractName = contractConfig.name;
  const context = `test/${contractKey}`;
  const abi = contractAbis[contractKey];

  if (!isAddress(contractAddress)) {
    logger.error({ context }, `${contractName}: Invalid contract address`);
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
    burnedAddresses: [],
    transferredAddresses: [],
    beginningBlock: BigInt(contractConfig.deploymentBlock),
    lastProcessedBlock: null,
    tierCounts: {},
    status: 'Failed',
    mismatch: null,
    timings: {
      totalSupply: 0,
      fetchOwners: 0,
      buildHolders: 0,
      fetchTiers: 0,
      fetchRewards: 0,
      logResults: 0,
      totalExecution: 0,
    },
  };

  const totalStart = process.hrtime.bigint();

  try {
    // Step 1: Fetch totalSupply, totalBurned, and disposition events
    let stepStart = process.hrtime.bigint();
    logger.info({ context }, `Fetching state for ${contractName}`);
    const { client } = await selectProvider(context, 'multicall');

    const calls = [
      { address: contractAddress, abi, functionName: 'totalSupply' },
      { address: contractAddress, abi, functionName: 'totalBurned' },
    ];
    const [supplyResult, burnedResult] = await retry(() =>
      client.multicall({
        contracts: calls,
        multicallAddress: MULTICALL3_ADDRESS,
        allowFailure: true,
      })
    );

    const totalSupply = supplyResult.status === 'success' ? supplyResult.result : 0n;
    const totalBurned = burnedResult.status === 'success' ? burnedResult.result : 0n;

    const totalTokens = Number(totalSupply);
    summary.totalLiveSupply = totalTokens;
    summary.totalBurned = Number(totalBurned);
    summary.totalMinted = totalTokens + summary.totalBurned;
    logger.info({ context }, `State: live=${totalTokens}, burned=${summary.totalBurned}, minted=${summary.totalMinted}`);

    // Fetch disposition events
    const { burnedAddresses, transferredAddresses } = await fetchDispositionEvents(
      context,
      client,
      contractAddress,
      contractConfig.deploymentBlock,
      await client.getBlockNumber()
    );
    summary.burnedTokens = totalBurned; // Use contract's totalBurned for consistency
    summary.burnedAddresses = Array.from(burnedAddresses);
    summary.transferredAddresses = Array.from(transferredAddresses);
    logger.info({ context }, `Verified ${summary.burnedAddresses.length} burn addresses, ${summary.transferredAddresses.length} transfer addresses`);

    // Validate burned tokens
    if (Number(totalBurned) !== summary.totalBurned) {
      summary.mismatch = `Burned tokens mismatch: ${totalBurned} (events) vs ${summary.totalBurned} (contract)`;
      logger.info({ context }, summary.mismatch);
    }

    // Validate totalLiveSupply
    const expectedLiveSupply = 8079;
    if (totalTokens !== expectedLiveSupply) {
      summary.mismatch = summary.mismatch
        ? `${summary.mismatch}; Live supply mismatch: ${totalTokens} vs expected ${expectedLiveSupply}`
        : `Live supply mismatch: ${totalTokens} vs expected ${expectedLiveSupply}`;
      logger.info({ context }, `Live supply mismatch: ${totalTokens} vs expected ${expectedLiveSupply}`);
    }

    summary.timings.totalSupply = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 2: Fetch owners
    stepStart = process.hrtime.bigint();
    const cacheKey = `${contractAddress}-owners`;
    const now = Date.now();
    let ownersData;

    if (inMemoryCache[cacheKey] && now - inMemoryCache[cacheKey].timestamp < CACHE_TTL) {
      logger.info({ context }, `Returning cached owners data for ${cacheKey}`);
      ownersData = inMemoryCache[cacheKey].data;
    } else {
      ownersData = await fetchOwnersAlchemy(contractAddress, contractKey);
      inMemoryCache[cacheKey] = { timestamp: now, data: ownersData };
    }

    const { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds, lastProcessedBlock } = ownersData;
    summary.nonExistentTokens = nonExistentTokens;
    summary.nonExistentTokenIds = nonExistentTokenIds;
    summary.lastProcessedBlock = lastProcessedBlock || (await client.getBlockNumber());
    summary.timings.fetchOwners = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 3: Build holders
    stepStart = process.hrtime.bigint();
    const filteredOwners = owners.filter(
      (owner) =>
        owner?.ownerAddress &&
        owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() &&
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
      let multiplierSum = 0;

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
        holdersMap.set(wallet, {
          wallet,
          tokenIds,
          tiers,
          total,
          multiplierSum,
          percentage: 0,
          rank: 0,
          claimableRewards: 0,
        });
      }
    }

    summary.uniqueHolders = holdersMap.size;
    summary.liveTokens = tokenCount;
    logger.info({ context }, `Processed ${holdersMap.size} holders, ${tokenCount} tokens`);
    summary.timings.buildHolders = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 4: Fetch tiers
    stepStart = process.hrtime.bigint();
    const tokenIds = Array.from(tokenOwnerMap.keys()).filter((id) => !nonExistentTokenIds.includes(id));
    if (tokenIds.length > 0) {
      logger.info({ context }, `Fetching tiers for ${tokenIds.length} tokens`);

      const cache = await loadCache();
      const contractCache = cache[contractAddress] || { owners: {}, tiers: {}, nonExistent: [] };
      const tierResults = [];
      const processedTokenIds = new Set();
      const uncachedTokenIds = tokenIds.filter((id) => !contractCache.tiers[id]);

      if (uncachedTokenIds.length > 0) {
        const tierCalls = uncachedTokenIds.map((tokenId) => ({
          address: contractAddress,
          abi,
          functionName: tierFunctions[contractKey].name,
          args: [BigInt(tokenId)],
        }));

        const chunkSize = 500; // Increased for performance
        const concurrencyLimit = 10;
        for (let i = 0; i < tierCalls.length; i += chunkSize * concurrencyLimit) {
          const batch = [];
          for (let j = 0; j < concurrencyLimit && i + j * chunkSize < tierCalls.length; j++) {
            const start = i + j * chunkSize;
            const chunk = tierCalls.slice(start, start + chunkSize);
            const tokenIdsChunk = uncachedTokenIds.slice(start, start + chunkSize);
            batch.push({ chunk, tokenIdsChunk });
          }
          await Promise.all(
            batch.map(async ({ chunk, tokenIdsChunk }) => {
              const { client } = await selectProvider(context, 'multicall');
              try {
                const results = await retry(
                  async () => {
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
                  },
                  { retries: 5, delay: 500, timeout: 30000 }
                );
                return results;
              } catch (error) {
                logger.error({ context }, `Failed tier chunk ${i / chunkSize + 1}: ${error.message}`);
                return chunk.map((_, idx) => ({
                  status: 'failure',
                  tokenId: tokenIdsChunk[idx],
                  error: error.message,
                }));
              }
            })
          ).then((results) => tierResults.push(...results.flat()));
          logger.info({ context }, `Tiers progress: ${Math.min(((i + chunkSize * concurrencyLimit) / tierCalls.length) * 100).toFixed(2)}%`);
        }

        tierResults.forEach((result) => {
          if (result.status === 'success' && result.result !== null && !processedTokenIds.has(result.tokenId)) {
            contractCache.tiers[result.tokenId] = result.result;
            processedTokenIds.add(result.tokenId);
          }
        });
        cache[contractAddress] = contractCache;
        await saveCache(cache);
      }

      tokenIds.forEach((tokenId) => {
        if (contractCache.tiers[tokenId] && !processedTokenIds.has(tokenId)) {
          tierResults.push({
            status: 'success',
            result: contractCache.tiers[tokenId],
            tokenId,
          });
          processedTokenIds.add(tokenId);
        }
      });

      summary.tierCounts = Object.keys(contractConfig.tiers).reduce((acc, tier) => {
        acc[tier] = { count: 0, name: contractConfig.tiers[tier].name };
        return acc;
      }, {});

      tierResults.forEach((result) => {
        if (result.status !== 'success' || result.result === null) {
          logger.info({ context }, `Failed tier for token ${result.tokenId}: ${result.error || 'Unknown error'}`);
          return;
        }

        const tokenId = result.tokenId;
        const tier = Number(result.result);
        if (tier < 1 || tier > maxTier) {
          logger.info({ context }, `Invalid tier ${tier} for token ${tokenId}`);
          return;
        }
        if (summary.tierCounts[tier]) {
          summary.tierCounts[tier].count += 1;
        }

        const wallet = tokenOwnerMap.get(tokenId);
        if (wallet) {
          const holder = holdersMap.get(wallet);
          if (holder) {
            holder.tiers[tier] += 1;
            holder.multiplierSum += contractConfig.tiers[tier]?.multiplier || 0;
          }
        }
      });
    }
    summary.timings.fetchTiers = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 5: Fetch claimable rewards
    stepStart = process.hrtime.bigint();
    const holders = Array.from(holdersMap.values());
    if (holders.length > 0 && vaultAddresses.element280 && isAddress(vaultAddresses.element280)) {
      logger.info({ context }, `Fetching claimable rewards for ${holders.length} holders`);

      const batchSize = 200; // Increased for performance
      const concurrencyLimit = 5;
      for (let i = 0; i < holders.length; i += batchSize) {
        const batchHolders = holders.slice(i, i + batchSize);
        logger.info({ context }, `Processing reward batch ${i / batchSize + 1} (${batchHolders.length} holders)`);

        const rewardCalls = batchHolders.map((holder) => ({
          address: vaultAddresses.element280,
          abi: element280VaultAbi,
          functionName: 'getRewards',
          args: [holder.tokenIds.map((id) => BigInt(id)), holder.wallet],
        }));

        const batchResults = await Promise.all(
          rewardCalls.map(async (call, idx) => {
            try {
              const { client } = await selectProvider(context, 'multicall');
              const result = await retry(
                async () => {
                  return await client.multicall({
                    contracts: [call],
                    multicallAddress: MULTICALL3_ADDRESS,
                    allowFailure: true,
                  });
                },
                { retries: 5, delay: 500, timeout: 30000 }
              );
              return { holder: batchHolders[idx], result: result[0], error: null };
            } catch (error) {
              return { holder: batchHolders[idx], result: null, error: error.message };
            }
          })
        );

        batchResults.forEach(({ holder, result, error }) => {
          if (error) {
            holder.claimableRewards = 0;
            logger.info({ context }, `Failed to fetch rewards for ${holder.wallet}: ${error}`);
          } else if (result?.status === 'success' && result.result) {
            const [, totalReward] = result.result;
            holder.claimableRewards = Number(totalReward) / 1e18;
          } else {
            holder.claimableRewards = 0;
            logger.info({ context }, `Invalid reward result for ${holder.wallet}: ${result?.error || 'Unknown error'}`);
          }
        });

        if (i + batchSize < holders.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } else {
      logger.info({ context }, `Vault address not set or invalid, skipping rewards`);
    }
    summary.timings.fetchRewards = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 6: Calculate ranks and percentages
    stepStart = process.hrtime.bigint();
    const totalMultiplierSum = holders.reduce((sum, h) => sum + h.multiplierSum, 0);
    holders.forEach((holder) => {
      holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
      holder.displayMultiplierSum = holder.multiplierSum / 10;
    });

    holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    holders.forEach((holder, index) => (holder.rank = index + 1));
    summary.timings.buildHolders += Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    // Step 7: Log results
    stepStart = process.hrtime.bigint();
    logger.info({ context }, `=== ${contractName} Holders ===`);
    if (process.env.LOG_WALLETS === 'true') {
      holders.forEach((holder) => {
        logger.info(
          { context },
          `Wallet: ${holder.wallet}, Tokens: ${holder.total}, Tiers: ${holder.tiers}, MultiplierSum: ${holder.multiplierSum}, Rank: ${holder.rank}, Percentage: ${holder.percentage.toFixed(2)}%, Rewards: ${holder.claimableRewards}`
        );
      });
    }

    logger.info(
      { context },
      `Summary: ${holdersMap.size} holders, ${tokenCount} tokens, live=${totalTokens}, minted=${summary.totalMinted}`
    );

    const expectedLiveTokens = totalTokens;
    const missingTokens = expectedLiveTokens - tokenCount;
    if (tokenCount < expectedLiveTokens) {
      summary.mismatch = `Processed ${tokenCount} tokens, expected ${expectedLiveTokens}. Missing ${missingTokens} (likely ${summary.burnedTokens} burned, ${nonExistentTokens} non-existent).`;
      logger.info({ context }, summary.mismatch);
    } else if (tokenCount > expectedLiveTokens) {
      summary.mismatch = `Processed ${tokenCount} tokens, exceeding ${expectedLiveTokens}.`;
      logger.info({ context }, summary.mismatch);
    } else {
      summary.status = 'Success';
    }
    summary.timings.logResults = Number(process.hrtime.bigint() - stepStart) / 1_000_000;

    summary.timings.totalExecution = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    return summary;
  } catch (error) {
    logger.error({ context }, `Test failed: ${error.message}`, { stack: error.stack });
    summary.error = error.message;
    summary.timings.totalExecution = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    return summary;
  }
}

// Main function
async function main() {
  try {
    await resetCache();
    const summary = await testNFTHolders();

    // Log summary
    logger.info({ context: 'test' }, '=== Element 280 Summary ===');
    console.table({
      Contract: summary.contractName,
      TotalMinted: summary.totalMinted,
      TotalLiveSupply: summary.totalLiveSupply,
      TotalBurned: summary.totalBurned,
      UniqueHolders: summary.uniqueHolders,
      LiveTokens: summary.liveTokens,
      BurnedTokens: summary.burnedTokens,
      BurnedAddresses: summary.burnedAddresses.length,
      TransferredAddresses: summary.transferredAddresses.length,
      BeginningBlock: summary.beginningBlock?.toString() || 'N/A',
      LastProcessedBlock: summary.lastProcessedBlock?.toString() || 'N/A',
      Status: summary.status,
      Mismatch: summary.mismatch || 'None',
      Error: summary.error || 'None',
    });

    // Log disposition addresses
    logger.info({ context: 'test' }, '=== Disposition Addresses ===');
    console.table({
      BurnedAddresses: summary.burnedAddresses.length,
      TransferredAddresses: summary.transferredAddresses.length,
    });

    // Log timings
    logger.info({ context: 'test' }, '=== Timings (ms) ===');
    console.table({
      Contract: summary.contractName,
      TotalSupply: summary.timings.totalSupply.toFixed(2),
      FetchOwners: summary.timings.fetchOwners.toFixed(2),
      BuildHolders: summary.timings.buildHolders.toFixed(2),
      FetchTiers: summary.timings.fetchTiers.toFixed(2),
      FetchRewards: summary.timings.fetchRewards.toFixed(2),
      LogResults: summary.timings.logResults.toFixed(2),
      TotalExecution: summary.timings.totalExecution.toFixed(2),
    });

    // Log tier counts
    logger.info({ context: 'test' }, '=== Element 280 Tier Counts ===');
    const tierTable = Object.entries(summary.tierCounts).map(([tier, data]) => ({
      Tier: tier,
      Name: data.name,
      Count: data.count,
    }));
    console.table(tierTable);

    if (summary.error) {
      logger.error({ context: 'test' }, 'Test failed');
      process.exit(1);
    } else if (summary.mismatch) {
      logger.info({ context: 'test' }, 'Test completed with mismatches');
      process.exit(0);
    } else {
      logger.info({ context: 'test' }, 'Test completed successfully');
      process.exit(0);
    }
  } catch (error) {
    logger.error({ context: 'test' }, `Tests failed: ${error.message}`, { stack: error.stack });
    process.exit(1);
  }
}

main();