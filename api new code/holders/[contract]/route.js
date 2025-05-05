// app/api/holders/[contract]/route.js
import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import config from '@/contracts/config';
import { logger } from '@/app/utils/logger';
import { populateHoldersMapCache } from './utils/population';
import { getCacheState, cache } from './utils/cache';

const redis = process.env.KV_URL ? new Redis(process.env.KV_URL, { tls: { rejectUnauthorized: false } }) : null;
const CACHE_TTL = 3600;

export async function GET(request, { params }) {
  const contractKey = params.contract.toLowerCase();
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || config.contractDetails[contractKey]?.pageSize || 1000);
  const wallet = searchParams.get('wallet')?.toLowerCase();

  logger.info('holders', `GET request: contract=${contractKey}, page=${page}, pageSize=${pageSize}, wallet=${wallet}`, {}, 'eth', contractKey);

  try {
    const contractConfig = config.nftContracts[contractKey];
    if (!contractConfig || config.contractDetails[contractKey]?.disabled) {
      throw new Error(`${contractKey} configuration missing or disabled`);
    }

    const cacheKey = `holders_${contractKey}_${page}_${pageSize}_${wallet || 'all'}`;
    let cachedData;

    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.info('holders', `Redis cache hit: ${cacheKey}`, {}, 'eth', contractKey);
        return NextResponse.json(JSON.parse(cached));
      }
    } else {
      cachedData = cache.get(`holders_${contractKey}`);
      if (cachedData) {
        logger.info('holders', `Node cache hit: ${cacheKey}`, {}, 'eth', contractKey);
      }
    }

    if (!cachedData) {
      logger.info('holders', `Cache miss: ${cacheKey}, triggering population`, {}, 'eth', contractKey);
      const result = await populateHoldersMapCache(contractKey, false);
      if (result.status === 'error') {
        throw new Error(result.error || 'Cache population failed');
      }
      cachedData = result;
    }

    let holders = cachedData.holders || [];
    if (wallet) {
      holders = holders.filter(h => h.owner.toLowerCase() === wallet);
    }
    const start = page * pageSize;
    const end = Math.min(start + pageSize, holders.length);
    const paginatedHolders = holders.slice(start, end);

    const response = {
      holders: paginatedHolders,
      totalMinted: cachedData.totalMinted,
      totalLive: cachedData.totalLive,
      totalBurned: cachedData.totalBurned, // Null for Element369 and Ascendant
      totalHolders: cachedData.totalHolders,
      page,
      pageSize,
      totalPages: Math.ceil(holders.length / pageSize),
    };

    if (redis) {
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(response));
    } else {
      cache.set(`holders_${contractKey}`, cachedData);
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error('holders', `GET error: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    return NextResponse.json({ error: error.message }, { status: error.message.includes('Rate limit') ? 429 : 500 });
  }
}

export async function POST(request, { params }) {
  const contractKey = params.contract.toLowerCase();
  try {
    logger.info('holders', `POST request received: contract=${contractKey}`, {}, 'eth', contractKey);

    if (!config.contractDetails[contractKey] || config.contractDetails[contractKey].disabled) {
      logger.error('holders', `Invalid or disabled contract: ${contractKey}`, {}, 'eth', contractKey);
      throw new Error(`Invalid or disabled contract: ${contractKey}`);
    }

    const body = await request.json().catch(() => ({}));
    const forceUpdate = body.forceUpdate === true;
    logger.info('holders', `Triggering populateHoldersMapCache for ${contractKey}, forceUpdate=${forceUpdate}`, {}, 'eth', contractKey);

    const { status, error, holders } = await populateHoldersMapCache(contractKey, forceUpdate);
    logger.info('holders', `populateHoldersMapCache result: status=${status}, error=${error || 'none'}, holders=${holders ? holders.length : 'none'}`, {}, 'eth', contractKey);

    if (status === 'error') {
      logger.error('holders', `Cache population failed: ${error || 'Unknown error'}`, {}, 'eth', contractKey);
      throw new Error(error || 'Cache population failed');
    }

    return NextResponse.json({
      message: status === 'up_to_date' ? 'Cache is up to date' : `${contractKey} cache population triggered`,
      status,
    }, { status: status === 'in_progress' ? 202 : 200 });
  } catch (error) {
    logger.error('holders', `POST error: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}