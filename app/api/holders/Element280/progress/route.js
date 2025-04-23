import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '../route';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { isCachePopulating, holdersMapCache, totalOwners, progressState } = await getCacheState();
  const contractName = 'element280';

  
  log(`Handling /progress: isPopulating=${isCachePopulating}, totalWallets=${holdersMapCache?.length || 0}, totalOwners=${totalOwners}, step=${progressState.step}`);

  try {
    const progressPercentage = progressState.totalNfts > 0 ? (progressState.processedNfts / progressState.totalNfts) * 100 : 0;
    const phase = isCachePopulating
      ? {
          fetching_supply: 'Fetching total supply',
          fetching_ownership: 'Fetching NFT ownership',
          initializing_holders: 'Initializing holder data',
          fetching_tiers: `Fetching tiers (${progressPercentage.toFixed(1)}%)`,
          fetching_rewards: `Fetching rewards (${progressPercentage.toFixed(1)}%)`,
          calculating_metrics: 'Calculating multipliers and rankings',
          error: 'Error during processing',
        }[progressState.step] || 'Processing'
      : 'Idle';

    return NextResponse.json({
      isPopulating: isCachePopulating,
      totalWallets: holdersMapCache?.length || 0,
      totalOwners,
      phase,
      progressPercentage: progressPercentage.toFixed(1),
    });
  } catch (error) {
    log(`Error in GET /progress: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}