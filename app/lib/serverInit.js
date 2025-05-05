// File: server/lib/serverInit.js
import { logger } from '@/app/lib/logger';
import { initializeCache } from '@/app/api new code/utils';
import chalk from 'chalk';

console.log(chalk.cyan('[ServerInit] Initializing server...'));

try {
  logger.info('serverInit', 'Server initialization started');
  await initializeCache();
} catch (error) {
  logger.error('serverInit', `Initialize cache error: ${error.message}`, { stack: error.stack });
  console.error(chalk.red('[ServerInit] Initialization error:'), error.message);
}

export const serverInit = true;