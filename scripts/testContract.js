// scripts/testContract.js
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/ollyjukes/nextjs.projects/titanx-utility/.env.local' });

import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { tokenContracts, uniswapV2PoolABI } from '../app/token_contracts.js';

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

async function test() {
  try {
    console.log('Alchemy API Key:', process.env.NEXT_PUBLIC_ALCHEMY_API_KEY);

    // Flare Auction
    console.log('Flare address:', tokenContracts.FLARE_AUCTION.address);
    let flareTimestamp = 0;
    try {
      flareTimestamp = await client.readContract({
        address: tokenContracts.FLARE_AUCTION.address,
        abi: tokenContracts.FLARE_AUCTION.abi,
        functionName: 'startTimestamp',
      });
      console.log('Flare startTimestamp:', flareTimestamp);
    } catch (e) {
      console.log('Flare startTimestamp failed:', e.shortMessage);
      console.log('Assuming startTimestamp is 0 (auction not started)');
    }

    try {
      const auctionState = await client.readContract({
        address: tokenContracts.FLARE_AUCTION.address,
        abi: tokenContracts.FLARE_AUCTION.abi,
        functionName: 'state',
      });
      console.log('Flare auction state:', auctionState);
    } catch (e) {
      console.log('Flare state failed:', e.shortMessage);
    }

    if (flareTimestamp > 0) {
      const flareDay = Math.max(1, Math.floor((Date.now() / 1000 - Number(flareTimestamp)) / (24 * 60 * 60)) + 1);
      try {
        const flareStats = await client.readContract({
          address: tokenContracts.FLARE_AUCTION.address,
          abi: tokenContracts.FLARE_AUCTION.abi,
          functionName: 'dailyStats',
          args: [flareDay],
        });
        console.log('Flare dailyStats:', flareStats);
      } catch (e) {
        console.log('Flare dailyStats failed:', e.shortMessage);
      }
    } else {
      console.log('Skipping Flare dailyStats: Auction not started');
    }

    // Ascendant Auction
    console.log('Ascendant address:', tokenContracts.ASCENDANT_AUCTION.address);
    let ascendantTimestamp = 0;
    try {
      ascendantTimestamp = await client.readContract({
        address: tokenContracts.ASCENDANT_AUCTION.address,
        abi: tokenContracts.ASCENDANT_AUCTION.abi,
        functionName: 'startTimestamp',
      });
      console.log('Ascendant startTimestamp:', ascendantTimestamp);
    } catch (e) {
      console.log('Ascendant startTimestamp failed:', e.shortMessage);
      console.log('Assuming startTimestamp is 0 (auction not started)');
    }

    if (ascendantTimestamp > 0) {
      const ascendantDay = Math.max(1, Math.floor((Date.now() / 1000 - Number(ascendantTimestamp)) / (24 * 60 * 60)) + 1);
      try {
        const ascendantStats = await client.readContract({
          address: tokenContracts.ASCENDANT_AUCTION.address,
          abi: tokenContracts.ASCENDANT_AUCTION.abi,
          functionName: 'dailyStats',
          args: [ascendantDay],
        });
        console.log('Ascendant dailyStats:', ascendantStats);
      } catch (e) {
        console.log('Ascendant dailyStats failed:', e.shortMessage);
      }
    } else {
      console.log('Skipping Ascendant dailyStats: Auction not started');
    }

    // Flare/X28 Pool
    console.log('Flare/X28 address:', tokenContracts.FLARE_X28.address);
    try {
      const flareX28Reserves = await client.readContract({
        address: tokenContracts.FLARE_X28.address,
        abi: uniswapV2PoolABI,
        functionName: 'getReserves',
      });
      console.log('Flare/X28 reserves:', flareX28Reserves);
    } catch (e) {
      console.log('Flare/X28 reserves failed:', e.shortMessage);
    }

    try {
      const flareX28Token0 = await client.readContract({
        address: tokenContracts.FLARE_X28.address,
        abi: uniswapV2PoolABI,
        functionName: 'token0',
      });
      console.log('Flare/X28 token0:', flareX28Token0);
    } catch (e) {
      console.log('Flare/X28 token0 failed:', e.shortMessage);
    }
  } catch (error) {
    console.error('General error:', error);
  }
}

test();