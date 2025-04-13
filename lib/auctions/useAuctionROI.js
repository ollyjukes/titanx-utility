// lib/auctions/useAuctionROI.js
'use client';
import { useMemo } from 'react';
import { useContractReadWithRetry } from '@/lib/hooks/useContractReadWithRetry';
import { getAuctionConfig } from '@/lib/auctions/config';
import { calculateFlareRates } from '@/lib/auctions/protocols/flare';
import { calculateAscendantRates } from '@/lib/auctions/protocols/ascendant';

const rateCalculators = {
  flare: calculateFlareRates,
  ascendant: calculateAscendantRates,
};

export function useAuctionROI(protocolKey) {
  const config = getAuctionConfig(protocolKey);
  if (!config) {
    console.error(`[useAuctionROI] Invalid protocol key: ${protocolKey}`);
    return { isLoading: false, hasError: true, status: 'error', data: null };
  }

  const maxDays = 64;
  const hasContract = config.auctionContract && config.auctionContract.address !== '0x0';

  const { data: startTimestamp, isLoading: startLoading, isError: startError, error: startErrorObj } = useContractReadWithRetry({
    config: hasContract ? { ...config.auctionContract, functionName: 'startTimestamp' } : {},
  });

  const currentDay = useMemo(() => {
    if (!hasContract) return 0;
    if (startTimestamp && Number(startTimestamp) > 0) {
      const secondsSinceStart = Math.floor(Date.now() / 1000) - Number(startTimestamp);
      const day = Math.floor(secondsSinceStart / (24 * 60 * 60));
      return Math.max(0, Math.min(day, maxDays - 1));
    }
    console.warn(`[${config.name}ROI] Invalid or missing startTimestamp, defaulting to maxDays - 1`, { error: startErrorObj?.message });
    return maxDays - 1;
  }, [startTimestamp, startErrorObj, config.name, hasContract]);

  const { data: dailyStats, isLoading: statsLoading, isError: statsError, error: statsErrorObj } = useContractReadWithRetry({
    config: hasContract ? { ...config.auctionContract, functionName: 'dailyStats', args: [BigInt(currentDay)] } : {},
  });

  const pairQueries = (config.pairs || []).reduce((acc, pair) => {
    pair.functions.forEach((func) => {
      const key = `${pair.key}.${func}`;
      acc[key] = useContractReadWithRetry({
        config: { ...pair.config, functionName: func, cacheTime: pair.cacheTime },
      });
    });
    return acc;
  }, {});

  const isLoading = startLoading || statsLoading || Object.values(pairQueries).some((q) => q.isLoading);
  const hasError = startError || statsError || Object.values(pairQueries).some((q) => q.isError);
  const errors = {
    startError: startErrorObj?.message,
    statsError: statsErrorObj?.message,
    ...Object.fromEntries(Object.entries(pairQueries).map(([key, q]) => [`${key}Error`, q.error?.message])),
  };

  const data = useMemo(() => {
    if (isLoading || hasError || !hasContract) {
      return { auctionRate: null, marketRate: null, secondaryRate: null, roi: null, marketDragonXPerTitanX: null };
    }
    const pairData = (config.pairs || []).reduce((acc, pair) => {
      acc[pair.key] = pair.functions.reduce((funcAcc, func) => {
        const query = pairQueries[`${pair.key}.${func}`];
        funcAcc[func] = query?.data;
        return funcAcc;
      }, {});
      return acc;
    }, {});
    try {
      const calculateRates = rateCalculators[protocolKey];
      return calculateRates ? calculateRates({ dailyStats, pairData }) : { auctionRate: null, marketRate: null, secondaryRate: null, roi: null, marketDragonXPerTitanX: null };
    } catch (error) {
      console.error(`[${config.name}ROI] Error calculating rates:`, error);
      return { auctionRate: null, marketRate: null, secondaryRate: null, roi: null, marketDragonXPerTitanX: null };
    }
  }, [dailyStats, pairQueries, config, isLoading, hasError, protocolKey]);

  const status = isLoading ? 'loading' : hasError ? 'error' : data.roi ? 'success' : 'no_data';

  return {
    isLoading,
    hasError,
    status,
    errors,
    data,
    protocol: config.name,
    externalUrl: config.externalUrl,
  };
}