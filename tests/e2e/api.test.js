// tests/e2e/api.test.js
import { jest } from '@jest/globals';
import request from 'supertest';
import { initializeCache } from '@/app/api/utils/cache';
import { createServer } from 'next';
import { parse } from 'url';
import { HoldersResponseSchema } from '@/lib/schemas';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import { logger } from '@/lib/logger';
import { client } from '@/app/api/utils/blockchain';
import config from '@/config';

// Mock dependencies
jest.mock('node-cache', () => {
  const mockCache = {
    set: jest.fn().mockReturnValue(true),
    get: jest.fn().mockReturnValue(undefined),
    del: jest.fn().mockReturnValue(1),
  };
  return jest.fn(() => mockCache);
});

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  chmod: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
  access: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
  appendFile: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@upstash/redis', () => {
  const mockRedisData = new Map();
  let mockQuotaExceeded = false;

  const mockRedis = {
    get: jest.fn().mockImplementation(async (key) => {
      if (mockQuotaExceeded) throw new Error('Redis quota exceeded');
      return mockRedisData.get(key) || null;
    }),
    set: jest.fn().mockImplementation(async (key, value) => {
      if (mockQuotaExceeded) throw new Error('Redis quota exceeded');
      mockRedisData.set(key, value);
      return 'OK';
    }),
    expire: jest.fn().mockImplementation(async () => {
      if (mockQuotaExceeded) throw new Error('Redis quota exceeded');
      return 1;
    }),
    del: jest.fn().mockImplementation(async (key) => {
      if (mockQuotaExceeded) throw new Error('Redis quota exceeded');
      return mockRedisData.delete(key) ? 1 : 0;
    }),
  };

  return {
    Redis: {
      fromEnv: jest.fn(() => mockRedis),
    },
    clearMockRedis: jest.fn(() => mockRedisData.clear()),
    setMockQuotaExceeded: jest.fn((state) => {
      mockQuotaExceeded = state;
    }),
  };
});

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn().mockReturnValue(undefined),
    error: jest.fn().mockReturnValue(undefined),
    warn: jest.fn().mockReturnValue(undefined),
    debug: jest.fn().mockReturnValue(undefined),
  },
}));

jest.mock('@/app/api/utils/blockchain', () => ({
  client: {
    getBlockNumber: jest.fn().mockResolvedValue(21500000n),
    getLogs: jest.fn().mockResolvedValue([]),
    readContract: jest.fn().mockImplementation(({ functionName }) => {
      if (functionName === 'totalSupply') return 100;
      if (functionName === 'totalBurned') return 10;
      if (functionName === 'totalShares') return BigInt(1000000000000000000);
      if (functionName === 'toDistribute') return BigInt(0);
      return 0;
    }),
    multicall: jest.fn().mockResolvedValue([]),
    getTransactionReceipt: jest.fn().mockResolvedValue({
      logs: [
        {
          address: config.nftContracts.element280.address,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x0000000000000000000000001234567890abcdef1234567890abcdef12345678',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
          ],
          data: '0x0000000000000000000000000000000000000000000000000000000000000001',
          blockNumber: BigInt(21500000),
        },
      ],
      blockNumber: BigInt(21500000),
    }),
    decodeEventLog: jest.fn().mockReturnValue({
      args: {
        from: '0x1234567890abcdef1234567890abcdef12345678',
        to: config.burnAddress,
        tokenId: BigInt(1),
      },
    }),
  },
  alchemy: {
    nft: {
      getOwnersForContract: jest.fn().mockResolvedValue({
        owners: [
          {
            ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
            tokenBalances: [{ tokenId: '1', balance: '1' }],
          },
        ],
      }),
    },
  },
}));

// Mock Next.js app
const app = createServer(async (req, res) => {
  const parsedUrl = parse(req.url, true);
  const { pathname, query } = parsedUrl;

  if (pathname === '/api/init') {
    const { GET } = await import('@/app/api/init/route');
    return GET(req);
  } else if (pathname.startsWith('/api/holders/')) {
    if (pathname.endsWith('/progress')) {
      const { GET } = await import('@/app/api/holders/[contract]/progress/route');
      return GET(req, { params: { contract: pathname.split('/')[3] } });
    } else if (pathname.includes('/validate-burned')) {
      const { POST } = await import('@/app/api/holders/Element280/validate-burned/route');
      return POST(req);
    } else {
      const { GET } = await import('@/app/api/holders/[contract]/route');
      return GET(req, { params: { contract: pathname.split('/')[3] } });
    }
  } else if (pathname === '/api/debug') {
    const { GET } = await import('@/app/api/debug/route');
    return GET(req);
  } else {
    res.statusCode = 404;
    res.end('Not Found');
  }
});

