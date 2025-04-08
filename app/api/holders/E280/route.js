// app/api/holders/E280/route.js
import { NextResponse } from 'next/server';
import { log } from '../../utils';

export async function GET(request) {
  log('GET /api/holders/E280: Data not available yet');
  return NextResponse.json({ message: 'E280 data will go live after deployment' });
}