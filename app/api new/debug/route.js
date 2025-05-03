import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

console.log('[Debug Route] Importing logger');
logger.info('debug', 'Debug route module loaded').catch(console.error);

export async function GET() {
  await logger.info('debug', 'Debug endpoint called');
  return NextResponse.json({
    message: 'Debug endpoint triggered',
    debug: process.env.DEBUG,
    nodeEnv: process.env.NODE_ENV,
  });
}