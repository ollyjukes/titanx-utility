Please find below my Nextjs project TitanXUtils.  This part is concentrating on 4 NFT colections and analysing their data.

Element369, Stax and Ascendant are complete.

I am still trying to perfect the Element280 NFT collection.
All 4 of these are on Ethereum.
I also have a placeholder for future collection E280; this will be deployed on BASE

I have a few components that are important for this analysis.
It shoud be noted that any code changes and enhancements/testing scripts should not risk breaking the work we've already done for  Element369, Stax and Ascendant 


These 3 are the wallets that I own:
0x15702443110894B26911B913b17ea4931F803B02
0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA
0x9D641961a31B3eED46e664fA631aAD3021323862

wallet: 0x15702443110894B26911B913b17ea4931F803B02
this output should be the following:
Element 280, live nfts count 29, 5 amped legendary, 1 legendary, 6 rare amped and 17 amp common: 
Minted 2  
Tiers minted  [0,0,0,0,0,2]
Transferred in  28
Transferred out  1
Burned 0

wallet: 0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA
this output should be the following:
Element 280, live nfts count 0
Minted 22 
Tiers minted  [[0,17,0,3,0,2]
Transferred in 6
Transferred out 27
Burned 1

wallet: 0x9D641961a31B3eED46e664fA631aAD3021323862
this output should be the following:
Element 280, live nfts count 0
Minted 0
Tiers minted   [0,0,0,0,0,0]
Transferred in 2
Transferred out 2
Burned 0

The current claimable reward Element280 tokens for wallet 0x15702443110894B26911B913b17ea4931F803B02 is currently 1,301,036,482 and my current % of rewards is 1.199%

This is because it is only valid for wallets that currently own at least bone element280 NFT to have a current claimable amount.  This information can be used with the Element280Vault contract and abi to calculate the Claimable value for a wallet.  

The project code and data sources that I think we need for our further analysis is below.



.env.local
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=1dd2a69d54ac94fdefad918243183710
NEXT_PUBLIC_ALCHEMY_API_KEY=rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI

project includes below

{
  "name": "titanx-utility",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "@covalenthq/client-sdk": "^2.2.5",
    "@tanstack/react-query": "^5.72.1",
    "@wagmi/connectors": "^5.7.11",
    "alchemy-sdk": "^3.5.6",
    "chart.js": "^4.4.9",
    "dotenv": "^16.5.0",
    "ethers": "^6.13.5",
    "framer-motion": "^12.6.3",
    "minimist": "^1.2.8",
    "next": "14.2.15",
    "node-fetch": "^3.3.2",
    "p-limit": "^6.2.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "react": "^18.3.1",
    "react-chartjs-2": "^5.3.0",
    "react-dom": "^18.3.1",
    "react-virtualized": "^9.22.6",
    "sqlite": "^5.1.1",
    "sqlite3": "^5.1.7",
    "uuid": "^11.1.0",
    "viem": "^2.27.2",
    "wagmi": "^2.14.15",
    "zustand": "^5.0.3"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "autoprefixer": "^10.4.21",
    "eslint": "^9",
    "eslint-config-next": "15.2.4",
    "tailwindcss": "^3.4.17"
  }


===========next

Thank you for the additional requirements. To summarize, the solution must:
Be specific to Element 280, ensuring no impact on other NFT collections.

Address potential database staleness by querying the blockchain for the latest data while using the element280.db database for wallet-specific data and complex aggregates.

Update the element280.db database with any new data obtained from the blockchain to keep it as up-to-date as possible.

Resolve the SQLITE_ERROR: table element280_summary has no column named totalRewardPool issue for the NFT->ETH->Element280 page.

Ensure the solution is quick, easy, and verifies the three wallets’ data from wallets.json.

We’ll implement a hybrid approach that:
Fetches real-time data (totalRewardPool, multiplierPool, totalSupply, totalBurned, totalMinted, totalLive, lastBlock, totalWallets, tierDistribution) from the Element 280 NFT and vault contracts using a single multicall and Alchemy’s getOwnersForContract.

Queries the database (element280.db) for wallet-specific data (element280_wallets) and burnedDistribution, as computing historical burn data on-chain is complex.

Updates the element280_summary table with fresh blockchain data to keep it up-to-date.

Ensures all changes are isolated to Element 280-specific code (/api/holders/Element280, public/data/element280.db, and optionally trackElement280NFTs.js).

This approach resolves the SQLITE_ERROR, ensures real-time accuracy, keeps the database updated, and remains specific to Element 280.
Key Considerations
Element 280 Specificity:
Modify only /api/holders/Element280 (or equivalent, e.g., app/api/holders/Element280/route.js or pages/api/holders/Element280.js).

Use public/data/element280.db, isolated from other collections’ databases.

Reference only Element 280’s CONTRACT_ADDRESS (NFT) and VAULT_CONTRACT_ADDRESS (vault).

Avoid shared utilities or ABIs used by other collections.

Handling Database Staleness:
Fetch totalRewardPool, multiplierPool, totalSupply, totalBurned, totalMinted, totalLive, lastBlock, totalWallets, and tierDistribution from the blockchain for real-time data.

Query element280_wallets for wallet data and element280_summary for burnedDistribution (historical data).

Update element280_summary with new blockchain data to keep it current.

Database Updates:
Add totalRewardPool to element280_summary schema to store blockchain-fetched data.

Update totalWallets, tierDistribution, and other fields in element280_summary with blockchain data.

Ensure element280_wallets updates are handled by trackElement280NFTs.js (existing script).

Solution Goals:
Resolve SQLITE_ERROR by adding totalRewardPool to the database and fetching it on-chain.

Ensure real-time data for critical metrics.

Maintain performance by leveraging the database for wallet data.

Keep changes minimal and Element 280-specific.

Implementation
Step 1: Update the Database Schema
Since the SQLITE_ERROR indicates element280_summary lacks a totalRewardPool column, we’ll add it to the schema. This requires updating trackElement280NFTs.js to include totalRewardPool and ensure the database is ready for updates from the API handler.
Update initDb in trackElement280NFTs.js:


its not just the summary table that needs to be updated with the latet data.  All the tables in the batabase need to be aswell.  These tables can be seen in the file scripts/trackElement280NFTs.jsspecifically the tables are described by the creation code in this file:


      id INTEGER PRIMARY KEY,
      totalMinted INTEGER,
      totalBurned INTEGER,
      totalLive INTEGER,
      totalWallets INTEGER,
      tierDistribution TEXT,
      burnedDistribution TEXT,
      multiplierPool INTEGER,
      lastBlock INTEGER
    );
    CREATE TABLE IF NOT EXISTS element280_transfers (
      tokenId TEXT,
      fromAddr TEXT,
      toAddr TEXT,
      tier INTEGER,
      blockNumber INTEGER,
      transactionHash TEXT,
      blockTimestamp INTEGER,
      eventType TEXT,
      multiplierPool INTEGER,
      totalSupply INTEGER,
      totalBurned INTEGER,
      ownerAddr TEXT,
      PRIMARY KEY (tokenId, transactionHash, eventType)
    );
    CREATE TABLE IF NOT EXISTS element280_wallets (
      address TEXT PRIMARY KEY,
      totalLive INTEGER,
      totalBurned INTEGER,
      totalBought INTEGER,
      totalSold INTEGER,
      minted INTEGER,
      tiersLive TEXT,
      tiersBurned TEXT,
      tiersMinted TEXT,
      tiersTransferredIn TEXT,
      tiersTransferredOut TEXT,
      nfts TEXT,
      multiplierSum INTEGER,
      displayMultiplierSum REAL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_addresses ON element280_transfers(fromAddr, toAddr);
    CREATE INDEX IF NOT EXISTS idx_transfers_tokenId ON element280_transfers(tokenId);
    CREATE INDEX IF NOT EXISTS idx_transfers_eventType ON element280_transfers(eventType);
    CREATE INDEX IF NOT EXISTS idx_transfers_blockNumber ON element280_transfers(blockNumber);
  `);```



===
old
cat components/NFTPage.js  components/NFTPageWrapper.js components/NFTSummary.js components/HolderTable/Ascendant.js components/HolderTable/Element369.js components/HolderTable/Element280.js components/HolderTable/E280.js components/HolderTable/Stax.js components/SearchResultsModal.js config.js app/store.js  app/page.js app/layout.js app/nft/page.js app/nft/\[chain\]/\[contract\]/page.js   > ClientStuff.txt
===

========================
Summary for README
========================
Current State: The application fetches and displays NFT holder data for collections (Element369, Element280, Stax, Ascendant, E280) using Alchemy and viem, with server-side caching (NodeCache) and client-side caching (useNFTStore). Element280’s cache population is slow (fetching_supply), causing delays.


Logging: Ensure DEBUG=false outputs only [ERROR] and [VALIDATION] logs, using pino-pretty in debug for readability.( this doesn't work in prod)
Enhance Caching: Use independent caches per collection, polling /progress endpoints to wait for server-side cache completion.
Improve Loading: Display loading states (<LoadingIndicator>) until each collection’s cache is ready, ensuring smooth switching between collections.
Support All Collections: Implement consistent /progress endpoints for Element369, Stax, Ascendant, and E280, Element280

Goal:
data is fetched for NFT collections when the button for that collection is clicked.  the cache should be checked first to make sure the data is available in the cache. The cache needs to contain all the data for that NFT collection ( wallets with live NFTs, their owned tiers, etc) and should either be written to file( node-cache) for quick access or Redit Upstash(controlled by env vars).  the cache needs to persist across server restarts.  If its not then the browser should give an animated loading message and then load the data when its fully available and only then render the page.  THe user can switch between NFT colections smoothly and each time its individual memory cache should be queried for complete data and only render once complete. Each NFT colection has its own memoey cache managed my node-cache (written to file) or Redis Upstash depending on whether an env variable is true or false.  I want to ensure the caching is correct before moving to redis upstash.
when a user switches to a different nft collection that data fetch should start. if the user switches back to the original nft collection the data fetch should continue from where it left off.
if a user uses the search functionality then this requires that all the data caches are completed before returning results.  The results should be one row for each NFT collection with its corresponding data and displayed on top of each other in a modal dialog.  The data for each collection is usually different.
If data is in the cache the system should load this but if there any more potential data on the block chain this should be checked first before displaying the data in the holder table. The cache should always be updated with the latest data from the blockchain when a user uses the Browser.  The cache should hold the lastBlock processed info)

Frontend Validation:
Verify HolderTable components (components/HolderTable/Element280.js, HolderTable/Element369.js, etc.) display data correctly (e.g., multiplierSum, shares, rewards).
i need help debugging the code to ensure this happens.
this project uses the free vercel tier and alchemy
Centralized configuration in config.js with ES Modules.
Moved ABIs to config.js for consistency.
Optimized Alchemy settings (batchSize: 10, batchDelayMs: 1000).
Caching Implementation
All collections (Element280, Element369, Stax, Ascendant) support Redis caching (via Upstash) and in-memory/file caching (node-cache) with toggles (DISABLE_*_REDIS in .env.local).

Testing:
Run the following commands to verify API endpoints:

curl -X POST http://localhost:3000/api/holders/Element280"
curl "http://localhost:3000/api/holders/Element280/progress"
curl "http://localhost:3000/api/holders/Element280"
curl "http://localhost:3000/api/holders/Stax"
curl "http://localhost:3000/api/holders/Element369"
curl "http://localhost:3000/api/holders/Ascendant"


*Data**:
  - Total Minted: 16,883 NFTs. ( this will never changed and shoud be hardcoded)
  - Total Live: 8,107 NFTs.  ( this is the current niumber as of a few days ago.  maybe less the next time we check. can only go down to 0)
  - Total Burned: 8,776 NFTs (via `Transfer` events to `0x0000...0000`). ( this is the current number as of a few days ago.  maybe more the next time we check. can only go up to a max of Total Minted)
  - Total Holders: 920 wallets ( as of now)



=============
Better concats
=============
cat package.json next.config.mjs jsconfig.json  \
tailwind.config.js .env.local .env.development.local \
lib/*  app/store.js config.js app/api/utils.js \
.babelrc   jest.config.js > ./envs.txt

find ./tests .babelrc jest.config.js -type d \( -name node_modules -o -name .next \) -prune -false -o -type f -exec cat {} + > ./testing_code.txt

find ./app/api ./lib  ./app/store.js -type d \( -name node_modules -o -name .next \) -prune -false -o -type f -exec cat {} + > ./server_code.txt

find  components lib app/nft app/mining app/auctions app/page.js app/layout.js app/page.js app/layout.js -type d \( -name node_modules -o -name .next -name ./app/api \) -prune -false -o -type f -exec cat {} + > ./client_code.txt

find ./abi -type d \( -name node_modules -o -name .next \) -prune -false -o -type f -exec cat {} + > ./abis_code.txt


clear; cat abis_code.txt
clear; cat envs.txt
clear; cat testing_code.txt
clear; cat server_code.txt 
clear; cat ClientStuff.txt

=============
server testing
=============
time curl -X POST http://localhost:3000/api/holders/Stax;
time curl -X POST http://localhost:3000/api/holders/element369;
time curl -X POST http://localhost:3000/api/holders/e280;
time curl -X POST http://localhost:3000/api/holders/element280;
time curl -X POST http://localhost:3000/api/holders/ascendant;

time curl -X POST http://localhost:3000/api/holders/Stax;
time curl -X POST http://localhost:3000/api/holders/element369;
time curl -X POST http://localhost:3000/api/holders/e280;
time curl -X POST http://localhost:3000/api/holders/element280;
time curl -X POST http://localhost:3000/api/holders/ascendant;

time curl -X POST http://localhost:3000/api/holders/Stax;
time curl -X POST http://localhost:3000/api/holders/element369;
time curl -X POST http://localhost:3000/api/holders/e280;
time curl -X POST http://localhost:3000/api/holders/element280;
time curl -X POST http://localhost:3000/api/holders/ascendant;

curl http://localhost:3000/api/holders/Stax/progress
curl http://localhost:3000/api/holders/element369/progress
curl http://localhost:3000/api/holders/e280/progress
curl http://localhost:3000/api/holders/element280/progress
curl http://localhost:3000/api/holders/ascendant/progress


given the testing and server code below can you help me complete all the testing code please?  ideally I'd end up with one script ( maybe called  backend.test.js) which calls all the other testing scripts to do a comprehensive one call test of all the backend data retieval, caching functionality

code below