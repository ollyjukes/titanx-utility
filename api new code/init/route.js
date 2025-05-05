// File: app/api/init/route.js
import { NextResponse } from 'next/server';
import { logger } from '@/app/lib/logger';
import { initializeCache } from '@/app/api new code/utils';
import chalk from 'chalk';

console.log(chalk.cyan('[Init Route] Importing logger and utils'));
logger.info('init', 'Init route module loaded', 'eth', 'general').catch(console.error);

export async function GET() {
  await logger.info('init', 'Init endpoint called', 'eth', 'general');
  await initializeCache();
  return NextResponse.json({
    message: 'Initialization triggered',
    debug: process.env.DEBUG,
    nodeEnv: process.env.NODE_ENV,
  });
}