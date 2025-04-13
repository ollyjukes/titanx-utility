// lib/auctions/config.js
import { tokenContracts, auctionABI, flareTokenABI, uniswapPoolABI, uniswapV2PoolABI } from '@/app/token_contracts';

export const auctionProtocols = {
  flare: {
    name: 'Flare',
    auctionContract: { address: tokenContracts.FLARE_AUCTION.address, abi: auctionABI, chainId: tokenContracts.FLARE_AUCTION.chainId },
    tokenContract: { address: tokenContracts.FLARE.address, abi: flareTokenABI, chainId: tokenContracts.FLARE.chainId },
    pairs: [
      { key: 'flareX28', config: { address: tokenContracts.FLARE_X28.address, abi: uniswapV2PoolABI, chainId: tokenContracts.FLARE_X28.chainId }, functions: ['getReserves', 'token0'] },
      { key: 'x28TitanX', config: { address: tokenContracts.X28_TITANX.address, abi: uniswapPoolABI, chainId: tokenContracts.X28_TITANX.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
      { key: 'titanXWeth', config: { address: tokenContracts.TITANX_WETH.address, abi: uniswapPoolABI, chainId: tokenContracts.TITANX_WETH.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
      { key: 'wethUsdc', config: { address: tokenContracts.WETH_USDC.address, abi: uniswapPoolABI, chainId: tokenContracts.WETH_USDC.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
    ],
    externalUrl: 'https://www.flare.win/auction',
  },
  ascendant: {
    name: 'Ascendant',
    auctionContract: { address: tokenContracts.ASCENDANT_AUCTION.address, abi: auctionABI, chainId: tokenContracts.ASCENDANT_AUCTION.chainId },
    tokenContract: { address: tokenContracts.ASCENDANT.address, abi: flareTokenABI, chainId: tokenContracts.ASCENDANT.chainId },
    pairs: [
      { key: 'ascendDragonX', config: { address: tokenContracts.ASCENDANT_DRAGONX.address, abi: uniswapPoolABI, chainId: tokenContracts.ASCENDANT_DRAGONX.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
      { key: 'dragonXTitanX', config: { address: tokenContracts.DRAGONX_TITANX.address, abi: uniswapPoolABI, chainId: tokenContracts.DRAGONX_TITANX.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
      { key: 'titanXWeth', config: { address: tokenContracts.TITANX_WETH.address, abi: uniswapPoolABI, chainId: tokenContracts.TITANX_WETH.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
      { key: 'wethUsdc', config: { address: tokenContracts.WETH_USDC.address, abi: uniswapPoolABI, chainId: tokenContracts.WETH_USDC.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
    ],
    externalUrl: 'https://app.ascendant.win/auction',
  },
  shogun: {
    name: 'Shogun',
    auctionContract: { address: '0x0', abi: auctionABI, chainId: 1 }, // No auction in tokenContracts
    tokenContract: { address: tokenContracts.SHOGUN.address, abi: flareTokenABI, chainId: tokenContracts.SHOGUN.chainId },
    pairs: [
      { key: 'shogunTitanX', config: { address: tokenContracts.SHOGUN_TITANX.address, abi: uniswapV2PoolABI, chainId: tokenContracts.SHOGUN_TITANX.chainId }, functions: ['getReserves', 'token0'] },
    ],
    externalUrl: 'https://app.shogun.win/auction',
  },
  blaze: {
    name: 'Blaze',
    auctionContract: { address: tokenContracts.BLAZE_AUCTION.address, abi: auctionABI, chainId: tokenContracts.BLAZE_AUCTION.chainId },
    tokenContract: { address: tokenContracts.BLAZE.address, abi: flareTokenABI, chainId: tokenContracts.BLAZE.chainId },
    pairs: [
      { key: 'blazeTitanX', config: { address: tokenContracts.BLAZE_TITANX.address, abi: uniswapV2PoolABI, chainId: tokenContracts.BLAZE_TITANX.chainId }, functions: ['getReserves', 'token0'] },
    ],
    externalUrl: 'https://app.titanblaze.win/auction',
  },
  volt: {
    name: 'Volt',
    auctionContract: { address: tokenContracts.VOLT_AUCTION.address, abi: auctionABI, chainId: tokenContracts.VOLT_AUCTION.chainId },
    tokenContract: { address: tokenContracts.VOLT.address, abi: flareTokenABI, chainId: tokenContracts.VOLT.chainId },
    pairs: [
      { key: 'voltTitanX', config: { address: tokenContracts.VOLT_TITANX.address, abi: uniswapPoolABI, chainId: tokenContracts.VOLT_TITANX.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
    ],
    externalUrl: 'https://app.volt.win/auction',
  },
  vyper: {
    name: 'Vyper',
    auctionContract: { address: tokenContracts.VYPER_CLASSIC_AUCTION.address, abi: auctionABI, chainId: tokenContracts.VYPER_CLASSIC_AUCTION.chainId },
    tokenContract: { address: tokenContracts.VYPER.address, abi: flareTokenABI, chainId: tokenContracts.VYPER.chainId },
    pairs: [
      { key: 'vyperDragonX', config: { address: tokenContracts.VYPER_DRAGONX.address, abi: uniswapPoolABI, chainId: tokenContracts.VYPER_DRAGONX.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
    ],
    externalUrl: 'https://app.vyper.win/auction',
  },
  flux: {
    name: 'Flux',
    auctionContract: { address: tokenContracts.FLUX_AUCTION.address, abi: auctionABI, chainId: tokenContracts.FLUX_AUCTION.chainId },
    tokenContract: { address: tokenContracts.FLUX.address, abi: flareTokenABI, chainId: tokenContracts.FLUX.chainId },
    pairs: [
      { key: 'fluxTitanX', config: { address: tokenContracts.FLUX_TITANX.address, abi: uniswapPoolABI, chainId: tokenContracts.FLUX_TITANX.chainId }, functions: ['slot0', 'token0'], cacheTime: 0 },
    ],
    externalUrl: 'https://app.flux.win/auction',
  },
  phoenix: {
    name: 'Phoenix',
    auctionContract: { address: tokenContracts.PHOENIX_AUCTION.address, abi: auctionABI, chainId: tokenContracts.PHOENIX_AUCTION.chainId },
    tokenContract: { address: tokenContracts.PHOENIX.address, abi: flareTokenABI, chainId: tokenContracts.PHOENIX.chainId },
    pairs: [], // No pool in tokenContracts
    externalUrl: 'https://app.phoenix.win/',
  },
  turbo: {
    name: 'Turbo',
    auctionContract: { address: '0x0', abi: auctionABI, chainId: 1 }, // No auction in tokenContracts
    tokenContract: { address: '0x0', abi: flareTokenABI, chainId: 1 }, // No token in tokenContracts
    pairs: [],
    externalUrl: 'https://app.turbo.win/auction',
  },
  goatx: {
    name: 'GoatX',
    auctionContract: { address: tokenContracts.GOATX_AUCTION.address, abi: auctionABI, chainId: tokenContracts.GOATX_AUCTION.chainId },
    tokenContract: { address: tokenContracts.GOATX.address, abi: flareTokenABI, chainId: tokenContracts.GOATX.chainId },
    pairs: [], // No pool in tokenContracts
    externalUrl: 'https://app.thegoatx.win/auction',
  },
};

export function getAuctionConfigs() {
  return Object.values(auctionProtocols);
}

export function getAuctionConfig(protocolKey) {
  return auctionProtocols[protocolKey];
}