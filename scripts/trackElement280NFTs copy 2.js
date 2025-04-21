// scripts/trackElement280NFTs.js

// Global error handlers for debugging
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

import { createPublicClient, http, parseAbiItem } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import { execSync } from 'child_process';
import pino from 'pino';
import { fileURLToPath } from 'url';
import minimist from 'minimist';
import { contractAddresses, vaultAddresses, deploymentBlocks, contractTiers } from '../app/nft-contracts.js';
import { Semaphore } from 'async-mutex';

// Initialize environment
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Parse command-line arguments
const args = minimist(process.argv.slice(2), {
  alias: { h: 'help', v: 'verbose', q: 'quiet' },
  boolean: ['verbose', 'quiet'],
});
const FORCE_REFRESH = args.refresh || (args.wallets ? true : false);
const FULL_MODE = args.full || !args.wallets;
const CUSTOM_WALLETS = args.wallets ? args.wallets.split(',').map(addr => addr.trim().toLowerCase()) : [];
const SHOW_HELP = args.help || false;
const SHOW_SUMMARY = args.summary || false;
const VERBOSE_MODE = args.verbose || false;
const QUIET_MODE = args.quiet || false;

// Validate logging options
if (VERBOSE_MODE && QUIET_MODE) {
  console.error('Error: Cannot use both --verbose (-v) and --quiet (-q) together');
  process.exit(1);
}

// Logger setup
const logLevel = VERBOSE_MODE ? 'debug' : QUIET_MODE ? 'error' : 'info';
const logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
});

// Semaphore for database transaction serialization
const dbSemaphore = new Semaphore(1);

// Constants
const CONTRACT_ADDRESS = contractAddresses.element280;
const VAULT_CONTRACT_ADDRESS = vaultAddresses.element280;
const DEPLOYMENT_BLOCK = Number(deploymentBlocks.element280);
const CACHE_FILE = path.join(process.cwd(), 'public', 'data', 'element280_nft_status.json');
const DB_FILE = path.join(process.cwd(), 'public', 'data', 'element280.db');
const CHECKPOINT_FILE = path.join(process.cwd(), 'public', 'data', 'element280_checkpoint.json');
const FAILED_TOKENS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_failed_tokens.json');
const SKIPPED_TOKENS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_skipped_tokens.json');
const SKIPPED_TOKENS_DETAILED_FILE = path.join(process.cwd(), 'public', 'data', 'element280_skipped_tokens_detailed.json');
// NEW: Added failed inserts file
const FAILED_INSERTS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_failed_inserts.json');
const BACKUP_DIR = path.join(process.cwd(), 'scripts', 'backups');
const MAX_BLOCK_RANGE = 5000;
const MAX_CONCURRENT_BLOCKS = 3;
const MAX_CONCURRENT_WALLETS = 3;
const MAX_MULTICALL_BATCH = 100;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ELMNT_DECIMALS = 18;
const BLOCK_STEP = 2000;
const DEBUG_WALLETS = [
  '0x15702443110894b26911b913b17ea4931f803b02',
  '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda',
  '0x9d641961a31b3eed46e664fa631aad3021323862', // NEW: Added third wallet
];
const DEBUG_TOKEN_IDS = [16028, 630, 631, 632]; // MODIFIED: Added token IDs 630, 631, 632

// In-memory cache for balanceOf results
const balanceOfCache = new Map();

// Help message
if (SHOW_HELP) {
  console.log(`
Usage: node scripts/trackElement280NFTs.js [options]

Tracks Element280 NFT ownership, transfers, and tier distribution for initial database population.

Options:
  --help, -h           Show this help message
  --refresh            Clear and refresh database
  --full               Process all wallets from transfers
  --wallets=addr1,addr2 Process specific wallets (automatically enables --refresh)
  --summary            Display summary and exit
  --verbose, -v        Enable verbose logging (debug level)
  --quiet, -q          Enable quiet mode (errors only)

Examples:
  node scripts/trackElement280NFTs.js --full
  node scripts/trackElement280NFTs.js --wallets=0x15702443110894b26911b913b17ea4931f803b02
  node scripts/trackElement280NFTs.js --summary
  node scripts/trackElement280NFTs.js --full --verbose
  node scripts/trackElement280NFTs.js --full --quiet
  `);
  process.exit(0);
}

// Verify environment
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  logger.error('ALCHEMY_API_KEY not defined in .env.local');
  process.exit(1);
}

// Contract ABIs
const element280Abi = [
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalBurned', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getTotalNftsPerTiers', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256[]' }] },
  { name: 'multiplierPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getNftTier', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint8' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'NonexistentToken', inputs: [] },
];

const element280VaultAbi = [
  { name: 'totalRewardPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    name: 'getRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { type: 'uint256[]', name: 'tokenIds' },
      { type: 'address', name: 'account' },
    ],
    outputs: [
      { type: 'bool[]', name: 'availability' },
      { type: 'uint256', name: 'totalReward' },
    ],
  },
];

// Clients
const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, { timeout: 60000 }),
});
const alchemy = new Alchemy({ apiKey: ALCHEMY_API_KEY, network: Network.ETH_MAINNET });

// Utility Functions
async function retry(fn, attempts = 30, delay = (retryCount) => Math.min(100 * 2 ** retryCount, 30000)) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) {
        logger.error(`Failed after ${attempts} attempts: ${error.message}`);
        throw error;
      }
      logger.warn(`Retry ${i + 1}/${attempts}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay(i)));
    }
  }
}

async function executeDbTransaction(db, fn) {
  const [value, release] = await dbSemaphore.acquire();
  try {
    await db.run('BEGIN TRANSACTION');
    const result = await fn();
    await db.run('COMMIT');
    return result;
  } catch (error) {
    await db.run('ROLLBACK');
    logger.error(`Transaction failed: ${error.message}`);
    throw error;
  } finally {
    release();
  }
}

async function clearDatabase() {
  logger.debug('Clearing database');
  const backupFile = path.join(BACKUP_DIR, `element280_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  try {
    execSync(`sqlite3 ${DB_FILE} .dump > ${backupFile}`);
    logger.info(`Backup created: ${backupFile}`);
  } catch (error) {
    logger.warn(`Backup failed: ${error.message}`);
  }
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
  await db.exec('DROP TABLE IF EXISTS element280_summary; DROP TABLE IF EXISTS element280_transfers; DROP TABLE IF EXISTS element280_wallets;');
  await db.close();
}

