// scripts/testElement280Wallets.js

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import pino from 'pino';
import { contractTiers } from '../app/nft-contracts.js';

// Logger setup
const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
});

// Database path
const DB_FILE = path.join(process.cwd(), 'public', 'data', 'element280.db');

// Wallets to test
const WALLETS = [
  '0x15702443110894B26911B913b17ea4931F803B02',
  '0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA',
  '0x9D641961a31B3eED46e664fA631aAD3021323862',
];

// Expected outputs for validation
const EXPECTED_OUTPUTS = {
  '0x15702443110894b26911b913b17ea4931f803b02': {
    totalLive: 29,
    tiersLive: [0, 17, 0, 6, 1, 5],
    minted: 2,
    tiersMinted: [0, 0, 0, 0, 0, 2],
    totalBought: 28,
    totalSold: 1,
    totalBurned: 0,
  },
  '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda': {
    totalLive: 0,
    tiersLive: [0, 0, 0, 0, 0, 0],
    minted: 22,
    tiersMinted: [0, 17, 0, 3, 0, 2],
    totalBought: 6,
    totalSold: 27,
    totalBurned: 1,
  },
  '0x9d641961a31b3eed46e664fa631aad3021323862': {
    totalLive: 0,
    tiersLive: [0, 0, 0, 0, 0, 0],
    minted: 0,
    tiersMinted: [0, 0, 0, 0, 0, 0],
    totalBought: 2,
    totalSold: 2,
    totalBurned: 0,
  },
};

// Tier names for formatting
const TIER_NAMES = {
  1: contractTiers.element280[1]?.name || 'Tier 1',
  2: contractTiers.element280[2]?.name || 'Amp Common',
  3: contractTiers.element280[3]?.name || 'Tier 3',
  4: contractTiers.element280[4]?.name || 'Rare Amped',
  5: contractTiers.element280[5]?.name || 'Legendary',
  6: contractTiers.element280[6]?.name || 'Amped Legendary',
};

// Function to format tiers for output
function formatTiers(tiers) {
  const tierCounts = tiers
    .map((count, i) => ({ count, name: TIER_NAMES[i + 1] }))
    .filter(t => t.count > 0)
    .map(t => `${t.count} ${t.name.toLowerCase()}`);
  return tierCounts.length > 0 ? tierCounts.join(', ') : 'none';
}

