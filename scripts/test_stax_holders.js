#!/usr/bin/env node

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { getAddress } from 'viem';
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

// Debug environment variables
logger.debug('test', 'Environment variables:', {
  ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY,
  NEXT_PUBLIC_ALCHEMY_API_KEY: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
  DEBUG: process.env.DEBUG,
  LOG_LEVEL: process.env.LOG_LEVEL,
});

// Alchemy configuration
const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!alchemyApiKey) {
  logger.error('test', 'ALCHEMY_API_KEY is not set in environment variables', {}, 'eth', 'stax');
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

// Stax contract details
const contractAddress = '0x74270Ca3a274B4dbf26be319A55188690CACE6E1';
const burnAddress = '0x0000000000000000000000000000000000000000';
const staxNFTAbi = [
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: 'result', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalBurned',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'getNftTier',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Embedded retry function from app/api/utils/retry.js
async function retry(operation, { retries = 3, delay = 1000, backoff = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt === retries) {
        logger.error('test/retry', `Circuit breaker: Rate limit exceeded after ${retries} attempts`, {}, 'eth', 'stax');
        throw new Error('Rate limit exceeded');
      }
      logger.warn('test/retry', `Retry attempt ${attempt}/${retries} failed: ${error.message}`, 'eth', 'stax');
      const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay * Math.min(attempt, 3);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}

// Utility to fetch owners using Alchemy NFT API (for debugging)
async function fetchOwnersWithNFTApi(contractAddress, options = {}) {
  const { withTokenBalances = true, maxPages = 100 } = options;
  const owners = [];
  let pageKey = null;
  let pageCount = 0;

  try {
    logger.info('test', `Fetching owners for contract ${contractAddress} using NFT API`, 'eth', 'stax');

    do {
      const params = {
        contractAddress,
        withTokenBalances,
        pageSize: 100,
      };
      if (pageKey) params.pageKey = pageKey;

      const response = await retry(
        async () => {
          try {
            const result = await nftClient.request({
              method: 'alchemy_getOwnersForCollection',
              params: [params],
            });
            return { status: 'success', result };
          } catch (error) {
            // Capture raw response if possible
            const rawResponse = error.response?.data || error.message;
            logger.debug('test', `Raw NFT API response:`, { rawResponse }, 'eth', 'stax');
            throw error;
          }
        },
        { retries: 3, delay: 1000, backoff: true }
      );

      logger.debug('test', `NFT API response:`, { response: response.result }, 'eth', 'stax');

      if (response.result.ownerAddresses) {
        owners.push(...response.result.ownerAddresses);
      }
      pageKey = response.result.pageKey || null;
      pageCount++;

      logger.debug('test', `Fetched page ${pageCount}, owners so far: ${owners.length}`, 'eth', 'stax');

      if (pageCount >= maxPages) {
        logger.warn('test', `Reached max pages (${maxPages}), stopping pagination`, 'eth', 'stax');
        break;
      }
    } while (pageKey);

    logger.info('test', `Fetched ${owners.length} owners via NFT API`, 'eth', 'stax');
    return owners;
  } catch (error) {
    logger.error('test', `Failed to fetch owners via NFT API: ${error.message}`, { stack: error.stack }, 'eth', 'stax');
    throw error;
  }
}

// Fetch owners using on-chain ownerOf calls
async function fetchOwnersOnChain(contractAddress, totalSupply, abi) {
  const owners = [];
  const tokenBalancesMap = new Map();
  const chunkSize = 50; // Batch calls to reduce requests

  try {
    logger.info('test', `Fetching owners on-chain for contract ${contractAddress}`, 'eth', 'stax');

    for (let start = 1; start <= totalSupply; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, totalSupply);
      const tokenIds = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));

      const calls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi,
        functionName: 'ownerOf',
        args: [tokenId],
      }));

      try {
        const results = await retry(
          async () => {
            const responses = await Promise.all(
              calls.map(call =>
                client.readContract({
                  address: call.address,
                  abi: call.abi,
                  functionName: call.functionName,
                  args: call.args,
                }).catch(() => null) // Handle non-existent tokens
              )
            );
            return responses.map((result, idx) => ({
              tokenId: Number(tokenIds[idx]),
              owner: result,
            }));
          },
          { retries: 3, delay: 1000, backoff: true }
        );

        results.forEach(({ tokenId, owner }) => {
          if (owner && owner.toLowerCase() !== burnAddress.toLowerCase()) {
            if (!tokenBalancesMap.has(owner)) {
              tokenBalancesMap.set(owner, []);
            }
            tokenBalancesMap.get(owner).push({ tokenId: tokenId.toString() });
          }
        });

        logger.debug('test', `Processed token IDs ${start} to ${end}`, 'eth', 'stax');
      } catch (error) {
        logger.warn('test', `Failed to fetch owners for token IDs ${start} to ${end}: ${error.message}`, 'eth', 'stax');
      }
    }

    tokenBalancesMap.forEach((tokenBalances, ownerAddress) => {
      owners.push({
        ownerAddress,
        tokenBalances,
      });
    });

    logger.info('test', `Fetched ${owners.length} owners on-chain`, 'eth', 'stax');
    return owners;
  } catch (error) {
    logger.error('test', `Failed to fetch owners on-chain: ${error.message}`, { stack: error.stack }, 'eth', 'stax');
    throw error;
  }
}

