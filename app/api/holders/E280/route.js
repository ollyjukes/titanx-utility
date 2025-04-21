// app/api/holders/E280/route.js
import { NextResponse } from 'next/server';
import { log } from '../../utils';

export async function GET(request) {
  log('GET /api/holders/E280: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}

export async function POST(request) {
  log('POST /api/holders/E280: Contract not yet deployed');
  return NextResponse.json({ error: 'E280 contract not yet deployed' }, { status: 400 });
}