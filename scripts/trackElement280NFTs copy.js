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
import { contractTiers, contractAddresses } from '../app/nft-contracts.js';
import fetch from 'node-fetch';

// Initialize environment
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Logger setup
const logger = pino({ level: 'debug', transport: { target: 'pino-pretty' } });

// Parse command-line arguments
const args = minimist(process.argv.slice(2), { alias: { h: 'help' } });
const FORCE_REFRESH = args.refresh || false;
const FULL_MODE = args.full || !args.wallets;
const CUSTOM_WALLETS = args.wallets ? args.wallets.split(',').map(addr => addr.trim().toLowerCase()) : [];
const SHOW_HELP = args.help || false;
const SHOW_SUMMARY = args.summary || false;

// Constants
const CONTRACT_ADDRESS = contractAddresses.element280;
const DEPLOYMENT_BLOCK = 20945304;
const CACHE_FILE = path.join(process.cwd(), 'public', 'data', 'element280_nft_status.json');
const DB_FILE = path.join(process.cwd(), 'public', 'data', 'element280.db');
const CHECKPOINT_FILE = path.join(process.cwd(), 'public', 'data', 'element280_checkpoint.json');
const FAILED_TOKENS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_failed_tokens.json');
const SKIPPED_TOKENS_FILE = path.join(process.cwd(), 'public', 'data', 'element280_skipped_tokens.json');
const SKIPPED_TOKENS_DETAILED_FILE = path.join(process.cwd(), 'public', 'data', 'element280_skipped_tokens_detailed.json');
const BACKUP_DIR = path.join(process.cwd(), 'scripts', 'backups');
const MAX_BLOCK_RANGE = 5000;
const MAX_CONCURRENT_BLOCKS = 3;
const MAX_CONCURRENT_WALLETS = 2;
const MAX_MULTICALL_BATCH = 100;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_ADDRESS_PADDED = '0x0000000000000000000000000000000000000000000000000000000000000000';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Help message
if (SHOW_HELP) {
  console.log(`
Usage: node scripts/trackElement280NFTs.js [options]

Tracks Element280 NFT ownership, transfers, and tier distribution.

Options:
  --help, -h           Show this help message
  --refresh            Clear and refresh database
  --full               Process all wallets from transfers
  --wallets=addr1,addr2 Process specific wallets
  --summary            Display summary and exit

Examples:
  node scripts/trackElement280NFTs.js --full
  node scripts/trackElement280NFTs.js --wallets=0x15702443110894B26911B913b17ea4931F803B02
  node scripts/trackElement280NFTs.js --summary
  `);
  process.exit(0);
}

// Verify environment
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  logger.error('ALCHEMY_API_KEY not defined in .env.local');
  process.exit(1);
}

// Contract ABI
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

// Clients
const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, { timeout: 60000 }),
});
const alchemy = new Alchemy({ apiKey: ALCHEMY_API_KEY, network: Network.ETH_MAINNET });

// Utility Functions
async function retry(fn, attempts = 15, delay = 15000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === attempts - 1) throw error;
      logger.warn(`Retry ${i + 1}/${attempts}: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

async function executeDbTransaction(db, fn) {
  await db.run('BEGIN TRANSACTION');
  try {
    const result = await fn();
    await db.run('COMMIT');
    return result;
  } catch (error) {
    await db.run('ROLLBACK');
    logger.error(`Transaction failed: ${error.message}`);
    throw error;
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
  const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
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
      displayMultiplierSum REAL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_addresses ON element280_transfers(fromAddr, toAddr);
    CREATE INDEX IF NOT EXISTS idx_transfers_tokenId ON element280_transfers(tokenId);
    CREATE INDEX IF NOT EXISTS idx_transfers_eventType ON element280_transfers(eventType);
    CREATE INDEX IF NOT EXISTS idx_transfers_blockNumber ON element280_transfers(blockNumber);
  `);
  logger.info('Database initialized');
  return db;
}

