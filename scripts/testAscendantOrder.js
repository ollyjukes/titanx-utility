// scripts/testAscendantWallet.js

async function fetchAscendantHoldersForWallet(targetWallet) {
    const targetWalletLower = targetWallet.toLowerCase(); // Normalize for comparison
    try {
      // Fetch from the Next.js server
      const res = await fetch('http://localhost:3000/api/holders/Ascendant?page=0&pageSize=1000');
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
  
      // Validate response
      if (!data.holders || !Array.isArray(data.holders)) {
        throw new Error('Invalid response: holders data is missing or not an array');
      }
  
      // Find the target wallet
      const targetHolder = data.holders.find(
        (holder) => holder && holder.wallet && holder.wallet.toLowerCase() === targetWalletLower
      );
  
      // Display target wallet details
      console.log(`\nDetails for Wallet ${targetWallet}:`);
      if (targetHolder) {
        console.log(
          `Rank: ${targetHolder.rank},\n` +
          `Wallet: ${targetHolder.wallet},\n` +
          `Shares: ${(targetHolder.shares / 1e18).toLocaleString()},\n` +
          `% Shares: ${data.totalShares ? ((targetHolder.shares / data.totalShares) * 100).toFixed(2) : 'N/A'}%,\n` +
          `Total NFTs: ${targetHolder.total},\n` +
          `Locked Ascendant: ${(targetHolder.lockedAscendant / 1e18).toLocaleString()},\n` +
          `Pending DAY8 Rewards: ${(targetHolder.pendingDay8 / 1e18).toLocaleString()},\n` +
          `Pending DAY28 Rewards: ${(targetHolder.pendingDay28 / 1e18).toLocaleString()},\n` +
          `Pending DAY90 Rewards: ${(targetHolder.pendingDay90 / 1e18).toLocaleString()}`
        );
      } else {
        console.log('This wallet does not hold any Ascendant NFTs.');
      }
  
      // Display top 5 holders for context (ordered by shares)
      console.log('\nTop 5 Ascendant Holders Ordered by Shares:');
      data.holders.slice(0, 5).forEach((holder, index) => {
        if (holder && holder.wallet && typeof holder.shares === 'number' && typeof holder.total === 'number') {
          console.log(
            `Rank ${index + 1}: Wallet ${holder.wallet.slice(0, 6)}...${holder.wallet.slice(-4)}, ` +
            `Shares: ${(holder.shares / 1e18).toLocaleString()}, ` +
            `% Shares: ${data.totalShares ? ((holder.shares / data.totalShares) * 100).toFixed(2) : 'N/A'}%, ` +
            `Total NFTs: ${holder.total}`
          );
        } else {
          console.warn(`Invalid holder data at index ${index}:`, holder);
        }
      });
  
      // Log total stats
      console.log('\nCollection Summary:');
      console.log(`Total Holders: ${data.holders.length}`);
      console.log(`Total Shares: ${(data.totalShares / 1e18).toLocaleString()}`);
      console.log(`Total NFTs: ${data.totalTokens.toLocaleString()}`);
      console.log(`Total Pending Rewards: ${(data.pendingRewards / 1e18).toLocaleString()}`);
    } catch (err) {
      console.error('Error:', err.message);
    }
  }
  
  // Run the function for the specified wallet
  fetchAscendantHoldersForWallet('0xF98f0ee190d9f2E6531E226933f1E47a2890CbDA');