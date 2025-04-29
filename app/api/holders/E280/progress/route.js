// ./app/api/holders/E280/progress/route.js
import { NextResponse } from 'next/server';
import { log } from '@/app/api/utils';

export async function GET() {
  log(`[E280] [VALIDATION] E280 is disabled`);
  return NextResponse.json({
    isPopulating: false,
    totalLiveHolders: 0,
    totalOwners: 0,
    phase: 'Disabled',
    progressPercentage: '0.0',
    debugId: `state-e280-${Math.random().toString(36).slice(2)}`,
  });
}