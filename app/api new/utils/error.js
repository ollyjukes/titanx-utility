// app/api/utils/error.js
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger.js';

export async function withErrorHandling(handler, context) {
  try {
    return await handler();
  } catch (error) {
    logger.error(
      'route',
      `${context.message}: ${error.message}`,
      { stack: error.stack, cause: error.cause },
      'eth',
      context.contractKey
    );
    return NextResponse.json(
      { error: error.message, details: error.cause || undefined },
      { status: error.cause?.status || 500 }
    );
  }
}