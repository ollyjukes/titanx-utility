// tests/unit/holders.test.js
import { jest } from '@jest/globals';
import { getHoldersMap, getOwnersForContract } from '@/app/api/utils/contracts';
import { populateHoldersMapCache } from '@/app/api/utils/holders';
import { HoldersResponseSchema } from '@/lib/schemas';
import NodeCache from 'node-cache';
import fs from 'fs/promises';
import config from '@/config';
import { logger } from '@/lib/logger';
import { client, alchemy } from '@/app/api/utils/blockchain';

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

jest.mock('p-limit', () => () => (fn) => fn());
jest.mock('chalk', () => ({
  green: jest.fn().mockImplementation((str) => str),
  yellow: jest.fn().mockImplementation((str) => str),
  red: jest.fn().mockImplementation((str) => str),
  blue: jest.fn().mockImplementation((str) => str),
  cyan: jest.fn().mockImplementation((str) => str),
}));

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
    getLogs: jest.fn().mockResolvedValue([
      {
        args: {
          from: '0x0000000000000000000000000000000000000000',
          to: '0x1234567890abcdef1234567890abcdef12345678',
          tokenId: BigInt(1),
        },
      },
    ]),
    readContract: jest.fn().mockImplementation(({ functionName }) => {
      if (functionName === 'totalSupply') return 100;
      if (functionName === 'totalBurned') return 10;
      return 0;
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

describe('Holder Utilities', () => {
  let mockNodeCacheInstance;
  let redis;

  beforeAll(async () => {
    const nodeCache = (await import('node-cache')).default;
    mockNodeCacheInstance = new nodeCache();
    redis = await import('@upstash/redis');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockNodeCacheInstance.set.mockReset().mockReturnValue(true);
    mockNodeCacheInstance.get.mockReset().mockReturnValue(undefined);
    mockNodeCacheInstance.del.mockReset().mockReturnValue(1);
    redis.clearMockRedis();
    fs.readFile.mockReset().mockRejectedValue({ code: 'ENOENT' });
    fs.writeFile.mockReset().mockResolvedValue(undefined);
  });

  it('should get holders map for ascendant contract', async () => {
    const contractKey = 'ascendant';
    const contractAddress = config.nftContracts.ascendant.address;
    const abi = config.abis.ascendant.main;
    const cacheState = {
      isPopulating: false,
      totalOwners: 0,
      totalLiveHolders: 0,
      progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
      lastUpdated: null,
      lastProcessedBlock: null,
      globalMetrics: {},
    };

    const result = await getHoldersMap(contractKey, contractAddress, abi, null, [], cacheState);
    expect(result.holdersMap.size).toBe(1);
    expect(result.holdersMap.get(1)).toEqual({ owner: '0x1234567890abcdef1234567890abcdef12345678', balance: 1 });
    expect(result.totalBurned).toBe(0);
    expect(result.lastBlock).toBe(21500000);
    expect(result.errorLog).toEqual([]);
    expect(client.getLogs).toHaveBeenCalledWith({
      address: contractAddress,
      event: expect.any(Object),
      fromBlock: BigInt(config.deploymentBlocks.ascendant.block),
      toBlock: 21500000n,
    });
    expect(fs.writeFile).toHaveBeenCalled(); // Cache state saved
  });

  it('should get holders map for element280 contract', async () => {
    const contractKey = 'element280';
    const contractAddress = config.nftContracts.element280.address;
    const abi = config.abis.element280.main;
    const cacheState = {
      isPopulating: false,
      totalOwners: 0,
      totalLiveHolders: 0,
      progressState: { step: 'idle', processedNfts: 0, totalNfts: 0, processedTiers: 0, totalTiers: 0, error: null, errorLog: [] },
      lastUpdated: null,
      lastProcessedBlock: null,
      globalMetrics: {},
    };

    const result = await getHoldersMap(contractKey, contractAddress, abi, null, [], cacheState);
    expect(result.holdersMap.size).toBe(1);
    expect(result.holdersMap.get('0x1234567890abcdef1234567890abcdef12345678')).toMatchObject({
      wallet: '0x1234567890abcdef1234567890abcdef12345678',
      tokenIds: [1],
      total: 1,
    });
    expect(result.totalBurned).toBe(10);
    expect(result.lastBlock).toBe(21500000);
    expect(result.errorLog).toEqual([]);
    expect(alchemy.nft.getOwnersForContract).toHaveBeenCalledWith(contractAddress, { withTokenBalances: true });
    expect(fs.writeFile).toHaveBeenCalled(); // Cache state saved
  });

  it('should get owners for contract', async () => {
    const contractAddress = config.nftContracts.element280.address;
    const abi = config.abis.element280.main;

    const owners = await getOwnersForContract(contractAddress, abi, { withTokenBalances: true });
    expect(owners).toEqual([
      {
        ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
        tokenBalances: [{ tokenId: 1, balance: 1 }],
      },
    ]);
    expect(alchemy.nft.getOwnersForContract).toHaveBeenCalledWith(contractAddress, { withTokenBalances: true, pageKey: null });
  });

  it('should handle alchemy error in getOwnersForContract', async () => {
    const contractAddress = config.nftContracts.element280.address;
    const abi = config.abis.element280.main;
    alchemy.nft.getOwnersForContract.mockRejectedValueOnce(new Error('Alchemy API error'));

    const owners = await getOwnersForContract(contractAddress, abi);
    expect(owners).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      'contracts',
      `Failed to fetch owners for ${contractAddress}: Alchemy API error`,
      expect.any(Object),
      'eth',
      'general'
    );
  });

  it('should cache valid holder data for all NFT collections', async () => {
    const collections = ['element280', 'element369', 'stax', 'ascendant'];
    const mockHolderData = (contract) => ({
      holders: [
        {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          tokenIds: [1],
          total: 1,
          tiers: contract === 'element280' ? [1, 0, 0, 0, 0, 0] :
                 contract === 'element369' ? [1, 0, 0] :
                 contract === 'stax' ? [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] :
                 [1, 0, 0, 0, 0, 0, 0, 0],
          multiplierSum: contract === 'element280' ? 10 :
                         contract === 'element369' ? 1 :
                         contract === 'stax' ? 1 :
                         1.01,
          percentage: 100,
          displayMultiplierSum: contract === 'element280' ? 0.1 : 1,
          rank: 1,
          ...(contract === 'element369' ? { infernoRewards: 0, fluxRewards: 0, e280Rewards: 0 } : {}),
          ...(contract === 'element280' || contract === 'stax' ? { claimableRewards: 0 } : {}),
          ...(contract === 'ascendant' ? {
            shares: 1,
            lockedAscendant: 0,
            pendingDay8: 0,
            pendingDay28: 0,
            pendingDay90: 0,
            claimableRewards: 0,
          } : {}),
        },
      ],
      totalBurned: 10,
      timestamp: 1234567890,
    });

    await import('@/app/api/utils/cache').then(({ initializeCache }) => initializeCache());

    for (const contract of collections) {
      const holderData = mockHolderData(contract);
      mockNodeCacheInstance.get.mockReturnValueOnce(holderData);
      fs.readFile.mockResolvedValueOnce(JSON.stringify({
        isPopulating: false,
        totalOwners: 1,
        totalLiveHolders: 1,
        progressState: { step: 'completed', processedNfts: 1, totalNfts: 100, processedTiers: 1, totalTiers: 100, error: null, errorLog: [] },
        lastUpdated: 1234567890,
        lastProcessedBlock: 21500000,
        globalMetrics: contract === 'ascendant' ? { totalShares: 1, pendingRewards: 0 } : {},
      }));

      const result = await populateHoldersMapCache(
        contract,
        config.nftContracts[contract].address,
        config.abis[contract].main,
        null,
        []
      );

      expect(result.status).toBe('up_to_date');
      expect(result.holders).toHaveLength(1);

      const cacheKey = `${contract}_holders`;
      const cachedData = await getCache(cacheKey, contract);
      expect(cachedData).toEqual(holderData);
      expect(mockNodeCacheInstance.set).toHaveBeenCalledWith(cacheKey, expect.any(Object), 0);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(`${contract}_holders.json`),
        expect.any(String)
      );

      if (contract === 'element280') {
        expect(redis.set).toHaveBeenCalledWith(cacheKey, JSON.stringify(holderData));
        expect(redis.expire).toHaveBeenCalledWith(cacheKey, 0);
      } else {
        expect(redis.set).not.toHaveBeenCalledWith(cacheKey, expect.any(String));
      }

      const response = {
        holders: cachedData.holders,
        totalItems: cachedData.holders.length,
        totalPages: 1,
        currentPage: 1,
        pageSize: 1000,
        totalBurned: cachedData.totalBurned,
        totalTokens: 100,
        ...(contract === 'ascendant' ? { totalShares: 1, pendingRewards: 0 } : {}),
        status: result.status,
        cacheState: {
          isPopulating: false,
          totalOwners: 1,
          totalLiveHolders: 1,
          progressState: {
            step: 'completed',
            processedNfts: 1,
            totalNfts: 100,
            processedTiers: 1,
            totalTiers: 100,
            error: null,
            errorLog: [],
          },
          lastUpdated: expect.any(Number),
          lastProcessedBlock: 21500000,
          globalMetrics: contract === 'ascendant' ? {
            totalTokens: 1,
            totalLockedAscendant: 0,
            totalShares: 1,
            toDistributeDay8: 0,
            toDistributeDay28: 0,
            toDistributeDay90: 0,
            pendingRewards: 0,
          } : {},
        },
      };
      const parsed = HoldersResponseSchema.safeParse(response);
      expect(parsed.success).toBe(true);
    }
  });
});