// api/holders/Element280/progress/route.js
// This route handles the progress of the cache population for the Element280 contract.
// It provides information about the current state of the cache population process,
// including whether it is currently populating, the total number of wallets,
// the total number of owners, and the current phase of the process.
// It also handles errors that may occur during the process and logs relevant information.
// The route is defined as a GET request handler and returns a JSON response with the progress information.

import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';
import { getCacheState } from '../route';

export async function GET(request) {
  const { isCachePopulating, holdersMapCache, totalOwners, progressState } = getCacheState();
  const contractName = 'element280';

  log(`Handling /progress: isPopulating=${isCachePopulating}, totalWallets=${holdersMapCache?.size || 0}, totalOwners=${totalOwners}, step=${progressState.step}`);

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
      totalWallets: holdersMapCache?.size || 0,
      totalOwners,
      phase,
      progressPercentage: progressPercentage.toFixed(1),
    });
  } catch (error) {
    log(`Error in GET /progress: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}