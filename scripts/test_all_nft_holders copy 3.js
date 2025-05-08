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

// Load environment variables from .env.local
dotenv.config({ path: path.join(projectRoot, '.env.local') });

// Console logger
const logger = {
  info: (context, message, ...args) => console.log(`[${context}] [INFO] ${message}`, ...args),
  warn: (context, message, ...args) => console.warn(`[${context}] [WARN] ${message}`, ...args),
  error: (context, message, meta = {}, ...args) => console.error(`[${context}] [ERROR] ${message}`, meta, ...args),
  debug: (context, message, ...args) => console.debug(`[${context}] [DEBUG] ${message}`, ...args),
};

// Alchemy configuration
const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('test', 'ALCHEMY_API_KEY is not set in environment variables', {}, 'eth', 'nft');
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
async function retry(operation, { retries = 5, delay = 2000, backoff = true } = {}) {
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
  const chunkSize = 50;
  const context = `test/${contractKey}`;
  let burnedTokens = 0; // Tokens owned by 0x000...000
  let nonExistentTokens = 0; // Tokens that revert on ownerOf
  const nonExistentTokenIds = []; // Track non-existent token IDs

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
                  // Log reverts only if DEBUG_NON_EXISTENT is enabled
                  if (process.env.DEBUG_NON_EXISTENT === 'true') {
                    logger.debug(
                      context,
                      `ownerOf failed for token ${call.args[0]}: ${error.message}`,
                      'eth',
                      'nft'
                    );
                  }
                  return null; // Treat as burned or non-existent
                })
            )
          );
          return responses.map((result, idx) => ({
            tokenId: Number(tokenIds[idx]),
            owner: result,
          }));
        },
        { retries: 5, delay: 2000, backoff: true }
      );

      results.forEach(({ tokenId, owner }) => {
        if (owner && owner.toLowerCase() !== burnAddress.toLowerCase()) {
          if (!tokenBalancesMap.has(owner)) {
            tokenBalancesMap.set(owner, []);
          }
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        } else if (owner && owner.toLowerCase() === burnAddress.toLowerCase()) {
          burnedTokens++; // Increment for burned tokens
          tokenBalancesMap.set(owner, tokenBalancesMap.get(owner) || []);
          tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
        } else {
          nonExistentTokens++; // Increment for reverts (null owner)
          nonExistentTokenIds.push(tokenId); // Track non-existent token ID
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

    // Log all owners before filtering
    logger.info(
      context,
      `Raw owners before filtering: ${owners.length} (${owners.map(o => `${o.ownerAddress} [${o.tokenBalances.length} tokens]`).join(', ')})`,
      'eth',
      'nft'
    );

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
async function testNFTHolders(contractKey) {
  const contractConfig = nftContracts[contractKey];
  if (!contractConfig) {
    logger.warn('test', `Skipping ${contractKey}: not found`, 'eth', 'nft');
    return;
  }

  const contractAddress = contractConfig.contractAddress;
  const contractName = contractConfig.name;
  const context = `test/${contractKey}`;
  const abi = contractAbis[contractKey];

  if (!isAddress(contractAddress)) {
    logger.error(context, `${contractName}: Invalid contract address: ${contractAddress}`, 'eth', 'nft');
    return;
  }

  try {
    // Step 1: Fetch totalSupply
    logger.info(context, `Fetching contract state for ${contractName} (${contractAddress})`, 'eth', 'nft');
    let totalSupply;
    let totalBurned = 0n;
    let totalMinted;

    if (contractKey === 'ascendant') {
      // Ascendant uses tokenId as the current max token ID
      totalSupply = await retry(
        () =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: 'tokenId',
          }),
        { retries: 5, delay: 2000, backoff: true }
      );
      totalMinted = Number(totalSupply); // No totalBurned, so totalMinted = totalSupply
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
        { retries: 5, delay: 2000, backoff: true }
      );

      totalBurned = await retry(
        () =>
          client.readContract({
            address: contractAddress,
            abi,
            functionName: 'totalBurned',
          }),
        { retries: 5, delay: 2000, backoff: true }
      ).catch(() => 0n);

      const totalTokens = Number(totalSupply);
      totalBurned = Number(totalBurned);
      totalMinted = totalTokens + totalBurned;
      logger.info(
        context,
        `Contract state: totalLiveSupply=${totalTokens}, totalBurned=${totalBurned}, totalMinted=${totalMinted}`,
        'eth',
        'nft'
      );
    }

    const totalTokens = Number(totalSupply);

    // Step 2: Fetch owners using on-chain ownerOf
    logger.info(context, `Fetching owners on-chain for ${contractName} (${contractAddress})`, 'eth', 'nft');
    const { owners, burnedTokens, nonExistentTokens, nonExistentTokenIds } = await fetchOwnersOnChain(contractAddress, totalTokens, abi, contractKey);

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

    logger.info(context, `Processed ${holdersMap.size} unique holders, ${tokenCount} tokens`, 'eth', 'nft');

    // Step 4: Fetch tiers for all tokens
    const tokenIds = Array.from(tokenOwnerMap.keys());
    if (tokenIds.length > 0) {
      logger.info(context, `Fetching tiers for ${tokenIds.length} tokens`, 'eth', 'nft');
      const tierCalls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi,
        functionName: tierFunctions[contractKey].name,
        args: [BigInt(tokenId)],
      }));

      const tierResults = [];
      const chunkSize = 25; // Reduced to avoid rate limits
      for (let i = 0; i < tierCalls.length; i += chunkSize) {
        const chunk = tierCalls.slice(i, i + chunkSize);
        try {
          const results = await retry(
            async () => {
              const responses = await Promise.all(
                chunk.map(call =>
                  client
                    .readContract({
                      address: call.address,
                      abi: call.abi,
                      functionName: call.functionName, // Fixed typo from previous message
                      args: call.args,
                    })
                    .catch(error => {
                      logger.warn(
                        context,
                        `Tier fetch failed for token ${call.args[0]}: ${error.message}`,
                        'eth',
                        'nft'
                      );
                      return null; // Handle failed tier calls gracefully
                    })
                )
              );
              return responses.map((result, idx) => ({
                status: result !== null ? 'success' : 'failure',
                result,
                tokenId: Number(chunk[idx].args[0]),
                error: result === null ? 'Failed to fetch tier' : undefined,
              }));
            },
            { retries: 5, delay: 2000, backoff: true }
          );
          tierResults.push(...results);
          logger.debug(context, `Processed tier chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(tierCalls.length / chunkSize)}`, 'eth', 'nft');
        } catch (error) {
          logger.error(context, `Failed to fetch tier chunk ${i / chunkSize + 1}: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
          tierResults.push(...chunk.map(c => ({ status: 'failure', tokenId: Number(c.args[0]), error: error.message })));
        }
      }

      // Update holders with tier data
      tierResults.forEach(result => {
        if (result.status === 'success' && result.result !== null) {
          const tokenId = result.tokenId;
          const tier = contractKey === 'ascendant' ? Number(result.result[1]) : Number(result.result);
          const wallet = tokenOwnerMap.get(tokenId);
          if (wallet && tier > 0) {
            const holder = holdersMap.get(wallet);
            if (holder) {
              holder.tiers[tier] += 1;
            }
          }
        } else {
          logger.warn(context, `Failed to fetch tier for token ${result.tokenId}: ${result.error}`, 'eth', 'nft');
        }
      });
    }

    // Step 5: Log results
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
      const expectedLiveTokens = totalTokens; // totalLiveSupply
      const missingTokens = expectedLiveTokens - tokenCount;
      if (tokenCount < expectedLiveTokens) {
        logger.warn(
          context,
          `Mismatch: Processed ${tokenCount} tokens, but totalLiveSupply=${expectedLiveTokens}. Missing ${missingTokens} tokens (likely ${burnedTokens} burned, ${nonExistentTokens} non-existent). Non-existent token IDs: [${nonExistentTokenIds.join(', ')}]`,
          'eth',
          'nft'
        );
      } else if (tokenCount > expectedLiveTokens) {
        logger.warn(
          context,
          `Mismatch: Processed ${tokenCount} tokens, exceeding totalLiveSupply=${expectedLiveTokens}. Possible duplicate tokens.`,
          'eth',
          'nft'
        );
      }
    }
  } catch (error) {
    logger.error(context, `Test failed: ${error.message}`, { stack: error.stack }, 'eth', 'nft');
    throw error;
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
    logger.info('test', 'All tests completed successfully', 'eth', 'nft');
    process.exit(0);
  } catch (error) {
    logger.error('test', 'Tests failed', { stack: error.stack }, 'eth', 'nft');
    process.exit(1);
  }
}

main();