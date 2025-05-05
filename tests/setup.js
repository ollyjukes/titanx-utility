// tests/setup.js
import { config } from 'dotenv';
import path from 'path';
import { jest } from '@jest/globals';

config({ path: path.join(process.cwd(), '.env.local') });

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn().mockReturnValue(undefined),
    warn: jest.fn().mockReturnValue(undefined),
    error: jest.fn().mockReturnValue(undefined),
    debug: jest.fn().mockReturnValue(undefined),
  },
}));

jest.mock('chalk', () => ({
  green: (str) => str,
  yellow: (str) => str,
  red: (str) => str,
  blue: (str) => str,
  cyan: (str) => str,
}));

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  console.log.mockRestore();
  console.error.mockRestore();
});