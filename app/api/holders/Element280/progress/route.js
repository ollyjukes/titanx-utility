// app/api/holders/Element280/progress/route.js

import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';

// Import shared cache variables from Element280 route
import { getCacheState } from '../route';

export async function GET(request) {
  const { isCachePopulating, holdersMapCache, totalOwners } = getCacheState();
  const contractName = 'element280';

  log(`Handling /progress: isPopulating=${isCachePopulating}, totalWallets=${holdersMapCache?.size || 0}, totalOwners=${totalOwners}`);

  try {
    return NextResponse.json({
      isPopulating: isCachePopulating,
      totalWallets: holdersMapCache?.size || 0,
      totalOwners,
      phase: isCachePopulating
        ? holdersMapCache && holdersMapCache.size >= totalOwners
          ? 'Phase 2: Calculating Rewards'
          : 'Phase 1: Fetching Wallets and NFTs'
        : 'Idle',
    });
  } catch (error) {
    log(`Error in GET /progress: ${error.message}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}