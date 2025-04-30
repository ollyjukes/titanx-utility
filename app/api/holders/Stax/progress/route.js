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

    let progressPercentage = '0.0';
    if (state.progressState.error) {
      progressPercentage = '0.0';
    } else if (state.progressState.step === 'completed') {
      progressPercentage = '100.0';
    } else if (state.progressState.totalNfts > 0) {
      if (state.progressState.step === 'fetching_owners') {
        // Owners phase: 0% to 50%
        const ownerProgress = (state.progressState.processedNfts / state.progressState.totalNfts) * 50;
        progressPercentage = Math.min(ownerProgress, 50).toFixed(1);
      } else if (state.progressState.step === 'fetching_tiers') {
        // Tiers phase: 50% to 100%
        const tierProgress = (state.progressState.processedTiers / state.progressState.totalTiers) * 50;
        progressPercentage = Math.min(50 + tierProgress, 100).toFixed(1);
      }
    }

    return NextResponse.json({
      isPopulating: state.isPopulating,
      totalLiveHolders: state.holderCount,
      totalOwners: state.holderCount,
      phase: state.progressState.step.charAt(0).toUpperCase() + state.progressState.step.slice(1),
      progressPercentage,
      lastProcessedBlock: state.lastProcessedBlock,
      error: state.progressState.error || null,
      errorLog: state.progressState.errorLog || [],
    });
  } catch (error) {
    logger.error('Stax', `Progress endpoint error: ${error.message}`, { stack: error.stack });
    return NextResponse.json({ error: 'Failed to fetch cache state', details: error.message }, { status: 500 });
  }
}