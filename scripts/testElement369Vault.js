// scripts/testElement369Vault.js
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { Alchemy, Network } from 'alchemy-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// Configuration
const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI';
const NFT_ADDRESS = '0x024D64E2F65747d8bB02dFb852702D588A062575'; // Element369 NFT
const VAULT_ADDRESS = '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5';
const TEST_WALLET = '0x15702443110894B26911B913b17ea4931F803B02';

// Minimal ABI
const VAULT_ABI = [
  {
    name: 'getRewards',
    inputs: [
      { type: 'uint256[]' },
      { type: 'address' },
      { type: 'bool' },
    ],
    outputs: [
      { type: 'bool[]' },
      { type: 'bool[]' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

async function getTokenIds(wallet) {
  const settings = {
    apiKey: ALCHEMY_API_KEY,
    network: Network.ETH_MAINNET,
  };
  const alchemy = new Alchemy(settings);
  try {
    console.log('Querying getNftsForOwner for contract:', NFT_ADDRESS, 'wallet:', wallet);
    const nfts = await alchemy.nft.getNftsForOwner(wallet, {
      contractAddresses: [NFT_ADDRESS],
    });
    console.log('Total NFTs:', nfts.totalCount);
    const tokenIds = nfts.ownedNfts.map(nft => Number(nft.tokenId));
    if (tokenIds.length > 0) {
      console.log('Found tokens:', tokenIds);
      return tokenIds;
    }

    console.log('getNftsForOwner returned empty; trying getOwnersForContract');
    const owners = await alchemy.nft.getOwnersForContract(NFT_ADDRESS, {
      withTokenBalances: true,
    });
    const walletData = owners.owners.find(
      owner => owner.ownerAddress.toLowerCase() === wallet.toLowerCase()
    );
    const ownerTokens = walletData ? walletData.tokenBalances.map(tb => Number(tb.tokenId)) : [];
    console.log('getOwnersForContract tokens:', ownerTokens);
    return ownerTokens;
  } catch (e) {
    console.error('Token fetch failed:', e.message);
    return [];
  }
}

async function test() {
  // Initialize client
  const client = createPublicClient({
    chain: mainnet,
    transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`),
  });

  // Fetch token IDs
  let tokenIds = [];
  try {
    console.log('Fetching token IDs for wallet:', TEST_WALLET);
    tokenIds = await getTokenIds(TEST_WALLET);
    console.log('Final Token IDs:', tokenIds);
    if (tokenIds.length === 0) {
      console.log('No tokens found; using sample IDs: [101, 102]');
      tokenIds = [101, 102];
    } else {
      tokenIds = tokenIds.slice(0, 2); // Use up to 2 tokens
    }
  } catch (e) {
    console.error('Failed to fetch token IDs:', e.message);
    console.log('Using sample IDs: [101, 102]');
    tokenIds = [101, 102];
  }

  // Test getRewards
  try {
    console.log('\nTesting getRewards with token IDs:', tokenIds);
    const result = await client.readContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: 'getRewards',
      args: [tokenIds, TEST_WALLET, false],
    });
    console.log('getRewards Result:', {
      availability: result[0],
      burned: result[1],
      infernoPool: Number(result[2]) / 1e18,
      fluxPool: Number(result[3]) / 1e18,
      e280Pool: Number(result[4]) / 1e18,
    });
  } catch (e) {
    console.error('getRewards failed:', e.message);
  }
}

test().catch(console.error);