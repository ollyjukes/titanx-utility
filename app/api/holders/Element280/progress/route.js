import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '@/app/api/holders/Element280/route';
import config from '@/config'; // Use @/ alias for root config.js

export async function GET() {
  const address = config.contractAddresses.element280.address; // Updated to use config
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: 'Element280 contract address not found' }, { status: 400 });
  }

  try {
    const state = await getCacheState(address);
    if (!state || !state.progressState) {
      log(`[element280] [ERROR] Invalid cache state for ${address}`);
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
    log(`[element280] [ERROR] Progress endpoint error: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}