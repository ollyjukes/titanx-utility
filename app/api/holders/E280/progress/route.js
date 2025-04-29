// app/api/holders/E280/progress/route.js
import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';

export async function GET(_request) {
  try {
    log('[E280] [INFO] Progress: Contract not yet deployed');
    return NextResponse.json({
      isPopulating: false,
      totalLiveHolders: 0,
      totalOwners: 0,
      phase: 'Not Deployed',
      progressPercentage: '0.0',
    });
  } catch (error) {
    log(`[E280] [ERROR] Progress endpoint error: ${error.message}`);
    return NextResponse.json({ error: 'Failed to fetch progress state' }, { status: 500 });
  }
}