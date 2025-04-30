// app/api/holders/Stax/progress/route.js
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger.js';
import { getCacheState } from '../route';

export async function GET() {
  try {
    const state = await getCacheState();
    if (!state || !state.progressState) {
      logger.error('Stax', 'Invalid cache state');
      return NextResponse.json({ error: 'Cache state not initialized' }, { status: 500 });
    }
    const progressPercentage = state.progressState.totalNfts > 0
      ? ((state.progressState.processedNfts / state.progressState.totalNfts) * 100).toFixed(1)
      : '0.0';

    return NextResponse.json({
      isPopulating: state.isPopulating,
      totalLiveHolders: state.holderCount,
      totalOwners: state.holderCount,
      phase: state.progressState.step.charAt(0).toUpperCase() + state.progressState.step.slice(1),
      progressPercentage,
      error: state.progressState.error || null,
    });
  } catch (error) {
    logger.error('Stax', `Progress endpoint error: ${error.message}`);
    return NextResponse.json({ error: 'Failed to fetch cache state', details: error.message }, { status: 500 });
  }
}