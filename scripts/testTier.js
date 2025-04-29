// scripts/testTier.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth-mainnet.g.alchemy.com/v2/rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI')
});

const abi = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'getNftTier',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  }
];

async function test(tokenId) {
  try {
    const tier = await client.readContract({
      address: '0x024D64E2F65747d8bB02dFb852702D588A062575',
      abi,
      functionName: 'getNftTier',
      args: [tokenId]
    });
    console.log(`Token ${tokenId}: Tier ${tier}`);
  } catch (error) {
    console.error(`Error for token ${tokenId}:`, error.message);
  }
}

const tokenIds = [294, 295, 434, 435, 227];
tokenIds.forEach(test);