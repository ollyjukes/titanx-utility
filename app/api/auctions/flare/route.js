// app/api/auctions/flare/route.js
import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { tokenContracts, auctionABI, flareMintingABI, uniswapPoolABI } from '@/app/token_contracts';
import { wdiv } from '@/utils/Math'; // Use shared wdiv

function getDayEnd(t) {
  const adjustedTime = t - 14 * 3600; // Subtract 14 hours
  const daysSinceEpoch = Math.floor(adjustedTime / 86400);
  return (daysSinceEpoch + 1) * 86400 + 14 * 3600; // Next day at 2 PM UTC
}

export async function GET() {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
    });

    // Fetch start timestamp
    const startTimestamp = await client.readContract({
      address: tokenContracts.FLARE_AUCTION.address,
      abi: auctionABI,
      functionName: 'startTimestamp',
    });

    const now = Date.now() / 1000;

    // Check if auction has started
    if (Number(startTimestamp) > now) {
      return NextResponse.json(
        {
          currentDay: 0,
          startTimestamp: Number(startTimestamp),
          flareEmitted: 0,
          titanXDeposited: 0,
          ethDeposited: 0,
          depositsLocked: false,
          roi: 0,
          currentFlarePerTitanX: 0,
          marketFlareTitanXPrice: 0,
          timeRemaining: 'Not started',
          deviationStatus: 'N/A',
          mintCycle: {
            currentCycle: 0,
            startsAt: 0,
            endsAt: 0,
            isMinting: false,
          },
        },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=300',
          },
        }
      );
    }

    // Calculate current day
    const currentDay = Math.max(1, Math.floor((now - Number(startTimestamp)) / 86400));

    // Fetch daily stats
    const dailyStats = await client.readContract({
      address: tokenContracts.FLARE_AUCTION.address,
      abi: auctionABI,
      functionName: 'dailyStats',
      args: [currentDay],
    });

    // Fetch minting cycle
    const mintCycle = await client.readContract({
      address: tokenContracts.FLARE_MINTING.address,
      abi: flareMintingABI,
      functionName: 'getCurrentMintCycle',
    });

    // Fetch TWAP and spot price
    const twapData = await client.readContract({
      address: tokenContracts.FLARE_X28.address,
      abi: uniswapPoolABI,
      functionName: 'observe',
      args: [[15 * 60, 0]], // 15-minute TWAP
    });
    const poolData = await client.readContract({
      address: tokenContracts.FLARE_X28.address,
      abi: uniswapPoolABI,
      functionName: 'slot0',
    });

    const [titanXDeposited, ethDeposited, flareEmitted, depositsLocked] = dailyStats;
    const [currentCycle, cycleStartsAt, cycleEndsAt] = mintCycle;
    const [sqrtPriceX96] = poolData;
    const [[tickCumulativesPast, tickCumulativesNow],] = twapData;

    // Calculate time remaining using getDayEnd
    const dayEnd = getDayEnd(Number(startTimestamp) + (currentDay - 1) * 86400);
    const secondsLeft = dayEnd - now;
    const hours = Math.floor(secondsLeft / 3600);
    const minutes = Math.floor((secondsLeft % 3600) / 60);
    const timeRemaining = secondsLeft > 0 ? `${hours}h ${minutes}m` : 'Ended';

    // Calculate deviation and prices
    let deviationStatus = 'N/A';
    let currentFlarePerTitanX = 0;
    let marketFlareTitanXPrice = 0;
    let roi = 0;
    if (flareEmitted !== 0n && titanXDeposited !== 0n) {
      const tickCumulativesDelta = Number(tickCumulativesNow) - Number(tickCumulativesPast);
      const secondsAgo = 15 * 60;
      let arithmeticMeanTick = Math.floor(tickCumulativesDelta / secondsAgo);
      if (tickCumulativesDelta < 0 && tickCumulativesDelta % secondsAgo !== 0) {
        arithmeticMeanTick--;
      }
      const sqrtPriceX96Twap = Math.sqrt(1.0001 ** arithmeticMeanTick) * 2 ** 96;
      const price = Number((BigInt(sqrtPriceX96) ** 2n) / (2n ** 192n)) / 1e18;
      const twapPrice = Number((BigInt(sqrtPriceX96Twap) ** 2n) / (2n ** 192n)) / 1e18;
      const diff = twapPrice >= price ? twapPrice - price : price - twapPrice;
      const deviationLimit = 300; // 3% from SwapActions.sol
      deviationStatus = (price * deviationLimit) / 10000 < diff ? 'Out of bounds' : 'Within bounds';
      currentFlarePerTitanX = Number(wdiv(flareEmitted, titanXDeposited)) / 1e18;
      marketFlareTitanXPrice = twapPrice;
      roi = deviationStatus === 'Out of bounds' ? 0 : (currentFlarePerTitanX / marketFlareTitanXPrice) * 100;
    }

    const auctionData = {
      currentDay,
      startTimestamp: Number(startTimestamp),
      flareEmitted: Number(flareEmitted) / 1e18,
      titanXDeposited: Number(titanXDeposited) / 1e18,
      ethDeposited: Number(ethDeposited) / 1e18,
      depositsLocked,
      roi,
      currentFlarePerTitanX,
      marketFlareTitanXPrice,
      timeRemaining,
      deviationStatus,
      mintCycle: {
        currentCycle: Number(currentCycle),
        startsAt: Number(cycleStartsAt),
        endsAt: Number(cycleEndsAt),
        isMinting: now < Number(cycleEndsAt),
      },
    };

    const cacheTTL = 5 * 60; // 5 minutes
    return NextResponse.json(auctionData, {
      headers: {
        'Cache-Control': `public, s-maxage=${cacheTTL}, stale-while-revalidate=${cacheTTL}`,
      },
    });
  } catch (error) {
    console.error('Error fetching Flare auction data:', error);
    return NextResponse.json(
      { error: `Failed to fetch auction data: ${error.message}` },
      { status: 500 }
    );
  }
}