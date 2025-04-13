// scripts/testAuctions.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { auctionABI } from '../app/token_contracts.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

async function testAuctions() {
  const protocols = [
    { name: 'Flare', address: '0x58aD6ef28BfB092635454D02303aDbd4D87b503C' },
    { name: 'Ascendant', address: '0x592daEb53eB1cef8aa96305588310E997ec58c0c' },
    { name: 'Blaze', address: '0x200ed69de20Fe522d08dF5d7CE3d69aba4e02e74' },
    { name: 'Volt', address: '0xb3f2bE29BA969588E07bF7512e07008D6fdeB17B' },
    { name: 'Vyper', address: '0xC1da113c983b26aa2c3f4fFD5f10b47457FC3397' },
    { name: 'Flux', address: '0x36e5a8105f000029d4B3B99d0C3D0e24aaA52adF' },
    { name: 'Phoenix', address: '0xF41b5c99b8B6b88cF1Bd0320cB57e562EaF17DE1' },
    { name: 'GoatX', address: '0x059511B0BED706276Fa98877bd00ee0dD7303D32' },
  ];

  for (const { name, address } of protocols) {
    try {
      const startTimestamp = await client.readContract({
        address,
        abi: auctionABI,
        functionName: 'startTimestamp',
      });
      console.log(`${name} startTimestamp:`, Number(startTimestamp));
    } catch (error) {
      console.error(`${name} error:`, error.message);
    }
  }
}

testAuctions();