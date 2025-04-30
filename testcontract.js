// testContract.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import staxMainAbi from './abi/staxNFT.json' with { type: 'json' };
import pLimit from 'p-limit';

const limit = pLimit(5); // Limit concurrent requests to 5
const client = createPublicClient({
  chain: mainnet,
  transport: http('https://eth-mainnet.g.alchemy.com/v2/rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI', { timeout: 60000 }),
});

async function retry(fn, retries = 3, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`Retry ${i + 1}/${retries} failed for ${fn.name || 'fn'}: ${error.message}`);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function test() {
  try {
    // Fetch totalSupply
    const totalSupply = await retry(async () => {
      const result = await client.readContract({
        address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
        abi: staxMainAbi,
        functionName: 'totalSupply',
      });
      console.log('Total Supply:', result);
      return result;
    });
    
    // Fetch totalBurned
    const burnedCount = await retry(async () => {
      const result = await client.readContract({
        address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
        abi: staxMainAbi,
        functionName: 'totalBurned',
      });
      console.log('Burned Count:', result);
      return result;
    });

    // Fetch tiers for all token IDs
    console.log('Fetching tiers for all tokens...');
    const tokenIds = Array.from({ length: Number(totalSupply) }, (_, i) => i); // tokenId 0 to totalSupply-1
    const tierPromises = tokenIds.map(tokenId =>
      limit(() =>
        retry(async () => {
          try {
            const tier = await client.readContract({
              address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
              abi: staxMainAbi,
              functionName: 'getNftTier',
              args: [tokenId],
            });
            return { tokenId, tier: Number(tier) };
          } catch (error) {
            // Handle non-existent tokens
            if (error.message.includes('OwnerQueryForNonexistentToken')) {
              return { tokenId, tier: null, error: 'Non-existent token' };
            }
            throw error;
          }
        })
      )
    );

    const tiers = await Promise.all(tierPromises);
    
    // Log results
    console.log('\nTier Results:');
    tiers.forEach(({ tokenId, tier, error }) => {
      if (error) {
        console.log(`Token ${tokenId}: ${error}`);
      } else {
        console.log(`Token ${tokenId}: Tier ${tier}`);
      }
    });

    // Summarize tiers
    const tierSummary = tiers.reduce((acc, { tier }) => {
      if (tier !== null) {
        acc[tier] = (acc[tier] || 0) + 1;
      }
      return acc;
    }, {});
    console.log('\nTier Summary:');
    Object.entries(tierSummary).forEach(([tier, count]) => {
      console.log(`Tier ${tier}: ${count} tokens`);
    });

    // Log invalid tiers
    const invalidTiers = tiers.filter(({ tier }) => tier !== null && (tier < 1 || tier > 12));
    if (invalidTiers.length > 0) {
      console.log('\nInvalid Tiers:');
      invalidTiers.forEach(({ tokenId, tier }) => {
        console.log(`Token ${tokenId}: Tier ${tier}`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

test();