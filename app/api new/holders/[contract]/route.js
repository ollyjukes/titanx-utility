// app/api/holders/[contract]/route.js
import { NextResponse } from 'next/server';
import pLimit from 'p-limit';
import {
  logger,
  getCache,
  populateHoldersMapCache,
  getCacheState,
  formatHoldersResponse,
  validateContractConfig,
  initServer,
  isServerInitialized,
  withErrorHandling,
} from '@/app/api/utils';

const limit = pLimit(5);

// GET endpoint
export async function GET(request, { params }) {
  return withErrorHandling(async () => {
    if (!isServerInitialized()) {
      await initServer();
    }
    const contractKey = params.contract.toLowerCase();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const pageSize = parseInt(searchParams.get('pageSize')) || config.contractDetails[contractKey]?.pageSize || 10;
    const address = searchParams.get('address');

    const { contractAddress, vaultAddress, abi, vaultAbi } = validateContractConfig(contractKey);

    const cacheState = await getCacheState(contractKey);
    const { status, holders } = await limit(() =>
      populateHoldersMapCache(contractKey, contractAddress, abi, vaultAddress, vaultAbi, false, address)
    );

    if (!holders) {
      logger.info('route', `Returning in-progress response for ${contractKey}`, 'eth', contractKey);
      return NextResponse.json(
        { status: 'in_progress', cacheState },
        { status: 202 }
      );
    }

    const totalBurned = (await getCache(`${contractKey.toLowerCase()}_holders`, contractKey.toLowerCase()))?.totalBurned || 0;
    const response = await formatHoldersResponse({
      contractKey,
      holders,
      cacheState,
      status,
      page,
      pageSize,
      address,
      totalBurned,
    });

    return NextResponse.json(response);
  }, { message: 'GET error', contractKey });
}