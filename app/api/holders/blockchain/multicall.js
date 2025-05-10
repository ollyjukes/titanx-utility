// app/api/holders/blockchain/multicall.js
import pLimit from 'p-limit';
import { client } from '@/app/api/utils/client';
import { logger } from '@/app/lib/logger';
import config from '@/app/contracts_nft';
import { BATCH_SIZE, BATCH_DELAY_MS } from '@/app/lib/constants';

const concurrencyLimit = pLimit(config.alchemy.concurrencyLimit || 100);

export async function batchMulticall(calls, batchSize = BATCH_SIZE) {
  const results = [];
  const delay = async () => new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));

  const batchPromises = [];
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    batchPromises.push(
      concurrencyLimit(async () => {
        try {
          await delay();
          const batchResults = await client.multicall({
            contracts: batch.map(call => ({
              address: call.address,
              abi: call.abi,
              functionName: call.functionName,
              args: call.args || [],
            })),
            allowFailure: true,
          });
          logger.debug('multicall', `Processed batch ${i}-${i + batchSize - 1}: ${batchResults.length} results`, 'ETH', 'general');
          return batchResults.map((result, index) => ({
            status: result.status === 'success' ? 'success' : 'failure',
            result: result.status === 'success' ? result.result : null,
            error: result.status === 'failure' ? result.error?.message || 'Unknown error' : null,
          }));
        } catch (error) {
          logger.error('multicall', `Batch failed ${i}-${i + batchSize - 1}: ${error.message}`, { stack: error.stack }, 'ETH', 'general');
          return batch.map(() => ({
            status: 'failure',
            result: null,
            error: error.message,
          }));
        }
      })
    );
  }

  const batchResults = (await Promise.all(batchPromises)).flat();
  results.push(...batchResults);
  return results;
}