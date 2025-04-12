// lib/auctions/ascendant.js
'use client';
import { useEffect, useState } from 'react';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { tokenContracts, auctionABI, uniswapPoolABI } from '@/app/token_contracts';

export function useAscendantROI() {
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  const maxDays = 64;

  const auctionConfig = { address: tokenContracts.ASCENDANT_AUCTION.address, abi: auctionABI, chainId: 1 };
  const ascendDragonXConfig = { address: tokenContracts.ASCENDANT_DRAGONX.address, abi: uniswapPoolABI, chainId: 1 };
  const dragonXTitanXConfig = { address: tokenContracts.DRAGONX_TITANX.address, abi: uniswapPoolABI, chainId: 1 };
  const titanXWethConfig = { address: tokenContracts.TITANX_WETH.address, abi: uniswapPoolABI, chainId: 1 };
  const wethUsdcConfig = { address: tokenContracts.WETH_USDC.address, abi: uniswapPoolABI, chainId: 1 };

  const { data: startTimestamp, isLoading: startLoading, isError: startError, error: startErrorDetails } = useReadContract({
    ...auctionConfig,
    functionName: 'startTimestamp',
  });

  let currentDay = startTimestamp ? Math.floor((Date.now() / 1000 - Number(startTimestamp)) / (24 * 60 * 60)) : 0;
  currentDay = Math.max(0, Math.min(currentDay, maxDays - 1));

  const { data: dailyStats, isLoading: statsLoading, isError: statsError, error: statsErrorDetails } = useReadContract({
    ...auctionConfig,
    functionName: 'dailyStats',
    args: [currentDay],
  });

  const { data: ascendDragonXSlot0, isLoading: ascendDragonXSlot0Loading, isError: ascendDragonXSlot0Error, error: ascendDragonXSlot0ErrorDetails } = useReadContract({
    ...ascendDragonXConfig,
    functionName: 'slot0',
    cacheTime: 0,
  });

  const { data: ascendDragonXToken0, isLoading: ascendDragonXToken0Loading, isError: ascendDragonXToken0Error, error: ascendDragonXToken0ErrorDetails } = useReadContract({
    ...ascendDragonXConfig,
    functionName: 'token0',
  });

  const { data: dragonXTitanXSlot0, isLoading: dragonXTitanXSlot0Loading, isError: dragonXTitanXSlot0Error, error: dragonXTitanXSlot0ErrorDetails } = useReadContract({
    ...dragonXTitanXConfig,
    functionName: 'slot0',
    cacheTime: 0,
  });

  const { data: dragonXTitanXToken0, isLoading: dragonXTitanXToken0Loading, isError: dragonXTitanXToken0Error, error: dragonXTitanXToken0ErrorDetails } = useReadContract({
    ...dragonXTitanXConfig,
    functionName: 'token0',
  });

  const { data: titanXWethSlot0, isLoading: titanXWethSlot0Loading, isError: titanXWethSlot0Error, error: titanXWethSlot0ErrorDetails } = useReadContract({
    ...titanXWethConfig,
    functionName: 'slot0',
    cacheTime: 0,
  });

  const { data: titanXWethToken0, isLoading: titanXWethToken0Loading, isError: titanXWethToken0Error, error: titanXWethToken0ErrorDetails } = useReadContract({
    ...titanXWethConfig,
    functionName: 'token0',
  });

  const { data: wethUsdcSlot0, isLoading: wethUsdcSlot0Loading, isError: wethUsdcSlot0Error, error: wethUsdcSlot0ErrorDetails } = useReadContract({
    ...wethUsdcConfig,
    functionName: 'slot0',
    cacheTime: 0,
  });

  const { data: wethUsdcToken0, isLoading: wethUsdcToken0Loading, isError: wethUsdcToken0Error, error: wethUsdcToken0ErrorDetails } = useReadContract({
    ...wethUsdcConfig,
    functionName: 'token0',
  });

  const coreLoading = startLoading || statsLoading || ascendDragonXSlot0Loading || ascendDragonXToken0Loading || dragonXTitanXSlot0Loading || dragonXTitanXToken0Loading;
  const usdLoading = titanXWethSlot0Loading || titanXWethToken0Loading || wethUsdcSlot0Loading || wethUsdcToken0Loading;
  const coreError = startError || statsError || ascendDragonXSlot0Error || ascendDragonXToken0Error || dragonXTitanXSlot0Error || dragonXTitanXToken0Error;
  const usdError = titanXWethSlot0Error || titanXWethToken0Error || wethUsdcSlot0Error || wethUsdcToken0Error;

  const isLoading = coreLoading || usdLoading;
  const hasError = coreError || usdError;

  useEffect(() => {
    if (coreError && retryCount < maxRetries) {
      console.error(`[AscendantROI] Retrying due to core error, attempt ${retryCount + 1}`, {
        startError: startErrorDetails?.message,
        statsError: statsErrorDetails?.message,
        ascendDragonXSlot0Error: ascendDragonXSlot0ErrorDetails?.message,
        ascendDragonXToken0Error: ascendDragonXToken0ErrorDetails?.message,
        dragonXTitanXSlot0Error: dragonXTitanXSlot0ErrorDetails?.message,
        dragonXTitanXToken0Error: dragonXTitanXToken0ErrorDetails?.message,
      });
      setTimeout(() => setRetryCount(retryCount + 1), 2000);
    } else if (!coreError && retryCount > 0) {
      setRetryCount(0);
    }
  }, [coreError, retryCount, startErrorDetails, statsErrorDetails, ascendDragonXSlot0ErrorDetails, ascendDragonXToken0ErrorDetails, dragonXTitanXSlot0ErrorDetails, dragonXTitanXToken0ErrorDetails]);

  const getPoolPrice = (slot0, token0Address, token1Address, poolAddress) => {
    if (!slot0 || !slot0[0]) return { price: null, description: 'No data available' };
    const sqrtPriceX96 = BigInt(slot0[0]);
    const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
    let price = sqrtPrice * sqrtPrice; // token1/token0
    const isToken0USDC = token0Address?.toLowerCase() === tokenContracts.USDC.address.toLowerCase();
    const isToken1USDC = token1Address?.toLowerCase() === tokenContracts.USDC.address.toLowerCase();
    if (isToken0USDC) price = 1 / price;
    else if (isToken1USDC) price = price;
    return { price, description: `${token1Address}/${token0Address} from ${poolAddress}` };
  };

  let auctionAscendantPerTitanX = null;
  let marketAscendantPerTitanX = null;
  let ascendPerDragonX = null;
  let marketDragonXPerTitanX = null;
  let roi = null;
  let status = 'loading';

  if (!coreLoading && !coreError && dailyStats && ascendDragonXSlot0 && ascendDragonXToken0 && dragonXTitanXSlot0 && dragonXTitanXToken0) {
    const isAscendToken0 = ascendDragonXToken0.toLowerCase() === tokenContracts.ASCENDANT.address.toLowerCase();
    const ascendDragonXPriceInfo = getPoolPrice(ascendDragonXSlot0, ascendDragonXToken0, tokenContracts.DRAGONX.address, ascendDragonXConfig.address);
    ascendPerDragonX = isAscendToken0 ? ascendDragonXPriceInfo.price : ascendDragonXPriceInfo.price ? 1 / ascendDragonXPriceInfo.price : null;

    const isDragonXToken0 = dragonXTitanXToken0.toLowerCase() === tokenContracts.DRAGONX.address.toLowerCase();
    const dragonXTitanXPriceInfo = getPoolPrice(dragonXTitanXSlot0, dragonXTitanXToken0, tokenContracts.TITANX.address, dragonXTitanXConfig.address);
    marketDragonXPerTitanX = isDragonXToken0 ? (dragonXTitanXPriceInfo.price ? 1 / dragonXTitanXPriceInfo.price : null) : dragonXTitanXPriceInfo.price;

    if (ascendPerDragonX && marketDragonXPerTitanX) {
      marketAscendantPerTitanX = ascendPerDragonX * marketDragonXPerTitanX;
    }

    const tokenEmitted = dailyStats[2] ? Number(formatEther(BigInt(dailyStats[2]))) : 0;
    const titanXDeposited = dailyStats[0] ? Number(formatEther(BigInt(dailyStats[0]))) : 0;
    auctionAscendantPerTitanX = titanXDeposited > 0 ? tokenEmitted / titanXDeposited : null;

    roi = auctionAscendantPerTitanX && marketAscendantPerTitanX ? ((auctionAscendantPerTitanX / marketAscendantPerTitanX) * 100).toFixed(2) : null;
    status = roi ? 'success' : 'no_data';
  } else if (hasError) {
    status = 'error';
  }

  return {
    auctionAscendantPerTitanX,
    marketAscendantPerTitanX,
    ascendPerDragonX,
    marketDragonXPerTitanX,
    roi,
    isLoading,
    hasError,
    status,
  };
}