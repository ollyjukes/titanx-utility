// scripts/trackElement280NFTs.js
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
import pino from 'pino';
import { promises as fs } from 'fs';
import config from '../config.js';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
});

const log = message => logger.info(message);

const ALCHEMY_API_KEY = config.alchemy.apiKey || process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`),
});

async function getOwnersForContract(contractAddress, abi, fromBlock = 0n) {
  try {
    const logs = await client.getLogs({
      address: contractAddress,
      event: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)']),
      fromBlock,
    });
    const owners = {};
    logs.forEach(log => {
      const { tokenId, to } = log.args;
      if (to !== '0x0000000000000000000000000000000000000000') {
        owners[tokenId.toString()] = { ownerAddress: to, tokenId: tokenId.toString() };
      } else {
        delete owners[tokenId.toString()];
      }
    });
    log(`[trackElement280NFTs] Fetched ${Object.keys(owners).length} owners for contract ${contractAddress}`);
    return Object.values(owners);
  } catch (error) {
    log(`[trackElement280NFTs] Failed to fetch owners for contract ${contractAddress}: ${error.message}`);
    throw error;
  }
}

async function retry(fn, attempts = 3, delay = 1000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      log(`[trackElement280NFTs] Retry ${i + 1}/${attempts}: ${error.message}`);
      if (i === attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function trackElement280NFTs() {
  const contractAddress = config.contractAddresses.element280.address;
  if (!contractAddress) {
    log('[trackElement280NFTs] Error: Element280 contract address not configured');
    throw new Error('Element280 contract address not configured');
  }

  log(`[trackElement280NFTs] Starting NFT tracking for contract: ${contractAddress}`);
  const element280Abi = JSON.parse(await fs.readFile('./abi/element280.json', 'utf8'));

  try {
    const nfts = await retry(() => getOwnersForContract(contractAddress, element280Abi));
    log(`[trackElement280NFTs] Fetched ${nfts.length} NFTs`);

    const burnAddress = '0x0000000000000000000000000000000000000000';
    const validNfts = nfts.filter(nft => nft.ownerAddress.toLowerCase() !== burnAddress);
    log(`[trackElement280NFTs] Filtered to ${validNfts.length} valid NFTs (excluding burned)`);

    const ownership = {};
    validNfts.forEach(nft => {
      const owner = nft.ownerAddress.toLowerCase();
      if (!ownership[owner]) {
        ownership[owner] = [];
      }
      ownership[owner].push(nft.tokenId);
    });

    const output = {
      contractAddress,
      totalNfts: validNfts.length,
      totalOwners: Object.keys(ownership).length,
      ownership,
      timestamp: new Date().toISOString(),
    };

    const outputPath = `./element280_nft_ownership_${Date.now()}.json`;
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
    log(`[trackElement280NFTs] Ownership data written to ${outputPath}`);

    return output;
  } catch (error) {
    log(`[trackElement280NFTs] Error: ${error.message}`);
    console.error('[trackElement280NFTs] Error stack:', error.stack);
    throw error;
  }
}

trackElement280NFTs()
  .then(() => {
    log('[trackElement280NFTs] Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    log(`[trackElement280NFTs] Script failed: ${error.message}`);
    process.exit(1);
  });