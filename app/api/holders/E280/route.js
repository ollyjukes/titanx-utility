// app/api/holders/E280/route.js
import { NextResponse } from 'next/server';
import { log, getCache } from '@/app/api/utils';

const COLLECTION = 'e280';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '1000', 10);
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[E280] [INFO] GET Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  const cacheKey = `e280_holders_${page}_${pageSize}_${wallet || 'all'}`;
  try {
    const cachedData = await getCache(cacheKey, COLLECTION);
    if (cachedData) {
      log(`[E280] [INFO] Cache hit: ${cacheKey}`);
      return NextResponse.json(cachedData);
    }
    log(`[E280] [INFO] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[E280] [ERROR] Cache read error: ${cacheError.message}, stack: ${cacheError.stack}`);
  }

  log(`[E280] [VALIDATION] Contract not yet deployed`);
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}

export async function POST(_request) {
  log(`[E280] [VALIDATION] POST: Contract not yet deployed`);
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}