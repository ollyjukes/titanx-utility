// tests/unit/utils.test.js
import { jest } from '@jest/globals';
import { validateContractConfig } from '@/app/api/utils/config';
import { withErrorHandling } from '@/app/api/utils/error';
import { batchMulticall } from '@/app/api/utils/multicall';
import { initServer, isServerInitialized } from '@/app/api/utils/serverInit';
import { logger } from '@/lib/logger';
import { client } from '@/app/api/utils/blockchain';
import config from '@/config';
import { NextResponse } from 'next/server';

// Mock dependencies
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
    multicall: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/app/api/utils/cache', () => ({
  initializeCache: jest.fn().mockResolvedValue(true),
}));

describe('Utility Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateContractConfig', () => {
    it('should validate valid contract config', () => {
      const contractKey = 'element280';
      const result = validateContractConfig(contractKey);
      expect(result).toEqual({
        contractAddress: config.nftContracts.element280.address,
        vaultAddress: undefined,
        abi: config.abis.element280.main,
        vaultAbi: config.abis.element280.vault || [],
      });
    });

    it('should throw for invalid contract', () => {
      expect(() => validateContractConfig('invalid')).toThrow('Invalid contract: invalid');
      expect(logger.error).toHaveBeenCalledWith(
        'config',
        'Invalid contract: invalid',
        expect.any(Object),
        'eth',
        'invalid'
      );
    });

    it('should throw for disabled contract', () => {
      expect(() => validateContractConfig('e280')).toThrow('Contract e280 is disabled');
      expect(logger.warn).toHaveBeenCalledWith(
        'config',
        'Contract e280 is disabled',
        expect.any(Object),
        'eth',
        'e280'
      );
    });
  });

  describe('withErrorHandling', () => {
    it('should handle successful handler', async () => {
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ success: true }));
      const context = { message: 'Test handler', contractKey: 'element280' };
      const result = await withErrorHandling(handler, context);
      expect(result).toEqual(NextResponse.json({ success: true }));
      expect(handler).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Test error'));
      const context = { message: 'Test handler', contractKey: 'element280' };
      const result = await withErrorHandling(handler, context);
      expect(result.status).toBe(500);
      expect(result.body).toEqual({ error: 'Test error' });
      expect(logger.error).toHaveBeenCalledWith(
        'route',
        'Test handler: Test error',
        expect.any(Object),
        'eth',
        'element280'
      );
    });
  });

  describe('batchMulticall', () => {
    it('should process multicall batch', async () => {
      const calls = [
        { address: '0x1', abi: [], functionName: 'test', args: [] },
        { address: '0x2', abi: [], functionName: 'test', args: [] },
      ];
      client.multicall.mockResolvedValue([{ status: 'success', result: 42 }, { status: 'success', result: 43 }]);
      const results = await batchMulticall(calls, 1);
      expect(results).toEqual([{ status: 'success', result: 42 }, { status: 'success', result: 43 }]);
      expect(client.multicall).toHaveBeenCalledTimes(2);
      expect(logger.debug).toHaveBeenCalledWith('multicall', expect.any(String), 'eth', 'general');
    });

    it('should handle multicall errors', async () => {
      const calls = [{ address: '0x1', abi: [], functionName: 'test', args: [] }];
      client.multicall.mockRejectedValueOnce(new Error('Multicall error'));
      const results = await batchMulticall(calls);
      expect(results).toEqual([{ status: 'failure', result: null }]);
      expect(logger.error).toHaveBeenCalledWith(
        'multicall',
        'Batch 0-49 failed: Multicall error',
        expect.any(Object),
        'eth',
        'general'
      );
    });
  });

  describe('Server Initialization', () => {
    it('should initialize server', async () => {
      const { initializeCache } = require('@/app/api/utils/cache');
      initializeCache.mockResolvedValue(true);
      await initServer();
      expect(initializeCache).toHaveBeenCalled();
      expect(isServerInitialized()).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('server', 'Cache initialized successfully', 'eth', 'general');
    });

    it('should handle cache initialization failure', async () => {
      const { initializeCache } = require('@/app/api/utils/cache');
      initializeCache.mockResolvedValue(false);
      await expect(initServer()).rejects.toThrow('Cache initialization failed');
      expect(logger.error).toHaveBeenCalledWith(
        'server',
        'Cache initialization failed',
        expect.any(Object),
        'eth',
        'general'
      );
    });

    it('should skip initialization if already initialized', async () => {
      const { initializeCache } = require('@/app/api/utils/cache');
      initializeCache.mockReset();
      await initServer();
      await initServer();
      expect(initializeCache).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith('server', 'Server already initialized', 'eth', 'general');
    });
  });
});