// lib/auctions/protocols/ascendant.js
import { formatEther } from 'viem';
import { tokenContracts } from '@/app/token_contracts';

export function calculateAscendantRates({ dailyStats, pairData }) {
  if (!dailyStats || !pairData.ascendDragonX?.slot0 || !pairData.ascendDragonX?.token0 || !pairData.dragonXTitanX?.slot0 || !pairData.dragonXTitanX?.token0) {
    return { auctionRate: null, marketRate: null, secondaryRate: null, roi: null, marketDragonXPerTitanX: null };
  }

  const ascendDragonXSlot0 = pairData.ascendDragonX.slot0;
  const ascendDragonXToken0 = pairData.ascendDragonX.token0;
  const dragonXTitanXSlot0 = pairData.dragonXTitanX.slot0;
  const dragonXTitanXToken0 = pairData.dragonXTitanX.token0;

  const isAscendToken0 = ascendDragonXToken0.toLowerCase() === tokenContracts.ASCENDANT.address.toLowerCase();
  const sqrtPriceX96Ascend = BigInt(ascendDragonXSlot0[0]);
  const sqrtPriceAscend = Number(sqrtPriceX96Ascend) / (2 ** 96);
  let ascendPerDragonX = sqrtPriceAscend * sqrtPriceAscend;
  if (isAscendToken0) ascendPerDragonX = 1 / ascendPerDragonX;

  const isDragonXToken0 = dragonXTitanXToken0.toLowerCase() === tokenContracts.DRAGONX.address.toLowerCase();
  const sqrtPriceX96Dragon = BigInt(dragonXTitanXSlot0[0]);
  const sqrtPriceDragon = Number(sqrtPriceX96Dragon) / (2 ** 96);
  let marketDragonXPerTitanX = sqrtPriceDragon * sqrtPriceDragon;
  if (isDragonXToken0) marketDragonXPerTitanX = 1 / marketDragonXPerTitanX;

  const marketRate = ascendPerDragonX * marketDragonXPerTitanX;
  const tokenEmitted = dailyStats[2] ? Number(formatEther(BigInt(dailyStats[2]))) : 0;
  const titanXDeposited = dailyStats[0] ? Number(formatEther(BigInt(dailyStats[0]))) : 0;
  const auctionRate = titanXDeposited > 0 ? tokenEmitted / titanXDeposited : null;
  const roi = auctionRate && marketRate ? ((auctionRate / marketRate) * 100).toFixed(2) : null;

  return {
    auctionRate,
    marketRate,
    secondaryRate: ascendPerDragonX,
    marketDragonXPerTitanX,
    roi,
  };
}