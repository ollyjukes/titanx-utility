// lib/store.js
'use client';
import { create } from 'zustand';

export const useFlareAuctionStore = create((set) => ({
  isFlareAuctionDay: false,
  nextFlareAuctionStart: null,
  setFlareAuctionDay: (isFlareAuctionDay, nextFlareAuctionStart) =>
    set({ isFlareAuctionDay, nextFlareAuctionStart }),
}));