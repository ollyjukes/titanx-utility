// scripts/trackElement280NFTs.js

// Global error handlers
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
const VERBOSE_MODE = args.verbose || true;
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
const FAILED_INSERTS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_failed_inserts.json');
const FAILED_BLOCKS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_failed_blocks.json');
const SKIPPED_WALLETS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_skipped_wallets.json');
const COLLECTED_WALLETS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_collected_wallets.json');
const BACKUP_DIR = path.join(process.cwd(), 'scripts', 'backups');
const MAX_BLOCK_RANGE = 5000;
const MAX_CONCURRENT_BLOCKS = 3;
const MAX_CONCURRENT_WALLETS = 1;
const MAX_MULTICALL_BATCH = 50;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ELMNT_DECIMALS = 18;
const BLOCK_STEP = 1000;
const DEBUG_WALLETS = [
  '0x15702443110894b26911b913b17ea4931f803b02',
  '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda',
  '0x9d641961a31b3eed46e664fa631aad3021323862',
];
const DEBUG_TOKEN_IDS = [16028, 630, 631, 632];

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
    name: 'getClaimableRewardsForTokens',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256[]' }],
    outputs: [{ type: 'uint256' }],
  },
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
async function retry(fn, attempts = 5, delay = retryCount => Math.min(1000 * 2 ** retryCount, 10000)) {
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
      ALTER TABLE element280_wallets ADD COLUMN claimableRewards REAL DEFAULT 0;
      ALTER TABLE element280_wallets ADD COLUMN tiersMinted TEXT DEFAULT '[0,0,0,0,0,0]';
      ALTER TABLE element280_wallets ADD COLUMN tiersTransferredIn TEXT DEFAULT '[0,0,0,0,0,0]';
      ALTER TABLE element280_wallets ADD COLUMN tiersTransferredOut TEXT DEFAULT '[0,0,0,0,0,0]';
    `);
    logger.info('Database migrated');
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
  await fs.appendFile(SKIPPED_TOKENS_DETAILED_FILE, JSON.stringify(skippedDetails, null, 2) + '\n');
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

async function fetchContractData() {
  try {
    const [totalSupply, totalBurned, tierCounts, multiplierPool, totalRewardPool] = await retry(() =>
      client.multicall({
        contracts: [
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalSupply' },
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalBurned' },
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'getTotalNftsPerTiers' },
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'multiplierPool' },
          { address: VAULT_CONTRACT_ADDRESS, abi: element280VaultAbi, functionName: 'totalRewardPool' },
        ],
      })
    );
    return {
      totalMinted: Number(totalSupply.result) + Number(totalBurned.result),
      totalBurned: Number(totalBurned.result),
      totalLive: Number(totalSupply.result),
      tierDistribution: tierCounts.result.map(Number),
      multiplierPool: Number(multiplierPool.result),
      totalRewardPool: Number(totalRewardPool.result),
    };
  } catch (error) {
    logger.error(`Failed to fetch contract data: ${error.message}`);
    throw error;
  }
}

async function fetchAndStoreEvents(db, startBlock, endBlock, skippedTokenIds, skippedDetails) {
  const burnedDistribution = [0, 0, 0, 0, 0, 0];
  const limit = pLimit(MAX_CONCURRENT_BLOCKS);
  const ranges = [];
  for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += MAX_BLOCK_RANGE) {
    const toBlock = Math.min(fromBlock + MAX_BLOCK_RANGE - 1, endBlock);
    ranges.push({ fromBlock, toBlock });
  }

  const failedBlocks = [];
  await Promise.all(
    ranges.map(({ fromBlock, toBlock }) =>
      limit(async () => {
        try {
          const logs = await retry(() =>
            client.getLogs({
              address: CONTRACT_ADDRESS,
              event: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'),
              fromBlock: BigInt(fromBlock),
              toBlock: BigInt(toBlock),
            })
          );

          const uniqueBlocks = [...new Set(logs.map(log => Number(log.blockNumber)))];
          const blockTimestamps = new Map();
          await Promise.all(
            uniqueBlocks.map(blockNumber =>
              retry(() =>
                client.getBlock({ blockNumber: BigInt(blockNumber) }).then(block =>
                  blockTimestamps.set(blockNumber, Number(block.timestamp))
                )
              )
            )
          );

          for (const log of logs) {
            const { from, to, tokenId } = log.args;
            const tokenIdNum = tokenId.toString();
            const blockNumber = Number(log.blockNumber);
            const transactionHash = log.transactionHash.toLowerCase();
            let tier = 0;
            let eventType = 'transfer';
            let ownerAddr = '';

            if (from.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
              eventType = 'mint';
            } else if (to.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
              eventType = 'burn';
            }

            try {
              tier = Number(
                await retry(() =>
                  client.readContract({
                    address: CONTRACT_ADDRESS,
                    abi: element280Abi,
                    functionName: 'getNftTier',
                    args: [tokenId],
                    blockNumber: BigInt(blockNumber),
                  })
                )
              );
            } catch (error) {
              logger.warn(`Skipping token ${tokenIdNum} at block ${blockNumber}: Failed to fetch tier (${error.message})`);
              skippedTokenIds.add(tokenIdNum);
              skippedDetails.push({ tokenId: tokenIdNum, blockNumber, reason: `Failed to fetch tier: ${error.message}` });
              continue;
            }

            try {
              ownerAddr = await retry(() =>
                client.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: element280Abi,
                  functionName: 'ownerOf',
                  args: [tokenId],
                  blockNumber: BigInt(blockNumber),
                })
              );
            } catch (error) {
              logger.warn(`Token ${tokenIdNum} owner fetch failed: ${error.message}`);
            }

            const [multiplierPool, totalSupply, totalBurned] = await retry(() =>
              client.multicall({
                contracts: [
                  { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'multiplierPool', blockNumber: BigInt(blockNumber) },
                  { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalSupply', blockNumber: BigInt(blockNumber) },
                  { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalBurned', blockNumber: BigInt(blockNumber) },
                ],
              })
            );

            try {
              await executeDbTransaction(db, async () => {
                await db.run(
                  `INSERT OR REPLACE INTO element280_transfers (
                    tokenId, fromAddr, toAddr, tier, blockNumber, transactionHash,
                    blockTimestamp, eventType, multiplierPool, totalSupply, totalBurned, ownerAddr
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    tokenIdNum,
                    from.toLowerCase(),
                    to.toLowerCase(),
                    tier,
                    blockNumber,
                    transactionHash,
                    blockTimestamps.get(blockNumber) || 0,
                    eventType,
                    multiplierPool.status === 'success' ? Number(multiplierPool.result) : 0,
                    totalSupply.status === 'success' ? Number(totalSupply.result) : 0,
                    totalBurned.status === 'success' ? Number(totalBurned.result) : 0,
                    ownerAddr.toLowerCase(),
                  ]
                );
              });
            } catch (error) {
              logger.error(`Failed to insert transfer for token ${tokenIdNum}: ${error.message}`);
              await fs.appendFile(FAILED_INSERTS_FILE, JSON.stringify({ tokenId: tokenIdNum, error: error.message }) + '\n');
            }

            if (eventType === 'burn' && tier >= 1 && tier <= 6) {
              burnedDistribution[tier - 1]++;
            }
          }
        } catch (error) {
          logger.error(`Failed to process block range ${fromBlock}-${toBlock}: ${error.message}`);
          failedBlocks.push({ fromBlock, toBlock, error: error.message });
        }
      })
    )
  );

  if (failedBlocks.length > 0) {
    await fs.writeFile(FAILED_BLOCKS_FILE, JSON.stringify(failedBlocks, null, 2));
  }

  return burnedDistribution;
}

