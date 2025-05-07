#!/usr/bin/env node

import { createPublicClient, http, getAddress, isAddress } from 'viem';
import { mainnet } from 'viem/chains';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(projectRoot, '.env.local') });

// Console logger
const logger = {
    log: (level, context, message, meta = {}, ...args) => {
      const silent = process.env.SILENT === 'true';
      if (silent && !['error', 'summary'].includes(level)) return;
      if (level === 'debug' && process.env.DEBUG !== 'true') return;
      const prefix = `[${context}] [${level.toUpperCase()}]`;
      if (level === 'error') {
        console.error(`${prefix} ${message}`, meta, ...args);
      } else if (level === 'warn') {
        console.warn(`${prefix} ${message}`, ...args);
      } else if (level === 'debug') {
        console.log(`${prefix} ${message}`, ...args);
      } else {
        console.log(`${prefix} ${message}`, ...args);
      }
    },
    info: (context, message, ...args) => logger.log('info', context, message, {}, ...args),
    warn: (context, message, ...args) => logger.log('warn', context, message, {}, ...args),
    error: (context, message, meta = {}, ...args) => logger.log('error', context, message, meta, ...args),
    debug: (context, message, ...args) => logger.log('debug', context, message, {}, ...args),
    summary: (context, message, ...args) => logger.log('summary', context, message, {}, ...args),
    important: (context, message, ...args) => logger.log('important', context, message, {}, ...args),
  };

// Alchemy configuration
const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('test', 'ALCHEMY_API_KEY is not set');
  process.exit(1);
}

// Initialize Viem client
const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`),
});

// Initialize NFT API client
const nftClient = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyApiKey}`),
});

// Burn address
const burnAddress = '0x0000000000000000000000000000000000000000';

// Inline contract configurations
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
    contractAddress: '0x024d64e2f65747d8bb02dfb852702d588a062575', // Checksummed
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

// Inline ABI definitions
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

