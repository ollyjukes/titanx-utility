This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


# Summary of changed files
git diff --name-status main auction_dev

# Detailed diff
git diff main auction_dev

# Commits in auction_dev not in main
git log --oneline --graph main..auction_dev

# Check specific files
git diff main auction_dev -- .gitignore



ascendant:
[test/ascendant] [WARN] Error caching tier for token 1342: Do not know how to serialize a BigInt
[test/ascendant] [WARN] Error caching tier for token 1343: Do not know how to serialize a BigInt
[test/ascendant] [INFO] === Ascendant Holders ===
[test/ascendant] [INFO] Summary: 95 holders, 843 tokens, live=1348, minted=N/A


NFT Collection	Deployment Block
Element 280	    20945304
Element 369	    21224418
Stax	        21452667
Ascendant	    21112535


TOTALS
Element369:
MInted 448         live 417             burned 31  this is correct.   131 unique holders correct
check other numbers

element280:
Minted   16883       live  8079            burned 8804  this is correct.   your unique holders is wrong.  576 is wrong,  should be 917 

Stax:
minted 503         live  454             burned 49  is correct .  please check other calculations  - unique holders 117,  I see 118,  which is right?

Ascendant:   1348 total minted for all time     , │ 95    = unique holders    843 = current live supply
could you totals up the tiers totals for each collection and make sure its the same as the previously calculated totals
ascendant:  Rarity 0: =common. , Rarity 1 = rare, Rarity 2=legendary
    


At the end please also print out the deployment blocks for each Collection and the last block processed for that collection
Seems like the [INFO] Fetching owners for  function is working.  but the next part of the processing is bugged.  how are you doing this?

PLease don't output these messages:  DEBUG] Reset Alchemy requestCount 
Please summarise all of these:  WARN] Failed to fetch tier for token 91: contractKey is not defined.  
for this one I checked on etherscan and its a common LFG tier: 
I'm wondering if issues hppen when NFTs are created or burned in batches. 

interestingly:  WARN] Processed 402 live tokens, expected 454. Difference likely due to 4 burned, 48 non-existent.------  454 actually is 402+4+48.  Maybe the dapp itself is classifying these incorrectly. we;ll need to investigate.




================================= rational - from version 11
**Summary of NFT Collection Extraction and Performance Enhancements**

**Summary of NFT Collection Extraction and Performance Enhancements**

The script extracts ownership and tier data for four NFT collections (`stax`, `element280`, `element369`, `ascendant`) using the Viem library, which interacts with the Ethereum blockchain via the Alchemy API. Below is how each collection is processed, the API functions used, and their source:

- **Stax** (503 tokens, `0x74270Ca3...`):
  - **Total Supply**:
    - Function: `readContract` with `totalSupply` and `totalBurned`.
    - Source: Viem library, queries Alchemy API to read contract state.
  - **Owners**:
    - Function: `multicall` with `ownerOf(tokenId)` in 100-token chunks.
    - Source: Viem library, batches calls via Alchemy API.
  - **Tiers**:
    - Function: `multicall` with `getNftTier(tokenId)` (tiers 1–12).
    - Source: Viem library, batches calls via Alchemy API.
  - **Notes**: Standard ERC-721 ABI, caches non-existent tokens.

- **Element 280** (16,883 tokens, `0x7F090d10...`):
  - **Total Supply**:
    - Function: `readContract` with `totalSupply` and `totalBurned`.
    - Source: Viem library, queries Alchemy API.
  - **Owners**:
    - Function: `multicall` with `ownerOf(tokenId)` in 100-token chunks.
    - Source: Viem library, batches calls via Alchemy API.
  - **Tiers**:
    - Function: `multicall` with `getNftTier(tokenId)` (tiers 1–6).
    - Source: Viem library, batches calls via Alchemy API.
  - **Notes**: Large collection, requires rate limit handling.

- **Element 369** (dynamic supply, `0x024d64e2...`):
  - **Total Supply**:
    - Function: `readContract` with `totalSupply` and `totalBurned`.
    - Source: Viem library, queries Alchemy API.
  - **Owners**:
    - Function: `multicall` with `ownerOf(tokenId)` in 100-token chunks.
    - Source: Viem library, batches calls via Alchemy API.
  - **Tiers**:
    - Function: `multicall` with `getNftTier(tokenId)` (tiers 1–3).
    - Source: Viem library, batches calls via Alchemy API.
  - **Notes**: Dynamic supply, similar ABI to Stax.

- **Ascendant** (dynamic supply, `0x9da95c32...`):
  - **Total Supply**:
    - Function: `readContract` with `tokenId` (no `totalBurned`).
    - Source: Viem library, queries Alchemy API.
  - **Owners**:
    - Function: `multicall` with `ownerOf(tokenId)` in 100-token chunks.
    - Source: Viem library, batches calls via Alchemy API.
  - **Tiers**:
    - Function: `multicall` with `getNFTAttribute(tokenId)` (tiers 1–8, includes rarity).
    - Source: Viem library, batches calls via Alchemy API.
  - **Notes**: Unique ABI, parses tuple for tier and rarity.

**Performance Enhancements**:
- **Multicall**: Batches up to 100 calls to reduce RPC requests (Viem via Alchemy API).
- **Rate Limiting**: Tracks Alchemy’s 330 CUPS limit, pauses near threshold.
- **Caching**: Stores owner/tier data in `tier_cache.json`, skips non-existent tokens.
- **Concurrency**: Limits to 2 concurrent requests, staggered by 200ms.
- **Retries**: 3 attempts with exponential backoff for failures.
- **Chunking**: Processes 100-token chunks for scalability.
- **Metrics**: Tracks latency and request counts for optimization.
- **Error Handling**: Robust logging and graceful failure recovery.

The script ensures efficiency and scalability for large collections like Element 280 while maintaining reliability through caching and retry mechanisms, leveraging Viem’s interaction with the Alchemy API.
==============================