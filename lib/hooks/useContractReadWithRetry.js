// lib/hooks/useContractReadWithRetry.js
'use client';
import { useEffect, useState } from 'react';
import { useReadContract } from 'wagmi';

export function useContractReadWithRetry({ config, maxRetries = 3, retryDelay = 2000 }) {
  const [retryCount, setRetryCount] = useState(0);
  const { data, isLoading, isError, error, refetch } = useReadContract(config);

  useEffect(() => {
    if (isError && retryCount < maxRetries) {
      console.error(`[useContractReadWithRetry] Retrying ${config.functionName} at ${config.address}, attempt ${retryCount + 1}`, {
        error: error?.message,
      });
      const timeout = setTimeout(() => {
        setRetryCount((prev) => prev + 1);
        refetch();
      }, retryDelay);
      return () => clearTimeout(timeout);
    } else if (!isError && retryCount > 0) {
      setRetryCount(0);
    }
  }, [isError, retryCount, refetch, error, maxRetries, retryDelay, config.address, config.functionName]);

  return {
    data,
    isLoading,
    isError,
    error,
    retryCount,
  };
}