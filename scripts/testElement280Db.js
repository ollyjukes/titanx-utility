// scripts/testElement280Db.js
import { Alchemy, Network } from 'alchemy-sdk';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import path from 'path';
import pino from 'pino';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// Logger setup
const logger = pino({ level: process.env.LOG_LEVEL || 'error' }); // Default to errors only

const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const CONTRACT_ADDRESS = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
const WALLETS = [
  '0x15702443110894B26911B913b17ea4931F803B02',
  '0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA',
  '0x9D641961a31B3eED46e664fA631aAD3021323862',
];
const DB_PATH = './public/data/element280.db';
const JSON_PATH = './public/data/element280_nft_status.json';
const TIER_MAPPING = {
  1: 'Common',
  2: 'CommonAmped',
  3: 'Rare',
  4: 'RareAmped',
  5: 'Legendary',
 6: 'LegendaryAmped',
};
const EXPECTED_NFTS = {
  '0x15702443110894B26911B913b17ea4931F803B02': {
    count: 29,
    breakdown: { CommonAmped: 17, RareAmped: 6, Legendary: 1, LegendaryAmped: 5 },
    rewards: 1301036482 / 1e18,
  },
  '0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA': { count: 0, rewards: 0 },
  '0x9D641961a31B3eED46e664fA631aAD3021323862': { count: 0, rewards: 0 },
};
const EXPECTED_TRANSFERS_0x9D6 = [
  { blockNumber: 21312344, eventType: 'transfer', toAddr: '0x9D641961a31B3eED46e664fA631aAD3021323862' },
  { blockNumber: 22032493, eventType: 'transfer', toAddr: '0x9D641961a31B3eED46e664fA631aAD3021323862' },
  { blockNumber: 21312393, eventType: 'transfer', fromAddr: '0x9D641961a31B3eED46e664fA631aAD3021323862', toAddr: ['0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA', '0x15702443110894B26911B913b17ea4931F803B02'] },
  { blockNumber: 22032708, eventType: 'transfer', fromAddr: '0x9D641961a31B3eED46e664fA631aAD3021323862', toAddr: ['0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA', '0x15702443110894B26911B913b17ea4931F803B02'] },
];

