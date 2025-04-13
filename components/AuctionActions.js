// components/AuctionActions.js
'use client';
import { useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { tokenContracts, auctionABI } from '@/app/token_contracts';

export default function AuctionActions({ auctionName }) {
  const { address, isConnected } = useAccount();
  const { writeContract } = useWriteContract();
  const [depositAmount, setDepositAmount] = useState('');

  const contractAddress =
    auctionName === 'Flare' ? tokenContracts.FLARE_AUCTION.address :
    auctionName === 'Ascendant' ? tokenContracts.ASCENDANT_AUCTION.address :
    auctionName === 'Blaze' ? tokenContracts.BLAZE_AUCTION.address :
    auctionName === 'Volt' ? tokenContracts.VOLT_AUCTION.address :
    auctionName === 'Vyper' ? tokenContracts.VYPER_CLASSIC_AUCTION.address :
    auctionName === 'Flux' ? tokenContracts.FLUX_AUCTION.address :
    auctionName === 'Phoenix' ? tokenContracts.PHOENIX_AUCTION.address :
    auctionName === 'GoatX' ? tokenContracts.GOATX_AUCTION.address :
    null;

  const handleDeposit = async () => {
    if (!isConnected) {
      alert('Please connect your wallet.');
      return;
    }
    if (!depositAmount || isNaN(depositAmount) || Number(depositAmount) <= 0) {
      alert('Please enter a valid deposit amount.');
      return;
    }
    try {
      await writeContract({
        address: contractAddress,
        abi: auctionABI,
        functionName: 'deposit',
        args: [parseEther(depositAmount)],
      });
      alert(`${auctionName} deposit successful!`);
      setDepositAmount('');
    } catch (error) {
      console.error(`${auctionName} deposit failed:`, error);
      alert('Deposit failed.');
    }
  };

  const handleClaim = async () => {
    if (!isConnected) {
      alert('Please connect your wallet.');
      return;
    }
    try {
      await writeContract({
        address: contractAddress,
        abi: auctionABI,
        functionName: 'claim',
        args: [],
      });
      alert(`${auctionName} claim successful!`);
    } catch (error) {
      console.error(`${auctionName} claim failed:`, error);
      alert('Claim failed.');
    }
  };

  if (!contractAddress || contractAddress === '0x0') return null;

  return (
    <div className="mt-4 space-y-2">
      <div className="flex space-x-2">
        <input
          type="number"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          placeholder="Amount in TITANX"
          className="flex-1 px-3 py-2 bg-gray-700 text-gray-100 rounded"
        />
        <button
          onClick={handleDeposit}
          disabled={!isConnected || !depositAmount}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-600"
        >
          Deposit
        </button>
      </div>
      <button
        onClick={handleClaim}
        disabled={!isConnected}
        className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-600"
      >
        Claim Rewards
      </button>
    </div>
  );
}