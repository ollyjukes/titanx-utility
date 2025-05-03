import {
    retry,
    isValidAddress,
    normalizeAddress,
    formatNumber,
    timeout,
  } from '../app/api/utils/helpers.js';
  
  // Minimal test runner
  global.describe = (name, fn) => {
    console.log(`\n${name}`);
    fn();
  };
  
  global.it = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}: ${error.message}`);
      console.error(error.stack);
      process.exitCode = 1;
    }
  };
  
  global.expect = (actual) => ({
    toBe: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, but got ${actual}`);
      }
    },
    toThrow: (expected) => {
      try {
        actual();
        throw new Error('Expected function to throw, but it did not');
      } catch (error) {
        if (!error.message.includes(expected)) {
          throw new Error(`Expected error to include "${expected}", but got "${error.message}"`);
        }
      }
    },
    rejects: {
      toThrow: async (expected) => {
        try {
          await actual;
          throw new Error('Expected promise to reject, but it resolved');
        } catch (error) {
          if (!error.message.includes(expected)) {
            throw new Error(`Expected error to include "${expected}", but got "${error.message}"`);
          }
        }
      },
    },
  });
  
  describe('Helpers', () => {
    it('should retry on failure', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) throw new Error('Fail');
        return 'Success';
      };
      const result = await retry(fn, 2, () => 100);
      expect(result).toBe('Success');
      expect(attempts).toBe(2);
    });
  
    it('should validate Ethereum address', () => {
      expect(isValidAddress('0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA')).toBe(true);
      expect(isValidAddress('0xInvalid')).toBe(false);
    });
  
    it('should normalize address', () => {
      expect(normalizeAddress('0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA')).toBe(
        '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda'
      );
      expect(() => normalizeAddress('0xInvalid')).toThrow('Invalid Ethereum address');
    });
  
    it('should format number', () => {
      expect(formatNumber(1234567.89)).toBe('1,234,567.89');
      expect(formatNumber(null)).toBe('N/A');
    });
  
    it('should timeout after specified ms', async () => {
      await expect(timeout(100)).rejects.toThrow('Operation timed out after 100ms');
    });
  });