const alchemy = new Alchemy({
  apiKey: ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

async function testElement280Db() {
  if (!ALCHEMY_API_KEY) {
    throw new Error('NEXT_PUBLIC_ALCHEMY_API_KEY is not set in .env.local');
  }

  let db;
  const summary = {
    schema: { valid: false, missingTables: [] },
    wallets: {},
    transfers: {},
    jsonConsistency: { valid: false, mismatches: 0 },
    onChain: {},
  };

  try {
    // Open database
    db = await open({ filename: DB_PATH, driver: sqlite3.Database });

    // Test 1: Inspect Database Schema
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table';");
    const requiredTables = ['element280_summary', 'element280_transfers', 'element280_wallets'];
    summary.schema.valid = requiredTables.every(t => tables.some(tbl => tbl.name === t));
    summary.schema.missingTables = requiredTables.filter(t => !tables.some(tbl => tbl.name === t));
    if (!summary.schema.valid) {
      logger.error('Missing required tables: %s', summary.schema.missingTables.join(', '));
    }

    // Test 2: Verify NFTs and Rewards for Wallets
    for (const wallet of WALLETS) {
      summary.wallets[wallet] = { nftsValid: false, rewardsValid: false, tiersValid: true };
      const walletData = await db.get(
        'SELECT totalLive, tiersLive, nfts, claimableRewards FROM element280_wallets WHERE address = ?',
        wallet
      );
      let nfts = [];
      let summaryTiers = {};
      let rewards = 0;

      if (walletData) {
        try {
          const tiersArray = JSON.parse(walletData.tiersLive || '[]');
          summaryTiers = tiersArray.reduce((acc, count, index) => {
            if (count > 0 && TIER_MAPPING[index + 1]) {
              acc[TIER_MAPPING[index + 1]] = count;
            }
            return acc;
          }, {});
          nfts = JSON.parse(walletData.nfts || '[]').filter(nft => nft.status === 'live');
          rewards = walletData.claimableRewards || 0;
        } catch (error) {
          logger.error('Failed to parse tiersLive or nfts for %s: %s', wallet, error.message);
        }
      }

      const expected = EXPECTED_NFTS[wallet];
      summary.wallets[wallet].nftsValid = (walletData ? walletData.totalLive : 0) === expected.count &&
        nfts.length === expected.count &&
        (expected.count === 0 || Object.entries(expected.breakdown || {}).every(([key, count]) => summaryTiers[key] === count));
      summary.wallets[wallet].rewardsValid = expected.rewards === 0 ? rewards === 0 : Math.abs(rewards - expected.rewards) < 0.01;
      if (wallet === '0x15702443110894B26911B913b17ea4931F803B02') {
        const tierMismatch = Object.entries(expected.breakdown || {}).filter(([key, count]) => summaryTiers[key] !== count);
        summary.wallets[wallet].tiersValid = tierMismatch.length === 0;
        if (!summary.wallets[wallet].tiersValid) {
          logger.error('Tier mismatch for %s: %j', wallet, tierMismatch);
        }
      }
    }

    // Test 3: Check Redeemed NFT and Transfer History
    for (const wallet of WALLETS) {
      summary.transfers[wallet] = { activeNftsValid: true, specificTxsValid: true };
      const transfers = await db.all(
        'SELECT tokenId, eventType, ownerAddr, blockNumber, fromAddr, toAddr, transactionHash FROM element280_transfers WHERE ownerAddr = ? OR fromAddr = ? OR toAddr = ?',
        wallet,
        wallet,
        wallet
      );
      const activeNfts = transfers.filter(t => t.ownerAddr?.toLowerCase() === wallet.toLowerCase() && t.eventType !== 'burn');

      if (wallet === '0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA') {
        const redeemed = transfers.find(t => t.eventType === 'burn' && t.blockNumber === 21033499);
        summary.transfers[wallet].redeemedValid = !!redeemed;
        summary.transfers[wallet].activeNftsValid = activeNfts.length === 0;
        if (!summary.transfers[wallet].activeNftsValid) {
          logger.error('Found %d active NFTs for %s, expected 0', activeNfts.length, wallet);
        }
      } else if (wallet === '0x9D641961a31B3eED46e664fA631aAD3021323862') {
        const sentTransfers = transfers.filter(t => t.fromAddr?.toLowerCase() === wallet.toLowerCase() && t.eventType === 'transfer' && ['0x15702443110894B26911B913b17ea4931F803B02', '0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA'].includes(t.toAddr?.toLowerCase()));
        summary.transfers[wallet].activeNftsValid = activeNfts.length === 0;
        summary.transfers[wallet].sentTransfersCount = sentTransfers.length;

        const txMatches = EXPECTED_TRANSFERS_0x9D6.every(expectedTx => {
          return transfers.some(t => t.blockNumber === expectedTx.blockNumber && t.eventType === expectedTx.eventType &&
            (expectedTx.fromAddr ? t.fromAddr?.toLowerCase() === expectedTx.fromAddr.toLowerCase() : true) &&
            (expectedTx.toAddr ? (Array.isArray(expectedTx.toAddr) ? expectedTx.toAddr.map(a => a.toLowerCase()).includes(t.toAddr?.toLowerCase()) : t.toAddr?.toLowerCase() === expectedTx.toAddr.toLowerCase()) : true)
          );
        });
        summary.transfers[wallet].specificTxsValid = txMatches;
        if (!txMatches) {
          logger.error('Missing expected transfers for %s at blocks %j', wallet, EXPECTED_TRANSFERS_0x9D6.map(t => t.blockNumber));
        }
      } else {
        summary.transfers[wallet].activeNftsValid = activeNfts.length === EXPECTED_NFTS[wallet].count;
      }
    }

    // Test 4: Cross-Check with element280_nft_status.json
    let jsonData = { wallets: [] };
    try {
      jsonData = JSON.parse(await fs.readFile(JSON_PATH, 'utf-8'));
    } catch (error) {
      logger.error('Failed to read or parse JSON: %s', error.message);
      summary.jsonConsistency.valid = false;
      return;
    }
    const dbNfts = await db.all(
      'SELECT tokenId, ownerAddr AS owner, tier, eventType FROM element280_transfers WHERE eventType != ? AND ownerAddr != ?',
      'burn',
      '0x0000000000000000000000000000000000000000'
    );
    const jsonNfts = jsonData.wallets.flatMap(w => {
      try {
        if (!w.address) return [];
        const nfts = JSON.parse(w.nfts || '[]').filter(nft => nft.status === 'live');
        return nfts.map(nft => ({ ...nft, owner: w.address }));
      } catch (error) {
        logger.error('Failed to parse nfts for wallet %s: %s', w.address || 'undefined', error.message);
        return [];
      }
    });
    summary.jsonConsistency.mismatches = dbNfts.filter(dbNft => {
      const jsonNft = jsonNfts.find(jn => jn.tokenId === dbNft.tokenId);
      return !jsonNft || jsonNft.owner?.toLowerCase() !== dbNft.owner?.toLowerCase() || jsonNft.tier !== dbNft.tier;
    }).length;
    summary.jsonConsistency.valid = summary.jsonConsistency.mismatches === 0 && jsonData.wallets.length > 0;

    // Test 5: Verify On-Chain State with Alchemy
    for (const wallet of WALLETS) {
      summary.onChain[wallet] = { consistent: false };
      try {
        const response = await alchemy.nft.getNftsForOwner(wallet, { contractAddresses: [CONTRACT_ADDRESS] });
        const onChainTokenIds = response.ownedNfts.map(nft => nft.tokenId);
        const dbTokenIds = (await db.all(
          'SELECT tokenId FROM element280_transfers WHERE ownerAddr = ? AND eventType != ?',
          wallet,
          'burn'
        )).map(t => t.tokenId);
        summary.onChain[wallet].consistent = onChainTokenIds.length === dbTokenIds.length &&
          onChainTokenIds.every(id => dbTokenIds.includes(id));
        if (!summary.onChain[wallet].consistent) {
          logger.error('On-chain vs DB mismatch for %s: onChain=%d, DB=%d', wallet, onChainTokenIds.length, dbTokenIds.length);
        }
      } catch (error) {
        logger.error('On-chain check failed for %s: %s', wallet, error.message);
      }
    }

    // Output summary
    console.log(JSON.stringify(summary, null, 2));

  } catch (error) {
    logger.error('Test failed: %s', error.message);
  } finally {
    if (db) await db.close();
  }
}

testElement280Db().catch(error => logger.error('Test failed: %s', error.message));