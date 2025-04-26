// scripts/fetchElement280SummaryStats.js

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import dotenv from 'dotenv';
import pino from 'pino';
import { contractAddresses, vaultAddresses, contractTiers } from '../app/nft-contracts.js';

// Initialize environment
dotenv.config({ path: './.env.local' });

// Logger setup
const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });

// Contract addresses
const CONTRACT_ADDRESS = contractAddresses.element280;
const VAULT_CONTRACT_ADDRESS = vaultAddresses.element280;

// Validate contract addresses
if (!CONTRACT_ADDRESS || !CONTRACT_ADDRESS.startsWith('0x')) {
  logger.error('Invalid or missing CONTRACT_ADDRESS in ../app/nft-contracts.js');
  process.exit(1);
}
if (!VAULT_CONTRACT_ADDRESS || !VAULT_CONTRACT_ADDRESS.startsWith('0x')) {
  logger.error('Invalid or missing VAULT_CONTRACT_ADDRESS in ../app/nft-contracts.js');
  process.exit(1);
}

// Validate Alchemy API key
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  logger.error('NEXT_PUBLIC_ALCHEMY_API_KEY not defined in .env.local');
  process.exit(1);
}

// ABI for relevant functions
const element280Abi = [
  {
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: 'result', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'totalBurned',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'getTotalNftsPerTiers',
    outputs: [{ internalType: 'uint256[]', name: 'total', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'multiplierPool',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const vaultAbi = [
  {
    name: 'totalRewardPool',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Client
const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, { timeout: 60000 }),
});

const ELMNT_DECIMALS = 18;

// Custom JSON serializer to handle BigInt
function serializeBigInt(obj) {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value, 2);
}

async function retry(fn, attempts = 3, delay = 1000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) {
        logger.error(`Failed after ${attempts} attempts: ${error.message}`);
        throw error;
      }
      logger.warn(`Retry ${i + 1}/${attempts}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

async function fetchSummaryStats() {
  try {
    logger.info(`Fetching summary stats for Element280 at ${CONTRACT_ADDRESS}`);
    // Batch calls using multicall
    const results = await retry(() =>
      client.multicall({
        contracts: [
          {
            address: CONTRACT_ADDRESS,
            abi: element280Abi,
            functionName: 'totalSupply',
          },
          {
            address: CONTRACT_ADDRESS,
            abi: element280Abi,
            functionName: 'totalBurned',
          },
          {
            address: CONTRACT_ADDRESS,
            abi: element280Abi,
            functionName: 'getTotalNftsPerTiers',
          },
          {
            address: CONTRACT_ADDRESS,
            abi: element280Abi,
            functionName: 'multiplierPool',
          },
          {
            address: VAULT_CONTRACT_ADDRESS,
            abi: vaultAbi,
            functionName: 'totalRewardPool',
          },
        ],
      })
    );

    // Log raw results for debugging with BigInt serialization
    logger.debug(`Multicall results: ${serializeBigInt(results.map(r => ({ status: r.status, result: r.result })))}`);

    // Check for failed calls
    const failedCalls = results.filter(r => r.status === 'failure');
    if (failedCalls.length > 0) {
      logger.warn(`Some multicall calls failed: ${serializeBigInt(failedCalls)}`);
    }

    // Extract results with error handling
    const totalLive = results[0].status === 'success' ? Number(results[0].result) : 0;
    const totalBurned = results[1].status === 'success' ? Number(results[1].result) : 0;
    const totalMinted = totalLive + totalBurned;
    const tierDistributionRaw = results[2].status === 'success' && Array.isArray(results[2].result) ? results[2].result.map(Number) : [0, 0, 0, 0, 0, 0];
    const multiplierPool = results[3].status === 'success' ? Number(results[3].result) : 0;
    const totalRewardPool = results[4].status === 'success' ? Number((Number(results[4].result) / Math.pow(10, ELMNT_DECIMALS)).toFixed(2)) : 0;

    // Log if getTotalNftsPerTiers failed
    if (results[2].status !== 'success' || !Array.isArray(results[2].result)) {
      logger.error(`getTotalNftsPerTiers failed or returned invalid data: ${serializeBigInt(results[2])}`);
    }

    // Format tier distribution
    const tierDistribution = tierDistributionRaw.map((count, i) => ({
      tier: contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`,
      count,
      percentage: totalLive > 0 ? ((count / totalLive) * 100).toFixed(2) : 0,
    }));

    // Validate tier distribution
    const tierSum = tierDistributionRaw.reduce((sum, count) => sum + count, 0);
    if (tierSum !== totalLive && tierSum > 0) {
      logger.warn(`Tier distribution sum (${tierSum}) does not match totalLive (${totalLive})`);
    }

    const summary = {
      totalMinted,
      totalLive,
      totalBurned,
      tierDistribution,
      multiplierPool,
      totalRewardPool,
    };

    logger.info('Element280 Summary Stats:');
    logger.info(`Total Minted: ${summary.totalMinted}`);
    logger.info(`Total Live: ${summary.totalLive}`);
    logger.info(`Total Burned: ${summary.totalBurned}`);
    logger.info(`Tier Distribution: ${serializeBigInt(summary.tierDistribution)}`);
    logger.info(`Multiplier Pool: ${summary.multiplierPool}`);
    logger.info(`Total Reward Pool: ${summary.totalRewardPool} ELMNT`);

    return summary;
  } catch (error) {
    logger.error(`Failed to fetch summary stats: ${error.message}`);
    throw error;
  }
}

fetchSummaryStats()
  .then(() => process.exit(0))
  .catch(error => {
    logger.error('Script failed:', error);
    process.exit(1);
  });