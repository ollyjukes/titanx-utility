// ./app/api/holders/Ascendant/progress/route.js
import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '@/app/api/holders/Ascendant/route';
import config from '@/config';

export async function GET() {
  const address = config.contractAddresses.ascendant.address;
  if (!address) {
    log(`[ascendant] [VALIDATION] Ascendant contract address not found`);
    return NextResponse.json({ error: 'Ascendant contract address not found' }, { status: 400 });
  }

  try {
    const state = await getCacheState(address);
    if (!state || !state.progressState) {
      log(`[ascendant] [VALIDATION] Invalid cache state for ${address}`);
      return NextResponse.json({ error: 'Cache state not initialized' }, { status: 500 });
    }
    const progressPercentage = state.progressState.totalNfts > 0
      ? ((state.progressState.processedNfts / state.progressState.totalNfts) * 100).toFixed(1)
      : '0.0';

    return NextResponse.json({
      isPopulating: state.isCachePopulating,
      totalLiveHolders: state.totalOwners,
      totalOwners: state.totalOwners,
      phase: state.progressState.step.charAt(0).toUpperCase() + state.progressState.step.slice(1),
      progressPercentage,
    });
  } catch (error) {
    log(`[ascendant] [ERROR] Progress endpoint error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}