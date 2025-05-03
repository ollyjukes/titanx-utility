// app/api/utils/serverInit.js
import { initializeCache } from './cache.js';
import { logger } from '@/lib/logger';

let isInitialized = false;

export async function initServer() {
  if (isInitialized) {
    logger.debug('server', 'Server already initialized', 'eth', 'general');
    return;
  }
  try {
    const cacheInitialized = await initializeCache();
    if (!cacheInitialized) {
      logger.error('server', 'Cache initialization failed', {}, 'eth', 'general');
      throw new Error('Cache initialization failed');
    }
    logger.info('server', 'Cache initialized successfully', 'eth', 'general');
    isInitialized = true;
  } catch (error) {
    logger.error('server', `Server initialization failed: ${error.message}`, { stack: error.stack }, 'eth', 'general');
    throw error;
  }
}

export function isServerInitialized() {
  return isInitialized;
}