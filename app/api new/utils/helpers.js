const defaultConfig = {
    alchemy: {
      maxRetries: 2,
      batchDelayMs: 500,
      retryMaxDelayMs: 10000,
    },
  };
  
  export async function retry(
    fn,
    attempts = defaultConfig.alchemy.maxRetries,
    delay = (retryCount) =>
      Math.min(
        defaultConfig.alchemy.batchDelayMs * 2 ** retryCount,
        defaultConfig.alchemy.retryMaxDelayMs
      )
  ) {
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (error) {
        console.error(`[Helpers] [ERROR] Retry ${i + 1}/${attempts}: ${error.message}`);
        if (i === attempts - 1) {
          throw new Error(`Failed after ${attempts} attempts: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay(i)));
      }
    }
  }
  
  export function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
  
  export function timeout(ms) {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    );
  }
  
  export function normalizeAddress(address) {
    if (!isValidAddress(address)) {
      throw new Error('Invalid Ethereum address');
    }
    return address.toLowerCase();
  }
  
  export function formatNumber(value, decimals = 2) {
    if (typeof value !== 'number') return 'N/A';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }