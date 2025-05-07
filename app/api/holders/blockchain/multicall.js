import pLimit from 'p-limit';
import { client } from '@/app/api/utils/client';
import { logger } from '@/app/lib/logger';
import config from '@/contracts/config';

const concurrencyLimit = pLimit(3);

export async function batchMulticall(calls, batchSize = config.alchemy.batchSize || 10) {
  const results = [];
  const delay = async () => new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs || 500));

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

          const batchResult = batchResults.map((result, index) => ({
            status: result.status === 'success' ? 'success' : 'failure',
            result: result.status === 'success' ? result.result : null,
            error: result.status === 'failure' ? result.error?.message || 'Unknown error' : null,
          }));
          return batchResult;
        } catch (error) {
          logger.error('blockchain/multicall', `Batch multicall failed: ${error.message}`, { stack: error.stack }, 'eth', 'general');
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