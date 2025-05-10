// app/contracts/contracts_auct_mint.js
import { getAddress } from 'viem';

// Import ABIs from abi directory
import ascendantAuctionABI from '@/abi/ascendantAuction.json';
import blazeAuctionABI from '@/abi/blazeAuction.json';
import flareAuctionABI from '@/abi/flareAuction.json';
import flareMintingABI from '@/abi/flareMinting.json';
import fluxAuctionABI from '@/abi/fluxAuction.json';
import goatXAuctionABI from '@/abi/goatXAuction.json';
import matrixAuctionABI from '@/abi/matrixAuction.json';
import phoenixAuctionABI from '@/abi/phoenixAuction.json';
import shogunAuctionABI from '@/abi/shogunAuction.json';
import voltAuctionABI from '@/abi/voltAuction.json';
import vyperBoostAuctionABI from '@/abi/vyperBoostAuction.json';
import vyperClassicAuctionABI from '@/abi/vyperClassicAuction.json';

export const auctionMintContracts = {
  ascendantAuction: {
    name: 'Ascendant Auction',
    abi: ascendantAuctionABI,
    address: getAddress('0x592daEb53eB1cef8aa96305588310E997ec58c0c'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Ascendant NFT minting.',
  },
  blazeAuction: {
    name: 'Blaze Auction',
    abi: blazeAuctionABI,
    address: getAddress('0x200ed69de20Fe522d08dF5d7CE3d69aba4e02e74'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Blaze NFT minting.',
  },
  flareAuction: {
    name: 'Flare Auction',
    abi: flareAuctionABI,
    address: getAddress('0x58ad6EF28bFB092635454d02303aBBd4D87b503c'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Flare NFT minting.',
  },
  flareMinting: {
    name: 'Flare Minting',
    abi: flareMintingABI,
    address: getAddress('0x9983eF6Af4DE8fE58C45f6DC54Cf5Ad349431A82'),
    chainId: 1,
    type: 'minting',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Minting contract for Flare NFTs.',
  },
  fluxAuction: {
    name: 'Flux Auction',
    abi: fluxAuctionABI,
    address: getAddress('0x36e5a8105f000029d4B3B99d0C3D0e24aaA52adF'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Flux NFT minting.',
  },
  goatXAuction: {
    name: 'GoatX Auction',
    abi: goatXAuctionABI,
    address: getAddress('0x059511B0BED706276Fa98877bd00ee0dD7303D32'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for GoatX NFT minting.',
  },
  matrixAuction: {
    name: 'Matrix Auction',
    abi: matrixAuctionABI,
    address: getAddress('0x9f29E5b2d67C4a7315c5D6AbD448C45f9dD51CAF'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Matrix NFT minting.',
  },
  phoenixAuction: {
    name: 'Phoenix Auction',
    abi: phoenixAuctionABI,
    address: getAddress('0xF41b5c99b8B6b88cF1Bd0320cB57e562EaF17DE1'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Phoenix NFT minting.',
  },
  shogunAuction: {
    name: 'Shogun Auction',
    abi: shogunAuctionABI,
    address: getAddress('0x79bd712f876c364Aa5e775A1eD40dE1fDfdB2a50'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Shogun NFT minting.',
  },
  voltAuction: {
    name: 'Volt Auction',
    abi: voltAuctionABI,
    address: getAddress('0xb3f2bE29BA969588E07bF7512e07008D6fdeB17B'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Volt NFT minting.',
  },
  vyperBoostAuction: {
    name: 'Vyper Boost Auction',
    abi: vyperBoostAuctionABI,
    address: getAddress('0x4D994F53FE2d8BdBbF64dC2e53C58Df00b84e713'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Vyper Boost NFT minting.',
  },
  vyperClassicAuction: {
    name: 'Vyper Classic Auction',
    abi: vyperClassicAuctionABI,
    address: getAddress('0xC1da113c983b26aa2c3f4fFD5f10b47457FC3397'),
    chainId: 1,
    type: 'auction',
    deploymentBlock: 'TBD', // Replace with actual deployment block if available
    description: 'Auction contract for Vyper Classic NFT minting.',
  },
};

// Export ABIs for backward compatibility
export const abis = {
  ascendantAuction: auctionMintContracts.ascendantAuction.abi,
  blazeAuction: auctionMintContracts.blazeAuction.abi,
  flareAuction: auctionMintContracts.flareAuction.abi,
  flareMinting: auctionMintContracts.flareMinting.abi,
  fluxAuction: auctionMintContracts.fluxAuction.abi,
  goatXAuction: auctionMintContracts.goatXAuction.abi,
  matrixAuction: auctionMintContracts.matrixAuction.abi,
  phoenixAuction: auctionMintContracts.phoenixAuction.abi,
  shogunAuction: auctionMintContracts.shogunAuction.abi,
  voltAuction: auctionMintContracts.voltAuction.abi,
  vyperBoostAuction: auctionMintContracts.vyperBoostAuction.abi,
  vyperClassicAuction: auctionMintContracts.vyperClassicAuction.abi,
};