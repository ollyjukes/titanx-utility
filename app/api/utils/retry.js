// app/api/utils/retry.js
import { logger } from '@/app/lib/logger';
import config from '@/app/contracts_nft';

export async function retry(operation, { retries = config.alchemy.maxRetries, delay = config.alchemy.batchDelayMs, backoff = true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.message.includes('429')) {
        logger.error('retry', `Rate limit hit after ${attempt} attempts`, 'ETH', 'general');
        throw new Error('Rate limit exceeded');
      }
      logger.warn('retry', `Attempt ${attempt}/${retries} failed: ${error.message}`, 'ETH', 'general');
      const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}