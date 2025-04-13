// lib/auctions/ascendant.js
'use client';
import { useAuctionROI } from './useAuctionROI';

export function useAscendantROI() {
  return useAuctionROI('ascendant');
}