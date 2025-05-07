import { logger } from '@/app/lib/logger';

export async function log(scope, message, chain = 'eth', collection = 'general') {
  await logger.info(scope, message, chain, collection);
}