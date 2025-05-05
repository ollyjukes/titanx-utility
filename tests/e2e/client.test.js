// tests/e2e/client.test.js
import { jest } from '@jest/globals';
import { fetchCollectionData } from '@/lib/fetchCollectionData';
import config from '@/config';
import { logger } from '@/lib/logger';
import fetch from 'node-fetch';

// Mock dependencies
jest.mock('node-fetch');
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn().mockReturnValue(undefined),
    error: jest.fn().mockReturnValue(undefined),
    warn: jest.fn().mockReturnValue(undefined),
    debug: jest.fn().mockReturnValue(undefined),
  },
}));

describe('Client-Side Server Interactions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetch.mockReset();
  });

  describe('fetchCollectionData', () => {
    it('should fetch collection data after cache completion', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ phase: 'Idle', totalOwners: 0 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ phase: 'Completed', totalOwners: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            holders: [{ wallet: '0x1234567890abcdef1234567890abcdef12345678', total: 1 }],
            totalTokens: 100,
            totalBurned: 10,
            totalPages: 1,
          }),
        });

      const result = await fetchCollectionData('ascendant', '/api/holders/ascendant', 10);
      expect(result).toEqual({
        holders: [{ wallet: '0x1234567890abcdef1234567890abcdef12345678', total: 1 }],
        totalTokens: 100,
        totalShares: 0,
        totalBurned: 10,
        summary: {},
      });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/progress'), expect.any(Object));
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('page=0&pageSize=10'), expect.any(Object));
    });

    it('should handle disabled contract', async () => {
      const result = await fetchCollectionData('e280', '/api/holders/e280', 10);
      expect(result).toEqual({
        holders: [],
        totalTokens: 0,
        totalBurned: 0,
        error: 'Contract not deployed',
      });
    });

    it('should handle progress fetch failure', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      const result = await fetchCollectionData('ascendant', '/api/holders/ascendant', 10);
      expect(result).toEqual({
        holders: [],
        totalTokens: 0,
        totalBurned: 0,
        error: 'Failed to fetch cache progress',
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle timeout during polling', async () => {
      jest.useFakeTimers();
      fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ phase: 'Starting', progressPercentage: '10.0' }),
      });

      const fetchPromise = fetchCollectionData('ascendant', '/api/holders/ascendant', 10);
      jest.advanceTimersByTime(60000); // Simulate timeout (default 60s)
      const result = await fetchPromise;

      expect(result).toEqual({
        holders: [],
        totalTokens: 0,
        totalBurned: 0,
        error: 'Timed out waiting for cache to populate',
      });
      expect(fetch).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'fetchCollectionData',
        'Timed out waiting for cache to populate for ascendant',
        expect.any(Object)
      );

      jest.useRealTimers();
    });

    it('should handle invalid response schema', async () => {
      fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ phase: 'Completed', totalOwners: 1 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ holders: [{}] }), // Invalid holder data
        });

      const result = await fetchCollectionData('ascendant', '/api/holders/ascendant', 10);
      expect(result).toEqual({
        holders: [],
        totalTokens: 0,
        totalBurned: 0,
        error: 'Invalid response format',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'fetchCollectionData',
        expect.stringContaining('Response validation failed'),
        expect.any(Object)
      );
    });
  });
});