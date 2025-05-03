// app/api/utils/response.js
import { HoldersResponseSchema } from '@/lib/schemas';
import { logger } from '@/lib/logger.js';
import { sanitizeBigInt } from './serialization.js';

export function formatHoldersResponse({
  contractKey,
  holders,
  cacheState,
  status,
  page,
  pageSize,
  address,
  totalBurned,
}) {
  const totalItems = address ? holders.length : cacheState.totalOwners;
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = address ? 0 : (page - 1) * pageSize;
  const paginatedHolders = address ? holders : holders.slice(start, start + pageSize);

  const response = {
    holders: paginatedHolders,
    totalItems,
    totalPages,
    currentPage: page,
    pageSize,
    totalBurned,
    totalTokens: cacheState.progressState.totalNfts || 0,
    totalShares: contractKey === 'ascendant' ? cacheState.globalMetrics.totalShares || 0 : undefined,
    pendingRewards: contractKey === 'ascendant' ? cacheState.globalMetrics.pendingRewards || 0 : undefined,
    status,
    cacheState: sanitizeBigInt(cacheState),
  };

  const parsed = HoldersResponseSchema.safeParse(response);
  if (!parsed.success) {
    logger.error(
      'response',
      `Response validation failed: ${JSON.stringify(parsed.error)}`,
      { errors: parsed.error },
      'eth',
      contractKey
    );
    throw new Error('Invalid response format', { cause: parsed.error });
  }

  logger.info(
    'response',
    `Formatted response with ${paginatedHolders.length} holders for ${contractKey}, page ${page}`,
    'eth',
    contractKey
  );
  return parsed.data;
}