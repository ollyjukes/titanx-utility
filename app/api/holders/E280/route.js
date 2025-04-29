// app/api/holders/E280/route.js
import { NextResponse } from 'next/server';
import { log, getCache } from '@/app/api/utils';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '0');
  const pageSize = parseInt(searchParams.get('pageSize') || '1000');
  const wallet = searchParams.get('wallet')?.toLowerCase();

  log(`[E280] GET Request: page=${page}, pageSize=${pageSize}, wallet=${wallet}`);

  const cacheKey = `e280_holders_${page}_${pageSize}_${wallet || 'all'}`;
  let cachedData;
  try {
    cachedData = await getCache(cacheKey);
    if (cachedData) {
      log(`[E280] Cache hit: ${cacheKey}`);
      return NextResponse.json(cachedData);
    }
    log(`[E280] Cache miss: ${cacheKey}`);
  } catch (cacheError) {
    log(`[E280] Cache read error: ${cacheError.message}`);
  }

  log('[E280] GET: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}

export async function POST(_request) {
  log('[E280] POST: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}