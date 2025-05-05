// app/api/holders/[contract]/progress/route.js
import { NextResponse } from 'next/server';
import { logger, validateContract } from '@/app/api new code/utils';
import { getCacheState } from '@/app/api new code/holders/utils/cache';

export async function GET(request, { params }) {
  const { contract } = await params; // Await params
  const contractKey = contract.toLowerCase();

  try {
    await validateContract(contractKey);
    const cacheState = await getCacheState(contractKey);
    return NextResponse.json({
      isPopulating: cacheState.isPopulating,
      totalLiveHolders: cacheState.totalLiveHolders,
      totalOwners: cacheState.totalOwners,
      phase: cacheState.phase,
      progressPercentage: cacheState.progressPercentage,
      lastProcessedBlock: cacheState.lastProcessedBlock,
      lastUpdated: cacheState.lastUpdated,
      error: cacheState.error,
      errorLog: cacheState.errorLog,
      globalMetrics: cacheState.globalMetrics,
    });
  } catch (error) {
    logger.error('progress', `Failed to fetch progress for ${contractKey}: ${error.message}`, { stack: error.stack }, 'eth', contractKey);
    return NextResponse.json(
      { error: `Failed to fetch progress for ${contractKey}`, details: error.message },
      { status: 500 }
    );
  }
}