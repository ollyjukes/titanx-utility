import { z } from 'zod';

export const HoldersResponseSchema = z.object({
  holders: z.array(
    z.object({
      wallet: z.string(),
      tokenIds: z.array(z.number()),
      tiers: z.array(z.number()),
      total: z.number(),
      multiplierSum: z.number(),
      shares: z.number().optional(),
      lockedAscendant: z.number().optional(),
      claimableRewards: z.number().optional(),
      pendingDay8: z.number().optional(),
      pendingDay28: z.number().optional(),
      pendingDay90: z.number().optional(),
      infernoRewards: z.number().optional(),
      fluxRewards: z.number().optional(),
      e280Rewards: z.number().optional(),
      percentage: z.number().optional(),
      displayMultiplierSum: z.number().optional(),
      rank: z.number(),
      tokens: z.array(
        z.object({
          tokenId: z.number(),
          tier: z.number(),
          rawTier: z.number().optional(),
          rarityNumber: z.number(),
          rarity: z.number()
        })
      ).optional()
    })
  ),
  totalPages: z.number(),
  totalTokens: z.number(),
  totalBurned: z.number().nullable(),
  summary: z.object({
    totalLive: z.number(),
    totalBurned: z.number().nullable(),
    totalMinted: z.number(),
    tierDistribution: z.array(z.number()),
    multiplierPool: z.number(),
    rarityDistribution: z.array(z.number()).optional()
  }),
  globalMetrics: z.object({}).optional(),
  contractKey: z.string().optional(),
}).refine(
  (data) => {
    const contractKey = data.contractKey?.toLowerCase();
    if (['stax', 'element280', 'element369'].includes(contractKey)) {
      return typeof data.totalBurned === 'number' && data.totalBurned >= 0 && data.summary != null;
    }
    return true;
  },
  {
    message: 'totalBurned must be a non-negative number and summary must exist for stax, element280, and element369',
    path: ['totalBurned', 'summary'],
  }
);

export const ProgressResponseSchema = z.object({
  isPopulating: z.boolean(),
  totalLiveHolders: z.number(),
  totalOwners: z.number(),
  phase: z.string(),
  progressPercentage: z.string(),
  lastProcessedBlock: z.number().nullable(),
  lastUpdated: z.string().datetime().nullable(),
  error: z.string().nullable(),
  errorLog: z.array(z.any()),
  globalMetrics: z.object({}).optional(),
  isErrorLogTruncated: z.boolean().optional(),
  status: z.enum(['idle', 'pending', 'success', 'error']), // Added status field
});