async function processWallet(owner, db, failedTokenIds, skippedTokenIds, skippedDetails) {
  if (owner.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;

  logger.info(`Processing wallet ${owner}`);
  if (DEBUG_WALLETS.includes(owner.toLowerCase())) {
    logger.debug(`Processing debug wallet ${owner}`);
  }

  const wallet = {
    wallet: owner.toLowerCase(),
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

  // NEW: Fetch current balance
  try {
    const balance = await retry(() =>
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: element280Abi,
        functionName: 'balanceOf',
        args: [owner],
      })
    );
    wallet.totalLive = Number(balance);
  } catch (error) {
    logger.warn(`Failed to get balance for ${owner}: ${error.message}`);
    wallet.totalLive = 0;
  }

  // NEW: Fetch owned NFTs
  let nfts = [];
  if (wallet.totalLive > 0) {
    try {
      const nftsResponse = await retry(() =>
        alchemy.nft.getNftsForOwner(owner, {
          contractAddresses: [CONTRACT_ADDRESS],
        })
      );
      nfts = nftsResponse.ownedNfts.map(nft => ({
        tokenId: nft.tokenId,
        status: 'live',
        tier: 0,
        tierName: '',
      }));

      const tokenIds = nfts.map(nft => BigInt(nft.tokenId));
      const tierCalls = tokenIds.map(tokenId => ({
        address: CONTRACT_ADDRESS,
        abi: element280Abi,
        functionName: 'getNftTier',
        args: [tokenId],
      }));

      const tierResults = await retry(() => client.multicall({ contracts: tierCalls }));
      const validTokenIds = [];
      nfts.forEach((nft, index) => {
        if (tierResults[index].status === 'success') {
          const tier = Number(tierResults[index].result);
          if (tier >= 1 && tier <= 6) {
            nft.tier = tier;
            nft.tierName = contractTiers.element280[tier].name;
            wallet.tiersLive[tier - 1]++;
            validTokenIds.push(BigInt(nft.tokenId));
          }
        }
      });

      wallet.nfts = nfts;

      // Calculate multiplier sum
      const multipliers = Object.values(contractTiers.element280).map(t => t.multiplier);
      wallet.multiplierSum = nfts.reduce((sum, nft) => sum + (nft.tier > 0 ? multipliers[nft.tier - 1] : 0), 0);
      wallet.displayMultiplierSum = wallet.multiplierSum / 100;

      // Calculate claimable rewards
      if (validTokenIds.length > 0) {
        try {
          const rewards = await retry(
            () =>
              client.readContract({
                address: CONTRACT_ADDRESS,
                abi: element280Abi,
                functionName: 'getClaimableRewardsForTokens',
                args: [validTokenIds],
              }),
            2,
            1000,
            true
          );
          wallet.claimableRewards = Number(rewards) / 1e18;
        } catch (error) {
          logger.warn(`Rewards query failed for ${owner}: ${error.message}`);
          wallet.claimableRewards = 0;
        }
      }
    } catch (error) {
      logger.warn(`Failed to process NFTs for ${owner}: ${error.message}`);
    }
  }

  // NEW: Process transfers to calculate minted, bought, sold, burned
  try {
    const transfers = await db.all(
      `SELECT tokenId, transactionHash, blockNumber, eventType, tier, fromAddr, toAddr
       FROM element280_transfers
       WHERE lower(fromAddr) = ? OR lower(toAddr) = ?
       ORDER BY blockNumber ASC`,
      [owner.toLowerCase(), owner.toLowerCase()]
    );
    logger.debug(`Fetched ${transfers.length} transfers for ${owner}`);
    if (transfers.length === 0) {
      logger.warn(`No transfers found for ${owner}`);
    } else {
      logger.trace(`Transfers for ${owner}: ${JSON.stringify(transfers, null, 2)}`);
    }

    for (const log of transfers) {
      const { fromAddr, toAddr, tokenId, tier, eventType } = log;
      if (tier < 1 || tier > 6) continue;

      if (eventType === 'mint') {
        wallet.minted += 1;
        wallet.tiersMinted[tier - 1]++;
      } else if (eventType === 'burn') {
        wallet.totalBurned += 1;
        wallet.tiersBurned[tier - 1]++;
      } else if (eventType === 'transfer') {
        if (fromAddr.toLowerCase() === owner.toLowerCase()) {
          wallet.totalSold += 1;
          wallet.tiersTransferredOut[tier - 1]++;
        }
        if (toAddr.toLowerCase() === owner.toLowerCase()) {
          wallet.totalBought += 1;
          wallet.tiersTransferredIn[tier - 1]++;
        }
      }
    }
  } catch (error) {
    logger.error(`Failed to fetch transfers for ${owner}: ${error.message}`);
  }

  return wallet;
}

