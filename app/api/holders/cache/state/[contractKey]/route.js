// app/api/holders/cache/state/[contractKey]/route.js
import { NextResponse } from 'next/server';
import { getCacheState } from '@/app/api/holders/cache/state';
import { logger } from '@/app/lib/logger';

// In app/api/holders/cache/state/[contractKey]/route.js
export async function GET(request, { params }) {
  const { contractKey } = await params;
  if (!contractKey) {
    logger.error('cache/state', 'Contract key missing in request', 'eth', 'general');
    return NextResponse.json({ error: 'Contract key is required' }, { status: 400 });
  }
  try {
    const cacheState = await getCacheState(contractKey.toLowerCase());
    logger.info('cache/state', `Fetched cache state for ${contractKey}`, 'eth', contractKey);
    return NextResponse.json({
      ...cacheState,
      errorLog: cacheState.progressState.errorLog, // Explicitly include errorLog
    });
  } catch (error) {
    logger.error(
      'cache/state',
      `Failed to fetch cache state for ${contractKey}: ${error.message}`,
      { stack: error.stack },
      'eth',
      contractKey
    );
    return NextResponse.json({ error: `Failed to fetch cache state: ${error.message}` }, { status: 500 });
  }
}