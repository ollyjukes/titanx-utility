// File: lib/schemas.js
import { z } from 'zod';

export const HoldersResponseSchema = z.object({
  holders: z.array(z.object({
    wallet: z.string(),
    total: z.number().optional(),
    tiers: z.array(z.number()).optional(),
    shares: z.number().optional(),
  })),
  totalTokens: z.number().optional(),
  totalShares: z.number().optional(),
  totalBurned: z.number().optional(),
  summary: z.object({}).optional(),
  totalPages: z.number().optional(),
});