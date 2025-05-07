import { NextResponse } from 'next/server';
import { logger } from '@/app/lib/logger';
import { ProgressResponseSchema } from '@/app/lib/schemas';
import { getCacheState } from '@/app/api/holders/cache/state';
import config from '@/contracts/config';
import { sanitizeBigInt } from '@/app/api/holders/cache/holders'; // Added for BigInt handling

export async function GET(_request, { params }) {
  const { contract } = await params;
  const contractKey = contract.toLowerCase();
  // Retrieve chain dynamically from config.nftContracts (from file1)
  const chain = config.nftContracts[contractKey]?.chain || 'eth';

  // Validate contract key
  if (!config.contractDetails[contractKey]) {
    logger.error('progress', `Invalid contract: ${contractKey}`, chain, contractKey);
    return NextResponse.json({ error: `Invalid contract: ${contractKey}` }, { status: 400 });
  }

  // Check if contract is disabled
  if (config.contractDetails[contractKey].disabled) {
    return NextResponse.json({ error: `${contractKey} contract not deployed` }, { status: 400 });
  }

  try {
    // Fetch cache state
    const state = await getCacheState(contractKey);
    // Fallback response for missing cache state (from file1)
    if (!state || !state.progressState) {
      logger.warn('progress', `No cache state found for ${contractKey}`, chain, contractKey);
      return NextResponse.json(
        sanitizeBigInt({
          isPopulating: false,
          totalLiveHolders: 0,
          totalOwners: 0,
          phase: 'Idle',
          progressPercentage: '0.0',
          lastProcessedBlock: null,
          lastUpdated: null,
          error: null,
          errorLog: [],
          globalMetrics: {},
          isErrorLogTruncated: false,
          status: 'idle', // Added status field (from file1)
        }),
        { status: 200 }
      );
    }

    // Calculate progress percentage (retained from existing code)
    let progressPercentage = '0.0';
    if (state.progressState.error) {
      progressPercentage = '0.0';
    } else if (state.progressState.step === 'completed') {
      progressPercentage = '100.0';
    } else if (state.progressState.totalNfts > 0) {
      if (state.progressState.step === 'fetching_owners') {
        const ownerProgress = (state.progressState.processedNfts / state.progressState.totalNfts) * 50;
        progressPercentage = Math.min(ownerProgress, 50).toFixed(1);
      } else if (state.progressState.step === 'fetching_tiers') {
        const tierProgress = (state.progressState.processedTiers / state.progressState.totalTiers) * 50;
        progressPercentage = Math.min(50 + tierProgress, 100).toFixed(1);
      }
    } else if (['fetching_owners', 'fetching_tiers'].includes(state.progressState.step)) {
      logger.debug('progress', 'No NFTs found, progress remains at 0.0', chain, contractKey);
    }

    // Build response
    const response = {
      isPopulating: state.isPopulating,
      totalLiveHolders: state.totalOwners,
      totalOwners: state.totalOwners,
      phase: state.progressState.step
        ? state.progressState.step.charAt(0).toUpperCase() + state.progressState.step.slice(1)
        : 'Unknown',
      progressPercentage,
      lastProcessedBlock: state.lastProcessedBlock,
      lastUpdated: state.lastUpdated,
      error: state.progressState.error || null,
      errorLog: (state.progressState.errorLog || []).slice(-50),
      isErrorLogTruncated: (state.progressState.errorLog || []).length > 50,
      globalMetrics: state.globalMetrics,
      // Added status field (from file1)
      status: state.progressState.error ? 'error' : state.isPopulating ? 'pending' : 'success',
    };

    // Validate response schema (retained from existing code)
    const validation = ProgressResponseSchema.safeParse(response);
    if (!validation.success) {
      logger.error('progress', `Invalid response data: ${JSON.stringify(validation.error.errors)}`, chain, contractKey);
      return NextResponse.json({ error: 'Invalid response data' }, { status: 500 });
    }

    // Apply sanitizeBigInt to response (from file1)
    return NextResponse.json(sanitizeBigInt(response));
  } catch (error) {
    logger.error('progress', `GET /api/holders/${contractKey}/progress: ${error.message}`, { stack: error.stack }, chain, contractKey);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}