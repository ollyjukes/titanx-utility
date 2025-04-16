import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { formatUnits } from 'viem';
import { Alchemy, Network } from 'alchemy-sdk';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { contractTiers } from '../app/nft-contracts.js';

// Load ABI from file
const ascendantAbi = JSON.parse(await fs.readFile(path.join(process.cwd(), 'abi', 'ascendantNFT.json'), 'utf8'));

// Load .env.local
dotenv.config({ path: '.env.local' });

const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI';
const WALLET_ADDRESS = '0xf98f0ee190d9f2e6531e226933f1e47a2890cbda';
const CONTRACT_ADDRESS = '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f';
const SAVE_TO_FILE = false; // Set to true to save output

const client = createPublicClient({
  chain: mainnet,
  transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, { timeout: 10000 }),
});

const alchemy = new Alchemy({
  apiKey: ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

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

async function getTokenIds(wallet) {
  let tokenIds = [];

  // 1. Check balanceOf
  console.log('Checking balanceOf for wallet:', wallet);
  try {
    const balance = await retry(() =>
      client.readContract({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'balanceOf',
        args: [wallet],
      })
    );
    console.log(`Balance of NFTs: ${balance}`);
    if (Number(balance) === 0) {
      console.log('No NFTs owned according to balanceOf.');
      return [];
    }
  } catch (error) {
    console.error(`balanceOf failed: ${error.message}`);
  }

  // 2. Try getNftsForOwner
  console.log('Querying getNftsForOwner for wallet:', wallet);
  try {
    const nfts = await retry(() =>
      alchemy.nft.getNftsForOwner(wallet, {
        contractAddresses: [CONTRACT_ADDRESS],
        withTokenBalances: true,
      })
    );
    console.log('getNftsForOwner response:', {
      totalCount: nfts.totalCount,
      ownedNfts: nfts.ownedNfts.map(nft => ({ tokenId: nft.tokenId, contract: nft.contract.address })),
    });
    tokenIds = nfts.ownedNfts.map(nft => BigInt(nft.tokenId));
  } catch (error) {
    console.error(`getNftsForOwner failed: ${error.message}`);
  }

  if (tokenIds.length > 0) {
    console.log('Found tokens (getNftsForOwner):', tokenIds.map(id => id.toString()));
    return tokenIds;
  }

  // 3. Try getOwnersForContract
  console.log('getNftsForOwner returned empty; trying getOwnersForContract');
  try {
    const owners = await retry(() =>
      alchemy.nft.getOwnersForContract(CONTRACT_ADDRESS, { withTokenBalances: true })
    );
    console.log('getOwnersForContract response:', {
      ownersCount: owners.owners.length,
      walletData: owners.owners.find(owner => owner.ownerAddress.toLowerCase() === wallet.toLowerCase()),
    });
    const walletData = owners.owners.find(
      owner => owner.ownerAddress.toLowerCase() === wallet.toLowerCase()
    );
    tokenIds = walletData ? walletData.tokenBalances.map(tb => BigInt(tb.tokenId)) : [];
    console.log('getOwnersForContract tokens:', tokenIds.map(id => id.toString()));
  } catch (error) {
    console.error(`getOwnersForContract failed: ${error.message}`);
  }

  if (tokenIds.length > 0) {
    console.log('Found tokens (getOwnersForContract):', tokenIds.map(id => id.toString()));
    return tokenIds;
  }

  // 4. Scan ownerOf
  console.log('Alchemy calls failed; scanning ownerOf for token IDs 1–10000...');
  try {
    const maxTokenId = 10000;
    const batchSize = 500;
    let allTokenIds = [];
    for (let start = 1; start <= maxTokenId; start += batchSize) {
      const end = Math.min(start + batchSize - 1, maxTokenId);
      console.log(`Scanning token IDs ${start}–${end}...`);
      const ownerOfCalls = Array.from({ length: end - start + 1 }, (_, i) => ({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'ownerOf',
        args: [BigInt(start + i)],
      }));
      const ownerOfResults = await retry(() => client.multicall({ contracts: ownerOfCalls }));
      const batchTokenIds = ownerOfResults
        .map((result, i) => {
          if (result.status === 'success' && result.result.toLowerCase() === wallet.toLowerCase()) {
            return BigInt(start + i);
          }
          return null;
        })
        .filter(id => id !== null);
      allTokenIds = [...allTokenIds, ...batchTokenIds];
    }
    console.log('ownerOf scan tokens:', allTokenIds.map(id => id.toString()));
    tokenIds = allTokenIds;
  } catch (error) {
    console.error(`ownerOf scan failed: ${error.message}`);
  }

  return tokenIds;
}

async function getWalletData() {
  console.log(`Fetching data for wallet ${WALLET_ADDRESS} on contract ${CONTRACT_ADDRESS} (chain: ${client.chain.name})...`);

  // 1. Fetch token IDs
  let tokenIds = [];
  try {
    tokenIds = await retry(() => getTokenIds(WALLET_ADDRESS));
    console.log(`Total NFTs: ${tokenIds.length}`);
    console.log(`Token IDs: [${tokenIds.join(', ')}]`);
  } catch (error) {
    console.error(`Failed to fetch token IDs: ${error.message}`);
    return;
  }

  if (tokenIds.length === 0) {
    console.log('No NFTs found.');
    return;
  }

  // 2. Validate ownership
  const ownerOfCalls = tokenIds.map(tokenId => ({
    address: CONTRACT_ADDRESS,
    abi: ascendantAbi,
    functionName: 'ownerOf',
    args: [tokenId],
  }));

  let validTokenIds = [];
  try {
    const ownerOfResults = await retry(() => client.multicall({ contracts: ownerOfCalls }));
    validTokenIds = tokenIds.filter((tokenId, i) => {
      const owner = ownerOfResults[i].status === 'success' && ownerOfResults[i].result.toLowerCase();
      const isValid = owner === WALLET_ADDRESS.toLowerCase();
      if (!isValid) {
        console.log(`Token ${tokenId} not owned by ${WALLET_ADDRESS}: owner=${owner}`);
      }
      return isValid;
    });
    console.log(`Valid Token IDs: [${validTokenIds.join(', ')}]`);
  } catch (error) {
    console.error(`Failed to validate ownership: ${error.message}`);
    return;
  }

  if (validTokenIds.length === 0) {
    console.log('No valid NFTs owned.');
    return;
  }

  // 3. Fetch NFT attributes and user records
  const tierCalls = validTokenIds.map(tokenId => ({
    address: CONTRACT_ADDRESS,
    abi: ascendantAbi,
    functionName: 'nftAttributes', // Try nftAttributes instead of getNFTAttribute
    args: [tokenId],
  }));
  const recordCalls = validTokenIds.map(tokenId => ({
    address: CONTRACT_ADDRESS,
    abi: ascendantAbi,
    functionName: 'userRecords',
    args: [tokenId],
  }));
  const claimableCall = [{
    address: CONTRACT_ADDRESS,
    abi: ascendantAbi,
    functionName: 'batchClaimableAmount',
    args: [validTokenIds],
  }];

  let tierResults, recordResults, claimableResult;
  try {
    [tierResults, recordResults, claimableResult] = await Promise.all([
      retry(() => client.multicall({ contracts: tierCalls })),
      retry(() => client.multicall({ contracts: recordCalls })),
      retry(() => client.multicall({ contracts: claimableCall })),
    ]);
    console.log('Raw tierResults:', tierResults);
  } catch (error) {
    console.error(`Failed to fetch contract data: ${error.message}`);
    return;
  }

  // 4. Process token data
  const tokenData = validTokenIds.map((tokenId, i) => {
    const tierResult = tierResults[i].status === 'success' && tierResults[i].result ? tierResults[i].result : [0, 8, 0]; // Fallback to tier 8
    const tier = Number(tierResult[1]); // tier is second element
    const record = recordResults[i].status === 'success' ? recordResults[i].result : [0, 0, 0, 0, 0];
    return {
      tokenId: tokenId.toString(),
      tier,
      shares: parseFloat(formatUnits(BigInt(record[0]), 18)),
      lockedAscendant: parseFloat(formatUnits(BigInt(record[1]), 18)),
      rewardDebt: parseFloat(formatUnits(BigInt(record[2]), 18)),
      startTime: Number(record[3]),
      endTime: Number(record[4]),
    };
  });

  // 5. Claimable rewards
  let claimableRewards = 0;
  let claimableRaw = 0n;
  if (claimableResult[0].status === 'success') {
    claimableRaw = BigInt(claimableResult[0].result || 0);
    claimableRewards = parseFloat(formatUnits(claimableRaw, 18));
  } else {
    console.error(`Failed batchClaimableAmount: ${claimableResult[0].error || 'No result'}`);
  }

  // 6. Contract-level data
  let totalShares = 0, toDistributeDay8 = 0, toDistributeDay28 = 0, toDistributeDay90 = 0, rewardPerShare = 0;
  try {
    const [totalSharesRaw, day8Raw, day28Raw, day90Raw, rewardPerShareRaw] = await Promise.all([
      retry(() => client.readContract({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'totalShares',
      })),
      retry(() => client.readContract({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'toDistribute',
        args: [0], // POOLS.DAY_8
      })),
      retry(() => client.readContract({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'toDistribute',
        args: [1], // POOLS.DAY_28
      })),
      retry(() => client.readContract({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'toDistribute',
        args: [2], // POOLS.DAY_90
      })),
      retry(() => client.readContract({
        address: CONTRACT_ADDRESS,
        abi: ascendantAbi,
        functionName: 'rewardPerShare',
      })),
    ]);
    totalShares = parseFloat(formatUnits(totalSharesRaw, 18));
    toDistributeDay8 = parseFloat(formatUnits(day8Raw, 18));
    toDistributeDay28 = parseFloat(formatUnits(day28Raw, 18));
    toDistributeDay90 = parseFloat(formatUnits(day90Raw, 18));
    rewardPerShare = parseFloat(formatUnits(rewardPerShareRaw, 18));
  } catch (error) {
    console.error(`Failed to fetch contract-level data: ${error.message}`);
  }

  // 7. Calculate pending rewards and multiplier
  const totalTokenShares = tokenData.reduce((sum, t) => sum + t.shares, 0);
  const multiplierSum = tokenData.reduce((sum, t) => sum + (contractTiers.ascendantNFT[t.tier]?.multiplier || 0), 0);

  // 8. Output
  const result = {
    wallet: WALLET_ADDRESS,
    totalNfts: validTokenIds.length,
    tokenData,
    claimableRewards,
    claimableRaw: claimableRaw.toString(),
    totalShares,
    toDistributeDay8,
    toDistributeDay28,
    toDistributeDay90,
    rewardPerShare,
    pendingDay8: totalTokenShares * (totalShares > 0 ? toDistributeDay8 / totalShares : 0),
    pendingDay28: totalTokenShares * (totalShares > 0 ? toDistributeDay28 / totalShares : 0),
    pendingDay90: totalTokenShares * (totalShares > 0 ? toDistributeDay90 / totalShares : 0),
    shares: totalTokenShares,
    lockedAscendant: tokenData.reduce((sum, t) => sum + t.lockedAscendant, 0),
    multiplierSum,
  };

  console.log('\n=== Wallet Data ===');
  console.log(`Wallet: ${result.wallet}`);
  console.log(`Total NFTs: ${result.totalNfts}`);
  console.log(`Shares: ${result.shares}`);
  console.log(`Locked Ascendant: ${result.lockedAscendant}`);
  console.log(`Multiplier Sum: ${result.multiplierSum}`);
  console.log(`Claimable Rewards: ${result.claimableRewards} DragonX`);
  console.log(`Claimable Raw: ${result.claimableRaw}`);
  console.log(`Pending Day 8: ${result.pendingDay8}`);
  console.log(`Pending Day 28: ${result.pendingDay28}`);
  console.log(`Pending Day 90: ${result.pendingDay90}`);
  console.log(`\nContract Data:`);
  console.log(`Total Shares: ${result.totalShares}`);
  console.log(`To Distribute Day 8: ${result.toDistributeDay8}`);
  console.log(`To Distribute Day 28: ${result.toDistributeDay28}`);
  console.log(`To Distribute Day 90: ${result.toDistributeDay90}`);
  console.log(`Reward Per Share: ${result.rewardPerShare}`);
  console.log(`\nToken Details:`);
  console.table(tokenData);

  // Optional: Save to file
  if (SAVE_TO_FILE) {
    await fs.writeFile('ascendant_wallet_data.json', JSON.stringify(result, null, 2));
    console.log('Saved to ascendant_wallet_data.json');
  }
}

getWalletData().catch(error => console.error('Script failed:', error.message));