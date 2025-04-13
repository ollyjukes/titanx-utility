// lib/auctions/flare.js
'use client';
import { useAuctionROI } from './useAuctionROI';

export function useFlareROI() {
  return useAuctionROI('flare');
}