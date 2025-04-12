// scripts/testFlareMinting.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { flareMintingABI } from '../app/token_contracts.js';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`),
});

async function testFlareMinting() {
  try {
    const mintCycle = await client.readContract({
      address: '0x9983eF6Af4DE8fE58C45f6DC54Cf5Ad349431A82',
      abi: flareMintingABI,
      functionName: 'getCurrentMintCycle',
    });
    console.log('Mint Cycle:', {
      currentCycle: Number(mintCycle[0]),
      startsAt: Number(mintCycle[1]),
      endsAt: Number(mintCycle[2]),
      isMinting: mintCycle[2] > Math.floor(Date.now() / 1000),
    });

    const startTimestamp = await client.readContract({
      address: '0x9983eF6Af4DE8fE58C45f6DC54Cf5Ad349431A82',
      abi: flareMintingABI,
      functionName: 'startTimestamp',
    });
    console.log('FlareMinting startTimestamp:', Number(startTimestamp));
  } catch (error) {
    console.error('Error querying FlareMinting:', error);
  }
}

testFlareMinting();