describe('API Routes', () => {
  let mockNodeCacheInstance;
  let redis;

  beforeAll(async () => {
    const nodeCache = (await import('node-cache')).default;
    mockNodeCacheInstance = new nodeCache();
    redis = await import('@upstash/redis');
    await initializeCache();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockNodeCacheInstance.set.mockReset().mockReturnValue(true);
    mockNodeCacheInstance.get.mockReset().mockReturnValue(undefined);
    mockNodeCacheInstance.del.mockReset().mockReturnValue(1);
    redis.clearMockRedis();
    fs.readFile.mockReset().mockRejectedValue({ code: 'ENOENT' });
    fs.writeFile.mockReset().mockResolvedValue(undefined);
  });

  describe('GET /api/init', () => {
    it('should initialize cache and return status', async () => {
      const response = await request(app).get('/api/init');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Initialization triggered',
        debug: undefined,
        nodeEnv: undefined,
      });
      expect(logger.info).toHaveBeenCalledWith('init', 'Init endpoint called', 'eth', 'general');
    });
  });

  describe('GET /api/holders/[contract]', () => {
    it('should return holders for ascendant contract', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        isPopulating: false,
        totalOwners: 0,
        totalLiveHolders: 0,
        progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
        lastUpdated: null,
        lastProcessedBlock: null,
        globalMetrics: {},
      }));

      const response = await request(app)
        .get('/api/holders/ascendant')
        .query({ page: 1, pageSize: 10 });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        holders: expect.any(Array),
        totalItems: expect.any(Number),
        totalPages: expect.any(Number),
        currentPage: 1,
        pageSize: 10,
        totalBurned: expect.any(Number),
        totalTokens: expect.any(Number),
        totalShares: expect.any(Number),
        pendingRewards: expect.any(Number),
        status: 'populated',
        cacheState: expect.any(Object),
      });
      expect(HoldersResponseSchema.safeParse(response.body).success).toBe(true);
    });

    it('should return 400 for invalid contract', async () => {
      const response = await request(app)
        .get('/api/holders/invalid')
        .query({ page: 1, pageSize: 10 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid contract: invalid' });
    });

    it('should return 202 for cache in progress', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        isPopulating: true,
        totalOwners: 0,
        totalLiveHolders: 0,
        progressState: { step: 'starting', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
        lastUpdated: null,
        lastProcessedBlock: null,
        globalMetrics: {},
      }));

      const response = await request(app)
        .get('/api/holders/ascendant')
        .query({ page: 1, pageSize: 10 });

      expect(response.status).toBe(202);
      expect(response.body).toEqual({
        status: 'in_progress',
        cacheState: expect.any(Object),
      });
    });

    it('should filter by address', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        isPopulating: false,
        totalOwners: 0,
        totalLiveHolders: 0,
        progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
        lastUpdated: null,
        lastProcessedBlock: null,
        globalMetrics: {},
      }));

      const response = await request(app)
        .get('/api/holders/ascendant')
        .query({ page: 1, pageSize: 10, address: '0x1234567890abcdef1234567890abcdef12345678' });

      expect(response.status).toBe(200);
      expect(response.body.holders).toHaveLength(1);
      expect(response.body.holders[0].wallet).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(HoldersResponseSchema.safeParse(response.body).success).toBe(true);
    });
  });

  describe('GET /api/holders/[contract]/progress', () => {
    it('should return progress state', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        isPopulating: false,
        totalOwners: 1,
        totalLiveHolders: 1,
        progressState: { step: 'completed', processedNfts: 1, totalNfts: 100, processedTiers: 1, totalTiers: 100, error: null, errorLog: [] },
        lastUpdated: 1234567890,
        lastProcessedBlock: 21500000,
        globalMetrics: {},
      }));

      const response = await request(app).get('/api/holders/ascendant/progress');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        isPopulating: false,
        totalLiveHolders: 1,
        totalOwners: 1,
        phase: 'Completed',
        progressPercentage: '100.0',
        lastProcessedBlock: 21500000,
        error: null,
        errorLog: [],
      });
    });

    it('should return 400 for invalid contract', async () => {
      const response = await request(app).get('/api/holders/invalid/progress');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid contract: invalid' });
    });

    it('should return error state', async () => {
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        isPopulating: false,
        totalOwners: 0,
        totalLiveHolders: 0,
        progressState: { step: 'error', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: 'Test error', errorLog: [{ error: 'Test error' }] },
        lastUpdated: null,
        lastProcessedBlock: null,
        globalMetrics: {},
      }));

      const response = await request(app).get('/api/holders/ascendant/progress');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        isPopulating: false,
        totalLiveHolders: 0,
        totalOwners: 0,
        phase: 'Error',
        progressPercentage: '0.0',
        error: 'Test error',
        errorLog: [{ error: 'Test error' }],
      });
    });
  });

  describe('POST /api/holders/Element280/validate-burned', () => {
    it('should validate burned transaction', async () => {
      const response = await request(app)
        .post('/api/holders/Element280/validate-burned')
        .send({ transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        burnedTokenIds: ['1'],
        blockNumber: '21500000',
      });
      expect(client.getTransactionReceipt).toHaveBeenCalledWith({
        hash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      });
      expect(mockNodeCacheInstance.set).toHaveBeenCalled();
    });

    it('should return 400 for invalid transaction hash', async () => {
      const response = await request(app)
        .post('/api/holders/Element280/validate-burned')
        .send({ transactionHash: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid transaction hash' });
    });

    it('should return 404 for missing transaction', async () => {
      client.getTransactionReceipt.mockResolvedValueOnce(null);
      const response = await request(app)
        .post('/api/holders/Element280/validate-burned')
        .send({ transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Transaction not found' });
    });

    it('should return 400 for no burn events', async () => {
      client.getTransactionReceipt.mockResolvedValueOnce({ logs: [], blockNumber: BigInt(21500000) });
      const response = await request(app)
        .post('/api/holders/Element280/validate-burned')
        .send({ transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'No burn events found in transaction' });
    });
  });

  describe('GET /api/debug', () => {
    it('should return debug info', async () => {
      const response = await request(app).get('/api/debug');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        message: 'Debug endpoint triggered',
        debug: undefined,
        nodeEnv: undefined,
      });
      expect(logger.info).toHaveBeenCalledWith('debug', 'Debug endpoint called');
    });
  });
});