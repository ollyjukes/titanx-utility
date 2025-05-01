import { NextResponse } from 'next/server';
import { logger, loadCacheState } from '@/app/api/utils';
import config from '@/config';

async function getCacheState(contractKey) {
  const cacheState = {
    isPopulating: false,
    totalOwners: 0,
    progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
    lastUpdated: null,
    lastProcessedBlock: null,
  };
  try {
    const savedState = await loadCacheState(contractKey, contractKey.toLowerCase());
    if (savedState && typeof savedState === 'object') {
      cacheState.isPopulating = savedState.isPopulating ?? false;
      cacheState.totalOwners = savedState.totalOwners ?? 0;
      cacheState.progressState = {
        step: savedState.progressState?.step ?? 'idle',
        processedNfts: savedState.progressState?.processedNfts ?? 0,
        totalNfts: savedState.progressState?.totalNfts ?? 0,
        processedTiers: savedState.progressState?.processedTiers ?? 0,
        totalTiers: savedState.progressState?.totalTiers ?? 0,
        error: savedState.progressState?.error ?? null,
        errorLog: savedState.progressState?.errorLog ?? [],
      };
      cacheState.lastUpdated = savedState.lastUpdated ?? null;
      cacheState.lastProcessedBlock = savedState.lastProcessedBlock ?? null;
    }
  } catch (error) {
    logger.error(contractKey, `Failed to load cache state: ${error.message}`, { stack: error.stack });
  }
  return cacheState;
}

export async function GET(_request, { params }) {
  const { contract } = await params; // Await params
  const contractKey = contract.toLowerCase();

  if (!config.contractDetails[contractKey]) {
    logger.error(contractKey, `Invalid contract: ${contractKey}`);
    return NextResponse.json({ error: `Invalid contract: ${contractKey}` }, { status: 400 });
  }

  if (config.contractDetails[contractKey].disabled) {
    return NextResponse.json({ error: `${contractKey} contract not deployed` }, { status: 400 });
  }

  try {
    const state = await getCacheState(contractKey);
    if (!state || !state.progressState) {
      logger.error(contractKey, 'Invalid cache state');
      return NextResponse.json({ error: 'Cache state not initialized' }, { status: 500 });
    }

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
    }

    return NextResponse.json({
      isPopulating: state.isPopulating,
      totalLiveHolders: state.totalOwners,
      totalOwners: state.totalOwners,
      phase: state.progressState.step.charAt(0).toUpperCase() + state.progressState.step.slice(1),
      progressPercentage,
      lastProcessedBlock: state.lastProcessedBlock,
      error: state.progressState.error || null,
      errorLog: state.progressState.errorLog || [],
    });
  } catch (error) {
    logger.error(contractKey, `Progress endpoint error: ${error.message}`, { stack: error.stack });
    return NextResponse.json({ error: `Failed to fetch ${contractKey} cache state`, details: error.message }, { status: 500 });
  }
}