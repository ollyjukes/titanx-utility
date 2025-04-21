// Save as scripts/testAlchemy.js
import { Alchemy, Network } from 'alchemy-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: './.env.local' });

const alchemy = new Alchemy({
  apiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

(async () => {
  try {
    const block = await alchemy.core.getBlockNumber();
    console.log(`Latest block: ${block}`);
    const nfts = await alchemy.nft.getNftsForOwner('0x15702443110894b26911b913b17ea4931f803b02', {
      contractAddresses: ['0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9'],
    });
    console.log(`NFTs for 0x15702443110894b26911b913b17ea4931f803b02: ${nfts.ownedNfts.length}`, nfts.ownedNfts.map(nft => nft.tokenId));
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
})();