async function retry(operation, { retries = 3, delay = 1000, backoff = false } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (error.message.includes('429') && attempt === retries) {
          logger.error('test/retry', `Rate limit exceeded after ${retries} attempts`, {}, 'eth', 'nft');
          throw new Error('Rate limit exceeded');
        }
        if (attempt < retries) {
          const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay;
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
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
    const contractName = nftContracts[contractKey].name;
  
    try {
      do {
        const params = {
          contractAddress,
          withTokenBalances,
          pageSize: 100,
        };
        if (pageKey) params.pageKey = pageKey;
  
        const result = await retry(
          () =>
            nftClient.request({
              method: 'alchemy_getOwnersForCollection',
              params: [params],
            }),
          { retries: 3, delay: 1000, backoff: true }
        );
  
        if (result.ownerAddresses) {
          owners.push(...result.ownerAddresses);
        }
        pageKey = result.pageKey || null;
        pageCount++;
  
        if (pageCount >= maxPages) {
          break;
        }
      } while (pageKey);
  
      return owners;
    } catch (error) {
      const message = error.message.includes('Must be authenticated')
        ? 'Must be authenticated'
        : error.message;
      logger.error(context, `${contractName}: NFT API call failed: ${message}`, { stack: error.stack }, 'eth', 'nft');
      throw error;
    }
  }

// Fetch owners using on-chain ownerOf calls
async function fetchOwnersOnChain(contractAddress, totalSupply, abi, contractKey, functionFailures) {
    const owners = [];
    const tokenBalancesMap = new Map();
    const chunkSize = 20;
    const burnedTokens = [];
    const context = `test/${contractKey}`;
    const contractName = nftContracts[contractKey].name;
  
    try {
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
          () =>
            client.multicall({
              contracts: calls,
              allowFailure: true,
            }),
          { retries: 3, delay: 1000, backoff: true }
        );
  
        results.forEach((result, index) => {
          const tokenId = Number(tokenIds[index]);
          if (functionFailures['ownerOf']) {
            burnedTokens.push(tokenId);
            return;
          }
          if (result.status === 'failure' || !result.result) {
            if (!functionFailures['ownerOf']) {
              const message = result.error?.message.includes('0x')
                ? `Reverted with signature ${result.error.message.match(/0x[a-fA-F0-9]{8}/)?.[0] || 'unknown'}`
                : result.error?.message.includes('invalid address')
                ? 'Invalid contract address'
                : result.error?.message || 'Unknown error';
              functionFailures['ownerOf'] = message;
              logger.error(
                context,
                `${contractName}: ABI function ownerOf failed for tokenId ${tokenId}: ${message}`,
                { stack: result.error?.stack || '' },
                'eth',
                'nft'
              );
            }
            burnedTokens.push(tokenId);
          } else {
            const owner = result.result;
            if (owner.toLowerCase() === burnAddress.toLowerCase()) {
              burnedTokens.push(tokenId);
            } else {
              if (!tokenBalancesMap.has(owner)) {
                tokenBalancesMap.set(owner, []);
              }
              tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
            }
          }
        });
      }
  
      tokenBalancesMap.forEach((tokenBalances, ownerAddress) => {
        owners.push({
          ownerAddress,
          tokenBalances,
        });
      });
  
      return { owners, burnedTokens };
    } catch (error) {
      logger.error(context, `${contractName}: Failed to fetch owners on-chain: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
      throw error;
    }
  }

// Fetch tier for a single token
async function fetchTier(contractKey, contractAddress, tokenId, abi, functionFailures) {
    const tierFunction = tierFunctions[contractKey];
    const context = `test/${contractKey}`;
    const contractName = nftContracts[contractKey].name;
  
    if (functionFailures[tierFunction.name]) {
      return 0;
    }
  
    try {
      const result = await retry(
        () =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: tierFunction.name,
            args: [BigInt(tokenId)],
          }),
        { retries: 3, delay: 1000, backoff: true }
      );
      return contractKey === 'ascendant' ? Number(result[1]) : Number(result);
    } catch (error) {
      const message = error.message.includes('0x')
        ? `Reverted with signature ${error.message.match(/0x[a-fA-F0-9]{8}/)?.[0] || 'unknown'}`
        : error.message.includes('invalid address')
        ? 'Invalid contract address'
        : error.message;
      if (!functionFailures[tierFunction.name]) {
        functionFailures[tierFunction.name] = message;
        logger.error(
          context,
          `${contractName}: ABI function ${tierFunction.name} failed for tokenId ${tokenId}: ${message}`,
          { stack: error.stack },
          'eth',
          'nft'
        );
      }
      return 0;
    }
  }

// Test function for a single NFT collection
async function testNFTHolders(contractKey) {
    const contractConfig = nftContracts[contractKey];
    if (!contractConfig) {
      logger.error('test', `Skipping ${contractKey}: not found`, {}, 'eth', 'nft');
      return;
    }
  
    const contractAddress = contractConfig.contractAddress;
    const contractName = contractConfig.name;
    if (!isAddress(contractAddress)) {
      logger.error(
        `test/${contractKey}`,
        `${contractName}: Invalid contract address: ${contractAddress}. Skipping collection.`,
        'eth',
        'nft'
      );
      return;
    }
  
    const abi = contractAbis[contractKey];
    const context = `test/${contractKey}`;
    const functionFailures = {};
    let usedApi = false;
  
    try {
      // Step 1: Fetch totalSupply and totalBurned
      let totalSupply, totalBurned = 0n;
  
      const supplyFunction = contractKey === 'ascendant' ? 'tokenId' : 'totalSupply';
      try {
        totalSupply = await retry(
          () =>
            client.readContract({
              address: contractAddress,
              abi,
              functionName: supplyFunction,
            }),
          { retries: 3, delay: 1000, backoff: true }
        );
      } catch (error) {
        const message = error.message.includes('invalid address')
          ? 'Invalid contract address'
          : error.message.includes('execution reverted')
          ? 'Contract not deployed or function unavailable'
          : error.message;
        functionFailures[supplyFunction] = message;
        logger.error(
          context,
          `${contractName}: ABI function ${supplyFunction} failed: ${message}`,
          { stack: error.stack },
          'eth',
          'nft'
        );
        try {
          const response = await retry(
            () =>
              nftClient.request({
                method: 'alchemy_getContractMetadata',
                params: [{ contractAddress }],
              }),
            { retries: 3, delay: 1000, backoff: true }
          );
          totalSupply = BigInt(response.totalSupply || contractConfig.totalMinted || 0);
          usedApi = true;
        } catch (apiError) {
          const message = apiError.message.includes('Must be authenticated')
            ? 'Must be authenticated'
            : apiError.message;
          logger.error(
            context,
            `${contractName}: Fallback NFT API failed: ${message}`,
            { stack: apiError.stack },
            'eth',
            'nft'
          );
          totalSupply = BigInt(contractConfig.totalMinted || 0);
        }
      }
  
      if (contractKey !== 'ascendant') {
        try {
          totalBurned = await retry(
            () =>
              client.readContract({
                address: contractAddress,
                abi,
                functionName: 'totalBurned',
              }),
            { retries: 3, delay: 1000, backoff: true }
          );
        } catch (error) {
          const message = error.message.includes('invalid address')
            ? 'Invalid contract address'
            : error.message.includes('execution reverted')
            ? 'Contract not deployed or function unavailable'
            : error.message;
          functionFailures['totalBurned'] = message;
          logger.error(
            context,
            `${contractName}: ABI function totalBurned failed: ${message}`,
            { stack: error.stack },
            'eth',
            'nft'
          );
          totalBurned = 0n;
        }
      }
  
      const totalTokens = Number(totalSupply);
      const burnedTokensContract = Number(totalBurned);
      const totalMinted = contractConfig.totalMinted || totalTokens + burnedTokensContract;
  
      // Step 2: Fetch owners
      let ownersResult;
      const useAlchemy = process.env.USE_ALCHEMY_FOR_OWNERS !== 'false';
      try {
        if (useAlchemy) {
          ownersResult = {
            owners: await fetchOwnersWithNFTApi(contractAddress, contractKey, {
              withTokenBalances: true,
              maxPages: 100,
            }),
          };
          usedApi = true;
        } else {
          throw new Error('Alchemy API disabled, falling back to on-chain');
        }
      } catch (nftApiError) {
        const message = nftApiError.message.includes('Must be authenticated')
          ? 'Must be authenticated'
          : nftApiError.message;
        logger.error(
          context,
          `${contractName}: NFT API failed: ${message}. Falling back to on-chain ownerOf`,
          'eth',
          'nft'
        );
        ownersResult = await fetchOwnersOnChain(contractAddress, totalTokens, abi, contractKey, functionFailures);
      }
  
      const { owners, burnedTokens: burnedTokenIds = [] } = ownersResult;
      const filteredOwners = owners.filter(
        owner =>
          owner?.ownerAddress &&
          owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() &&
          owner.tokenBalances?.length > 0
      );
  
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
          continue;
        }
  
        const tokenIds = [];
        const tiers = Array(maxTier + 1).fill(0);
        let total = 0;
  
        for (const tb of owner.tokenBalances) {
          if (!tb.tokenId) continue;
          const tokenId = Number(tb.tokenId);
          if (seenTokenIds.has(tokenId)) {
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
  
      // Step 4: Fetch tiers for all tokens
      const tokenIds = Array.from(tokenOwnerMap.keys());
      if (tokenIds.length > 0) {
        const tierCalls = tokenIds.map(tokenId => ({
          address: contractAddress,
          abi,
          functionName: tierFunctions[contractKey].name,
          args: [BigInt(tokenId)],
        }));
  
        const tierResults = [];
        const chunkSize = 20;
        for (let i = 0; i < tierCalls.length; i += chunkSize) {
          const chunk = tierCalls.slice(i, i + chunkSize);
          const results = await Promise.all(
            chunk.map(async call => {
              if (functionFailures[call.functionName]) {
                return { status: 'failure', tokenId: Number(call.args[0]), error: 'Prior failure' };
              }
              try {
                const result = await retry(
                  () =>
                    client.readContract({
                      address: call.address,
                      abi,
                      functionName: call.functionName,
                      args: call.args,
                    }),
                  { retries: 3, delay: 1000, backoff: true }
                );
                return { status: 'success', result, tokenId: Number(call.args[0]) };
              } catch (error) {
                const message = error.message.includes('0x')
                  ? `Reverted with signature ${error.message.match(/0x[a-fA-F0-9]{8}/)?.[0] || 'unknown'}`
                  : error.message.includes('invalid address')
                  ? 'Invalid contract address'
                  : error.message;
                if (!functionFailures[call.functionName]) {
                  functionFailures[call.functionName] = message;
                  logger.error(
                    context,
                    `${contractName}: ABI function ${call.functionName} failed for tokenId ${call.args[0]}: ${message}`,
                    { stack: error.stack },
                    'eth',
                    'nft'
                  );
                }
                return { status: 'failure', tokenId: Number(call.args[0]), error: message };
              }
            })
          );
          tierResults.push(...results);
        }
  
        // Update holders with tier data
        tierResults.forEach(result => {
          if (result.status === 'success') {
            const tokenId = result.tokenId;
            const tier = contractKey === 'ascendant' ? Number(result.result[1]) : Number(result.result);
            const wallet = tokenOwnerMap.get(tokenId);
            if (wallet && tier > 0) {
              const holder = holdersMap.get(wallet);
              if (holder) {
                holder.tiers[tier] += 1;
              }
            }
          }
        });
      }
  
      // Step 5: Log results
      const holderList = Array.from(holdersMap.values());
      const tierSummary = Array(maxTier + 1).fill(0);
      holderList.forEach(holder => {
        holder.tiers.forEach((count, tier) => {
          tierSummary[tier] += count;
        });
      });
  
      logger.summary(
        context,
        `${contractName}: Summary: ${holderList.length} holders, ${tokenCount} tokens, burned=${burnedTokenIds.length}, tiers=[${tierSummary}]`,
        'eth',
        'nft'
      );
  
      // Recommend API or on-chain based on failures
      const abiFailed = Object.keys(functionFailures).length > 0;
      const criticalAbiFailures = Object.keys(functionFailures).some(f => f !== 'ownerOf');
      const recommendation = usedApi && !abiFailed
        ? 'Use Alchemy NFT API (successful, no ABI failures)'
        : usedApi && !criticalAbiFailures
        ? 'Use Alchemy NFT API (successful, only ownerOf ABI failures)'
        : usedApi && criticalAbiFailures
        ? 'Use on-chain ABI functions cautiously (API succeeded, critical ABI failures)'
        : !usedApi && !abiFailed
        ? 'Use on-chain ABI functions (API failed, no ABI failures)'
        : !usedApi && !criticalAbiFailures
        ? 'Use on-chain ABI functions (API failed, only ownerOf ABI failures)'
        : 'Use on-chain ABI functions with caution (API failed, critical ABI failures)';
      logger.summary(context, `${contractName}: Recommendation: ${recommendation}`, 'eth', 'nft');
  
      if (abiFailed) {
        logger.summary(
          context,
          `${contractName}: ABI function failures: ${JSON.stringify(functionFailures, null, 2)}`,
          'eth',
          'nft'
        );
      }
    } catch (error) {
      logger.error(context, `${contractName}: Test failed: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
    }
  }

// Main test function for all NFT collections
async function testAllNFTHolders() {
  const contractKeys = ['stax', 'element280', 'element369', 'ascendant'];
  for (const contractKey of contractKeys) {
    await testNFTHolders(contractKey);
  }
}

// Run the test
async function main() {
    try {
      await testAllNFTHolders();
      logger.summary('test', 'All tests completed', 'eth', 'nft');
      process.exit(0);
    } catch (error) {
      logger.error('test', `Tests failed: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
      process.exit(1);
    }
  }

main();