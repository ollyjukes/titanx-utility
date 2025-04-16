import { Alchemy, Network } from 'alchemy-sdk';
import dotenv from 'dotenv';

// Load .env.local
dotenv.config({ path: '.env.local' });

// Configuration
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI';
const CONTRACT_ADDRESS = '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f';

// Initialize Alchemy
const alchemy = new Alchemy({
  apiKey: ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

// Retry logic
async function retry(fn, attempts = 5, delay = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`Retry ${i + 1}/${attempts} failed: ${error.message}`);
      if (i === attempts - 1) throw error;
      await new Promise(res => setTimeout(res, delay * (i + 1)));
    }
  }
}

async function checkSupply() {
  try {
    console.log(`Checking total tokens for contract ${CONTRACT_ADDRESS} on Ethereum...`);

    // Fetch owners with token balances
    let owners = [];
    let pageKey = null;
    do {
      const response = await retry(() =>
        alchemy.nft.getOwnersForContract(CONTRACT_ADDRESS, {
          withTokenBalances: true,
          pageKey,
        })
      );
      owners = owners.concat(response.owners);
      pageKey = response.pageKey;
    } while (pageKey);

    console.log(`Raw owners count: ${owners.length}`);

    // Filter out burn address and invalid owners
    const burnAddress = '0x0000000000000000000000000000000000000000';
    const filteredOwners = owners.filter(
      (owner) => owner?.ownerAddress && owner.ownerAddress.toLowerCase() !== burnAddress && owner.tokenBalances?.length > 0
    );
    console.log(`Filtered owners count: ${filteredOwners.length}`);

    // Count total tokens
    const totalTokens = filteredOwners.reduce((sum, owner) => {
      return sum + owner.tokenBalances.reduce((tokenSum, tb) => tokenSum + (tb.tokenId ? 1 : 0), 0);
    }, 0);

    console.log('Total Tokens:', totalTokens);

    // Optional: Check burn address
    const burnNfts = await retry(() =>
      alchemy.nft.getNftsForOwner(burnAddress, {
        contractAddresses: [CONTRACT_ADDRESS],
      })
    );
    console.log('Burn Address NFTs:', {
      totalCount: burnNfts.totalCount,
      tokenIds: burnNfts.ownedNfts.map(nft => nft.tokenId),
    });
  } catch (error) {
    console.error('Failed to fetch total tokens:', error.message);
  }
}

checkSupply();