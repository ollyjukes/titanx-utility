// scripts/checkTokens.js
import { Alchemy, Network } from 'alchemy-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI';
const NFT_ADDRESS = '0xC1bD0B0E4bC6a3F3e439eE4D0fD69267c29F4180';
const WALLET = '0x15702443110894B26911B913b17ea4931F803B02';

async function check() {
  const alchemy = new Alchemy({ apiKey: ALCHEMY_API_KEY, network: Network.ETH_MAINNET });
  try {
    const nfts = await alchemy.nft.getNftsForOwner(WALLET, {
      contractAddresses: [NFT_ADDRESS],
    });
    console.log('Total NFTs:', nfts.totalCount);
    console.log('Token IDs:', nfts.ownedNfts.map(nft => Number(nft.tokenId)));
  } catch (e) {
    console.error('Error:', e.message);
  }
}

check().catch(console.error);