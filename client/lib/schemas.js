import { z } from 'zod';

export const HoldersResponseSchema = z.object({
  holders: z.array(z.any()),
  totalPages: z.number(),
  totalTokens: z.number(),
  totalBurned: z.number().nullable(), // Allow null for Ascendant
  summary: z.object({
    totalLive: z.number(),
    totalBurned: z.number().nullable(), // Allow null for Ascendant
    totalMinted: z.number(),
    tierDistribution: z.array(z.number()),
    multiplierPool: z.number(),
  }).nullable(), // Allow null for Ascendant
  globalMetrics: z.object({}).optional(),
  contractKey: z.string().optional(), // Added for validation
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
  lastUpdated: z.number().nullable(),
  error: z.string().nullable(),
  errorLog: z.array(z.any()), // Flexible to handle various error log formats
  globalMetrics: z.object({}).optional(),
});