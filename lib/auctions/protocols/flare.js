// lib/auctions/protocols/flare.js
import { formatEther } from 'viem';
import { tokenContracts } from '@/app/token_contracts';

export function calculateFlareRates({ dailyStats, pairData }) {
  if (!dailyStats || !pairData.flareX28?.getReserves || !pairData.flareX28?.token0 || !pairData.x28TitanX?.slot0 || !pairData.x28TitanX?.token0) {
    return { auctionRate: null, marketRate: null, secondaryRate: null, roi: null };
  }

  const flareX28Reserves = pairData.flareX28.getReserves;
  const flareX28Token0 = pairData.flareX28.token0;
  const x28TitanXSlot0 = pairData.x28TitanX.slot0;
  const x28TitanXToken0 = pairData.x28TitanX.token0;

  const isFlareToken0 = flareX28Token0.toLowerCase() === tokenContracts.FLARE.address.toLowerCase();
  const reserve0 = Number(formatEther(BigInt(flareX28Reserves[0])));
  const reserve1 = Number(formatEther(BigInt(flareX28Reserves[1])));
  const flarePerX28 = isFlareToken0 ? reserve1 / reserve0 : reserve0 / reserve1;

  const isX28Token0 = x28TitanXToken0.toLowerCase() === tokenContracts.X28.address.toLowerCase();
  const sqrtPriceX96 = BigInt(x28TitanXSlot0[0]);
  const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
  let x28PerTitanX = sqrtPrice * sqrtPrice;
  if (isX28Token0) x28PerTitanX = 1 / x28PerTitanX;

  const marketRate = flarePerX28 * x28PerTitanX;
  const flareEmitted = dailyStats[2] ? Number(formatEther(BigInt(dailyStats[2]))) : 0;
  const titanXDeposited = dailyStats[0] ? Number(formatEther(BigInt(dailyStats[0]))) : 0;
  const auctionRate = titanXDeposited > 0 ? flareEmitted / titanXDeposited : null;
  const roi = auctionRate && marketRate ? ((auctionRate / marketRate) * 100).toFixed(2) : null;

  return {
    auctionRate,
    marketRate,
    secondaryRate: flarePerX28,
    roi,
  };
}