// tests/unit/cache.test.js
import { jest } from '@jest/globals';
import NodeCache from 'node-cache';
import { Redis } from '@upstash/redis';
import fs from 'fs/promises';
import path from 'path';
import config from '@/config';
import { logger } from '@/lib/logger';
import { client } from '@/app/api/utils/blockchain';
import { parseAbiItem } from 'viem';

// Mock dependencies
jest.mock('node-cache', () => {
  const mockCache = {
    get: jest.fn(),
    set: jest.fn().mockReturnValue(true),
    del: jest.fn().mockReturnValue(1),
    flushAll: jest.fn(),
  };
  return jest.fn(() => mockCache);
});

jest.mock('@upstash/redis', () => ({
  Redis: {
    fromEnv: jest.fn(),
  },
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(null),
}));

jest.mock('viem', () => ({
  parseAbiItem: jest.fn().mockReturnValue({
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  }),
}));

jest.mock('@/app/api/utils/blockchain', () => ({
  client: {
    getBlockNumber: jest.fn().mockResolvedValue(BigInt(1000)),
    getLogs: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/config', () => ({
  cache: {
    nodeCache: {
      stdTTL: 3600,
      checkperiod: 120,
    },
    redis: {
      disableElement280: false,
      disableElement369: true,
      disableStax: true,
      disableAscendant: true,
      disableE280: true,
    },
  },
  contractDetails: {
    element280: { name: 'Element280', apiEndpoint: '/api/holders/Element280', pageSize: 100, disabled: false },
    ascendant: { name: 'Ascendant', apiEndpoint: '/api/holders/Ascendant', pageSize: 1000, disabled: false },
    e280: { name: 'E280', apiEndpoint: '/api/holders/E280', pageSize: 1000, disabled: true },
  },
  nftContracts: {
    element280: { address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9' },
  },
  burnAddress: '0x0000000000000000000000000000000000000000',
  deploymentBlocks: {
    element280: { block: '20945304' },
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    debug: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Cache Utilities', () => {
  let mockNodeCacheInstance;
  let mockRedisInstance;
  let cacheUtils;

  beforeEach(async () => {
    jest.resetModules(); // Clear module cache
    jest.clearAllMocks();

    mockNodeCacheInstance = {
      get: jest.fn(),
      set: jest.fn().mockReturnValue(true),
      del: jest.fn().mockReturnValue(1),
      flushAll: jest.fn(),
    };
    NodeCache.mockReturnValue(mockNodeCacheInstance);

    mockRedisInstance = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    Redis.fromEnv.mockReturnValue(mockRedisInstance);

    client.getBlockNumber.mockResolvedValue(BigInt(1000));
    client.getLogs.mockResolvedValue([]);
    fs.mkdir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue(null);

    // Set environment variables
    process.env.DEBUG = 'true';
    process.env.UPSTASH_REDIS_REST_URL = 'https://splendid-sunbird-26504.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'AWeIAAIjcDE5ODI2M2QyMGMzNWU0MmE1YWZmYjRhNTljZmQwMzU0YXAxMA';

    // Import cache module after mocks
    cacheUtils = await import('@/app/api/utils/cache');
    await cacheUtils.resetCache(); // Reset cache state
  });

  afterEach(() => {
    delete process.env.DEBUG;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  describe('initializeCache', () => {
    it('initializes node-cache with config settings', async () => {
      await cacheUtils.initializeCache();
      expect(NodeCache).toHaveBeenCalledWith({
        stdTTL: 3600,
        checkperiod: 120,
      });
      expect(Redis.fromEnv).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('cache', 'Redis initialized', 'eth', 'general');
    });

    it('throws error on Redis initialization failure', async () => {
      Redis.fromEnv.mockImplementationOnce(() => {
        throw new Error('Redis init failed');
      });
      await expect(cacheUtils.initializeCache()).rejects.toThrow('Redis init failed');
      expect(logger.error).toHaveBeenCalledWith(
        'cache',
        'Failed to initialize cache: Redis init failed',
        expect.any(Object),
        'eth',
        'general'
      );
    });
  });

  describe('getCache', () => {
    beforeEach(async () => {
      await cacheUtils.initializeCache();
    });

    it('returns cached data from node-cache if available', async () => {
      const key = 'test-key';
      const expectedData = { holders: [], totalTokens: 0 };
      mockNodeCacheInstance.get.mockReturnValue(expectedData);

      const result = await cacheUtils.getCache(key, 'element280');
      expect(mockNodeCacheInstance.get).toHaveBeenCalledWith(key);
      expect(result).toEqual(expectedData);
      expect(mockRedisInstance.get).not.toHaveBeenCalled();
    });

    it('fetches from Redis if node-cache is empty and Redis is enabled', async () => {
      const key = 'test-key';
      const expectedData = { holders: [], totalTokens: 0 };
      mockNodeCacheInstance.get.mockReturnValue(undefined);
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(expectedData));

      const result = await cacheUtils.getCache(key, 'element280');
      expect(mockNodeCacheInstance.get).toHaveBeenCalledWith(key);
      expect(mockRedisInstance.get).toHaveBeenCalledWith(key);
      expect(result).toEqual(expectedData);
      expect(mockNodeCacheInstance.set).toHaveBeenCalledWith(key, expectedData, 3600);
    });

    it('returns null if no data in node-cache or Redis', async () => {
      const key = 'test-key';
      mockNodeCacheInstance.get.mockReturnValue(undefined);
      mockRedisInstance.get.mockResolvedValue(null);

      const result = await cacheUtils.getCache(key, 'element280');
      expect(mockNodeCacheInstance.get).toHaveBeenCalledWith(key);
      expect(mockRedisInstance.get).toHaveBeenCalledWith(key);
      expect(result).toBeNull();
    });

    it('skips Redis for disabled collections', async () => {
      const key = 'test-key';
      mockNodeCacheInstance.get.mockReturnValue(undefined);

      const result = await cacheUtils.getCache(key, 'ascendant');
      expect(mockNodeCacheInstance.get).toHaveBeenCalledWith(key);
      expect(mockRedisInstance.get).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('setCache', () => {
    beforeEach(async () => {
      await cacheUtils.initializeCache();
    });

    it('sets data in node-cache', async () => {
      const key = 'test-key';
      const value = { holders: [], totalTokens: 0 };
      const ttl = 3600;

      await cacheUtils.setCache(key, value, ttl, 'element280');
      expect(mockNodeCacheInstance.set).toHaveBeenCalledWith(key, value, ttl);
      expect(mockRedisInstance.set).toHaveBeenCalledWith(key, JSON.stringify(value), { ex: ttl });
    });

    it('skips Redis for disabled collections', async () => {
      const key = 'test-key';
      const value = { holders: [], totalTokens: 0 };
      const ttl = 3600;

      await cacheUtils.setCache(key, value, ttl, 'ascendant');
      expect(mockNodeCacheInstance.set).toHaveBeenCalledWith(key, value, ttl);
      expect(mockRedisInstance.set).not.toHaveBeenCalled();
    });
  });

  describe('saveCacheState', () => {
    it('saves state to file', async () => {
      const collection = 'element280';
      const state = { totalOwners: 10 };
      const prefix = 'element280';
      const cacheDir = path.join(process.cwd(), 'cache');
      const filePath = path.join(cacheDir, `${prefix}_holders.json`);

      await cacheUtils.saveCacheState(collection, state, prefix);
      expect(fs.mkdir).toHaveBeenCalledWith(cacheDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(filePath, JSON.stringify(state, null, 2));
      expect(logger.debug).toHaveBeenCalledWith(
        'cache',
        `Saved cache state to file: ${filePath}`,
        'eth',
        collection
      );
    });

    it('handles file write error', async () => {
      const collection = 'element280';
      const state = { totalOwners: 10 };
      const prefix = 'element280';
      fs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      await cacheUtils.saveCacheState(collection, state, prefix);
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'cache',
        `Failed to save cache state for ${collection}: Write failed`,
        expect.any(Object),
        'eth',
        collection
      );
    });
  });

  describe('loadCacheState', () => {
    it('loads state from file', async () => {
      const collection = 'element280';
      const prefix = 'element280';
      const state = { totalOwners: 10 };
      const filePath = path.join(process.cwd(), 'cache', `${prefix}_holders.json`);
      fs.readFile.mockResolvedValueOnce(JSON.stringify(state));

      const result = await cacheUtils.loadCacheState(collection, prefix);
      expect(fs.readFile).toHaveBeenCalledWith(filePath, 'utf8');
      expect(result).toEqual(state);
    });

    it('returns null on file read error', async () => {
      const collection = 'element280';
      const prefix = 'element280';
      fs.readFile.mockRejectedValueOnce(new Error('File not found'));

      const result = await cacheUtils.loadCacheState(collection, prefix);
      expect(fs.readFile).toHaveBeenCalled();
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'cache',
        `Failed to load cache state for ${collection}: File not found`,
        expect.any(Object),
        'eth',
        collection
      );
    });
  });

  describe('getCacheState', () => {
    it('returns default state if no saved state', async () => {
      const contractKey = 'element280';
      fs.readFile.mockResolvedValueOnce(null);

      const result = await cacheUtils.getCacheState(contractKey);
      expect(result).toEqual({
        isPopulating: false,
        totalOwners: 0,
        totalLiveHolders: 0,
        progressState: {
          step: 'idle',
          processedNfts: 0,
          totalNfts: 0,
          processedTiers: 0,
          totalTiers: 0,
          error: null,
          errorLog: [],
        },
        lastUpdated: null,
        lastProcessedBlock: null,
        globalMetrics: {},
      });
    });

    it('loads saved state', async () => {
      const contractKey = 'element280';
      const savedState = {
        isPopulating: true,
        totalOwners: 100,
        totalLiveHolders: 90,
        progressState: {
          step: 'fetching_owners',
          processedNfts: 50,
          totalNfts: 1000,
          processedTiers: 10,
          totalTiers: 1000,
          error: null,
          errorLog: [],
        },
        lastUpdated: '2023-10-01T00:00:00.000Z',
        lastProcessedBlock: 20945304,
        globalMetrics: {},
      };
      fs.readFile.mockResolvedValueOnce(JSON.stringify(savedState));

      const result = await cacheUtils.getCacheState(contractKey);
      expect(fs.readFile).toHaveBeenCalled();
      expect(result).toEqual(savedState);
      expect(logger.debug).toHaveBeenCalledWith(
        'cache',
        `Loaded cache state: totalOwners=${savedState.totalOwners}, step=${savedState.progressState.step}`,
        'eth',
        contractKey
      );
    });
  });

  describe('saveCacheStateContract', () => {
    it('saves cache state', async () => {
      const contractKey = 'element280';
      const cacheState = { totalOwners: 10, progressState: { step: 'completed' } };

      await cacheUtils.saveCacheStateContract(contractKey, cacheState);
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        'cache',
        `Saved cache state: totalOwners=${cacheState.totalOwners}, step=${cacheState.progressState.step}`,
        'eth',
        contractKey
      );
    });

    it('handles save error', async () => {
      const contractKey = 'element280';
      const cacheState = { totalOwners: 10 };
      fs.writeFile.mockRejectedValueOnce(new Error('Write failed'));

      await cacheUtils.saveCacheStateContract(contractKey, cacheState);
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'cache',
        `Failed to save cache state: Write failed`,
        expect.any(Object),
        'eth',
        contractKey
      );
    });
  });

  describe('getNewEvents', () => {
    beforeEach(async () => {
      await cacheUtils.initializeCache();
    });

    it('returns cached events if available', async () => {
      const contractKey = 'element280';
      const contractAddress = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
      const fromBlock = 20945304;
      const errorLog = [];
      const cachedEvents = { burnedTokenIds: [1], transferTokenIds: [], lastBlock: 1000 };
      mockNodeCacheInstance.get.mockReturnValue(cachedEvents);

      const result = await cacheUtils.getNewEvents(contractKey, contractAddress, fromBlock, errorLog);
      expect(mockNodeCacheInstance.get).toHaveBeenCalledWith(
        `${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}`
      );
      expect(result).toEqual(cachedEvents);
      expect(client.getLogs).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'cache',
        `Events cache hit: ${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}, count: ${cachedEvents.burnedTokenIds.length + (cachedEvents.transferTokenIds?.length || 0)}`,
        'eth',
        contractKey
      );
    });

    it('fetches and caches new events', async () => {
      const contractKey = 'element280';
      const contractAddress = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
      const fromBlock = 20945304;
      const errorLog = [];
      const logs = [
        {
          args: {
            from: '0x1234567890abcdef1234567890abcdef12345678',
            to: '0x0000000000000000000000000000000000000000',
            tokenId: BigInt(1),
          },
          address: contractAddress,
          topics: ['0x', '0x', '0x'],
        },
        {
          args: {
            from: '0x1234567890abcdef1234567890abcdef12345678',
            to: '0x4567890abcdef1234567890abcdef1234567890',
            tokenId: BigInt(2),
          },
          address: contractAddress,
          topics: ['0x', '0x', '0x'],
        },
      ];
      client.getLogs.mockResolvedValueOnce(logs);

      const result = await cacheUtils.getNewEvents(contractKey, contractAddress, fromBlock, errorLog);
      expect(client.getLogs).toHaveBeenCalledWith({
        address: contractAddress,
        event: expect.any(Object),
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(1000),
      });
      expect(mockNodeCacheInstance.set).toHaveBeenCalledWith(
        `${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}`,
        {
          burnedTokenIds: [1],
          transferTokenIds: [
            {
              tokenId: 2,
              from: '0x1234567890abcdef1234567890abcdef12345678',
              to: '0x4567890abcdef1234567890abcdef1234567890',
            },
          ],
          lastBlock: 1000,
          timestamp: expect.any(Number),
        },
        3600
      );
      expect(result).toEqual({
        burnedTokenIds: [1],
        transferTokenIds: [
          {
            tokenId: 2,
            from: '0x1234567890abcdef1234567890abcdef12345678',
            to: '0x4567890abcdef1234567890abcdef1234567890',
          },
        ],
        lastBlock: 1000,
        timestamp: expect.any(Number),
      });
      expect(logger.info).toHaveBeenCalledWith(
        'cache',
        `Cached events: ${contractKey.toLowerCase()}_events_${contractAddress}_${fromBlock}, burns: 1, transfers: 1`,
        'eth',
        contractKey
      );
    });

    it('handles no new blocks', async () => {
      const contractKey = 'element280';
      const contractAddress = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
      const fromBlock = 1000;
      const errorLog = [];
      client.getBlockNumber.mockResolvedValueOnce(BigInt(1000));

      const result = await cacheUtils.getNewEvents(contractKey, contractAddress, fromBlock, errorLog);
      expect(result).toEqual({
        burnedTokenIds: [],
        transferTokenIds: [],
        lastBlock: 1000,
      });
      expect(client.getLogs).not.toHaveBeenCalled();
      expect(errorLog).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith(
        'cache',
        `No new blocks: fromBlock ${fromBlock} >= endBlock 1000`,
        'eth',
        contractKey
      );
    });

    it('handles fetch block number error', async () => {
      const contractKey = 'element280';
      const contractAddress = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
      const fromBlock = 20945304;
      const errorLog = [];
      client.getBlockNumber.mockRejectedValueOnce(new Error('Block fetch failed'));

      await expect(
        cacheUtils.getNewEvents(contractKey, contractAddress, fromBlock, errorLog)
      ).rejects.toThrow('Block fetch failed');
      expect(errorLog).toContainEqual({
        timestamp: expect.any(String),
        phase: 'fetch_block_number',
        error: 'Block fetch failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'cache',
        'Failed to fetch block number: Block fetch failed',
        expect.any(Object),
        'eth',
        contractKey
      );
    });

    it('handles fetch logs error', async () => {
      const contractKey = 'element280';
      const contractAddress = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
      const fromBlock = 20945304;
      const errorLog = [];
      client.getBlockNumber.mockResolvedValueOnce(BigInt(1000));
      client.getLogs.mockRejectedValueOnce(new Error('Logs fetch failed'));

      await expect(
        cacheUtils.getNewEvents(contractKey, contractAddress, fromBlock, errorLog)
      ).rejects.toThrow('Logs fetch failed');
      expect(errorLog).toContainEqual({
        timestamp: expect.any(String),
        phase: 'fetch_events',
        error: 'Logs fetch failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        'cache',
        'Failed to fetch events: Logs fetch failed',
        expect.any(Object),
        'eth',
        contractKey
      );
    });
  });
});