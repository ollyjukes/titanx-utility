import { logger } from '@/app/lib/logger';

export async function retry(operation, { retries = 3, delay = 1000, backoff = false } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.message.includes('429') && attempt === retries) {
        logger.error('utils/retry', `Circuit breaker: Rate limit exceeded after ${retries} attempts`, {}, 'eth', 'general');
        throw new Error('Rate limit exceeded');
      }
      logger.warn('utils/retry', `Retry attempt ${attempt}/${retries} failed: ${error.message}`, 'eth', 'general');
      const waitTime = backoff ? delay * Math.pow(2, attempt - 1) : delay * Math.min(attempt, 3);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw lastError;
}