// Main test function
async function testWallets() {
  let db;
  try {
    // Open database
    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database,
    });
    logger.info(`Connected to database: ${DB_FILE}`);

    // Count total transfers and unique wallets with live NFTs
    const totalTransfers = await db.get(`SELECT COUNT(*) AS count FROM element280_transfers`);
    logger.info(`Total transfers in element280_transfers: ${totalTransfers.count}`);
    const uniqueWalletsWithNfts = await db.get(`
      SELECT COUNT(DISTINCT toAddr) AS count
      FROM element280_transfers
      WHERE eventType = 'mint' OR (eventType = 'transfer' AND toAddr != ?)
      EXCEPT
      SELECT DISTINCT fromAddr
      FROM element280_transfers
      WHERE eventType = 'burn' OR (eventType = 'transfer' AND fromAddr != ?)
    `, ['0x0000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000']);
    logger.info(`Unique wallets with live NFTs: ${uniqueWalletsWithNfts.count}`);

    // Test each wallet
    for (const wallet of WALLETS) {
      const walletLower = wallet.toLowerCase();
      logger.info(`\nTesting wallet: ${wallet}`);

      // Fetch wallet data
      const walletData = await db.get(
        `SELECT address, totalLive, totalBurned, minted, totalBought, totalSold,
                tiersLive, tiersMinted, tiersTransferredIn, tiersTransferredOut
         FROM element280_wallets
         WHERE lower(address) = ?`,
        [walletLower]
      );

      if (!walletData) {
        logger.error(`No data found for wallet ${wallet}`);
        const transferCheck = await db.get(
          `SELECT COUNT(*) AS count
           FROM element280_transfers
           WHERE lower(fromAddr) = ? OR lower(toAddr) = ?`,
          [walletLower, walletLower]
        );
        logger.info(`Transfers found for ${wallet}: ${transferCheck.count}`);
        continue;
      }

      // Parse JSON fields
      const tiersLive = JSON.parse(walletData.tiersLive || '[0,0,0,0,0,0]');
      const tiersMinted = JSON.parse(walletData.tiersMinted || '[0,0,0,0,0,0]');

      // Format output
      let output = `Element 280, live nfts count ${walletData.totalLive}`;
      if (walletData.totalLive > 0) {
        output += `, ${formatTiers(tiersLive)}`;
      }
      output += `\nMinted ${walletData.minted}`;
      output += `\nTiers minted ${JSON.stringify(tiersMinted)}`;
      output += `\nTransferred in ${walletData.totalBought}`;
      output += `\nTransferred out ${walletData.totalSold}`;
      output += `\nBurned ${walletData.totalBurned}`;

      console.log(`wallet: ${wallet}`);
      console.log(output);
      console.log('');

      // Validate against expected output
      const expected = EXPECTED_OUTPUTS[walletLower];
      if (!expected) {
        logger.warn(`No expected output defined for ${wallet}`);
        continue;
      }

      const discrepancies = [];
      if (walletData.totalLive !== expected.totalLive) {
        discrepancies.push(`totalLive: got ${walletData.totalLive}, expected ${expected.totalLive}`);
      }
      if (walletData.minted !== expected.minted) {
        discrepancies.push(`minted: got ${walletData.minted}, expected ${expected.minted}`);
      }
      if (walletData.totalBought !== expected.totalBought) {
        discrepancies.push(`totalBought: got ${walletData.totalBought}, expected ${expected.totalBought}`);
      }
      if (walletData.totalSold !== expected.totalSold) {
        discrepancies.push(`totalSold: got ${walletData.totalSold}, expected ${expected.totalSold}`);
      }
      if (walletData.totalBurned !== expected.totalBurned) {
        discrepancies.push(`totalBurned: got ${walletData.totalBurned}, expected ${expected.totalBurned}`);
      }
      if (JSON.stringify(tiersLive) !== JSON.stringify(expected.tiersLive)) {
        discrepancies.push(`tiersLive: got ${JSON.stringify(tiersLive)}, expected ${JSON.stringify(expected.tiersLive)}`);
      }
      if (JSON.stringify(tiersMinted) !== JSON.stringify(expected.tiersMinted)) {
        discrepancies.push(`tiersMinted: got ${JSON.stringify(tiersMinted)}, expected ${JSON.stringify(expected.tiersMinted)}`);
      }

      if (discrepancies.length > 0) {
        logger.warn(`Discrepancies for ${wallet}:\n  ${discrepancies.join('\n  ')}`);
      } else {
        logger.info(`Wallet ${wallet} matches expected output`);
      }

      // Debug: Fetch transfer events
      try {
        const transfers = await db.all(
          `SELECT tokenId, eventType, tier, fromAddr, toAddr, blockNumber, transactionHash
           FROM element280_transfers
           WHERE lower(fromAddr) = ? OR lower(toAddr) = ?
           ORDER BY blockNumber ASC`,
          [walletLower, walletLower]
        );
        logger.info(`Found ${transfers.length} transfers for ${wallet}`);
        if (transfers.length > 0) {
          logger.debug(`Transfers for ${wallet}:\n${JSON.stringify(transfers, null, 2)}`);
          const mintedTokens = transfers
            .filter(t => t.eventType === 'mint' && t.toAddr.toLowerCase() === walletLower)
            .map(t => t.tokenId);
          const transferIn = transfers
            .filter(t => t.eventType === 'transfer' && t.toAddr.toLowerCase() === walletLower)
            .map(t => t.tokenId);
          const transferOut = transfers
            .filter(t => t.eventType === 'transfer' && t.fromAddr.toLowerCase() === walletLower)
            .map(t => t.tokenId);
          logger.info(`Minted token IDs: ${mintedTokens.join(', ') || 'none'}`);
          logger.info(`Transferred in token IDs: ${transferIn.join(', ') || 'none'}`);
          logger.info(`Transferred out token IDs: ${transferOut.join(', ') || 'none'}`);
        }

        const multiEventTx = transfers.filter(t => t.transactionHash === '0xc078b6ff30bb5e2b0dc06742494d6a28f944513ae3583c639928e8ce95c78dc7');
        if (multiEventTx.length > 0) {
          logger.info(`Multi-event transaction 0xc078b6ff... events for ${wallet}:\n${JSON.stringify(multiEventTx, null, 2)}`);
        }
      } catch (error) {
        logger.error(`Failed to fetch transfers for ${wallet}: ${error.message}`);
      }
    }

    // Summarize summary stats
    try {
      const summary = await db.get(
        `SELECT totalMinted, totalBurned, totalLive, totalWallets
         FROM element280_summary
         WHERE id = 1`
      );
      if (summary) {
        logger.info(`\nDatabase Summary Stats:`);
        logger.info(`Total Minted: ${summary.totalMinted}`);
        logger.info(`Total Live: ${summary.totalLive}`);
        logger.info(`Total Burned: ${summary.totalBurned}`);
        logger.info(`Total Wallets: ${summary.totalWallets}`);
      } else {
        logger.warn(`No summary stats found in element280_summary`);
      }
    } catch (error) {
      logger.error(`Failed to fetch summary stats: ${error.message}`);
    }

    // Check 0xc078b6ff... transaction
    try {
      const multiEventTx = await db.all(
        `SELECT tokenId, eventType, tier, fromAddr, toAddr, blockNumber, transactionHash
         FROM element280_transfers
         WHERE transactionHash = '0xc078b6ff30bb5e2b0dc06742494d6a28f944513ae3583c639928e8ce95c78dc7'
         ORDER BY tokenId`
      );
      if (multiEventTx.length > 0) {
        logger.info(`Multi-event transaction 0xc078b6ff... events:\n${JSON.stringify(multiEventTx, null, 2)}`);
      } else {
        logger.warn(`No events found for transaction 0xc078b6ff...`);
      }
    } catch (error) {
      logger.error(`Failed to fetch 0xc078b6ff... events: ${error.message}`);
    }

  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (db) await db.close();
    logger.info('Database connection closed');
  }
}

testWallets().catch(error => {
  logger.error('Test script failed:', error);
  process.exit(1);
});