async function trackElement280NFTs() {
  if (SHOW_HELP) {
    console.log(`
      Usage: node scripts/trackElement280NFTs.js [options]
      Options:
        --help, -h          Show this help message
        --verbose, -v       Enable verbose logging
        --quiet, -q         Enable quiet mode (errors only)
        --full              Run full sync from deployment block
        --refresh           Force refresh of wallet data
        --summary           Show summary only
        --wallets=addr1,addr2 Process specific wallets (comma-separated)
    `);
    process.exit(0);
  }

  const result = {
    summary: {
      totalMinted: 0,
      totalBurned: 0,
      totalLive: 0,
      totalWallets: 0,
      tierDistribution: [0, 0, 0, 0, 0, 0],
      burnedDistribution: [0, 0, 0, 0, 0, 0],
      multiplierPool: 0,
      totalRewardPool: 0,
    },
    wallets: [],
    burnedNfts: [],
  };

  const failedTokenIds = await loadFailedTokens();
  const skippedTokenIds = await loadSkippedTokens();
  const skippedDetails = [];

  let db;
  try {
    if (FULL_MODE) {
      await clearDatabase();
    }
    await createScriptBackup();
    db = await initDb();
    await migrateDb(db);

    const checkpoint = await loadCheckpoint();
    const contractData = await fetchContractData();
    Object.assign(result.summary, contractData);

    const endBlock = Number(await client.getBlockNumber());
    result.summary.burnedDistribution = await fetchAndStoreEvents(db, DEPLOYMENT_BLOCK, endBlock, skippedTokenIds, skippedDetails);
    await db.run('UPDATE element280_summary SET lastBlock = ? WHERE id = 1', endBlock);

    const wallets = new Map();
    let owners = [];

    // NEW: Fetch current owners using Alchemy
    if (CUSTOM_WALLETS.length === 0) {
      logger.info('Fetching owners with NFTs');
      try {
        const ownersResponse = await retry(() => alchemy.nft.getOwnersForContract(CONTRACT_ADDRESS));
        owners = ownersResponse.owners
          .filter(owner => owner.toLowerCase() !== ZERO_ADDRESS.toLowerCase())
          .map(owner => owner.toLowerCase());
        logger.info(`Found ${owners.length} owners`);
      } catch (error) {
        logger.error(`Failed to fetch owners: ${error.message}`);
      }
    } else {
      owners = CUSTOM_WALLETS;
      logger.info(`Processing custom wallets: ${CUSTOM_WALLETS.join(', ')}`);
    }

    // MODIFIED: Initialize wallets from owners and transfers
    for (const owner of owners) {
      wallets.set(owner.toLowerCase(), {
        wallet: owner.toLowerCase(),
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

    // NEW: Add wallets from transfers
    const transferWallets = await db.all(`
      SELECT DISTINCT address
      FROM (
        SELECT lower(fromAddr) AS address FROM element280_transfers WHERE fromAddr != ?
        UNION
        SELECT lower(toAddr) AS address FROM element280_transfers WHERE toAddr != ?
      )`,
      [ZERO_ADDRESS.toLowerCase(), ZERO_ADDRESS.toLowerCase()]
    );
    for (const { address } of transferWallets) {
      if (!wallets.has(address.toLowerCase())) {
        wallets.set(address.toLowerCase(), {
          wallet: address.toLowerCase(),
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

    logger.info(`Collected ${wallets.size} unique wallets`);
    await fs.writeFile(COLLECTED_WALLETS_FILE, JSON.stringify([...wallets.keys()], null, 2));

    // Verify debug wallets
    DEBUG_WALLETS.forEach(wallet => {
      if (!wallets.has(wallet.toLowerCase())) {
        logger.warn(`Debug wallet ${wallet} not found in wallets Map`);
      } else {
        logger.info(`Debug wallet ${wallet} included in wallets Map`);
      }
    });

    // Process wallets
    const walletLimit = pLimit(MAX_CONCURRENT_WALLETS);
    const walletResults = [];
    let walletCount = 0;
    for (const walletAddr of wallets.keys()) {
      logger.debug(`Processing wallet ${walletAddr}`);
      const wallet = await walletLimit(() => processWallet(walletAddr, db, failedTokenIds, skippedTokenIds, skippedDetails));
      if (wallet) {
        walletResults.push(wallet);
        await retry(
          async () => {
            await executeDbTransaction(db, async () => {
              await db.run(
                `INSERT OR REPLACE INTO element280_wallets (
                  address, totalLive, totalBurned, totalBought, totalSold, minted,
                  tiersLive, tiersBurned, tiersMinted, tiersTransferredIn, tiersTransferredOut,
                  nfts, multiplierSum, displayMultiplierSum, claimableRewards
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
            });
            logger.debug(`Inserted/updated wallet ${walletAddr}`);
          },
          3,
          1000
        );
        walletCount++;
        logger.info(`Processed ${walletCount}/${wallets.size} wallets: ${walletAddr}`);
      } else {
        logger.warn(`No wallet data returned for ${walletAddr}`);
        await fs.appendFile(
          SKIPPED_WALLETS_FILE,
          JSON.stringify({ wallet: walletAddr, timestamp: new Date().toISOString() }) + '\n'
        );
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // NEW: Process transfers in memory for historical stats
    const logs = await db.all('SELECT * FROM element280_transfers ORDER BY blockNumber ASC');
    for (const log of logs) {
      const from = log.fromAddr.toLowerCase();
      const to = log.toAddr.toLowerCase();
      const tokenIdNum = log.tokenId;
      const tier = log.tier;
      const eventType = log.eventType;

      if (from !== ZERO_ADDRESS.toLowerCase() && !wallets.has(from)) {
        wallets.set(from, {
          wallet: from,
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
      if (to !== ZERO_ADDRESS.toLowerCase() && !wallets.has(to)) {
        wallets.set(to, {
          wallet: to,
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

      if (eventType === 'mint' && tier >= 1 && tier <= 6) {
        const wallet = wallets.get(to);
        wallet.minted += 1;
        wallet.totalBought += 1;
        wallet.tiersMinted[tier - 1]++;
      } else if (eventType === 'burn' && tier >= 1 && tier <= 6) {
        const wallet = wallets.get(from);
        wallet.totalBurned += 1;
        wallet.totalSold += 1;
        wallet.tiersBurned[tier - 1]++;
        result.burnedNfts.push({
          tokenId: tokenIdNum,
          tier,
          tierName: contractTiers.element280[tier].name,
          burnerWallet: from,
          transactionHash: log.transactionHash,
          blockTimestamp: log.blockTimestamp,
          ownerAddr: log.ownerAddr,
        });
      } else if (eventType === 'transfer' && tier >= 1 && tier <= 6) {
        const fromWallet = wallets.get(from);
        const toWallet = wallets.get(to);
        fromWallet.totalSold += 1;
        toWallet.totalBought += 1;
        fromWallet.tiersTransferredOut[tier - 1]++;
        toWallet.tiersTransferredIn[tier - 1]++;
      }
    }

    // NEW: Finalize wallet data
    result.wallets = Array.from(wallets.values())
      .filter(w => w.totalLive > 0 || w.totalBurned > 0 || w.totalBought > 0 || w.totalSold > 0 || w.minted > 0)
      .map((w, index) => ({
        ...w,
        rank: index + 1,
        percentage: result.summary.multiplierPool > 0 ? (w.multiplierSum / result.summary.multiplierPool) * 100 : 0,
      }));
    result.summary.totalWallets = result.wallets.length;

    // Update summary
    await executeDbTransaction(db, async () => {
      await db.run(
        `INSERT OR REPLACE INTO element280_summary (
          id, totalMinted, totalBurned, totalLive, totalWallets,
          tierDistribution, burnedDistribution, multiplierPool, totalRewardPool, lastBlock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          1,
          result.summary.totalMinted,
          result.summary.totalBurned,
          result.summary.totalLive,
          result.summary.totalWallets,
          JSON.stringify(result.summary.tierDistribution),
          JSON.stringify(result.summary.burnedDistribution),
          result.summary.multiplierPool,
          result.summary.totalRewardPool,
          endBlock,
        ]
      );
    });

    // Save failed and skipped tokens
    await saveFailedTokens(failedTokenIds);
    await saveSkippedTokens(skippedTokenIds, skippedDetails);

    // Save output
    await fs.writeFile(CACHE_FILE, JSON.stringify(result, null, 2));
    await saveCheckpoint(endBlock);

    logger.info(`Completed: Processed ${result.wallets.length} wallets, ${result.burnedNfts.length} burned NFTs`);
    logger.info(`Summary: totalMinted=${result.summary.totalMinted}, totalLive=${result.summary.totalLive}, totalBurned=${result.summary.totalBurned}, totalWallets=${result.summary.totalWallets}`);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    throw error;
  } finally {
    if (db) await db.close();
  }

  return result;
}

trackElement280NFTs().catch(error => {
  logger.error('Script failed:', error);
  process.exit(1);
});