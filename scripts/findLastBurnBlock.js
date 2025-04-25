// scripts/findLastBurnBlock.js
import { Alchemy, Network } from 'alchemy-sdk';

const alchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI',
  network: Network.ETH_MAINNET,
});

async function findLastBurnBlock() {
  const contractAddress = '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9';
  const burnAddress = '0x0000000000000000000000000000000000000000';
  const fromBlock = 17435629; // DEPLOYMENT_BLOCK
  const blockRange = 2000; // Matches MAX_BLOCK_RANGE in validate-burned/route.js
  let lastBurnBlock = fromBlock;

  try {
    const currentBlock = await alchemy.core.getBlockNumber();
    console.log(`[findLastBurnBlock] Current block: ${currentBlock}`);

    for (let from = fromBlock; from <= currentBlock; from += blockRange) {
      const to = Math.min(from + blockRange - 1, currentBlock);
      console.log(`[findLastBurnBlock] Processing blocks ${from} to ${to}`);

      const logs = await alchemy.core.getLogs({
        address: contractAddress,
        fromBlock: from,
        toBlock: to,
        topics: [
          '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer event
          null, // from address (any)
          `0x000000000000000000000000${burnAddress.slice(2)}`, // to address (burn address, padded)
        ],
      });

      if (logs.length > 0) {
        const latestBurnBlock = Math.max(...logs.map(log => log.blockNumber));
        lastBurnBlock = Math.max(lastBurnBlock, latestBurnBlock);
        console.log(`[findLastBurnBlock] Found ${logs.length} burn events, latest at block ${latestBurnBlock}`);
      }
    }

    console.log(`[findLastBurnBlock] Last burn block: ${lastBurnBlock}`);
    return lastBurnBlock;
  } catch (error) {
    console.error(`[findLastBurnBlock] Error: ${error.message}, stack: ${error.stack}`);
    throw error;
  }
}

findLastBurnBlock()
  .then(block => process.exit(0))
  .catch(error => process.exit(1));