async function loadCheckpoint() {
  try {
    const data = await fs.readFile(CHECKPOINT_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
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

async function displaySummary() {
  try {
    const jsonData = await fs.readFile(CACHE_FILE, 'utf8').catch(() => null);
    if (!jsonData) {
      console.error('No data in element280_nft_status.json. Run script first.');
      process.exit(1);
    }
    const result = JSON.parse(jsonData);
    const db = await open({ filename: DB_FILE, driver: sqlite3.Database });
    const wallets = await db.all('SELECT address, totalLive, totalBurned, tiersLive, multiplierSum FROM element280_wallets');
    const transferCount = await db.get('SELECT COUNT(*) as count FROM element280_transfers').then(row => row.count).catch(() => 0);

    console.log('\n=== Element280 NFT Summary ===');
    console.log(`Contract Address: ${result.contractAddress}`);
    console.log(`Deployment Block: ${result.deploymentBlock}`);
    console.log(`Chain: ${result.chain}`);
    console.log(`Total Minted: ${result.summary.totalMinted}`);
    console.log(`Total Live: ${result.summary.totalLive}`);
    console.log(`Total Burned: ${result.summary.totalBurned}`);
    console.log(`Total Wallets: ${result.summary.totalWallets}`);
    console.log(`Total Transfers Recorded: ${transferCount}`);
    console.log(`Multiplier Pool: ${result.summary.multiplierPool}`);

    if (transferCount === 0) {
      console.log(
        '\n[WARNING] No transfers found. Check Alchemy API key, logs, or run with --refresh.'
      );
    }

    console.log('\nTier Distribution:');
    result.summary.formatted.tierDistribution.forEach(({ tier, count, percentage, multiplier }) => {
      console.log(`  ${tier}: ${count} (${percentage}%), Multiplier: ${multiplier}`);
    });

    console.log('\nBurned Distribution:');
    result.summary.formatted.burnedDistribution.forEach(({ tier, count, burnedPercentage }) => {
      console.log(`  ${tier}: ${count} (${burnedPercentage}% of tier)`);
    });

    console.log('\nWallet Details:');
    for (const { address, totalLive, totalBurned, tiersLive, multiplierSum } of wallets) {
      const tiers = JSON.parse(tiersLive || '[0,0,0,0,0,0]');
      console.log(`\n  Wallet: ${address}`);
      console.log(`    Total Live NFTs: ${totalLive}`);
      console.log(`    Total Burned NFTs: ${totalBurned}`);
      console.log(`    Multiplier Sum: ${multiplierSum}`);
      console.log(`    Tier Distribution:`);
      let hasTiers = false;
      tiers.forEach((count, i) => {
        if (count > 0) {
          const tierName = contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`;
          console.log(`      ${tierName}: ${count}`);
          hasTiers = true;
        }
      });
      if (!hasTiers) console.log('      No live NFTs');

      const transfers = await db.all(
        `SELECT tokenId, eventType, tier, blockNumber, fromAddr, toAddr, transactionHash
         FROM element280_transfers WHERE fromAddr = ? OR toAddr = ? ORDER BY blockNumber ASC`,
        [address, address]
      );
      console.log(`    Transfers (${transfers.length}):`);
      if (transfers.length > 0) {
        transfers.forEach(({ tokenId, eventType, tier, blockNumber, fromAddr, toAddr, transactionHash }) => {
          const tierName = contractTiers.element280[tier]?.name || `Tier ${tier}`;
          console.log(
            `      Token ${tokenId} (${tierName}): ${eventType}, Block: ${blockNumber}, From: ${fromAddr}, To: ${toAddr}, Tx: ${transactionHash}`
          );
        });
      } else {
        console.log('      No transfers recorded');
      }
    }

    await db.close();
    process.exit(0);
  } catch (error) {
    logger.error(`Summary error: ${error.message}`);
    process.exit(1);
  }
}

if (SHOW_SUMMARY) {
  await displaySummary();
}

async function processWallet(owner, db, failedTokenIds, skippedTokenIds, skippedDetails) {
  if (owner.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return null;

  logger.info(`Processing wallet ${owner}`);
  if (['0x15702443110894b26911b913b17ea4931f803b02', '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda', '0x9d641961a31b3eed46e664fa631aad3021323862'].includes(owner.toLowerCase())) {
    logger.info(`Processing specified wallet ${owner}`);
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
  };

  const transfers = await db.all(
    `SELECT tokenId, transactionHash, blockNumber, eventType, tier, fromAddr, toAddr
     FROM element280_transfers WHERE fromAddr = ? OR toAddr = ? ORDER BY blockNumber ASC`,
    [owner, owner]
  );
  logger.info(`Fetched ${transfers.length} transfers for ${owner}`);

  for (const transfer of transfers) {
    if (transfer.tier < 1 || transfer.tier > 6) {
      skippedTokenIds.add(transfer.tokenId);
      skippedDetails.push({ tokenId: transfer.tokenId, reason: `Invalid tier ${transfer.tier}`, blockNumber: transfer.blockNumber, wallet: owner });
      logger.warn(`Skipped invalid tier ${transfer.tier} for token ${transfer.tokenId}, wallet=${owner}`);
      continue;
    }

    const nftData = {
      tokenId: transfer.tokenId,
      status: 'live',
      tier: transfer.tier,
      tierName: contractTiers.element280[transfer.tier]?.name || `Tier ${transfer.tier}`,
      transactionHash: transfer.transactionHash,
      blockNumber: transfer.blockNumber,
      lastEventType: transfer.eventType,
    };

    if (transfer.eventType === 'mint') {
      wallet.minted++;
      wallet.tiersMinted[transfer.tier - 1]++;
      if (transfer.toAddr.toLowerCase() === owner.toLowerCase()) {
        wallet.tiersLive[transfer.tier - 1]++;
        wallet.nfts.push(nftData);
      }
    } else if (transfer.eventType === 'burn') {
      wallet.totalBurned++;
      wallet.tiersBurned[transfer.tier - 1]++;
      wallet.tiersLive[transfer.tier - 1] = Math.max(0, wallet.tiersLive[transfer.tier - 1] - 1);
      wallet.nfts = wallet.nfts.filter(nft => nft.tokenId !== transfer.tokenId);
    } else if (transfer.eventType === 'transfer') {
      if (transfer.fromAddr.toLowerCase() === owner.toLowerCase()) {
        wallet.tiersTransferredOut[transfer.tier - 1]++;
        wallet.tiersLive[transfer.tier - 1] = Math.max(0, wallet.tiersLive[transfer.tier - 1] - 1);
        wallet.nfts = wallet.nfts.filter(nft => nft.tokenId !== transfer.tokenId);
        wallet.totalSold++;
      }
      if (transfer.toAddr.toLowerCase() === owner.toLowerCase()) {
        wallet.tiersTransferredIn[transfer.tier - 1]++;
        wallet.tiersLive[transfer.tier - 1]++;
        wallet.nfts.push(nftData);
        wallet.totalBought++;
      }
    }
  }

  // Always check current ownership for specified wallets
  logger.info(`Checking current NFT ownership for ${owner} via balanceOf`);
  let totalLive;
  try {
    totalLive = Number(
      await retry(() =>
        client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'balanceOf', args: [owner] })
      )
    ) || 0;
  } catch (error) {
    logger.error(`balanceOf failed for ${owner}: ${error.message}`);
    totalLive = 0;
  }
  logger.info(`balanceOf for ${owner}: ${totalLive}`);

  logger.info(`Fetching NFTs via Alchemy for ${owner}`);
  const nftsResponse = await retry(() =>
    alchemy.nft.getNftsForOwner(owner, { contractAddresses: [CONTRACT_ADDRESS] })
  ).catch(error => {
    logger.error(`Alchemy getNftsForOwner failed for ${owner}: ${error.message}`);
    return { ownedNfts: [] };
  });
  const nfts = [];
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

    const tier = Number(
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
      skippedTokenIds.add(tokenId);
      skippedDetails.push({ tokenId, reason: `Invalid tier ${tier}`, wallet: owner });
      logger.warn(`Invalid tier ${tier} for token ${tokenId}, wallet=${owner}`);
      continue;
    }

    nfts.push({
      tokenId,
      status: 'live',
      tier,
      tierName: contractTiers.element280[tier]?.name || `Tier ${tier}`,
      transactionHash: '',
      blockNumber: latestBlock,
      lastEventType: 'unknown',
    });
  }

  if (nfts.length > 0) {
    wallet.nfts = nfts;
    wallet.tiersLive = [0, 0, 0, 0, 0, 0];
    nfts.forEach(nft => {
      wallet.tiersLive[nft.tier - 1]++;
    });
    wallet.totalLive = nfts.length;
  } else {
    wallet.totalLive = totalLive;
  }

  wallet.tiersLive = wallet.tiersLive.map(count => Math.max(0, count));
  wallet.multiplierSum = wallet.nfts.reduce((sum, nft) => sum + (contractTiers.element280[nft.tier]?.multiplier || 0), 0);
  wallet.displayMultiplierSum = wallet.multiplierSum / 100;

  logger.info(`Wallet ${owner}: totalLive=${wallet.totalLive}, totalBurned=${wallet.totalBurned}, minted=${wallet.minted}, totalBought=${wallet.totalBought}, totalSold=${wallet.totalSold}, tiersLive=${JSON.stringify(wallet.tiersLive)}, nfts=${JSON.stringify(wallet.nfts)}`);
  return wallet;
}

async function fetchContractData() {
  const [totalSupply, totalBurned, tierCounts, multiplierPool] = await Promise.all([
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalSupply' })),
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalBurned' })),
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'getTotalNftsPerTiers' })),
    retry(() => client.readContract({ address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'multiplierPool' })),
  ]);
  return {
    totalLive: Number(totalSupply),
    totalBurned: Number(totalBurned),
    totalMinted: Number(totalSupply) + Number(totalBurned),
    tierDistribution: tierCounts.map(Number),
    multiplierPool: Number(multiplierPool),
  };
}

async function fetchEtherscanLogs(fromBlock, toBlock) {
  const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
  if (!ETHERSCAN_API_KEY) {
    logger.error('ETHERSCAN_API_KEY not defined');
    return [];
  }
  const url = `https://api.etherscan.io/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=${CONTRACT_ADDRESS}&topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef&apikey=${ETHERSCAN_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status !== '1') {
    logger.error(`Etherscan API error: ${data.message}`);
    return [];
  }
  return data.result.map(log => ({
    blockNumber: `0x${parseInt(log.blockNumber, 16).toString(16)}`,
    transactionHash: log.transactionHash,
    args: {
      from: `0x${log.topics[1].slice(26)}`,
      to: `0x${log.topics[2].slice(26)}`,
      tokenId: BigInt(parseInt(log.topics[3], 16)),
    },
  }));
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAlchemyLogs(fromBlock, toBlock) {
  const logs = await alchemy.core.getLogs({
    address: CONTRACT_ADDRESS,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    topics: [[TRANSFER_TOPIC]],
  });

  return logs.map(log => {
    const from = `0x${log.topics[1].slice(-40)}`.toLowerCase();
    const to = `0x${log.topics[2].slice(-40)}`.toLowerCase();
    const tokenId = BigInt(`0x${log.topics[3].slice(-64)}`).toString();
    const eventType = from === ZERO_ADDRESS ? 'mint' : to === ZERO_ADDRESS ? 'burn' : 'transfer';

    logger.debug(`Raw log: block=${log.blockNumber}, tx=${log.transactionHash}, from=${from}, to=${to}, tokenId=${tokenId}, eventType=${eventType}`);

    return {
      blockNumber: Number(log.blockNumber),
      transactionHash: log.transactionHash,
      args: { from, to, tokenId, eventType },
      eventType,
    };
  });
}

async function fetchAndStoreEvents(db, startBlock, endBlock, skippedTokenIds, skippedDetails) {
  logger.debug(`Starting fetchAndStoreEvents: startBlock=${startBlock}, endBlock=${endBlock}, CUSTOM_WALLETS=${JSON.stringify(CUSTOM_WALLETS)}`);

  const checkpoint = await loadCheckpoint();
  const effectiveStartBlock = FORCE_REFRESH ? DEPLOYMENT_BLOCK : Math.max(startBlock, checkpoint.lastBlock + 1);
  const latestBlock = await alchemy.core.getBlockNumber();
  const finalEndBlock = Math.min(endBlock, latestBlock);
  const blockRange = 2000;
  const ranges = [];
  for (let fromBlock = effectiveStartBlock; fromBlock <= finalEndBlock; fromBlock += blockRange) {
    ranges.push({ fromBlock, toBlock: Math.min(fromBlock + blockRange - 1, finalEndBlock) });
  }

  let burnedDistribution = [0, 0, 0, 0, 0, 0];
  const blockTimestamps = new Map();
  const customWalletTokens = new Set();
  let totalLogsProcessed = 0;

  for (const { fromBlock, toBlock } of ranges) {
    logger.info(`Processing blocks ${fromBlock}-${toBlock}`);
    let logs;
    for (let i = 0; i < 5; i++) {
      try {
        logs = await fetchAlchemyLogs(fromBlock, toBlock);
        break;
      } catch (error) {
        if (i === 4) {
          logger.error(`Failed to fetch logs for blocks ${fromBlock}-${toBlock}: ${error.message}`);
          skippedDetails.push({ blockRange: `${fromBlock}-${toBlock}`, reason: `Log fetch failed: ${error.message}` });
          logs = [];
          break;
        }
        logger.warn(`Retrying (${i + 1}/5) for blocks ${fromBlock}-${toBlock}: ${error.message}`);
        await delay(1000);
      }
    }
    logger.info(`Fetched ${logs.length} logs for blocks ${fromBlock}-${toBlock}`);
    totalLogsProcessed += logs.length;

    logs.forEach(log => {
      if (!log.args || !log.args.to || !log.args.from || !log.args.tokenId) {
        logger.warn(`Invalid log data: ${JSON.stringify(log)}`);
        return;
      }
      if (CUSTOM_WALLETS && CUSTOM_WALLETS.includes(log.args.to.toLowerCase()) && log.eventType === 'transfer') {
        customWalletTokens.add(log.args.tokenId);
        logger.debug(`Added token ${log.args.tokenId} to customWalletTokens for wallet ${log.args.to}`);
      }
    });

    logs.forEach(log => {
      const isCustomWallet = CUSTOM_WALLETS && (CUSTOM_WALLETS.includes(log.args.from.toLowerCase()) || CUSTOM_WALLETS.includes(log.args.to.toLowerCase()));
      const isSpecifiedWallet = ['0x15702443110894b26911b913b17ea4931f803b02', '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda', '0x9d641961a31b3eed46e664fa631aad3021323862'].includes(log.args.from.toLowerCase()) || ['0x15702443110894b26911b913b17ea4931f803b02', '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda', '0x9d641961a31b3eed46e664fa631aad3021323862'].includes(log.args.to.toLowerCase());
      const isRelevantBlock = [21033499, 21312344, 21312393, 22032493, 22032708, 21312538].includes(log.blockNumber);
      const isRelevantTx = log.transactionHash === '0xaad622cea7ee5da2721bd000c50b85f5004b252e4e42b938e1115ad3a7c9245c';
      const isCustomTokenMint = log.eventType === 'mint' && customWalletTokens.has(log.args.tokenId);
      if (log.eventType === 'burn' || isCustomWallet || isRelevantBlock || isRelevantTx || isCustomTokenMint || isSpecifiedWallet) {
        logger.info(`Event: token=${log.args.tokenId}, type=${log.eventType}, from=${log.args.from}, to=${log.args.to}, block=${log.blockNumber}, tx=${log.transactionHash}`);
      }
    });

    const contractState = await retry(() =>
      client.multicall({
        contracts: [
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'multiplierPool', blockNumber: BigInt(toBlock) },
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalSupply', blockNumber: BigInt(toBlock) },
          { address: CONTRACT_ADDRESS, abi: element280Abi, functionName: 'totalBurned', blockNumber: BigInt(toBlock) },
        ],
      }), 30, 20000
    ).catch(() => {
      logger.error(`Multicall failed for block ${toBlock}`);
      return [{ status: 'failure' }, { status: 'failure' }, { status: 'failure' }];
    });

    const uniqueBlocks = [...new Set(logs.map(log => Number(log.blockNumber)))];
    logger.debug(`Fetching timestamps for ${uniqueBlocks.length} unique blocks`);
    await Promise.all(
      uniqueBlocks.map(blockNumber =>
        retry(() => client.getBlock({ blockNumber: BigInt(blockNumber) }), 30, 20000)
          .then(block => blockTimestamps.set(blockNumber, Number(block.timestamp)))
          .catch(error => logger.error(`Failed to fetch block ${blockNumber}: ${error.message}`))
      )
    );

    const tierCalls = logs.map(log => ({
      address: CONTRACT_ADDRESS,
      abi: element280Abi,
      functionName: 'getNftTier',
      args: [log.args.tokenId],
      blockNumber: BigInt(log.blockNumber),
    }));

    const tierResults = tierCalls.length > 0 ? await batchMulticall(tierCalls) : [];
    logger.debug(`Fetched ${tierResults.length} tier results for ${logs.length} logs`);

    await executeDbTransaction(db, async () => {
      for (let i = 0; i < logs.length; i++) {
        const { from, to, tokenId, eventType } = logs[i].args;
        const tokenIdNum = tokenId?.toString();
        if (!tokenIdNum || isNaN(Number(tokenIdNum))) {
          skippedTokenIds.add(tokenIdNum);
          skippedDetails.push({ tokenId: tokenIdNum, reason: 'Invalid tokenId', blockNumber: Number(logs[i].blockNumber) });
          logger.warn(`Skipped invalid tokenId: ${tokenIdNum}, block=${logs[i].blockNumber}`);
          continue;
        }
        const blockNumber = Number(logs[i].blockNumber);
        const transactionHash = logs[i].transactionHash || '';
        const ownerAddr = eventType === 'burn' ? ZERO_ADDRESS : to;

        // Check for duplicate transfer
        const existingTransfer = await db.get(
          `SELECT * FROM element280_transfers WHERE tokenId = ? AND transactionHash = ? AND eventType = ?`,
          [tokenIdNum, transactionHash, eventType]
        );
        if (existingTransfer) {
          logger.debug(`Skipped duplicate ${eventType}: token=${tokenIdNum}, block=${blockNumber}, tx=${transactionHash}`);
          continue;
        }

        let tier = i < tierResults.length && tierResults[i]?.status === 'success' ? Number(tierResults[i].result) : null;
        if (!tier) {
          try {
            tier = Number(
              await retry(() =>
                client.readContract({
                  address: CONTRACT_ADDRESS,
                  abi: element280Abi,
                  functionName: 'getNftTier',
                  args: [BigInt(tokenIdNum)],
                  blockNumber: BigInt(blockNumber),
                }), 30, 20000
              )
            );
          } catch (error) {
            logger.error(`getNftTier failed for token ${tokenIdNum} at block ${blockNumber}: ${error.message}`);
            tier = 0;
          }
        }
        if (tier < 1 || tier > 6) {
          logger.warn(`Invalid tier ${tier} for token ${tokenIdNum}, block=${blockNumber}`);
          skippedTokenIds.add(tokenIdNum);
          skippedDetails.push({ tokenId: tokenIdNum, reason: `Invalid tier ${tier}`, blockNumber });
          continue;
        }

        if (eventType === 'burn' && tier >= 1 && tier <= 6) {
          burnedDistribution[tier - 1]++;
          logger.debug(`Incremented burnedDistribution for tier ${tier}: ${burnedDistribution}`);
        }

        try {
          const changes = await db.run(
            `INSERT OR IGNORE INTO element280_transfers (
              tokenId, fromAddr, toAddr, tier, blockNumber, transactionHash, blockTimestamp, eventType,
              multiplierPool, totalSupply, totalBurned, ownerAddr
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tokenIdNum,
              from,
              to,
              tier,
              blockNumber,
              transactionHash,
              blockTimestamps.get(blockNumber) || 0,
              eventType,
              contractState[0].status === 'success' ? Number(contractState[0].result) : 0,
              contractState[1].status === 'success' ? Number(contractState[1].result) : 0,
              contractState[2].status === 'success' ? Number(contractState[2].result) : 0,
              ownerAddr,
            ]
          );
          if (changes.changes > 0) {
            logger.info(`Inserted ${eventType}: token=${tokenIdNum}, from=${from}, to=${to}, block=${blockNumber}, tx=${transactionHash}`);
          } else {
            logger.debug(`Skipped duplicate ${eventType}: token=${tokenIdNum}, block=${blockNumber}, tx=${transactionHash}`);
          }
        } catch (error) {
          logger.error(`Database insert failed for token ${tokenIdNum}: ${error.message}`);
          skippedDetails.push({ tokenId: tokenIdNum, reason: `DB insert failed: ${error.message}`, blockNumber });
        }
      }
    });

    await db.run('UPDATE element280_summary SET burnedDistribution = ? WHERE id = 1', JSON.stringify(burnedDistribution));
    await saveCheckpoint(toBlock);
    logger.debug(`Saved checkpoint for block ${toBlock}`);
    await delay(200);
  }

  const targetWallets = CUSTOM_WALLETS.length > 0 ? CUSTOM_WALLETS : ['0x15702443110894b26911b913b17ea4931f803b02', '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda', '0x9d641961a31b3eed46e664fa631aad3021323862'];
  const walletTransfers = targetWallets.length > 0 ? await db.all(
    `SELECT * FROM element280_transfers WHERE fromAddr IN (${targetWallets.map(() => '?').join(',')}) OR toAddr IN (${targetWallets.map(() => '?').join(',')})`,
    [...targetWallets, ...targetWallets]
  ) : await db.all('SELECT * FROM element280_transfers WHERE eventType IN ("mint", "burn")');
  logger.info(`Total transfers for wallets ${targetWallets.join(', ') || 'mint/burn only'}: ${walletTransfers.length}`);
  const mintTransfers = walletTransfers.filter(t => t.eventType === 'mint');
  logger.info(`Total mints for wallets: ${mintTransfers.length}`);
  mintTransfers.forEach(t => {
    logger.info(`Mint: token=${t.tokenId}, to=${t.toAddr}, block=${t.blockNumber}, tx=${t.transactionHash}`);
  });
  const burnTransfers = walletTransfers.filter(t => t.eventType === 'burn');
  logger.info(`Total burns for wallets: ${burnTransfers.length}`);
  burnTransfers.forEach(t => {
    logger.info(`Burn: token=${t.tokenId}, from=${t.fromAddr}, block=${t.blockNumber}, tx=${t.transactionHash}`);
  });

  logger.info(`Completed fetchAndStoreEvents: processed ${totalLogsProcessed} logs from blocks ${effectiveStartBlock}-${finalEndBlock}`);
  return burnedDistribution;
}

async function calculateSummaryStats(db) {
  const transfers = await db.all('SELECT eventType, tokenId, toAddr FROM element280_transfers');
  const totalMinted = transfers.filter(t => t.eventType === 'mint').length;
  const totalBurned = transfers.filter(t => t.eventType === 'burn').length;
  const liveTokens = new Set();
  transfers.forEach(t => {
    if (t.eventType === 'mint' || t.eventType === 'transfer') {
      liveTokens.add(t.tokenId);
    }
    if (t.eventType === 'burn') {
      liveTokens.delete(t.tokenId);
    }
  });
  const totalLive = liveTokens.size;

  return { totalMinted, totalBurned, totalLive };
}

async function trackElement280NFTs() {
  logger.info(`Tracking NFTs for ${CONTRACT_ADDRESS} in ${FULL_MODE ? 'FULL' : 'CUSTOM'} mode, CUSTOM_WALLETS=${JSON.stringify(CUSTOM_WALLETS)}`);
  const startTime = Date.now();
  if (FORCE_REFRESH) {
    await clearDatabase();
    await Promise.all([
      fs.unlink(CHECKPOINT_FILE).catch(() => {}),
      fs.unlink(FAILED_TOKENS_FILE).catch(() => {}),
      fs.unlink(SKIPPED_TOKENS_FILE).catch(() => {}),
      fs.unlink(SKIPPED_TOKENS_DETAILED_FILE).catch(() => {}),
    ]);
  }

  const db = await initDb();
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
    await executeDbTransaction(db, () =>
      db.run(
        `INSERT OR REPLACE INTO element280_summary (
          id, totalMinted, totalBurned, totalLive, totalWallets, tierDistribution, burnedDistribution, multiplierPool, lastBlock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          1,
          result.summary.totalMinted,
          result.summary.totalBurned,
          result.summary.totalLive,
          0,
          JSON.stringify(result.summary.tierDistribution),
          JSON.stringify(result.summary.burnedDistribution),
          result.summary.multiplierPool,
          0,
        ]
      )
    );

    const endBlock = Number(await client.getBlockNumber());
    result.summary.burnedDistribution = await fetchAndStoreEvents(db, DEPLOYMENT_BLOCK, endBlock, skippedTokenIds, skippedDetails);
    await db.run('UPDATE element280_summary SET lastBlock = ? WHERE id = 1', endBlock);

    const wallets = new Map();
    if (CUSTOM_WALLETS.length > 0) {
      logger.info(`Processing wallets: ${CUSTOM_WALLETS.join(', ')}`);
      CUSTOM_WALLETS.forEach(addr =>
        wallets.set(addr, {
          wallet: addr,
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
        })
      );
    } else {
      logger.info('Processing all wallets');
      const logs = await db.all('SELECT fromAddr, toAddr FROM element280_transfers');
      for (const { fromAddr: from, toAddr: to } of logs) {
        if (from.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && !wallets.has(from)) {
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
          });
        }
        if (to.toLowerCase() !== ZERO_ADDRESS.toLowerCase() && !wallets.has(to)) {
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
          });
        }
      }
      logger.info(`Collected ${wallets.size} unique wallets: ${[...wallets.keys()].join(', ')}`);
    }

    const walletLimit = pLimit(MAX_CONCURRENT_WALLETS);
    const walletResults = [];
    let walletCount = 0;
    await executeDbTransaction(db, async () => {
      for (const walletAddr of wallets.keys()) {
        logger.debug(`Processing wallet ${walletAddr}`);
        const wallet = await walletLimit(() => processWallet(walletAddr, db, failedTokenIds, skippedTokenIds, skippedDetails));
        if (wallet) {
          walletResults.push(wallet);
          await db.run(
            `INSERT OR REPLACE INTO element280_wallets (
              address, totalLive, totalBurned, totalBought, totalSold, minted, tiersLive, tiersBurned,
              tiersMinted, tiersTransferredIn, tiersTransferredOut, nfts, multiplierSum, displayMultiplierSum
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              wallet.wallet,
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
            ]
          );
          walletCount++;
          logger.info(`Processed ${walletCount}/${wallets.size} wallets: ${walletAddr}`);
        } else {
          logger.warn(`No wallet data returned for ${walletAddr}`);
        }
      }
    });

    walletResults.forEach(wallet => {
      if (wallet) wallets.set(wallet.wallet, wallet);
    });

    await saveFailedTokens(failedTokenIds);
    await saveSkippedTokens(skippedTokenIds, skippedDetails);

    const logs = await db.all('SELECT * FROM element280_transfers ORDER BY blockNumber ASC');
    for (const { tokenId: tokenIdNum, tier, eventType, transactionHash, blockNumber, blockTimestamp, ownerAddr, fromAddr: from } of logs) {
      if (eventType === 'burn' && tier >= 1 && tier <= 6) {
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

    await db.run('UPDATE element280_summary SET totalWallets = ?, burnedDistribution = ? WHERE id = 1', [
      result.summary.totalWallets,
      JSON.stringify(result.summary.burnedDistribution),
    ]);

    // Calculate summary stats before finalizing
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
      tierDistribution: result.summary.tierDistribution.map((count, i) => ({
        tier: contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`,
        count,
        percentage: result.summary.totalLive > 0 ? ((count / result.summary.totalLive) * 100).toFixed(2) : '0.00',
        multiplier: contractTiers.element280[i + 1]?.multiplier || 0,
      })),
      burnedDistribution: result.summary.burnedDistribution.map((count, i) => ({
        tier: contractTiers.element280[i + 1]?.name || `Tier ${i + 1}`,
        count,
        burnedPercentage:
          count + result.summary.tierDistribution[i] > 0
            ? ((count / (count + result.summary.tierDistribution[i])) * 100).toFixed(2)
            : '0.00',
      })),
    };

    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(result, (key, value) => (typeof value === 'bigint' ? value.toString() : value)));

    const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`
=== Element280 NFT Summary ===
Wallets: ${walletCount}
Total Minted: ${totalMinted}
Total Live: ${totalLive}
Total Burned: ${totalBurned}
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