async function initDb() {
  const db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database,
  });
  await db.configure('busyTimeout', 60000);
  await db.run('PRAGMA journal_mode = WAL;');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS element280_summary (
      id INTEGER PRIMARY KEY,
      totalMinted INTEGER,
      totalBurned INTEGER,
      totalLive INTEGER,
      totalWallets INTEGER,
      tierDistribution TEXT,
      burnedDistribution TEXT,
      multiplierPool INTEGER,
      totalRewardPool INTEGER,
      lastBlock INTEGER
    );
    CREATE TABLE IF NOT EXISTS element280_transfers (
      tokenId TEXT,
      fromAddr TEXT,
      toAddr TEXT,
      tier INTEGER,
      blockNumber INTEGER,
      transactionHash TEXT,
      blockTimestamp INTEGER,
      eventType TEXT,
      multiplierPool INTEGER,
      totalSupply INTEGER,
      totalBurned INTEGER,
      ownerAddr TEXT,
      PRIMARY KEY (tokenId, transactionHash, eventType)
    );
    CREATE TABLE IF NOT EXISTS element280_wallets (
      address TEXT PRIMARY KEY,
      totalLive INTEGER,
      totalBurned INTEGER,
      totalBought INTEGER,
      totalSold INTEGER,
      minted INTEGER,
      tiersLive TEXT,
      tiersBurned TEXT,
      tiersMinted TEXT,
      tiersTransferredIn TEXT,
      tiersTransferredOut TEXT,
      nfts TEXT,
      multiplierSum INTEGER,
      displayMultiplierSum REAL,
      claimableRewards REAL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_addresses ON element280_transfers(fromAddr, toAddr);
    CREATE INDEX IF NOT EXISTS idx_transfers_tokenId ON element280_transfers(tokenId);
    CREATE INDEX IF NOT EXISTS idx_transfers_eventType ON element280_transfers(eventType);
    CREATE INDEX IF NOT EXISTS idx_transfers_blockNumber ON element280_transfers(blockNumber);
  `);
  logger.info('Database initialized');
  return db;
}

async function migrateDb(db) {
  try {
    await db.exec(`
      ALTER TABLE element280_summary ADD COLUMN totalRewardPool INTEGER DEFAULT 0;
    `);
    logger.info('Added totalRewardPool column to element280_summary');
  } catch (error) {
    if (!error.message.includes('duplicate column name')) {
      logger.error(`Migration failed: ${error.message}`);
      throw error;
    }
  }
  try {
    await db.exec(`
      ALTER TABLE element280_wallets ADD COLUMN claimableRewards REAL DEFAULT 0;
    `);
    logger.info('Added claimableRewards column to element280_wallets');
  } catch (error) {
    if (!error.message.includes('duplicate column name')) {
      logger.error(`Migration failed: ${error.message}`);
      throw error;
    }
  }
}

async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf8');
    const checkpoint = JSON.parse(data);
    logger.info(`Loaded checkpoint: lastBlock=${checkpoint.lastBlock}`);
    return checkpoint;
  } catch {
    logger.info(`No checkpoint file found, starting from deployment block ${DEPLOYMENT_BLOCK - 1}`);
    return { lastBlock: DEPLOYMENT_BLOCK - 1 };
  }
}

async function saveCheckpoint(lastBlock) {
  await fs.writeFile(CHECKPOINT_FILE, JSON.stringify({ lastBlock }));
  logger.info(`Checkpoint saved: lastBlock=${lastBlock}`);
}

async function loadFailedTokens() {
  try {
    return new Set(JSON.parse(await fs.readFile(FAILED_TOKENS_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

async function saveFailedTokens(failedTokenIds) {
  await fs.writeFile(FAILED_TOKENS_FILE, JSON.stringify([...failedTokenIds]));
  logger.info('Saved failed tokens');
}

async function loadSkippedTokens() {
  try {
    return new Set(JSON.parse(await fs.readFile(SKIPPED_TOKENS_FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

async function saveSkippedTokens(skippedTokenIds, skippedDetails = []) {
  await fs.writeFile(SKIPPED_TOKENS_FILE, JSON.stringify([...skippedTokenIds]));
  await fs.writeFile(SKIPPED_TOKENS_DETAILED_FILE, JSON.stringify(skippedDetails, null, 2));
  logger.info('Saved skipped tokens');
}

async function createScriptBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(BACKUP_DIR, `trackElement280NFTs_${timestamp}.js`);
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  await fs.copyFile(fileURLToPath(import.meta.url), backupFile);
  logger.info(`Script backup created: ${backupFile}`);
}

async function batchMulticall(contracts) {
  const results = [];
  for (let i = 0; i < contracts.length; i += MAX_MULTICALL_BATCH) {
    const batch = contracts.slice(i, i + MAX_MULTICALL_BATCH);
    results.push(...(await retry(() => client.multicall({ contracts: batch }))));
  }
  return results;
}

async function validateTokenOwnership(owner, tokenId, blockNumber) {
  try {
    const currentOwner = await retry(() =>
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: element280Abi,
        functionName: 'ownerOf',
        args: [BigInt(tokenId)],
        blockNumber: BigInt(blockNumber),
      })
    );
    return currentOwner && currentOwner.toLowerCase() === owner.toLowerCase();
  } catch (error) {
    logger.warn(`Token ${tokenId} validation failed: ${error.message}`);
    return false;
  }
}

async function fetchTimestamps(blockNumbers) {
  const timestamps = {};
  const batchSize = 100;
  for (let i = 0; i < blockNumbers.length; i += batchSize) {
    const batch = blockNumbers.slice(i, i + batchSize);
    const blockPromises = batch.map(async blockNumber => {
      try {
        const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
        timestamps[blockNumber] = Number(block.timestamp);
      } catch (error) {
        logger.error(`Failed to fetch timestamp for block ${blockNumber}: ${error.message}`);
        timestamps[blockNumber] = 0;
      }
    });
    await Promise.all(blockPromises);
    logger.debug(`Fetched timestamps for blocks ${batch[0]}-${batch[batch.length - 1]}`);
  }
  return timestamps;
}

async function fetchContractData() {
  const results = await Promise.all([
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalSupply' })),
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalBurned' })),
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'getTotalNftsPerTiers' })),
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'multiplierPool' })),
    retry(() => client.readContract({ address: VAULT_CONTRACT_ADDRESS, abi: element280VaultAbi, functionName: 'totalRewardPool' }))
      .catch(error => {
        logger.error(`totalRewardPool call failed: ${error.message}`);
        return 0;
      }),
  ]);

  const tierDistributionRaw = Array.isArray(results[2]) ? results[2].map(Number) : [0, 0, 0, 0, 0, 0];

  const formattedTierDistribution = tierDistributionRaw.map((count, i) => ({
    tier: contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`,
    count,
    percentage: Number(results[0]) > 0 ? ((count / Number(results[0])) * 100).toFixed(2) : 0,
  }));

  return {
    totalLive: Number(results[0]),
    totalBurned: Number(results[1]),
    totalMinted: Number(results[0]) + Number(results[1]),
    tierDistribution: tierDistributionRaw,
    formattedTierDistribution,
    multiplierPool: Number(results[3]),
    totalRewardPool: Number((Number(results[4]) / Math.pow(10, ELMNT_DECIMALS)).toFixed(2)) || 0,
  };
}

