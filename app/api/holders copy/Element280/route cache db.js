import { NextResponse } from 'next/server';
import { alchemy, client, CACHE_TTL, batchMulticall } from '@/app/api/utils';
import { contractAddresses, contractTiers, vaultAddresses, element280MainAbi, element280VaultAbi } from '@/app/nft-contracts';
import pLimit from 'p-limit';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { LRUCache } from 'lru-cache';

// SQLite database setup
let db;
let dbInitialized = false;
async function initDb() {
  if (dbInitialized) return db;
  try {
    db = await open({
      filename: './element280.db',
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      busyTimeout: 10000,
    });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS holders (
        wallet TEXT PRIMARY KEY,
        total INTEGER,
        totalLive INTEGER,
        multiplierSum INTEGER,
        displayMultiplierSum REAL,
        tiers TEXT,
        tokenIds TEXT,
        claimableRewards REAL,
        percentage REAL,
        rank INTEGER
      );
      CREATE TABLE IF NOT EXISTS tokens (
        tokenId TEXT PRIMARY KEY,
        owner TEXT,
        tier INTEGER,
        reward REAL,
        lastUpdated INTEGER
      );
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tokens_owner ON tokens(owner);
      CREATE INDEX IF NOT EXISTS idx_tokens_lastUpdated ON tokens(lastUpdated);
    `);
    dbInitialized = true;
    log('[element280] SQLite database initialized');
  } catch (error) {
    log(`[element280] error: SQLite initialization failed: ${error.message}, stack: ${error.stack}`);
    throw error;
  }
  return db;
}

// In-memory cache
const cache = new LRUCache({ max: 1000, ttl: CACHE_TTL });
const tokenCache = new LRUCache({ max: 10000, ttl: 24 * 60 * 60 * 1000 });
let isCachePopulating = false;
let progressState = { step: 'idle', processedNfts: 0, totalNfts: 0, totalWallets: 0 };
const MAX_INITIAL_SUPPLY = 16883;
const FALLBACK_TOTAL_SUPPLY = 8137; // Current, may decrease
const FALLBACK_TOTAL_BURNED = 8746; // Current, may increase
const FALLBACK_EXPECTED_HOLDERS = 921; // Current, may change
const BURN_ADDRESS = '0x0000000000000000000000000000000000000000';

// Logging configuration
const logLevel = 'ERROR'; // Set to 'DEBUG' for verbose, 'ERROR' for minimal
function log(message) {
  if (logLevel === 'ERROR' && !message.toLowerCase().includes('error') && !message.includes('failed') && !message.includes('completed') && !message.includes('initialized')) {
    return;
  }
  console.log(`[${new Date().toISOString()}] [element280] ${message}`);
}

// Export cache state for /progress route
export function getCacheState() {
  return {
    isPopulating: isCachePopulating,
    totalWallets: progressState.totalWallets,
    totalOwners: tokenCache.size,
    step: progressState.step,
    processedNfts: progressState.processedNfts,
    totalNfts: progressState.totalNfts,
    progressPercentage: progressState.totalNfts > 0 ? Math.round((progressState.processedNfts / progressState.totalNfts) * 100) : 0,
  };
}

// Serialize BigInt
function serializeBigInt(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  ));
}

// Retry utility
async function retry(fn, attempts = 5, delay = (retryCount, error) => 
  error?.details?.code === 429 ? 6000 * 2 ** retryCount : 2000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts - 1) {
        log(`[element280] error: Retry failed: ${error.message}, code: ${error?.details?.code || 'unknown'}`);
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay(i, error)));
    }
  }
}

// Fetch total supply
async function getTotalSupply(contractAddress, db) {
  const cacheKey = `totalSupply:${contractAddress}`;
  try {
    const cached = await db.get('SELECT value FROM metadata WHERE key = ?', cacheKey);
    if (cached) return parseInt(cached.value);

    const result = await retry(() => client.multicall({
      contracts: [{ address: contractAddress, abi: element280MainAbi, functionName: 'totalSupply' }],
    }));
    const totalSupply = Number(result[0].result);
    if (isNaN(totalSupply) || totalSupply < 0 || totalSupply > MAX_INITIAL_SUPPLY) {
      log(`[element280] error: Invalid totalSupply=${totalSupply}, using fallback=${FALLBACK_TOTAL_SUPPLY}`);
      await db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', cacheKey, FALLBACK_TOTAL_SUPPLY);
      return FALLBACK_TOTAL_SUPPLY;
    }
    await db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', cacheKey, totalSupply);
    return totalSupply;
  } catch (error) {
    log(`[element280] error: getTotalSupply failed: ${error.message}`);
    return FALLBACK_TOTAL_SUPPLY;
  }
}

// Fetch NFT ownership
async function fetchAllNftOwnership(contractAddress, db, timings) {
  const start = Date.now();
  const ownershipByToken = new Map();
  const ownershipByWallet = new Map();

  try {
    const cachedTokens = await db.all('SELECT tokenId, owner FROM tokens WHERE lastUpdated > ?', 
      Date.now() - 7 * 24 * 60 * 60 * 1000);
    if (cachedTokens.length >= FALLBACK_TOTAL_SUPPLY) {
      cachedTokens.forEach(({ tokenId, owner }) => {
        if (owner !== BURN_ADDRESS) {
          ownershipByToken.set(tokenId, owner);
          const walletTokens = ownershipByWallet.get(owner) || [];
          walletTokens.push(tokenId);
          ownershipByWallet.set(owner, walletTokens);
        }
      });
      timings.tokenIdFetch = 0;
      return { ownershipByToken, ownershipByWallet, invalidTokens: MAX_INITIAL_SUPPLY - ownershipByToken.size };
    }

    const response = await retry(() => 
      alchemy.nft.getOwnersForContract(contractAddress, { withTokenBalances: true })
    );
    let invalidTokens = 0;
    response.owners.forEach(owner => {
      const ownerAddress = owner.ownerAddress.toLowerCase();
      if (ownerAddress === BURN_ADDRESS) {
        invalidTokens += owner.tokenBalances.length;
        return;
      }
      owner.tokenBalances.forEach(token => {
        const tokenId = token.tokenId;
        ownershipByToken.set(tokenId, ownerAddress);
        const walletTokens = ownershipByWallet.get(ownerAddress) || [];
        walletTokens.push(tokenId);
        ownershipByWallet.set(ownerAddress, walletTokens);
        db.run('INSERT OR REPLACE INTO tokens (tokenId, owner, tier, reward, lastUpdated) VALUES (?, ?, ?, ?, ?)', 
          [tokenId, ownerAddress, 0, 0, Date.now()]);
      });
    });

    await db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', 'invalidTokens', invalidTokens);
    timings.tokenIdFetch = Date.now() - start;
    return { ownershipByToken, ownershipByWallet, invalidTokens };
  } catch (error) {
    log(`[element280] error: fetchAllNftOwnership failed: ${error.message}`);
    throw error;
  }
}

// Populate holders cache
async function populateHoldersMapCache(contractAddress, tiers) {
  if (isCachePopulating) {
    log('[element280] error: Cache population already in progress');
    return;
  }
  isCachePopulating = true;
  progressState = { step: 'fetching_supply', processedNfts: 0, totalNfts: 0, totalWallets: 0 };
  const timings = { totalSupply: 0, tokenIdFetch: 0, holderInit: 0, tierFetch: 0, rewardFetch: 0, metricsCalc: 0, total: 0 };
  const errorLog = [];
  const totalStart = Date.now();
  const db = await initDb();

  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Cache population timed out after 30s')), 30000)
  );

  let ownershipByToken = new Map();
  let ownershipByWallet = new Map();
  let invalidTokens = 0;

  try {
    await Promise.race([
      (async () => {
        const totalSupplyStart = Date.now();
        const totalSupply = await getTotalSupply(contractAddress, db);
        timings.totalSupply = Date.now() - totalSupplyStart;
        invalidTokens = MAX_INITIAL_SUPPLY - totalSupply;
        await db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', 'invalidTokens', invalidTokens);

        const ownershipResult = await fetchAllNftOwnership(contractAddress, db, timings);
        ownershipByToken = ownershipResult.ownershipByToken;
        ownershipByWallet = ownershipResult.ownershipByWallet;
        invalidTokens = ownershipResult.invalidTokens;
        progressState = { 
          step: 'initializing_holders', 
          processedNfts: ownershipByToken.size, 
          totalNfts: MAX_INITIAL_SUPPLY, 
          totalWallets: ownershipByWallet.size 
        };

        const holderInitStart = Date.now();
        let processedWallets = 0;
        for (const [wallet, tokenIds] of ownershipByWallet) {
          try {
            const holder = {
              wallet,
              total: tokenIds.length,
              totalLive: tokenIds.length,
              multiplierSum: 0,
              displayMultiplierSum: 0,
              tiers: Array(6).fill(0),
              tokenIds: tokenIds.map(id => id.toString()),
              claimableRewards: 0,
              percentage: 0,
              rank: 0,
            };
            await db.run(
              'INSERT OR REPLACE INTO holders (wallet, total, totalLive, multiplierSum, displayMultiplierSum, tiers, tokenIds, claimableRewards, percentage, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [wallet, holder.total, holder.totalLive, holder.multiplierSum, holder.displayMultiplierSum, JSON.stringify(holder.tiers), JSON.stringify(holder.tokenIds), holder.claimableRewards, holder.percentage, holder.rank]
            );
            tokenCache.set(`${contractAddress}-${wallet}-nfts`, tokenIds.map(id => ({ tokenId: id, tier: 0 })));
            processedWallets++;
            progressState.totalWallets = processedWallets;
          } catch (error) {
            errorLog.push({ timestamp: new Date().toISOString(), phase: 'holder_init', wallet, error: error.message });
          }
        }
        timings.holderInit = Date.now() - holderInitStart;

        const tierFetchStart = Date.now();
        const allTokenIds = Array.from(ownershipByToken.keys());
        const tierCalls = [];
        for (const tokenId of allTokenIds) {
          const cached = await db.get('SELECT tier, lastUpdated FROM tokens WHERE tokenId = ?', tokenId);
          if (cached && cached.lastUpdated > Date.now() - 60 * 60 * 1000) {
            const owner = ownershipByToken.get(tokenId);
            const holder = await db.get('SELECT * FROM holders WHERE wallet = ?', owner);
            if (holder) {
              holder.tiers = JSON.parse(holder.tiers);
              holder.tiers[cached.tier - 1]++;
              await db.run('UPDATE holders SET tiers = ? WHERE wallet = ?', [JSON.stringify(holder.tiers), owner]);
            }
            continue;
          }
          tierCalls.push({ address: contractAddress, abi: element280MainAbi, functionName: 'getNftTier', args: [BigInt(tokenId)] });
        }
        const tierResults = await batchMulticall(tierCalls, 50);
        for (let i = 0; i < tierResults.length; i++) {
          const tokenId = tierCalls[i].args[0].toString();
          if (tierResults[i].status === 'success' && Number(tierResults[i].result) >= 1 && Number(tierResults[i].result) <= 6) {
            const tier = Number(tierResults[i].result);
            const owner = ownershipByToken.get(tokenId);
            const holder = await db.get('SELECT * FROM holders WHERE wallet = ?', owner);
            if (holder) {
              holder.tiers = JSON.parse(holder.tiers);
              holder.tiers[tier - 1]++;
              await db.run('UPDATE holders SET tiers = ? WHERE wallet = ?', [JSON.stringify(holder.tiers), owner]);
              await db.run('UPDATE tokens SET tier = ?, lastUpdated = ? WHERE tokenId = ?', [tier, Date.now(), tokenId]);
            }
          }
        }
        timings.tierFetch = Date.now() - tierFetchStart;

        const rewardFetchStart = Date.now();
        const rewardCalls = [];
        for (const [wallet, tokenIds] of ownershipByWallet) {
          for (const tokenId of tokenIds) {
            const cached = await db.get('SELECT reward, lastUpdated FROM tokens WHERE tokenId = ?', tokenId);
            if (cached && cached.lastUpdated > Date.now() - 60 * 60 * 1000) {
              const holder = await db.get('SELECT * FROM holders WHERE wallet = ?', wallet);
              if (holder) {
                holder.claimableRewards += cached.reward;
                await db.run('UPDATE holders SET claimableRewards = ? WHERE wallet = ?', [holder.claimableRewards, wallet]);
              }
              continue;
            }
            rewardCalls.push({
              address: vaultAddresses.element280.address,
              abi: element280VaultAbi,
              functionName: 'getRewards',
              args: [[BigInt(tokenId)], wallet],
            });
          }
        }
        const rewardResults = await batchMulticall(rewardCalls, 50);
        for (let i = 0; i < rewardResults.length; i++) {
          const result = rewardResults[i];
          if (result.status === 'success') {
            const tokenId = rewardCalls[i].args[0][0].toString();
            const reward = Number(BigInt(result.result[1] || 0)) / 1e18;
            const owner = ownershipByToken.get(tokenId);
            const holder = await db.get('SELECT * FROM holders WHERE wallet = ?', owner);
            if (holder) {
              holder.claimableRewards += reward;
              await db.run('UPDATE tokens SET reward = ?, lastUpdated = ? WHERE tokenId = ?', [reward, Date.now(), tokenId]);
              await db.run('UPDATE holders SET claimableRewards = ? WHERE wallet = ?', [holder.claimableRewards, owner]);
            }
          }
        }
        timings.rewardFetch = Date.now() - rewardFetchStart;

        const metricsStart = Date.now();
        const multipliers = Object.values(tiers).map(t => t.multiplier);
        let totalMultiplierSum = 0;
        const holders = await db.all('SELECT * FROM holders');
        for (const holder of holders) {
          holder.tiers = JSON.parse(holder.tiers);
          holder.multiplierSum = holder.tiers.reduce((sum, count, index) => sum + count * (multipliers[index] || 0), 0);
          holder.displayMultiplierSum = holder.multiplierSum / 10;
          totalMultiplierSum += holder.multiplierSum;
          await db.run('UPDATE holders SET multiplierSum = ?, displayMultiplierSum = ? WHERE wallet = ?', 
            [holder.multiplierSum, holder.displayMultiplierSum, holder.wallet]);
        }
        holders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
        for (let i = 0; i < holders.length; i++) {
          const holder = holders[i];
          holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
          holder.rank = i + 1;
          await db.run('UPDATE holders SET percentage = ?, rank = ? WHERE wallet = ?', [holder.percentage, holder.rank, holder.wallet]);
        }
        timings.metricsCalc = Date.now() - metricsStart;

        timings.total = Date.now() - totalStart;
        const summary = {
          totalDurationMs: timings.total,
          phases: { 
            fetchTotalSupply: timings.totalSupply, 
            fetchTokenIds: timings.tokenIdFetch, 
            holderInit: timings.holderInit, 
            fetchTiers: timings.tierFetch, 
            fetchRewards: timings.rewardFetch, 
            calculateMetrics: timings.metricsCalc 
          },
          nftsProcessed: ownershipByToken.size,
          walletsProcessed: ownershipByWallet.size,
          errors: errorLog,
        };
        await db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', 'lastSummary', JSON.stringify(summary));
        progressState = { 
          step: 'idle', 
          processedNfts: ownershipByToken.size, 
          totalNfts: MAX_INITIAL_SUPPLY, 
          totalWallets: ownershipByWallet.size 
        };
        log(`[element280] Cache population completed in ${timings.total}ms, holders: ${ownershipByWallet.size}, errors: ${errorLog.length}`);
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    log(`[element280] error: Cache population failed: ${error.message}, stack: ${error.stack}`);
    errorLog.push({ timestamp: new Date().toISOString(), phase: 'populate_cache', error: error.message });
    await db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', 'lastSummary', JSON.stringify({
      totalDurationMs: Date.now() - totalStart, 
      phases: timings, 
      nftsProcessed: ownershipByToken.size || 0, 
      walletsProcessed: ownershipByWallet.size || 0, 
      errors: errorLog 
    }));
    throw error;
  } finally {
    isCachePopulating = false;
  }
}

// Get holder data
async function getHolderData(contractAddress, wallet, tiers) {
  const cacheKey = `${contractAddress}-${wallet}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const db = await initDb();
  try {
    let holder = await db.get('SELECT * FROM holders WHERE wallet = ?', wallet.toLowerCase());
    if (holder) {
      holder.tiers = JSON.parse(holder.tiers);
      holder.tokenIds = JSON.parse(holder.tokenIds);
      cache.set(cacheKey, holder);
      return serializeBigInt(holder);
    }

    holder = {
      wallet: wallet.toLowerCase(),
      total: 0,
      totalLive: 0,
      multiplierSum: 0,
      displayMultiplierSum: 0,
      tiers: Array(6).fill(0),
      tokenIds: [],
      claimableRewards: 0,
      percentage: 0,
      rank: 0,
    };

    const tokenIds = await retry(() => client.readContract({
      address: contractAddress,
      abi: element280MainAbi,
      functionName: 'tokenIdsOf',
      args: [wallet.toLowerCase()],
    }));
    holder.total = tokenIds.length;
    holder.totalLive = tokenIds.length;
    if (tokenIds.length === 0) return null;

    const calls = tokenIds.flatMap(tokenId => [
      { address: contractAddress, abi: element280MainAbi, functionName: 'getNftTier', args: [tokenId] },
      { address: vaultAddresses.element280.address, abi: element280VaultAbi, functionName: 'getRewards', args: [[tokenId], wallet.toLowerCase()] },
    ]);
    const results = await batchMulticall(calls, 50);
    let totalRewards = 0;
    for (let i = 0; i < tokenIds.length; i++) {
      const tierResult = results[i * 2];
      const rewardResult = results[i * 2 + 1];
      const tokenId = tokenIds[i].toString();
      if (tierResult.status === 'success' && Number(tierResult.result) >= 1 && Number(tierResult.result) <= 6) {
        const tier = Number(tierResult.result);
        holder.tiers[tier - 1]++;
        holder.tokenIds.push(tokenId);
        await db.run('INSERT OR REPLACE INTO tokens (tokenId, owner, tier, reward, lastUpdated) VALUES (?, ?, ?, ?, ?)', 
          [tokenId, wallet.toLowerCase(), tier, 0, Date.now()]);
      }
      if (rewardResult.status === 'success') {
        const reward = Number(BigInt(rewardResult.result[1] || 0)) / 1e18;
        totalRewards += reward;
        await db.run('UPDATE tokens SET reward = ?, lastUpdated = ? WHERE tokenId = ?', [reward, Date.now(), tokenId]);
      }
    }
    holder.claimableRewards = totalRewards;
    const multipliers = Object.values(tiers).map(t => t.multiplier);
    holder.multiplierSum = holder.tiers.reduce((sum, count, index) => sum + count * (multipliers[index] || 0), 0);
    holder.displayMultiplierSum = holder.multiplierSum / 10;

    const allHolders = await db.all('SELECT * FROM holders');
    const totalMultiplierSum = allHolders.reduce((sum, h) => sum + h.multiplierSum, 0);
    holder.percentage = totalMultiplierSum > 0 ? (holder.multiplierSum / totalMultiplierSum) * 100 : 0;
    const sortedHolders = allHolders.sort((a, b) => b.multiplierSum - a.multiplierSum || b.total - a.total);
    holder.rank = sortedHolders.findIndex(h => h.wallet === wallet.toLowerCase()) + 1 || sortedHolders.length + 1;

    await db.run(
      'INSERT OR REPLACE INTO holders (wallet, total, totalLive, multiplierSum, displayMultiplierSum, tiers, tokenIds, claimableRewards, percentage, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [holder.wallet, holder.total, holder.totalLive, holder.multiplierSum, holder.displayMultiplierSum, JSON.stringify(holder.tiers), JSON.stringify(holder.tokenIds), holder.claimableRewards, holder.percentage, holder.rank]
    );
    cache.set(cacheKey, holder);
    return serializeBigInt(holder);
  } catch (error) {
    log(`[element280] error: getHolderData failed for wallet ${wallet}: ${error.message}`);
    throw error;
  }
}

// Get all holders
async function getAllHolders(contractAddress, tiers, page = 0, pageSize = 100, refresh = false) {
  const cacheKey = `${contractAddress}-all-${page}-${pageSize}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached) {
    return cached; // Silent cache hit
  }

  const db = await initDb();
  try {
    if (refresh) await populateHoldersMapCache(contractAddress, tiers);

    const totalSupply = await getTotalSupply(contractAddress, db);
    const holders = await db.all('SELECT * FROM holders LIMIT ? OFFSET ?', Math.min(pageSize, 100), page * Math.min(pageSize, 100));
    const totalHolders = (await db.get('SELECT COUNT(*) as count FROM holders')).count;
    const totalTokens = holders.reduce((sum, h) => sum + h.total, 0) || totalSupply;
    const invalidTokens = (await db.get('SELECT value FROM metadata WHERE key = ?', 'invalidTokens'))?.value || (MAX_INITIAL_SUPPLY - totalSupply);

    if (totalSupply + invalidTokens > MAX_INITIAL_SUPPLY) {
      log(`[element280] error: Data mismatch: totalSupply=${totalSupply}, invalidTokens=${invalidTokens}, exceeds MAX_INITIAL_SUPPLY=${MAX_INITIAL_SUPPLY}`);
    }

    const result = {
      holders: holders.map(h => ({ 
        ...h, 
        tiers: JSON.parse(h.tiers), 
        tokenIds: JSON.parse(h.tokenIds), 
        claimableRewards: Number(h.claimableRewards) 
      })),
      totalTokens,
      totalHolders,
      page,
      pageSize: Math.min(pageSize, 100),
      totalPages: Math.ceil(totalHolders / Math.min(pageSize, 100)),
      summary: {
        totalLive: totalSupply,
        totalBurned: invalidTokens,
        multiplierPool: holders.reduce((sum, h) => sum + h.multiplierSum, 0),
        totalRewardPool: holders.reduce((sum, h) => sum + Number(h.claimableRewards), 0),
      },
    };
    cache.set(cacheKey, result);
    return serializeBigInt(result);
  } catch (error) {
    log(`[element280] error: getAllHolders failed for page=${page}: ${error.message}`);
    throw error;
  }
}

// GET handler
export async function GET(request) {
  const { searchParams, pathname } = new URL(request.url);
  const address = contractAddresses.element280.address;
  if (!address) return NextResponse.json({ error: 'Element280 contract address not found', code: 400 }, { status: 400 });

  try {
    const db = await initDb();
    if (pathname.endsWith('/summary')) {
      const summary = await db.get('SELECT value FROM metadata WHERE key = ?', 'lastSummary');
      return NextResponse.json(summary ? JSON.parse(summary.value) : { error: 'No summary available', code: 404 }, { status: summary ? 200 : 404 });
    }

    const wallet = searchParams.get('wallet');
    const page = parseInt(searchParams.get('page') || '0', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
    const refresh = searchParams.get('refresh') === 'true';

    if (isCachePopulating && !wallet) {
      const cached = cache.get(`${address}-all-${page}-${pageSize}`);
      if (cached) {
        return NextResponse.json(serializeBigInt(cached), { headers: { 'X-Cache-Status': 'stale' } });
      }
    }

    const startTime = Date.now();
    if (wallet) {
      const holderData = await getHolderData(address, wallet, contractTiers.element280);
      return NextResponse.json(serializeBigInt({ holders: holderData ? [holderData] : [] }));
    } else {
      const result = await getAllHolders(address, contractTiers.element280, page, pageSize, refresh);
      return NextResponse.json(serializeBigInt(result), { headers: { 'X-Cache-Status': cache.get(`${address}-all-${page}-${pageSize}`) ? 'hit' : 'miss' } });
    }
  } catch (error) {
    const status = error.details?.code === 429 ? 429 : 500;
    const message = error.details?.code === 429 ? 'Rate limit exceeded' : `Server error: ${error.message}`;
    log(`[element280] error: GET error: ${message}`);
    return NextResponse.json({ error: message, code: status }, { status });
  }
}

// POST handler
export async function POST() {
  const address = contractAddresses.element280.address;
  if (!address) return NextResponse.json({ error: 'Element280 contract address not found', code: 400 }, { status: 400 });

  try {
    await populateHoldersMapCache(address, contractTiers.element280);
    const db = await initDb();
    const totalHolders = (await db.get('SELECT COUNT(*) as count FROM holders')).count;
    log(`[element280] Cache preload completed, total holders: ${totalHolders}`);
    return NextResponse.json({ message: 'Cache preload completed', totalHolders });
  } catch (error) {
    log(`[element280] error: Cache preload failed: ${error.message}`);
    return NextResponse.json({ error: `Cache preload failed: ${error.message}`, code: 500 }, { status: 500 });
  }
}

// Initialize cache on startup
let cacheInitialized = false;
if (!cacheInitialized) {
  cacheInitialized = true;
  (async () => {
    try {
      await populateHoldersMapCache(contractAddresses.element280.address, contractTiers.element280);
    } catch (error) {
      log(`[element280] error: Initial cache population failed: ${error.message}`);
    }
  })();
}