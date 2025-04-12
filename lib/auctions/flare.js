// lib/auctions/flare.js
'use client';
import { useEffect, useState } from 'react';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { tokenContracts, auctionABI, flareTokenABI, uniswapPoolABI, uniswapV2PoolABI } from '@/app/token_contracts';

export function useFlareROI() {
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;
  const maxDays = 64;

  const auctionConfig = { address: tokenContracts.FLARE_AUCTION.address, abi: auctionABI, chainId: 1 };
  const flareTokenConfig = { address: tokenContracts.FLARE.address, abi: flareTokenABI, chainId: 1 };
  const flareX28Config = { address: tokenContracts.FLARE_X28.address, abi: uniswapV2PoolABI, chainId: 1 };
  const x28TitanXConfig = { address: tokenContracts.X28_TITANX.address, abi: uniswapPoolABI, chainId: 1 };
  const titanXWethConfig = { address: tokenContracts.TITANX_WETH.address, abi: uniswapPoolABI, chainId: 1 };
  const wethUsdcConfig = { address: tokenContracts.WETH_USDC.address, abi: uniswapPoolABI, chainId: 1 };

  const { data: flareX28PoolAddress, isLoading: flareX28PoolLoading, isError: flareX28PoolError, error: flareX28PoolErrorDetails } = useReadContract({
    ...flareTokenConfig,
    functionName: 'x28FlarePool',
  });
  const flareX28PoolConfig = { address: flareX28PoolAddress || tokenContracts.FLARE_X28.address, abi: uniswapV2PoolABI, chainId: 1 };

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

  const { data: flareX28Reserves, isLoading: flareX28ReservesLoading, isError: flareX28ReservesError, error: flareX28ReservesErrorDetails } = useReadContract({
    ...flareX28PoolConfig,
    functionName: 'getReserves',
  });

  const { data: flareX28Token0, isLoading: flareX28Token0Loading, isError: flareX28Token0Error, error: flareX28Token0ErrorDetails } = useReadContract({
    ...flareX28PoolConfig,
    functionName: 'token0',
  });

  const { data: x28TitanXSlot0, isLoading: x28TitanXSlot0Loading, isError: x28TitanXSlot0Error, error: x28TitanXSlot0ErrorDetails } = useReadContract({
    ...x28TitanXConfig,
    functionName: 'slot0',
    cacheTime: 0,
  });

  const { data: x28TitanXToken0, isLoading: x28TitanXToken0Loading, isError: x28TitanXToken0Error, error: x28TitanXToken0ErrorDetails } = useReadContract({
    ...x28TitanXConfig,
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

  const coreLoading = startLoading || statsLoading || flareX28ReservesLoading || flareX28Token0Loading || x28TitanXSlot0Loading || x28TitanXToken0Loading || flareX28PoolLoading;
  const usdLoading = titanXWethSlot0Loading || titanXWethToken0Loading || wethUsdcSlot0Loading || wethUsdcToken0Loading;
  const coreError = startError || statsError || flareX28ReservesError || flareX28Token0Error || x28TitanXSlot0Error || x28TitanXToken0Error || flareX28PoolError;
  const usdError = titanXWethSlot0Error || titanXWethToken0Error || wethUsdcSlot0Error || wethUsdcToken0Error;

  const isLoading = coreLoading || usdLoading;
  const hasError = coreError || usdError;

  useEffect(() => {
    if (coreError && retryCount < maxRetries) {
      console.error(`[FlareROI] Retrying due to core error, attempt ${retryCount + 1}`, {
        startError: startErrorDetails?.message,
        statsError: statsErrorDetails?.message,
        flareX28ReservesError: flareX28ReservesErrorDetails?.message,
        flareX28Token0Error: flareX28Token0ErrorDetails?.message,
        x28TitanXSlot0Error: x28TitanXSlot0ErrorDetails?.message,
        x28TitanXToken0Error: x28TitanXToken0ErrorDetails?.message,
        flareX28PoolError: flareX28PoolErrorDetails?.message,
      });
      setTimeout(() => setRetryCount(retryCount + 1), 2000);
    } else if (!coreError && retryCount > 0) {
      setRetryCount(0);
    }
  }, [coreError, retryCount, startErrorDetails, statsErrorDetails, flareX28ReservesErrorDetails, flareX28Token0ErrorDetails, x28TitanXSlot0ErrorDetails, x28TitanXToken0ErrorDetails, flareX28PoolErrorDetails]);

  const getPoolPrice = (reservesOrSlot0, token0Address, token1Address, poolAddress, isV3 = false) => {
    if (!reservesOrSlot0) return { price: null, description: 'No data available' };
    if (!isV3 && Array.isArray(reservesOrSlot0) && reservesOrSlot0.length >= 2) {
      const reserve0 = Number(formatEther(BigInt(reservesOrSlot0[0])));
      const reserve1 = Number(formatEther(BigInt(reservesOrSlot0[1])));
      if (reserve0 === 0 || reserve1 === 0) return { price: null, description: 'Zero reserves' };
      const price = reserve1 / reserve0; // token1/token0
      return { price, description: `${token1Address}/${token0Address} from ${poolAddress}` };
    } else if (isV3 && Array.isArray(reservesOrSlot0) && reservesOrSlot0.length >= 1) {
      const sqrtPriceX96 = BigInt(reservesOrSlot0[0]);
      const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
      let price = sqrtPrice * sqrtPrice; // token1/token0
      const isToken0USDC = token0Address?.toLowerCase() === tokenContracts.USDC.address.toLowerCase();
      const isToken1USDC = token1Address?.toLowerCase() === tokenContracts.USDC.address.toLowerCase();
      if (isToken0USDC) price = 1 / price;
      else if (isToken1USDC) price = price;
      return { price, description: `${token1Address}/${token0Address} from ${poolAddress}` };
    }
    return { price: null, description: 'Invalid data' };
  };

  let auctionFlarePerTitanX = null;
  let marketFlarePerTitanX = null;
  let flarePerX28 = null;
  let roi = null;
  let status = 'loading';

  if (!coreLoading && !coreError && flareX28Reserves && flareX28Token0 && x28TitanXSlot0 && x28TitanXToken0 && dailyStats && flareX28PoolAddress) {
    const isFlareToken0 = flareX28Token0.toLowerCase() === tokenContracts.FLARE.address.toLowerCase();
    const flareX28PriceInfo = getPoolPrice(flareX28Reserves, flareX28Token0, tokenContracts.X28.address, flareX28PoolAddress, false);
    flarePerX28 = isFlareToken0 ? flareX28PriceInfo.price : flareX28PriceInfo.price ? 1 / flareX28PriceInfo.price : null;

    const isX28Token0 = x28TitanXToken0.toLowerCase() === tokenContracts.X28.address.toLowerCase();
    const x28TitanXPriceInfo = getPoolPrice(x28TitanXSlot0, x28TitanXToken0, tokenContracts.TITANX.address, x28TitanXConfig.address, true);
    const x28PerTitanX = isX28Token0 ? (x28TitanXPriceInfo.price ? 1 / x28TitanXPriceInfo.price : null) : x28TitanXPriceInfo.price;

    if (flarePerX28 && x28PerTitanX) {
      marketFlarePerTitanX = flarePerX28 * x28PerTitanX;
    }

    const flareEmitted = dailyStats[2] ? Number(formatEther(BigInt(dailyStats[2]))) : 0;
    const titanXDeposited = dailyStats[0] ? Number(formatEther(BigInt(dailyStats[0]))) : 0;
    auctionFlarePerTitanX = titanXDeposited > 0 ? flareEmitted / titanXDeposited : null;

    roi = auctionFlarePerTitanX && marketFlarePerTitanX ? ((auctionFlarePerTitanX / marketFlarePerTitanX) * 100).toFixed(2) : null;
    status = roi ? 'success' : 'no_data';
  } else if (hasError) {
    status = 'error';
  }

  return {
    auctionFlarePerTitanX,
    marketFlarePerTitanX,
    flarePerX28,
    roi,
    isLoading,
    hasError,
    status,
  };
}