async function fetchLogsWithPagination(fromBlock, toBlock) {
  let allLogs = [];
  let pageKey = null;
  let attempt = 0;
  const maxAttempts = 5; // NEW: Added retry limit

  do {
    try {
      const response = await retry(
        () =>
          client.getLogs({
            address: CONTRACT_ADDRESS,
            fromBlock: BigInt(fromBlock),
            toBlock: BigInt(toBlock),
            event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
            pageKey,
          }),
        3,
        retryCount => Math.min(1000 * 2 ** retryCount, 30000)
      );
      if (response.length > 0) {
        logger.debug(`Fetched page with ${response.length} logs, pageKey: ${pageKey || 'none'}, fromBlock=${fromBlock}, toBlock=${toBlock}`);
        // NEW: Verify log integrity
        response.forEach((log, index) => {
          if (!log.transactionHash || !log.args?.tokenId || !log.args?.from || !log.args?.to) {
            logger.warn(`Incomplete log at index ${index}: ${JSON.stringify(log, null, 2)}`);
          }
        });
      }
      allLogs.push(...response);
      pageKey = response.nextPageKey;
      attempt = 0; // NEW: Reset attempts on success
    } catch (error) {
      attempt++;
      logger.warn(`Attempt ${attempt}/${maxAttempts} failed for blocks ${fromBlock}-${toBlock}: ${error.message}`);
      if (attempt >= maxAttempts) {
        logger.error(`Failed to fetch logs after ${maxAttempts} attempts for blocks ${fromBlock}-${toBlock}`);
        break; // NEW: Stop pagination on max attempts
      }
      await delay(5000); // NEW: Wait before retrying
    }
  } while (pageKey);

  logger.info(`Total fetched ${allLogs.length} logs for blocks ${fromBlock}-${toBlock}`);
  return allLogs;
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAndStoreEvents(db, startBlock, endBlock, skippedTokenIds, skippedDetails) {
  logger.debug(`Starting fetchAndStoreEvents: startBlock=${startBlock}, endBlock=${endBlock}, CUSTOM_WALLETS=${JSON.stringify(CUSTOM_WALLETS)}`);
  let lastBlock = startBlock;
  if (!FORCE_REFRESH) {
    const checkpoint = await loadCheckpoint();
    if (checkpoint && checkpoint.lastBlock > lastBlock) {
      lastBlock = checkpoint.lastBlock;
    }
  } else {
    logger.info('FORCE_REFRESH enabled, starting from deployment block');
  }

  const burnedDistribution = [0, 0, 0, 0, 0, 0];
  const totalSteps = Math.ceil((endBlock - lastBlock) / BLOCK_STEP);
  const transfers = [];
  let lastToBlock = lastBlock;
  const processedTokenIds = new Set();
  const failedInserts = []; // NEW: Track failed inserts
  const transactionEventCounts = new Map(); // NEW: Track multi-event transactions

  for (let step = 0; step < totalSteps; step++) {
    const fromBlock = lastBlock + 1 + step * BLOCK_STEP;
    const toBlock = Math.min(fromBlock + BLOCK_STEP - 1, endBlock);
    if (fromBlock > endBlock) break;

    logger.info(`Processing blocks ${fromBlock}-${toBlock}`);
    let logs = [];
    try {
      logs = await fetchLogsWithPagination(fromBlock, toBlock);
      logger.info(`Fetched ${logs.length} logs for blocks ${fromBlock}-${toBlock}`);
    } catch (error) {
      logger.error(`Failed to fetch logs for blocks ${fromBlock}-${toBlock}: ${error.message}`);
      continue; // NEW: Continue to next block range
    }

    // NEW: Count events per transaction
    logs.forEach(log => {
      const txHash = log.transactionHash?.toLowerCase() || 'unknown';
      transactionEventCounts.set(txHash, (transactionEventCounts.get(txHash) || 0) + 1);
    });
    transactionEventCounts.forEach((count, txHash) => {
      if (count > 1) {
        logger.debug(`Transaction ${txHash} has ${count} Transfer events`);
      }
    });

    const blockNumbers = [...new Set(logs.map(log => Number(log.blockNumber)))];
    let timestamps = {};
    if (blockNumbers.length > 0) {
      timestamps = await fetchTimestamps(blockNumbers);
    } else {
      logger.debug(`No logs for blocks ${fromBlock}-${toBlock}, skipping timestamps`);
    }

    for (const log of logs) {
      // MODIFIED: Relaxed validation to handle malformed logs
      const tokenId = log.args?.tokenId ? Number(log.args.tokenId) : null;
      const fromAddr = log.args?.from ? log.args.from.toLowerCase() : null;
      const toAddr = log.args?.to ? log.args.to.toLowerCase() : null;
      const blockNumber = Number(log.blockNumber);
      const transactionHash = log.transactionHash ? log.transactionHash.toLowerCase() : null;

      if (!tokenId || !fromAddr || !toAddr || !transactionHash) {
        logger.error(`Invalid log: missing required fields, tokenId=${tokenId}, block=${blockNumber}, tx=${transactionHash}`);
        logger.debug(`Raw log: ${JSON.stringify(log, null, 2)}`);
        skippedTokenIds.add(tokenId || 'unknown');
        skippedDetails.push({
          tokenId: tokenId || 'unknown',
          reason: `Missing fields: tokenId=${tokenId}, from=${fromAddr}, to=${toAddr}, txHash=${transactionHash}`,
          blockNumber,
          fromAddr,
          toAddr,
          transactionHash,
        });
        continue;
      }

      processedTokenIds.add(tokenId);

      if (DEBUG_WALLETS.includes(fromAddr) || DEBUG_WALLETS.includes(toAddr)) {
        logger.debug(`Found event for wallet ${fromAddr} -> ${toAddr}, token=${tokenId}, tx=${transactionHash}`);
      }
      if (DEBUG_TOKEN_IDS.includes(tokenId)) {
        logger.debug(`Found event for token ${tokenId}, from=${fromAddr}, to=${toAddr}, tx=${transactionHash}`);
        // NEW: Log multi-mint transaction
        if (transactionHash === '0xc078b6ff30bb5e2b0dc06742494d6a28f944513ae3583c639928e8ce95c78dc7') {
          logger.info(`Processing token ${tokenId} in multi-mint transaction 0xc078b6ff...`);
        }
      }

      let tier = null;
      try {
        tier = Number(
          await retry(() =>
            client.readContract({
              address: CONTRACT_ADDRESS,
              abi: element280Abi,
              functionName: 'getNftTier',
              args: [BigInt(tokenId)],
            })
          )
        );
        if (tier < 1 || tier > 6) {
          logger.warn(`Invalid tier ${tier} for token ${tokenId}, tx=${transactionHash}, storing with null tier`);
          skippedTokenIds.add(tokenId);
          skippedDetails.push({ tokenId, reason: `Invalid tier ${tier}`, blockNumber, fromAddr, toAddr });
          tier = null;
        }
      } catch (error) {
        logger.warn(`getNftTier failed for token ${tokenId}, tx=${transactionHash}: ${error.message}, storing with null tier`);
        skippedTokenIds.add(tokenId);
        skippedDetails.push({ tokenId, reason: `getNftTier failed: ${error.message}`, blockNumber, fromAddr, toAddr });
        tier = null;
      }

      let eventType = 'transfer';
      if (fromAddr === ZERO_ADDRESS.toLowerCase()) {
        eventType = 'mint';
        logger.info(`Mint: token=${tokenId}, to=${toAddr}, block=${blockNumber}, tx=${transactionHash}`);
      } else if (toAddr === ZERO_ADDRESS.toLowerCase()) {
        eventType = 'burn';
        if (tier !== null && tier >= 1 && tier <= 6) {
          burnedDistribution[tier - 1]++;
        }
        logger.info(`Burn: token=${tokenId}, from=${fromAddr}, block=${blockNumber}, tx=${transactionHash}`);
      } else {
        logger.info(`Transfer: token=${tokenId}, from=${fromAddr}, to=${toAddr}, block=${blockNumber}, tx=${transactionHash}`);
      }

      transfers.push({
        tokenId,
        tier,
        eventType,
        transactionHash,
        blockNumber,
        blockTimestamp: timestamps[blockNumber] || 0,
        ownerAddr: toAddr === ZERO_ADDRESS.toLowerCase() ? fromAddr : toAddr,
        fromAddr,
        toAddr,
      });
    }

    // MODIFIED: Insert transfers individually to prevent batch rollback
    if (transfers.length > 0) {
      for (const transfer of transfers) {
        await executeDbTransaction(db, async () => {
          try {
            await db.run(
              `INSERT OR IGNORE INTO element280_transfers (
                tokenId, tier, eventType, transactionHash, blockNumber, blockTimestamp, ownerAddr, fromAddr, toAddr
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                transfer.tokenId,
                transfer.tier,
                transfer.eventType,
                transfer.transactionHash,
                transfer.blockNumber,
                transfer.blockTimestamp,
                transfer.ownerAddr,
                transfer.fromAddr,
                transfer.toAddr,
              ]
            );
            logger.debug(`Inserted ${transfer.eventType}: token=${transfer.tokenId}, from=${transfer.fromAddr}, to=${transfer.toAddr}, block=${transfer.blockNumber}, tx=${transfer.transactionHash}`);
          } catch (error) {
            logger.error(`Failed to insert transfer for token ${transfer.tokenId}, tx=${transfer.transactionHash}: ${error.message}`);
            failedInserts.push({ ...transfer, error: error.message });
          }
        });
      }
    }

    lastBlock = toBlock;
    lastToBlock = toBlock;
    await saveCheckpoint(lastBlock);
    await delay(2000); // MODIFIED: Increased delay to avoid rate limits
  }

  // Compute burnedDistribution from database
  const burnEvents = await db.all(`SELECT tier FROM element280_transfers WHERE eventType = 'burn' AND tier BETWEEN 1 AND 6`);
  burnEvents.forEach(event => {
    if (event.tier >= 1 && event.tier <= 6) {
      burnedDistribution[event.tier - 1]++;
    }
  });

  // NEW: Enhanced logging for processed token IDs
  logger.info(`Processed ${processedTokenIds.size} token IDs: ${[...processedTokenIds].sort((a, b) => a - b).join(', ')}`);
  if (processedTokenIds.has(16028)) {
    logger.info(`Token ID 16028 was processed in fetchAndStoreEvents`);
  } else {
    logger.warn(`Token ID 16028 was NOT processed in fetchAndStoreEvents`);
  }
  if (processedTokenIds.has(630) || processedTokenIds.has(631) || processedTokenIds.has(632)) {
    logger.info(`Token IDs 630, 631, 632 processed: ${[630, 631, 632].filter(id => processedTokenIds.has(id)).join(', ')}`);
  } else {
    logger.warn(`Token IDs 630, 631, 632 were NOT processed`);
  }

  // NEW: Save failed inserts
  if (failedInserts.length > 0) {
    logger.error(`Failed to insert ${failedInserts.length} transfers:`);
    failedInserts.forEach(f => logger.error(`Token ${f.tokenId}, tx=${f.transactionHash}: ${f.error}`));
    await fs.writeFile(FAILED_INSERTS_FILE, JSON.stringify(failedInserts, null, 2));
    logger.info(`Saved failed inserts to ${FAILED_INSERTS_FILE}`);
  }

  logger.info(`Completed fetchAndStoreEvents: processed ${transfers.length} logs from blocks ${startBlock}-${lastToBlock}`);
  return burnedDistribution;
}

async function processWallet(owner, db, failedTokenIds, skippedTokenIds, skippedDetails) {
  if (owner.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;

  logger.info(`Processing wallet ${owner}`);
  if (DEBUG_WALLETS.includes(owner.toLowerCase())) {
    logger.debug(`Processing specified wallet ${owner}`);
  }

  const wallet = {
    wallet: owner,
    totalLive: 0,
    totalBurned: 0,
    totalBought: 0,
    totalSold: 0,
    minted: 0,
    tiersLive: [0, 0, 0, 0, 0, 0],
    tiersBurned: [0, 0, 0, 0, 0, 0],
    tiersMinted: [0, 0, 0, 0, 0, 0],
    tiersTransferredIn: [0, 0, 0, 0, 0, 0],
    tiersTransferredOut: [0, 0, 0, 0, 0, 0],
    nfts: [],
    multiplierSum: 0,
    displayMultiplierSum: 0,
    claimableRewards: 0,
  };

  const transfers = await db.all(
    `SELECT tokenId, transactionHash, blockNumber, eventType, tier, fromAddr, toAddr
     FROM element280_transfers WHERE lower(fromAddr) = ? OR lower(toAddr) = ? ORDER BY blockNumber ASC`,
    [owner.toLowerCase(), owner.toLowerCase()]
  );
  logger.debug(`Fetched ${transfers.length} transfers for ${owner}`);
  logger.trace(`Transfers for ${owner}: ${JSON.stringify(transfers, null, 2)}`);

  for (const transfer of transfers) {
    if (transfer.tier !== null && (transfer.tier < 1 || transfer.tier > 6)) {
      skippedTokenIds.add(transfer.tokenId);
      skippedDetails.push({ tokenId: transfer.tokenId, reason: `Invalid tier ${transfer.tier}`, blockNumber: transfer.blockNumber, wallet: owner });
      logger.warn(`Skipped invalid tier ${transfer.tier} for token ${transfer.tokenId}, wallet=${owner}`);
      continue;
    }

    const nftData = {
      tokenId: transfer.tokenId,
      status: 'live',
      tier: transfer.tier,
      tierName: transfer.tier !== null ? (contractTiers.element280[transfer.tier]?.name || `Tier ${transfer.tier}`) : 'Unknown',
      transactionHash: transfer.transactionHash,
      blockNumber: transfer.blockNumber,
      lastEventType: transfer.eventType,
    };

    if (transfer.eventType === 'mint' && transfer.toAddr.toLowerCase() === owner.toLowerCase()) {
      wallet.minted++;
      if (transfer.tier !== null) {
        wallet.tiersMinted[transfer.tier - 1]++;
        wallet.tiersLive[transfer.tier - 1]++;
      }
      wallet.nfts.push(nftData);
      logger.debug(`Counted mint for ${owner}: token=${transfer.tokenId}, tx=${transfer.transactionHash}`);
    } else if (transfer.eventType === 'burn' && transfer.fromAddr.toLowerCase() === owner.toLowerCase()) {
      wallet.totalBurned++;
      if (transfer.tier !== null) {
        wallet.tiersBurned[transfer.tier - 1]++;
        wallet.tiersLive[transfer.tier - 1] = Math.max(0, wallet.tiersLive[transfer.tier - 1] - 1);
      }
      wallet.nfts = wallet.nfts.filter(nft => nft.tokenId !== transfer.tokenId);
    } else if (transfer.eventType === 'transfer') {
      if (transfer.fromAddr.toLowerCase() === owner.toLowerCase()) {
        if (transfer.tier !== null) {
          wallet.tiersTransferredOut[transfer.tier - 1]++;
          wallet.tiersLive[transfer.tier - 1] = Math.max(0, wallet.tiersLive[transfer.tier - 1] - 1);
        }
        wallet.nfts = wallet.nfts.filter(nft => nft.tokenId !== transfer.tokenId);
        wallet.totalSold++;
      }
      if (transfer.toAddr.toLowerCase() === owner.toLowerCase()) {
        if (transfer.tier !== null) {
          wallet.tiersTransferredIn[transfer.tier - 1]++;
          wallet.tiersLive[transfer.tier - 1]++;
        }
        wallet.nfts.push(nftData);
        wallet.totalBought++;
      }
    }
  }

  logger.info(`Checking current NFT ownership for ${owner} via balanceOf`);
  let totalLive;
  const cacheKey = owner.toLowerCase();
  if (balanceOfCache.has(cacheKey)) {
    totalLive = balanceOfCache.get(cacheKey);
    logger.debug(`Retrieved balanceOf from cache for ${owner}: ${totalLive}`);
  } else {
    try {
      totalLive = Number(
        await retry(() =>
          client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'balanceOf', args: [owner] })
        )
      ) || 0;
      balanceOfCache.set(cacheKey, totalLive);
    } catch (error) {
      logger.error(`balanceOf failed for ${owner}: ${error.message}`);
      totalLive = 0;
    }
  }
  logger.info(`balanceOf for ${owner}: ${totalLive}`);

  let nfts = [];
  if (totalLive > 0) {
    logger.info(`Fetching NFTs via Alchemy for ${owner}`);
    const nftsResponse = await retry(() =>
      alchemy.nft.getNftsForOwner(owner, { contractAddresses: [CONTRACT_ADDRESS] })
    ).catch(error => {
      logger.error(`Alchemy getNftsForOwner failed for ${owner}: ${error.message}`);
      return { ownedNfts: [] };
    });
    const latestBlock = Number(await client.getBlockNumber());

    for (const nft of nftsResponse.ownedNfts) {
      const tokenId = nft.tokenId;
      if (!tokenId || isNaN(Number(tokenId))) {
        skippedTokenIds.add(String(tokenId));
        skippedDetails.push({ tokenId, reason: 'Invalid tokenId', wallet: owner });
        logger.warn(`Skipped invalid tokenId ${tokenId} for wallet ${owner}`);
        continue;
      }

      const isOwner = await validateTokenOwnership(owner, tokenId, latestBlock);
      if (!isOwner) {
        skippedTokenIds.add(tokenId);
        skippedDetails.push({ tokenId, reason: `Not owned by ${owner}`, wallet: owner });
        logger.warn(`Token ${tokenId} not owned by ${owner}`);
        continue;
      }

      let tier = null;
      try {
        tier = Number(
          await retry(() =>
            client.readContract({
              address: CONTRACT_ADDRESS,
              abi: element280Abi,
              functionName: 'getNftTier',
              args: [BigInt(tokenId)],
            })
          )
        );
        if (tier < 1 || tier > 6) {
          logger.warn(`Invalid tier ${tier} for token ${tokenId}, wallet=${owner}, using null tier`);
          skippedTokenIds.add(tokenId);
          skippedDetails.push({ tokenId, reason: `Invalid tier ${tier}`, wallet: owner });
          tier = null;
        }
      } catch (error) {
        logger.error(`getNftTier failed for token ${tokenId}, wallet=${owner}: ${error.message}, using null tier`);
        skippedTokenIds.add(tokenId);
        skippedDetails.push({ tokenId, reason: `getNftTier failed: ${error.message}`, wallet: owner });
        tier = null;
      }

      nfts.push({
        tokenId,
        status: 'live',
        tier,
        tierName: tier !== null ? (contractTiers.element280[tier]?.name || `Tier ${tier}`) : 'Unknown',
        transactionHash: '',
        blockNumber: latestBlock,
        lastEventType: 'unknown',
      });
    }
  } else {
    logger.info(`Skipping Alchemy fetch for ${owner} as balanceOf is 0`);
  }

  if (nfts.length > 0) {
    wallet.nfts = nfts;
    wallet.tiersLive = [0, 0, 0, 0, 0, 0];
    nfts.forEach(nft => {
      if (nft.tier !== null) {
        wallet.tiersLive[nft.tier - 1]++;
      }
    });
    wallet.totalLive = nfts.length;
  } else {
    wallet.totalLive = totalLive;
  }

  if (wallet.totalLive > 0) {
    try {
      const tokenIds = wallet.nfts.map(nft => BigInt(nft.tokenId));
      const [availability, totalReward] = await retry(() =>
        client.readContract({
          address: VAULT_CONTRACT_ADDRESS,
          abi: element280VaultAbi,
          functionName: 'getRewards',
          args: [tokenIds, owner],
        })
      );
      wallet.claimableRewards = Number((Number(totalReward) / Math.pow(10, ELMNT_DECIMALS)).toFixed(2)) || 0;
      logger.debug(`getRewards for ${owner}: totalReward=${totalReward} (raw), claimableRewards=${wallet.claimableRewards} ELMNT, availability=${JSON.stringify(availability)}`);
    } catch (error) {
      logger.error(`getRewards failed for ${owner}: ${error.message}`);
      wallet.claimableRewards = 0;
    }
  } else {
    logger.info(`No live NFTs for ${owner}, setting claimableRewards to 0`);
    wallet.claimableRewards = 0;
  }

  wallet.tiersLive = wallet.tiersLive.map(count => Math.max(0, count));
  wallet.multiplierSum = wallet.nfts.reduce((sum, nft) => sum + (nft.tier !== null ? (contractTiers.element280[nft.tier]?.multiplier || 0) : 0), 0);
  wallet.displayMultiplierSum = wallet.multiplierSum / 100;

  logger.info(`Wallet ${owner}: totalLive=${wallet.totalLive}, totalBurned=${wallet.totalBurned}, minted=${wallet.minted}, totalBought=${wallet.totalBought}, totalSold=${wallet.totalSold}, tiersLive=${JSON.stringify(wallet.tiersLive)}, claimableRewards=${wallet.claimableRewards} ELMNT`);
  return wallet;
}

async function calculateSummaryStats(db) {
  const transfers = await db.all('SELECT eventType, tokenId, toAddr, fromAddr, blockNumber FROM element280_transfers ORDER BY blockNumber ASC');
  const totalMinted = transfers.filter(t => t.eventType === 'mint').length;
  const totalBurned = transfers.filter(t => t.eventType === 'burn').length;
  const liveTokens = new Map();

  transfers.forEach(t => {
    if (t.eventType === 'mint' || t.eventType === 'transfer') {
      liveTokens.set(t.tokenId, t.toAddr.toLowerCase());
    } else if (t.eventType === 'burn') {
      liveTokens.delete(t.tokenId);
    }
  });

  const totalLive = liveTokens.size;

  logger.info(`Summary stats: totalMinted=${totalMinted}, totalBurned=${totalBurned}, totalLive=${totalLive}`);
  return { totalMinted, totalBurned, totalLive };
}

async function trackElement280NFTs() {
  logger.info(`Tracking NFTs for ${CONTRACT_ADDRESS} in ${FULL_MODE ? 'FULL' : 'CUSTOM'} mode, CUSTOM_WALLETS=${JSON.stringify(CUSTOM_WALLETS)}, FORCE_REFRESH=${FORCE_REFRESH}, VERBOSE=${VERBOSE_MODE}, QUIET=${QUIET_MODE}`);
  const startTime = Date.now();
  if (FORCE_REFRESH) {
    logger.info('Performing database refresh due to --refresh or --wallets');
    await clearDatabase();
    await Promise.all([
      fs.unlink(CHECKPOINT_FILE).catch(() => {}),
      fs.unlink(FAILED_TOKENS_FILE).catch(() => {}),
      fs.unlink(SKIPPED_TOKENS_FILE).catch(() => {}),
      fs.unlink(SKIPPED_TOKENS_DETAILED_FILE).catch(() => {}),
      fs.unlink(FAILED_INSERTS_FILE).catch(() => {}), // NEW: Clear failed inserts
    ]);
  }

  const db = await initDb();
  await migrateDb(db);

  const result = {
    contractAddress: CONTRACT_ADDRESS,
    deploymentBlock: DEPLOYMENT_BLOCK,
    chain: client.chain.name,
    summary: {
      totalMinted: 0,
      totalBurned: 0,
      totalLive: 0,
      totalWallets: 0,
      tierDistribution: [0, 0, 0, 0, 0, 0],
      burnedDistribution: [0, 0, 0, 0, 0, 0],
      multiplierPool: 0,
      totalRewardPool: 0,
      formatted: {}
    },
    wallets: [],
    burnedNfts: [],
  };

  let skippedTokenIds = await loadSkippedTokens();
  let skippedDetails = [];
  let failedTokenIds = await loadFailedTokens();

  try {
    const contractData = await fetchContractData();
    Object.assign(result.summary, contractData);
    await executeDbTransaction(db, async () => {
      const changes = await db.run(
        `INSERT OR REPLACE INTO element280_summary (
          id, totalMinted, totalBurned, totalLive, totalWallets, tierDistribution, burnedDistribution, multiplierPool, totalRewardPool, lastBlock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          1,
          result.summary.totalMinted,
          result.summary.totalBurned,
          result.summary.totalLive,
          0,
          JSON.stringify(result.summary.tierDistribution),
          JSON.stringify(result.summary.burnedDistribution),
          result.summary.multiplierPool,
          result.summary.totalRewardPool,
          0,
        ]
      );
      logger.debug(`Inserted/updated element280_summary: changes=${changes.changes}`);
    });

    const endBlock = Number(await client.getBlockNumber());
    result.summary.burnedDistribution = await fetchAndStoreEvents(db, DEPLOYMENT_BLOCK, endBlock, skippedTokenIds, skippedDetails);
    await db.run('UPDATE element280_summary SET lastBlock = ? WHERE id = 1', endBlock);

    const wallets = new Map();
    if (CUSTOM_WALLETS.length > 0) {
      logger.info(`Processing wallets: ${CUSTOM_WALLETS.join(', ')}`);
      CUSTOM_WALLETS.forEach(addr =>
        wallets.set(addr.toLowerCase(), {
          wallet: addr.toLowerCase(),
          totalLive: 0,
          totalBurned: 0,
          totalBought: 0,
          totalSold: 0,
          minted: 0,
          tiersLive: [0, 0, 0, 0, 0, 0],
          tiersBurned: [0, 0, 0, 0, 0, 0],
          tiersMinted: [0, 0, 0, 0, 0, 0],
          tiersTransferredIn: [0, 0, 0, 0, 0, 0],
          tiersTransferredOut: [0, 0, 0, 0, 0, 0],
          nfts: [],
          multiplierSum: 0,
          displayMultiplierSum: 0,
          claimableRewards: 0,
        })
      );
    } else {
      logger.info('Processing all wallets');
      const logs = await db.all('SELECT fromAddr, toAddr FROM element280_transfers');
      for (const { fromAddr: from, toAddr: to } of logs) {
        if (from.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && !wallets.has(from.toLowerCase())) {
          wallets.set(from.toLowerCase(), {
            wallet: from.toLowerCase(),
            totalLive: 0,
            totalBurned: 0,
            totalBought: 0,
            totalSold: 0,
            minted: 0,
            tiersLive: [0, 0, 0, 0, 0, 0],
            tiersBurned: [0, 0, 0, 0, 0, 0],
            tiersMinted: [0, 0, 0, 0, 0, 0],
            tiersTransferredIn: [0, 0, 0, 0, 0, 0],
            tiersTransferredOut: [0, 0, 0, 0, 0, 0],
            nfts: [],
            multiplierSum: 0,
            displayMultiplierSum: 0,
            claimableRewards: 0,
          });
        }
        if (to.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && !wallets.has(to.toLowerCase())) {
          wallets.set(to.toLowerCase(), {
            wallet: to.toLowerCase(),
            totalLive: 0,
            totalBurned: 0,
            totalBought: 0,
            totalSold: 0,
            minted: 0,
            tiersLive: [0, 0, 0, 0, 0, 0],
            tiersBurned: [0, 0, 0, 0, 0, 0],
            tiersMinted: [0, 0, 0, 0, 0, 0],
            tiersTransferredIn: [0, 0, 0, 0, 0, 0],
            tiersTransferredOut: [0, 0, 0, 0, 0, 0],
            nfts: [],
            multiplierSum: 0,
            displayMultiplierSum: 0,
            claimableRewards: 0,
          });
        }
      }
      logger.debug(`Collected ${wallets.size} unique wallets: ${[...wallets.keys()].join(', ')}`);
    }

    const walletLimit = pLimit(MAX_CONCURRENT_WALLETS);
    const walletResults = [];
    let walletCount = 0;
    for (const walletAddr of wallets.keys()) {
      logger.debug(`Processing wallet ${walletAddr}`);
      const wallet = await walletLimit(() => processWallet(walletAddr, db, failedTokenIds, skippedTokenIds, skippedDetails));
      if (wallet) {
        walletResults.push(wallet);
        await executeDbTransaction(db, async () => {
          const changes = await db.run(
            `INSERT OR REPLACE INTO element280_wallets (
              address, totalLive, totalBurned, totalBought, totalSold, minted, tiersLive, tiersBurned,
              tiersMinted, tiersTransferredIn, tiersTransferredOut, nfts, multiplierSum, displayMultiplierSum, claimableRewards
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              wallet.wallet.toLowerCase(),
              wallet.totalLive,
              wallet.totalBurned,
              wallet.totalBought,
              wallet.totalSold,
              wallet.minted,
              JSON.stringify(wallet.tiersLive),
              JSON.stringify(wallet.tiersBurned),
              JSON.stringify(wallet.tiersMinted),
              JSON.stringify(wallet.tiersTransferredIn),
              JSON.stringify(wallet.tiersTransferredOut),
              JSON.stringify(wallet.nfts),
              wallet.multiplierSum,
              wallet.displayMultiplierSum,
              wallet.claimableRewards,
            ]
          );
          logger.debug(`Inserted/updated wallet ${walletAddr}: changes=${changes.changes}`);
        });
        walletCount++;
        logger.info(`Processed ${walletCount}/${wallets.size} wallets: ${walletAddr}`);
      } else {
        logger.warn(`No wallet data returned for ${walletAddr}`);
      }
      await delay(100);
    }

    logger.info(`Total wallets processed: ${walletResults.length}`);
    logger.debug(`Wallets to be included in result.wallets: ${walletResults.map(w => w.wallet).join(', ')}`);

    walletResults.forEach(wallet => {
      if (wallet) wallets.set(wallet.wallet.toLowerCase(), wallet);
    });

    await saveFailedTokens(failedTokenIds);
    await saveSkippedTokens(skippedTokenIds, skippedDetails);

    const logs = await db.all('SELECT * FROM element280_transfers ORDER BY blockNumber ASC');
    for (const { tokenId: tokenIdNum, tier, eventType, transactionHash, blockNumber, blockTimestamp, ownerAddr, fromAddr: from } of logs) {
      if (eventType === 'burn' && tier !== null && tier >= 1 && tier <= 6) {
        result.burnedNfts.push({
          tokenId: tokenIdNum,
          tier,
          tierName: contractTiers.element280[tier]?.name || `Tier ${tier}`,
          burnerWallet: from,
          transactionHash,
          blockNumber,
          blockTimestamp,
          ownerAddr,
          lastEventType: eventType,
        });
      }
    }

    result.wallets = Array.from(wallets.values())
      .filter(w => w.totalLive > 0 || w.totalBurned > 0 || w.minted > 0 || w.totalBought > 0 || w.totalSold > 0)
      .map((w, index) => ({
        ...w,
        rank: index + 1,
        percentage: result.summary.multiplierPool > 0 ? (w.multiplierSum / result.summary.multiplierPool) * 100 : 0,
      }));
    result.summary.totalWallets = result.wallets.length;

    logger.info(`Wallets included in JSON: ${result.wallets.length}`);
    logger.debug(`Wallet addresses in JSON: ${result.wallets.map(w => w.wallet).join(', ')}`);

    await executeDbTransaction(db, async () => {
      const changes = await db.run('UPDATE element280_summary SET totalWallets = ?, burnedDistribution = ?, totalRewardPool = ? WHERE id = 1', [
        result.summary.totalWallets,
        JSON.stringify(result.summary.burnedDistribution),
        result.summary.totalRewardPool,
      ]);
      logger.debug(`Updated element280_summary: changes=${changes.changes}`);
    });

    const { totalMinted, totalBurned, totalLive } = await calculateSummaryStats(db);
    result.summary.totalMinted = totalMinted;
    result.summary.totalBurned = totalBurned;
    result.summary.totalLive = totalLive;

    result.summary.formatted = {
      totalMinted: result.summary.totalMinted,
      totalBurned: result.summary.totalBurned,
      totalLive: result.summary.totalLive,
      totalWallets: result.summary.totalWallets,
      multiplierPool: result.summary.multiplierPool,
      totalRewardPool: result.summary.totalRewardPool,
      tierDistribution: result.summary.tierDistribution.map((count, i) => ({
        tier: contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`,
        count,
        percentage: result.summary.totalLive > 0 ? ((count / result.summary.totalLive) * 100).toFixed(2) : 0,
      })),
      burnedDistribution: result.summary.burnedDistribution.map((count, i) => ({
        tier: contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`,
        count,
        burnedPercentage: result.summary.tierDistribution[i] > 0 ? ((count / result.summary.tierDistribution[i]) * 100).toFixed(2) : 0,
      })),
    };

    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    try {
      const jsonContent = JSON.stringify(result, (key, value) => (typeof value === 'bigint' ? value.toString() : value));
      await fs.writeFile(CACHE_FILE, jsonContent);
      logger.info(`Successfully wrote to ${CACHE_FILE}, size=${jsonContent.length} bytes`);
      const writtenData = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
      const walletIncluded = writtenData.wallets.some(w => w.wallet.toLowerCase() === '0x15702443110894b26911b913b17ea4931f803b02');
      logger.debug(`Wallet 0x15702443110894b26911b913b17ea4931f803b02 included in JSON: ${walletIncluded}`);
    } catch (error) {
      logger.error(`Failed to write ${CACHE_FILE}: ${error.message}`);
      throw error;
    }

    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`
=== Element280 NFT Summary ===
Wallets: ${result.summary.totalWallets}
Total Minted: ${result.summary.totalMinted}
Total Live: ${result.summary.totalLive}
Total Burned: ${result.summary.totalBurned}
Multiplier Pool: ${result.summary.multiplierPool}
Total Reward Pool: ${result.summary.totalRewardPool} ELMNT
Total Execution Time: ${executionTime}s
`);

    await createScriptBackup();
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    throw error;
  } finally {
    await db.close();
  }

  logger.info(`Completed trackElement280NFTs: processed ${result.wallets.length} wallets`);
  return result;
}

trackElement280NFTs().catch(error => {
  logger.error('Script failed:', error);
  process.exit(1);
});