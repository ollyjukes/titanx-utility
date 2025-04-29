// app/api/holders/Stax/progress/route.js
import { NextResponse } from 'next/server';
import { getCacheState } from '../route';
import { log } from '@/app/api/utils';

export async function GET(_request) {
  try {
    const state = await getCacheState();
    const progressPercentage = state.holderCount > 0 ? '100.0' : '0.0';
    return NextResponse.json({
      isPopulating: !state.cached,
      totalLiveHolders: state.holderCount,
      totalOwners: state.holderCount,
      phase: state.cached ? 'Completed' : 'Idle',
      progressPercentage,
    });
  } catch (error) {
    log(`[Stax] [ERROR] Progress endpoint error: ${error.message}`);
    return NextResponse.json({ error: 'Failed to fetch cache state' }, { status: 500 });
  }
}