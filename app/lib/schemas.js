// app/lib/schemas.js
import { z } from 'zod';

export const HolderSchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
  rank: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  multiplierSum: z.number().nonnegative(),
  displayMultiplierSum: z.number().nonnegative(),
  percentage: z.number().nonnegative(),
  tiers: z.array(z.number().int().nonnegative()),
  claimableRewards: z.number().nonnegative(),
  buyCount: z.number().int().nonnegative(),
  sellCount: z.number().int().nonnegative(),
  burnCount: z.number().int().nonnegative(),
  boughtNfts: z.array(
    z.object({
      tokenId: z.number().int().positive(),
      transactionHash: z.string(),
      timestamp: z.number().int().nonnegative(),
    })
  ),
  soldNfts: z.array(
    z.object({
      tokenId: z.number().int().positive(),
      transactionHash: z.string(),
      timestamp: z.number().int().nonnegative(),
    })
  ),
  burnedNfts: z.array(
    z.object({
      tokenId: z.number().int().positive(),
      transactionHash: z.string(),
      timestamp: z.number().int().nonnegative(),
    })
  ),
  tokenIds: z.array(z.number().int().positive()).optional(),
  shares: z.number().nonnegative().optional(),
  lockedAscendant: z.number().nonnegative().optional(),
  pendingDay8: z.number().nonnegative().optional(),
  pendingDay28: z.number().nonnegative().optional(),
  pendingDay90: z.number().nonnegative().optional(),
  infernoRewards: z.number().nonnegative().optional(),
  fluxRewards: z.number().nonnegative().optional(),
  e280Rewards: z.number().nonnegative().optional(),
  tokens: z
    .array(
      z.object({
        tokenId: z.number().int().positive(),
        tier: z.number().int().positive(),
        rarityNumber: z.number().nonnegative(),
        rarity: z.number().int().positive(),
      })
    )
    .optional(),
});

export const HoldersResponseSchema = z
  .object({
    status: z.enum(['success', 'pending']),
    holders: z.array(HolderSchema),
    totalPages: z.number().int().positive(),
    totalTokens: z.number().int().nonnegative(),
    totalBurned: z.number().int().nonnegative(),
    lastBlock: z.number().int().nonnegative(),
    errorLog: z.array(
      z.object({
        timestamp: z.string(),
        phase: z.string(),
        error: z.string(),
        fromBlock: z.number().int().nonnegative().optional(),
        toBlock: z.number().int().nonnegative().optional(),
        tokenId: z.number().int().positive().optional(),
        wallet: z.string().optional(),
        chunk: z.number().int().positive().optional(),
      })
    ),
    contractKey: z.string(),
    summary: z.object({
      totalLive: z.number().int().nonnegative(),
      totalBurned: z.number().int().nonnegative(),
      totalMinted: z.number().int().nonnegative(),
      totalE280Burned: z.number().nonnegative().optional(),
      totalRewardsPaid: z.number().nonnegative().optional(),
      totalRewardPool: z.number().nonnegative().optional(),
      tierDistribution: z.array(z.number().int().nonnegative()),
      multiplierPool: z.number().nonnegative(),
      rarityDistribution: z.array(z.number().int().nonnegative()).optional(),
    }),
    transferSummary: z
      .object({
        buyCount: z.number().int().nonnegative(),
        sellCount: z.number().int().nonnegative(),
        burnCount: z.number().int().nonnegative(),
      })
      .optional(),
    globalMetrics: z
      .object({
        totalMinted: z.number().int().nonnegative(),
        totalLive: z.number().int().nonnegative(),
        totalBurned: z.number().int().nonnegative(),
        tierDistribution: z.array(z.number().int().nonnegative()),
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.contractKey.toLowerCase() === 'element280') {
        return data.totalBurned >= 0 && data.summary.totalBurned >= 0;
      }
      return true;
    },
    {
      message: 'totalBurned and summary.totalBurned must be non-negative for element280',
      path: ['totalBurned', 'summary.totalBurned'],
    }
  );

export const ProgressResponseSchema = z.object({
  isPopulating: z.boolean(),
  totalOwners: z.number().int().nonnegative(),
  totalLiveHolders: z.number().int().nonnegative(),
  progressState: z.object({
    step: z.string(),
    processedNfts: z.number().int().nonnegative(),
    totalNfts: z.number().int().nonnegative(),
    processedTiers: z.number().int().nonnegative(),
    totalTiers: z.number().int().nonnegative(),
    error: z.string().nullable(),
    errorLog: z.array(
      z.object({
        timestamp: z.string(),
        phase: z.string(),
        error: z.string(),
        fromBlock: z.number().int().nonnegative().optional(),
        toBlock: z.number().int().nonnegative().optional(),
        tokenId: z.number().int().positive().optional(),
        wallet: z.string().optional(),
        chunk: z.number().int().positive().optional(),
      })
    ),
    progressPercentage: z.string().regex(/^\d{1,3}%$/, 'Invalid percentage format'),
    totalLiveHolders: z.number().int().nonnegative(),
    totalOwners: z.number().int().nonnegative(),
    lastProcessedBlock: z.number().int().nonnegative().nullable(),
    lastUpdated: z.number().int().nonnegative().nullable(),
    isPopulating: z.boolean().optional(),
    status: z.string(),
  }),
  lastUpdated: z.number().int().nonnegative().nullable(),
  lastProcessedBlock: z.number().int().nonnegative().nullable(),
  globalMetrics: z.object({
    totalMinted: z.number().int().nonnegative().optional(),
    totalLive: z.number().int().nonnegative().optional(),
    totalBurned: z.number().int().nonnegative().optional(),
    tierDistribution: z.array(z.number().int().nonnegative()).optional(),
  }),
});