// Save as scripts/checkTransfersEtherscan.js
import { Alchemy, Network } from 'alchemy-sdk';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.local' });

const alchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, retries = 5, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === '1') return data;
      if (data.message === 'No records found') return { status: '0', result: [] };
      throw new Error(`Etherscan API error: ${data.message}`);
    } catch (error) {
      if (i === retries - 1) throw error;
      console.warn(`Retrying (${i + 1}/${retries}) after error: ${error.message}`);
      await delay(delayMs);
    }
  }
}

async function checkWalletTransfers(wallet) {
  console.log(`Checking transfers for wallet: ${wallet}`);
  try {
    const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
    if (!ETHERSCAN_API_KEY) throw new Error('ETHERSCAN_API_KEY not defined');

    const startBlock = 20945304;
    const endBlock = await alchemy.core.getBlockNumber();
    const blockRange = 100000;
    const logs = [];
    
    for (let fromBlock = startBlock; fromBlock <= endBlock; fromBlock += blockRange) {
      const toBlock = Math.min(fromBlock + blockRange - 1, endBlock);
      const url = `https://api.etherscan.io/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9&topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef&apikey=${ETHERSCAN_API_KEY}`;
      const data = await fetchWithRetry(url);
      logs.push(...data.result);
      console.log(`Fetched ${data.result.length} logs for blocks ${fromBlock} to ${toBlock}`);
      if (data.result.length === 0) break; // Stop if no more logs
      await delay(200);
    }

    console.log(`Total logs found: ${logs.length}`);
    const walletLogs = logs.filter(
      log => log.topics[1] === `0x000000000000000000000000${wallet.slice(2).toLowerCase()}` ||
             log.topics[2] === `0x000000000000000000000000${wallet.slice(2).toLowerCase()}`
    );
    console.log(`Found ${walletLogs.length} transfer events for ${wallet}`);
    walletLogs.forEach(log => {
      const eventType = log.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000' ? 'mint' :
                       log.topics[2] === '0x0000000000000000000000000000000000000000000000000000000000000000' ? 'burn' : 'transfer';
      console.log(`Token: ${parseInt(log.topics[3], 16)}, Event: ${eventType}, From: ${log.topics[1].slice(26)}, To: ${log.topics[2].slice(26)}, Block: ${parseInt(log.blockNumber, 16)}`);
    });
    const nfts = await alchemy.nft.getNftsForOwner(wallet, {
      contractAddresses: ['0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9'],
    });
    console.log(`Current NFTs: ${nfts.ownedNfts.length}`, nfts.ownedNfts.map(nft => nft.tokenId));
  } catch (error) {
    console.error(`Error for ${wallet}: ${error.message}`);
  }
}

const wallets = [
  '0x15702443110894b26911b913b17ea4931f803b02',
  '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda',
  '0x9d641961a31b3eed46e664fa631aad3021323862',
];

(async () => {
  for (const wallet of wallets) {
    await checkWalletTransfers(wallet);
  }
})();