// Main test function
async function testStaxHolders() {
  try {
    // Step 1: Fetch totalSupply and totalBurned
    logger.info('test', `Fetching contract state for Stax (${contractAddress})`, 'eth', 'stax');
    const [totalSupply, totalBurned] = await retry(
      () =>
        Promise.all([
          client.readContract({
            address: contractAddress,
            abi: staxNFTAbi,
            functionName: 'totalSupply',
          }),
          client.readContract({
            address: contractAddress,
            abi: staxNFTAbi,
            functionName: 'totalBurned',
          }).catch(() => 0n),
        ]),
      { retries: 3, delay: 1000, backoff: true }
    );

    const totalTokens = Number(totalSupply);
    const burnedTokens = Number(totalBurned);
    logger.info(
      'test',
      `Contract state: totalSupply=${totalTokens}, totalBurned=${burnedTokens}, totalLive=${totalTokens}`,
      'eth',
      'stax'
    );

    // Step 2: Fetch owners (default to on-chain due to NFT API issues)
    let owners;
    try {
      // Comment out NFT API call for now; uncomment to debug after fixing API key
      // owners = await fetchOwnersWithNFTApi(contractAddress, { withTokenBalances: true, maxPages: 100 });
      throw new Error('Skipping NFT API due to authentication issues');
    } catch (nftApiError) {
      logger.warn('test', `NFT API skipped: ${nftApiError.message}. Falling back to on-chain ownerOf`, 'eth', 'stax');
      owners = await fetchOwnersOnChain(contractAddress, totalTokens, staxNFTAbi);
    }

    const filteredOwners = owners.filter(
      owner => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress.toLowerCase() && owner.tokenBalances?.length > 0
    );

    logger.info('test', `Filtered ${filteredOwners.length} valid owners`, 'eth', 'stax');

    // Step 3: Build holders data
    const holdersMap = new Map();
    const tokenOwnerMap = new Map();
    let tokenCount = 0;
    const seenTokenIds = new Set();

    for (const owner of filteredOwners) {
      if (!owner.ownerAddress) continue;
      let wallet;
      try {
        wallet = getAddress(owner.ownerAddress).toLowerCase();
      } catch (e) {
        logger.warn('test', `Invalid wallet address: ${owner.ownerAddress}`, 'eth', 'stax');
        continue;
      }

      const tokenIds = [];
      const tiers = Array(13).fill(0); // Stax has tiers 1-12, index 0 unused
      let total = 0;

      for (const tb of owner.tokenBalances) {
        if (!tb.tokenId) continue;
        const tokenId = Number(tb.tokenId);
        if (seenTokenIds.has(tokenId)) {
          logger.warn('test', `Duplicate tokenId ${tokenId} for wallet ${wallet}`, 'eth', 'stax');
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

    logger.info('test', `Processed ${holdersMap.size} unique holders, ${tokenCount} tokens`, 'eth', 'stax');

    // Step 4: Fetch tiers for all tokens
    const tokenIds = Array.from(tokenOwnerMap.keys());
    if (tokenIds.length > 0) {
      logger.info('test', `Fetching tiers for ${tokenIds.length} tokens`, 'eth', 'stax');
      const tierCalls = tokenIds.map(tokenId => ({
        address: contractAddress,
        abi: staxNFTAbi,
        functionName: 'getNftTier',
        args: [BigInt(tokenId)],
      }));

      const tierResults = [];
      const chunkSize = 50; // Adjust based on Alchemy limits
      for (let i = 0; i < tierCalls.length; i += chunkSize) {
        const chunk = tierCalls.slice(i, i + chunkSize);
        try {
          const results = await retry(
            async () => {
              const responses = await Promise.all(
                chunk.map(call =>
                  client.readContract({
                    address: call.address,
                    abi: call.abi,
                    functionName: call.functionName,
                    args: call.args,
                  })
                )
              );
              return responses.map((result, idx) => ({ status: 'success', result, tokenId: Number(chunk[idx].args[0]) }));
            },
            { retries: 3, delay: 1000, backoff: true }
          );
          tierResults.push(...results);
          logger.debug('test', `Processed tier chunk ${Math.floor(i / chunkSize) + 1}/${Math.ceil(tierCalls.length / chunkSize)}`, 'eth', 'stax');
        } catch (error) {
          logger.error('test', `Failed to fetch tier chunk ${i / chunkSize + 1}: ${error.message}`, { stack: error.stack }, 'eth', 'stax');
          tierResults.push(...chunk.map(c => ({ status: 'failure', tokenId: Number(c.args[0]), error: error.message })));
        }
      }

      // Update holders with tier data
      tierResults.forEach(result => {
        if (result.status === 'success') {
          const tokenId = result.tokenId;
          const tier = Number(result.result) || 0;
          const wallet = tokenOwnerMap.get(tokenId);
          if (wallet) {
            const holder = holdersMap.get(wallet);
            if (holder) {
              holder.tiers[tier] += 1;
            }
          }
        } else {
          logger.warn('test', `Failed to fetch tier for token ${result.tokenId}: ${result.error}`, 'eth', 'stax');
        }
      });
    }

    // Step 5: Log results
    logger.info('test', `=== Stax Holders Data ===`, 'eth', 'stax');
    const holderList = Array.from(holdersMap.values());
    holderList.forEach(holder => {
      logger.info(
        'test',
        `Wallet: ${holder.wallet}, Tokens: ${holder.total}, Token IDs: [${holder.tokenIds.join(', ')}], Tiers: ${holder.tiers}`,
        'eth',
        'stax'
      );
    });

    // Summary
    logger.info(
      'test',
      `Summary: ${holderList.length} unique holders, ${tokenCount} live tokens, totalSupply=${totalTokens}, totalBurned=${burnedTokens}`,
      'eth',
      'stax'
    );

    // Validate against totalSupply
    if (tokenCount !== totalTokens) {
      logger.warn(
        'test',
        `Mismatch: Processed ${tokenCount} tokens, but totalSupply=${totalTokens}. Possible missing or burned tokens.`,
        'eth',
        'stax'
      );
    }
  } catch (error) {
    logger.error('test', `Test failed: ${error.message}`, { stack: error.stack }, 'eth', 'stax');
    throw error;
  }
}

// Run the test
async function main() {
  try {
    await testStaxHolders();
    logger.info('test', 'Test completed successfully', 'eth', 'stax');
    process.exit(0);
  } catch (error) {
    logger.error('test', 'Test failed', { stack: error.stack }, 'eth', 'stax');
    process.exit(1);
  }
}

main();