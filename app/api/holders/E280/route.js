import { NextResponse } from 'next/server';
import { log } from '../../utils';
import NodeCache from 'node-cache';

// Redis toggle
const DISABLE_REDIS = process.env.DISABLE_E280_REDIS === 'true';

// In-memory cache (for future use when contract is deployed)
const inMemoryCache = new NodeCache({ stdTTL: 3600 });

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || '1000');
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[E280] GET Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}, Redis=${!DISABLE_REDIS}`);

  // Placeholder for future cache check when contract is deployed
  /*
  const cacheKey = `e280_holders_${page}_${pageSize}_${wallet || 'all'}`;
  let cachedData;
  try {
    if (DISABLE_REDIS) {
      cachedData = inMemoryCache.get(cacheKey);
    } else {
      cachedData = await getCache(cacheKey);
    }
    if (cachedData) {
      log(`[E280] Cache hit: ${cacheKey} (Redis=${!DISABLE_REDIS})`);
      return NextResponse.json(cachedData);
    }
    log(`[E280] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[E280] Cache read error: ${cacheError.message}`);
  }
  */

  log('[E280] GET: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}

export async function POST(request) {
  log(`[E280] POST Request: Redis=${!DISABLE_REDIS}`);
  log('[E280] POST: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}