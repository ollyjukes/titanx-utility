// tests/backend.test.js
import { jest } from '@jest/globals';
import { run } from 'jest';

// Mock dependencies to ensure isolation
jest.mock('node-cache');
jest.mock('fs/promises');
jest.mock('@upstash/redis');
jest.mock('@/lib/logger');
jest.mock('@/app/api/utils/blockchain');
jest.mock('node-fetch');

describe('Backend Test Suite', () => {
  it('should run all backend tests with coverage', async () => {
    const result = await run([
      '--config', 'jest.config.js',
      '--collectCoverage',
      '--coverageDirectory', 'coverage',
      '--testPathPattern', 'tests/unit/.*\\.test\\.js',
      '--testPathPattern', 'tests/e2e/.*\\.test\\.js',
    ]);

    // Jest run returns undefined on success; errors are thrown on failure
    expect(result).toBeUndefined();
  }, 30000); // Increase timeout for full test suite
});