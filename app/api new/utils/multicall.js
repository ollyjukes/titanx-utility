// app/api/utils/multicall.js
import { client } from './blockchain.js';
import { logger } from '@/lib/logger.js';

export async function batchMulticall(calls, batchSize = 50) {
  logger.debug('multicall', `Processing ${calls.length} calls in batches of ${batchSize}`, 'eth', 'general');
  const results = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    try {
      const batchResults = await client.multicall({ contracts: batch });
      results.push(...batchResults);
      logger.debug('multicall', `Batch ${i}-${i + batchSize - 1} completed with ${batchResults.length} results`, 'eth', 'general');
    } catch (error) {
      logger.error('multicall', `Batch ${i}-${i + batchSize - 1} failed: ${error.message}`, { stack: error.stack }, 'eth', 'general');
      results.push(...batch.map(() => ({ status: 'failure', result: null })));
    }
  }
  logger.debug('multicall', `Completed with ${results.length} results`, 'eth', 'general');
  return results;
}