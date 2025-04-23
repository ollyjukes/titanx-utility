// api/holders/Element280/progress/route.js


import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '../route';

export async function GET(request) {
  const { isPopulating, totalWallets, totalOwners, step, processedNfts, totalNfts } = getCacheState();
  const contractName = 'element280';

  log(`Handling /progress: isPopulating=${isPopulating}, totalWallets=${totalWallets}, totalOwners=${totalOwners}, step=${step}`);

  try {
    const progressPercentage = totalNfts > 0 ? (processedNfts / totalNfts) * 100 : 0;
    const phase = isPopulating
      ? {
          fetching_supply: 'Fetching total supply',
          initializing_holders: 'Initializing holder data',
          fetching_tiers: `Fetching tiers (${progressPercentage.toFixed(1)}%)`,
          fetching_rewards: `Fetching rewards (${progressPercentage.toFixed(1)}%)`,
          calculating_metrics: 'Calculating multipliers and rankings',
          error: 'Error during processing',
        }[step] || 'Processing'
      : 'Idle';

    return NextResponse.json({
      isPopulating,
      totalWallets,
      totalOwners,
      phase,
      progressPercentage: progressPercentage.toFixed(1),
    });
  } catch (error) {
    log(`Error in GET /progress: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}