// app/api/holders/Stax/route.js
import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import pLimit from 'p-limit';
import config from '@/config.js';
import { retry, logger, getCache, setCache } from '@/app/api/utils';

const limit = pLimit(5);

export async function getCacheState() {
  const cacheData = await getCache('stax_holders');
  const hasCache = !!cacheData;
  const holderCount = cacheData ? cacheData.holders.length : 0;
  return {
    cached: hasCache,
    holderCount,
    lastUpdated: hasCache ? cacheData.timestamp : null,
  };
}

async function getHoldersMap() {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemy.apiKey}`),
  });

  const contractAddress = config.contractAddresses.stax.address;
  const holdersMap = new Map();
  let totalBurned = 0;

  try {
    logger.info('[Stax] Fetching total supply and burned NFTs...');
    const [totalSupply, burnedCount] = await Promise.all([
      retry(() =>
        client.readContract({
          address: contractAddress,
          abi: config.abis.stax.main,
          functionName: 'totalSupply',
        })
      ),
      retry(() =>
        client.readContract({
          address: contractAddress,
          abi: config.abis.stax.main,
          functionName: 'totalBurned',
        })
      ),
    ]);
    totalBurned = Number(burnedCount);

    logger.info(`[Stax] Total supply: ${totalSupply}, burned: ${totalBurned}`);
    const batchSize = config.alchemy.batchSize;
    for (let i = 0; i < Number(totalSupply); i += batchSize) {
      const tokenIds = Array.from(
        { length: Math.min(batchSize, Number(totalSupply) - i) },
        (_, j) => i + j
      );
      const ownerPromises = tokenIds.map((tokenId) =>
        limit(() =>
          retry(() =>
            client.readContract({
              address: contractAddress,
              abi: config.abis.stax.main,
              functionName: 'ownerOf',
              args: [tokenId],
            })
          )
        )
      );
      const owners = await Promise.all(ownerPromises);
      owners.forEach((owner, index) => {
        if (owner && owner !== '0x0000000000000000000000000000000000000000') {
          const current = holdersMap.get(owner) || {
            wallet: owner,
            tokenIds: [],
            tiers: Array(12).fill(0),
            total: 0,
            multiplierSum: 0,
          };
          current.tokenIds.push(tokenIds[index]);
          current.total += 1;
          holdersMap.set(owner, current);
        }
      });
    }

    logger.info('[Stax] Fetching tiers for holders...');
    for (const holder of holdersMap.values()) {
      const tierPromises = holder.tokenIds.map((tokenId) =>
        limit(() =>
          retry(() =>
            client.readContract({
              address: contractAddress,
              abi: config.abis.stax.main,
              functionName: 'getTier',
              args: [tokenId],
            })
          )
        )
      );
      const tiers = await Promise.all(tierPromises);
      tiers.forEach((tier) => {
        if (tier >= 1 && tier <= 12) {
          holder.tiers[tier - 1]++;
          holder.multiplierSum += config.contractDetails.stax.tiers[tier - 1].multiplier;
        }
      });
    }

    return { holdersMap, totalBurned };
  } catch (error) {
    logger.error(`[Stax] Error fetching holders: ${error.message}`);
    throw error;
  }
}

async function populateHoldersMapCache() {
  try {
    logger.info('[Stax] Populating holders cache...');
    const { holdersMap, totalBurned } = await getHoldersMap();
    const holders = Array.from(holdersMap.values());
    const cacheData = { holders, totalBurned, timestamp: Date.now() };

    await setCache('stax_holders', cacheData);
    logger.info(`[Stax] Cached ${holders.length} holders with ${totalBurned} burned`);

    return holders;
  } catch (error) {
    logger.error(`[Stax] Cache population failed: ${error.message}`);
    throw error;
  }
}

export async function GET(_request) {
  try {
    const cachedData = await getCache('stax_holders');
    if (cachedData) {
      logger.info(`[Stax] Cache hit for stax_holders: ${cachedData.holders.length} holders`);
      return NextResponse.json({
        holders: cachedData.holders,
        totalTokens: cachedData.holders.reduce((sum, h) => sum + h.total, 0),
        totalBurned: cachedData.totalBurned,
      });
    }

    logger.info('[Stax] Cache miss, fetching holders...');
    const { holdersMap, totalBurned } = await getHoldersMap();
    const holders = Array.from(holdersMap.values());
    const cacheData = { holders, totalBurned, timestamp: Date.now() };

    await setCache('stax_holders', cacheData);
    logger.info(`[Stax] Cached ${holders.length} holders with ${totalBurned} burned`);

    return NextResponse.json({
      holders,
      totalTokens: holders.reduce((sum, h) => sum + h.total, 0),
      totalBurned,
    });
  } catch (error) {
    logger.error(`[Stax] GET Error: ${error.message}`);
    return NextResponse.json({ error: 'Failed to fetch Stax holders' }, { status: 500 });
  }
}

export async function POST(_request) {
  try {
    await populateHoldersMapCache();
    return NextResponse.json({ message: 'Stax cache population triggered' });
  } catch (error) {
    logger.error(`[Stax] POST Error: ${error.message}`);
    return NextResponse.json({ error: 'Failed to populate Stax cache' }, { status: 500 });
  }
}