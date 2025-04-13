File: ./app/token_contracts.js
Contents:
// app/token_contracts.js
export const tokenContracts = {
  // Ascendant
  ASCENDANT: {
    name: 'Ascendant Token',
    address: '0x0943D06A5Ff3B25ddC51642717680c105AD63c01',
    chainId: 1,
    type: 'token',
  },
  ASCENDANT_AUCTION: {
    name: 'Ascendant Auction',
    address: '0x592daEb53eB1cef8aa96305588310E997ec58c0c',
    chainId: 1,
    type: 'auction',
  },
  ASCENDANT_BUY_AND_BURN: {
    name: 'Ascendant Buy and Burn',
    address: '0x27D21C4Fa62F063B5f005c5BD87cffEa62e348D1',
    chainId: 1,
    type: 'buyAndBurn',
  },
  ASCENDANT_DRAGONX: {
    name: 'ASCENDANT/DRAGONX Pool',
    address: '0xe8cC60F526bec8C663C6eEc5A65eFAe9d89Ee6aD',
    chainId: 1,
    type: 'uniswapV3Pool',
  },
  ASCENDANT_NFT_MARKETPLACE: {
    name: 'Ascendant NFT Marketplace',
    address: '0x2a7156295E85991A3861e2FAB09Eef6AcAC94717',
    chainId: 1,
    type: 'marketplace',
  },
  ASCENDANT_NFT_MINTING: {
    name: 'Ascendant NFT Minting',
    address: '0x9dA95C32C5869c84Ba2C020B5e87329eC0aDC97f',
    chainId: 1,
    type: 'minting',
  },
  ASCENDANT_PRIDE: {
    name: 'Ascendant Pride',
    address: '0x1B7C257ee2D1f30E1be2F90968258F13eD961c82',
    chainId: 1,
    type: 'special',
  },

  // Blaze
  BLAZE: {
    name: 'Blaze Token',
    address: '0xfcd7cceE4071aA4ecFAC1683b7CC0aFeCAF42A36',
    chainId: 1,
    type: 'token',
  },
  BLAZE_AUCTION: {
    name: 'Blaze Auction',
    address: '0x200ed69de20Fe522d08dF5d7CE3d69aba4e02e74',
    chainId: 1,
    type: 'auction',
  },
  BLAZE_BONFIRE: {
    name: 'Blaze Bonfire',
    address: '0x72AB9dcAc1BE635e83D0E458D2aA1FbF439B44f7',
    chainId: 1,
    type: 'bonfire',
  },
  BLAZE_BUY_AND_BURN: {
    name: 'Blaze Buy and Burn',
    address: '0x27D80441831252950C528343a4F5CcC6b1E0EA95',
    chainId: 1,
    type: 'buyAndBurn',
  },
  BLAZE_STAKING: {
    name: 'Blaze Staking',
    address: '0xBc0043bc5b0c394D9d05d49768f9548F8CF9587b',
    chainId: 1,
    type: 'staking',
  },
  BLAZE_TITANX: {
    name: 'BLAZE/TITANX Pool',
    address: '0x4D3A10d4792Dd12ececc5F3034C8e264B28485d1',
    chainId: 1,
    type: 'uniswapV2Pool',
  },

  // Bonfire
  BONFIRE: {
    name: 'Bonfire Token',
    address: '0x7d51174B02b6242D7b4510Cd988d24bC39d026c3',
    chainId: 1,
    type: 'token',
  },
  BONFIRE_BUY_AND_BURN: {
    name: 'Bonfire Buy and Burn',
    address: '0xe871fEB86093809F1c9555a83B292419BB23F699',
    chainId: 1,
    type: 'buyAndBurn',
  },
  BONFIRE_X28: {
    name: 'BONFIRE/X28 Pool',
    address: '0x2DF1230D9Bd024A9d4EdB53336165Eb27AaBc7Fd',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // DragonX
  DRAGONX: {
    name: 'DragonX Token',
    address: '0x96a5399D07896f757Bd4c6eF56461F58DB951862',
    chainId: 1,
    type: 'token',
  },
  DRAGONX_BURN_PROXY: {
    name: 'DragonX Burn Proxy',
    address: '0x1d59429571d8Fde785F45bf593E94F2Da6072Edb',
    chainId: 1,
    type: 'proxy',
  },
  DRAGONX_BUY_AND_BURN: {
    name: 'DragonX Buy and Burn',
    address: '0x1A4330EAf13869D15014abcA69516FC6AB36E54D',
    chainId: 1,
    type: 'buyAndBurn',
  },
  DRAGONX_BUY_TITANS: {
    name: 'DragonX Buy Titans',
    address: '0x1A4330EAf13869D15014abcA69516FC6AB36E54D',
    chainId: 1,
    type: 'buyAndBurn',
  },
  DRAGONX_HYBRID: {
    name: 'DragonX Hybrid',
    address: '0x619321771d67d9D8e69A3503683FcBa0678D2eF3',
    chainId: 1,
    type: 'hybrid',
  },
  DRAGONX_TITANX: {
    name: 'DRAGONX/TITANX Pool',
    address: '0x25215d9ba4403b3DA77ce50606b54577a71b7895',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // E280
  E280_BASE: {
    name: 'E280 Token (Base)',
    address: '0x058E7b30200d001130232e8fBfDF900590E0bAA9',
    chainId: 8453,
    type: 'token',
  },
  E280_ETH: {
    name: 'E280 Token (Ethereum)',
    address: '0x058E7b30200d001130232e8fBfDF900590E0bAA9',
    chainId: 1,
    type: 'token',
  },
  E280_BUY_AND_BURN: {
    name: 'E280 Buy and Burn',
    address: '0x6E83D86841C70CCA0f16bf653A22899d06935Ee2',
    chainId: 1,
    type: 'buyAndBurn',
  },
  E280_LP_DEPOSITOR: {
    name: 'E280 LP Depositor',
    address: '0xB302fbF6c9836557371a79012b540303Cc758BB3',
    chainId: 1,
    type: 'depositor',
  },
  E280_REWARD_DEPOSITOR: {
    name: 'E280 Reward Depositor',
    address: '0xD8f842150511e8F501050E8a4c6878104312d82C',
    chainId: 1,
    type: 'depositor',
  },
  E280_TAX_DEPOSITOR: {
    name: 'E280 Tax Depositor',
    address: '0x55F643B0B7b8d8B824c2b33eC392023AbefF0a52',
    chainId: 1,
    type: 'depositor',
  },
  E280_TAX_DISTRIBUTOR: {
    name: 'E280 Tax Distributor',
    address: '0x1b25cc7461a9EE4a4c8f9dA82c828D8a39ea73e4',
    chainId: 1,
    type: 'distributor',
  },
  STAX_ELEMENT280: {
    name: 'STAX/ELEMENT280 Pool',
    address: '0x190BD81780e46124245d39774776be939bB8595B',
    chainId: 1,
    type: 'uniswapV2Pool',
  },

  // Eden
  EDEN: {
    name: 'Eden Token',
    address: '0x31b2c59d760058cfe57e59472E7542f776d987FB',
    chainId: 1,
    type: 'token',
  },
  EDEN_BLOOM_POOL: {
    name: 'Eden Bloom Pool',
    address: '0xe5Da018596D0e60d704b09d0E43734266e280e05',
    chainId: 1,
    type: 'pool',
  },
  EDEN_BUY_AND_BURN: {
    name: 'Eden Buy and Burn',
    address: '0x1681EB21026104Fa63121fD517e065cEc21A4b4C',
    chainId: 1,
    type: 'buyAndBurn',
  },
  EDEN_MINING: {
    name: 'Eden Mining',
    address: '0x890B015ECA83a6CA03b436a748969976502B7c0c',
    chainId: 1,
    type: 'mining',
  },
  EDEN_STAKING: {
    name: 'Eden Staking',
    address: '0x32C611b0a96789BaA3d6bF9F0867b7E1b9d049Be',
    chainId: 1,
    type: 'staking',
  },

  // Element
  ELEMENT: {
    name: 'Element Token',
    address: '0xe9A53C43a0B58706e67341C4055de861e29Ee943',
    chainId: 1,
    type: 'token',
  },
  ELEMENT_BUY_AND_BURN: {
    name: 'Element Buy and Burn',
    address: '0x3F2b113d180ecb1457e450b9EfcAC3df1Dd29AD3',
    chainId: 1,
    type: 'buyAndBurn',
  },
  ELEMENT_BUY_AND_BURN_V2: {
    name: 'Element Buy and Burn V2',
    address: '0x88BB363b333a6291Cf7CF5931eFe7a1E2D978325',
    chainId: 1,
    type: 'buyAndBurn',
  },
  ELEMENT_HOLDER_VAULT: {
    name: 'Element Holder Vault',
    address: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97',
    chainId: 1,
    type: 'vault',
  },
  ELEMENT_NFT: {
    name: 'Element NFT',
    address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9',
    chainId: 1,
    type: 'nft',
  },

  // Element369
  ELEMENT369_FLUX_HUB: {
    name: 'Element369 Flux Hub',
    address: '0x6067487ee98B6A830cc3E5E7F57Dc194044D1F1D',
    chainId: 1,
    type: 'hub',
  },
  ELEMENT369_HOLDER_VAULT: {
    name: 'Element369 Holder Vault',
    address: '0x4e3DBD6333e649AF13C823DAAcDd14f8507ECBc5',
    chainId: 1,
    type: 'vault',
  },
  ELEMENT369_NFT: {
    name: 'Element369 NFT',
    address: '0x024D64E2F65747d8bB02dFb852702D588A062575',
    chainId: 1,
    type: 'nft',
  },

  // Flare
  FLARE: {
    name: 'Flare Token',
    address: '0x34a4FE5397bf2768189EDe14FE4adAD374B993B8',
    chainId: 1,
    type: 'token',
  },
  FLARE_AUCTION: {
    name: 'Flare Auction',
    address: '0x58aD6ef28BfB092635454D02303aDbd4D87b503C',
    chainId: 1,
    type: 'auction',
  },
  FLARE_AUCTION_BUY_AND_BURN: {
    name: 'Flare Auction Buy and Burn',
    address: '0x17d8258eC7fA1EfC9CA4c6C15f3417bF30564048',
    chainId: 1,
    type: 'buyAndBurn',
  },
  FLARE_AUCTION_TREASURY: {
    name: 'Flare Auction Treasury',
    address: '0x744D402674006f2711a3D6E4a80cc749C7915545',
    chainId: 1,
    type: 'treasury',
  },
  FLARE_BUY_AND_BURN: {
    name: 'Flare Buy and Burn',
    address: '0x6A12392C7dc5ddAA7d59007B329BFED35af092E6',
    chainId: 1,
    type: 'buyAndBurn',
  },
  FLARE_MINTING: {
    name: 'Flare Minting',
    address: '0x9983eF6Af4DE8fE58C45f6DC54Cf5Ad349431A82',
    chainId: 1,
    type: 'minting',
  },
  FLARE_X28: {
    name: 'FLARE/X28 Pool',
    address: '0x05b7Cc21A11354778Cf0D7faf159f1a99724ccFd',
    chainId: 1,
    type: 'uniswapV2Pool',
  },

  // Flux
  FLUX: {
    name: 'Flux Token',
    address: '0xBFDE5ac4f5Adb419A931a5bF64B0f3BB5a623d06',
    chainId: 1,
    type: 'token',
  },
  FLUX_777: {
    name: 'Flux 777',
    address: '0x52ca28e311f200d1CD47C06996063e14eC2d6aB1',
    chainId: 1,
    type: 'special',
  },
  FLUX_AUCTION: {
    name: 'Flux Auction',
    address: '0x36e5a8105f000029d4B3B99d0C3D0e24aaA52adF',
    chainId: 1,
    type: 'auction',
  },
  FLUX_BUY_AND_BURN: {
    name: 'Flux Buy and Burn',
    address: '0xaE14148F726E7C3AA5C0c992D044bE113b32292C',
    chainId: 1,
    type: 'buyAndBurn',
  },
  FLUX_STAKING: {
    name: 'Flux Staking',
    address: '0xd605a87187563C94c577a6E57e4a36eC8433B9aE',
    chainId: 1,
    type: 'staking',
  },
  FLUX_TITANX: {
    name: 'FLUX/TITANX Pool',
    address: '0x2278012E61c0fB38DaE1579bD41a87A59A5954c2',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // GoatX
  GOATX: {
    name: 'GoatX Token',
    address: '0x4Eca7761a516F8300711cbF920C0b85555261993',
    chainId: 1,
    type: 'token',
  },
  GOATX_AUCTION: {
    name: 'GoatX Auction',
    address: '0x059511B0BED706276Fa98877bd00ee0dD7303D32',
    chainId: 1,
    type: 'auction',
  },
  GOATX_BUY_AND_BURN: {
    name: 'GoatX Buy and Burn',
    address: '0xE6Cf4Cb42A6c37729c4546b4B9E83b97a05cE950',
    chainId: 1,
    type: 'buyAndBurn',
  },
  GOATX_MINING: {
    name: 'GoatX Mining',
    address: '0x4E83d6911bc1E191Bd207920737149B8FC060c8D',
    chainId: 1,
    type: 'mining',
  },

  // Helios
  HELIOS: {
    name: 'Helios Token',
    address: '0x2614f29C39dE46468A921Fd0b41fdd99A01f2EDf',
    chainId: 1,
    type: 'token',
  },
  HELIOS_BUY_AND_BURN: {
    name: 'Helios Buy and Burn',
    address: '0x9bff9f810d19cdb4bf7701c9d5ad101e91cda08d',
    chainId: 1,
    type: 'buyAndBurn',
  },
  HELIOS_TITANX: {
    name: 'HELIOS/TITANX Pool',
    address: '0x2C83C54C5612BfD62a78124D4A0eA001278a689c',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // Hyper
  HYPER: {
    name: 'Hyper Token',
    address: '0xE2cfD7a01ec63875cd9Da6C7c1B7025166c2fA2F',
    chainId: 1,
    type: 'token',
  },
  HYPER_BUY_AND_BURN: {
    name: 'Hyper Buy and Burn',
    address: '0x15Bec83b642217814dDAeB6F8A74ba7E0D6D157E',
    chainId: 1,
    type: 'buyAndBurn',
  },
  HYPER_TITANX: {
    name: 'HYPER/TITANX Pool',
    address: '0x14d725edB1299fF560d96f42462f0234B65B00AF',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // Hydra
  HYDRA: {
    name: 'Hydra Token',
    address: '0xCC7ed2ab6c3396DdBc4316D2d7C1b59ff9d2091F',
    chainId: 1,
    type: 'token',
  },
  HYDRA_BUY_AND_BURN: {
    name: 'Hydra Buy and Burn',
    address: '0xfEF10De0823F58DF4f5F24856aB4274EdeDa6A5c',
    chainId: 1,
    type: 'buyAndBurn',
  },
  HYDRA_DRAGONX: {
    name: 'HYDRA/DRAGONX Pool',
    address: '0xF8F0Ef9f6A12336A1e035adDDbD634F3B0962F54',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // Matrix
  MATRIX: {
    name: 'Matrix Token',
    address: '0xF2Fc894381792Ded27a7f08D9F0F246363cBe1ea',
    chainId: 1,
    type: 'token',
  },
  MATRIX_AUCTION: {
    name: 'Matrix Auction',
    address: '0x9f29E5b2d67C4a7315c5D6AbD448C45f9dD51CAF',
    chainId: 1,
    type: 'auction',
  },
  MATRIX_BUY_AND_BURN: {
    name: 'Matrix Buy and Burn',
    address: '0x50371D550e1eaB5aeC08d2D79B77B14b79dCC57E',
    chainId: 1,
    type: 'buyAndBurn',
  },
  MATRIX_HYPER: {
    name: 'MATRIX/HYPER Pool',
    address: '0x9dA4aCd7d87e7396901d92671173296bf9845c53',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // ORX
  ORX: {
    name: 'ORX Token',
    address: '0xd536e7a9543cf9867a580b45cec7f748a1fe11ec',
    chainId: 1,
    type: 'token',
  },
  ORX_MINTER: {
    name: 'ORX Minter',
    address: '0x4C93D6380D22C44850Bdfa569Df5dD96e278622B',
    chainId: 1,
    type: 'minter',
  },
  ORX_MULTISIG: {
    name: 'ORX Multisig',
    address: '0x54FDAcea0af4026306A665E9dAB635Ef5fF2963f',
    chainId: 1,
    type: 'multisig',
  },
  ORX_STAKING: {
    name: 'ORX Staking',
    address: '0xE293DFD4720308c048B63AfE885F5971E135Eb1e',
    chainId: 1,
    type: 'staking',
  },
  ORX_TITANX: {
    name: 'ORX/TITANX Pool',
    address: '0x2A216495584E406C39582d3ee583aEDA937beba6',
    chainId: 1,
    type: 'uniswapV3Pool',
  },
  USDX: {
    name: 'USDx Stable',
    address: '0xDDF73eAcB2218377FC38679aD14dfce51B651Dd1',
    chainId: 1,
    type: 'stablecoin',
  },

  // Phoenix
  PHOENIX: {
    name: 'Phoenix Token',
    address: '0xfe3F988a90dEa3eE537BB43eC1aCa7337A15D002',
    chainId: 1,
    type: 'token',
  },
  PHOENIX_AUCTION: {
    name: 'Phoenix Auction',
    address: '0xF41b5c99b8B6b88cF1Bd0320cB57e562EaF17DE1',
    chainId: 1,
    type: 'auction',
  },
  PHOENIX_BLAZE_STAKING_VAULT: {
    name: 'Phoenix Blaze Staking Vault',
    address: '0xBbe51Ee30422cb9a92D93363d2921A330813b598',
    chainId: 1,
    type: 'stakingVault',
  },
  PHOENIX_BUY_AND_BURN: {
    name: 'Phoenix Buy and Burn',
    address: '0x97eBd4f9FfCFE0cBC8F63A4e0B296FbB54f0a185',
    chainId: 1,
    type: 'buyAndBurn',
  },
  PHOENIX_FLUX_STAKING_VAULT: {
    name: 'Phoenix Flux Staking Vault',
    address: '0x3F1BFcd2a04a829ff4106217F8EB8eFa1C31e89b',
    chainId: 1,
    type: 'stakingVault',
  },
  PHOENIX_MINTING: {
    name: 'Phoenix Minting',
    address: '0xAaE97688F2c28c3E391dFddC7B26276D8445B199',
    chainId: 1,
    type: 'minting',
  },
  PHOENIX_TITANX_STAKING_VAULT: {
    name: 'Phoenix TitanX Staking Vault',
    address: '0x6B59b8E9635909B7f0FF2C577BB15c936f32619A',
    chainId: 1,
    type: 'stakingVault',
  },

  // Shogun
  SHOGUN: {
    name: 'Shogun Token',
    address: '0xfD4cB1294dF23920e683e046963117cAe6C807D9',
    chainId: 1,
    type: 'token',
  },
  SHOGUN_BUY_AND_BURN: {
    name: 'Shogun Buy and Burn',
    address: '0xF53D4f2E79d66605aE7c2CAdc0A40A1e7CbE973A',
    chainId: 1,
    type: 'buyAndBurn',
  },
  SHOGUN_TITANX: {
    name: 'SHOGUN/TITANX Pool',
    address: '0x79bd712f876c364Aa5e775A1eD40dE1FfdB2a50',
    chainId: 1,
    type: 'uniswapV2Pool',
  },

  // Stax
  STAX: {
    name: 'Stax Token',
    address: '0x4bd0F1886010253a18BBb401a788d8972c155b9d',
    chainId: 1,
    type: 'token',
  },
  STAX_BANK: {
    name: 'Stax Bank',
    address: '0x1b15e269D07986F0b8751872C16D9F47e1582402',
    chainId: 1,
    type: 'bank',
  },
  STAX_BLAZE: {
    name: 'Stax Blaze',
    address: '0x03a48BaadAe6A0474aDc6F39111428BaDbfb54D1',
    chainId: 1,
    type: 'staking',
  },
  STAX_BUY_AND_BURN: {
    name: 'Stax Buy and Burn',
    address: '0x1698a3e248FF7F0f1f91FE82Eedaa3F1212D1F7F',
    chainId: 1,
    type: 'buyAndBurn',
  },
  STAX_EDEN: {
    name: 'Stax Eden',
    address: '0x5d91C1180f063c66DC0a08CE136AeC92B97f8F87',
    chainId: 1,
    type: 'staking',
  },
  STAX_FLUX: {
    name: 'Stax Flux',
    address: '0xC3379750B254977f195BA60D096BBcCfe6b81ce8',
    chainId: 1,
    type: 'staking',
  },
  STAX_HELIOS: {
    name: 'Stax Helios',
    address: '0xCd5fd72664f5A4dB62E44e9c778E9dAeB01F2bB2',
    chainId: 1,
    type: 'staking',
  },
  STAX_HELIOS_V2: {
    name: 'Stax Helios V2',
    address: '0x3A50Cc9740DE6143c8d53Df44ece96Eeb07318E8',
    chainId: 1,
    type: 'staking',
  },
  STAX_HOLDER_VAULT: {
    name: 'Stax Holder Vault',
    address: '0x5D27813C32dD705404d1A78c9444dAb523331717',
    chainId: 1,
    type: 'vault',
  },
  STAX_HYPER: {
    name: 'Stax Hyper',
    address: '0xa23f149f10f415c56b1629Fe07bf94278c808271',
    chainId: 1,
    type: 'staking',
  },
  STAX_NFT: {
    name: 'Stax NFT',
    address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1',
    chainId: 1,
    type: 'nft',
  },
  STAX_ORX: {
    name: 'Stax ORX',
    address: '0xF1b7081Cab015ADB3c1B8D3A8732763dBc87B744',
    chainId: 1,
    type: 'staking',
  },
  STAX_TITANX: {
    name: 'Stax TitanX',
    address: '0x802974Ea9362b46a6eeAb4431E030D17dF6613E8',
    chainId: 1,
    type: 'staking',
  },

  // TitanX
  TITANX: {
    name: 'TitanX Token',
    address: '0xF19308F923582A6f7c465e5CE7a9Dc1BEC6665B1',
    chainId: 1,
    type: 'token',
  },
  TITANX_BUY_AND_BURN_V1: {
    name: 'TitanX Buy and Burn V1',
    address: '0x1393ad734EA3c52865b4B541cf049dafd25c23a5',
    chainId: 1,
    type: 'buyAndBurn',
  },
  TITANX_BUY_AND_BURN_V2: {
    name: 'TitanX Buy and Burn V2',
    address: '0x410e10C33a49279f78CB99c8d816F18D5e7D5404',
    chainId: 1,
    type: 'buyAndBurn',
  },
  TITANX_TREASURY: {
    name: 'TitanX Treasury',
    address: '0xA2d21205Aa7273BadDFC8E9551e05E23bB49ce46',
    chainId: 1,
    type: 'treasury',
  },
  TITANX_WETH: {
    name: 'TITANX/WETH Pool',
    address: '0xc45A81BC23A64eA556ab4CdF08A86B61cdcEEA8b',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // USDC
  USDC: {
    name: 'USDC Token',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1,
    type: 'stablecoin',
  },

  // Volt
  VOLT: {
    name: 'Volt Token',
    address: '0x66b5228CfD34d9f4d9f03188d67816286C7c0b74',
    chainId: 1,
    type: 'token',
  },
  VOLT_AUCTION: {
    name: 'Volt Auction',
    address: '0xb3f2bE29BA969588E07bF7512e07008D6fdeB17B',
    chainId: 1,
    type: 'auction',
  },
  VOLT_BUY_AND_BURN: {
    name: 'Volt Buy and Burn',
    address: '0x2801592e5Cdd85aC4e462DB2abC80951705cf601',
    chainId: 1,
    type: 'buyAndBurn',
  },
  VOLT_TITANX: {
    name: 'VOLT/TITANX Pool',
    address: '0x3F1A36B6C946E406f4295A89fF06a5c7d62F2fe2',
    chainId: 1,
    type: 'uniswapV3Pool',
  },
  VOLT_TREASURY: {
    name: 'Volt Treasury',
    address: '0xb638BFB7BC3B8398bee48569CFDAA6B3Bb004224',
    chainId: 1,
    type: 'treasury',
  },

  // Vyper
  VYPER: {
    name: 'Vyper Token',
    address: '0xd7fa4cFC22eA07DfCeD53033fbE59d8b62B8Ee9E',
    chainId: 1,
    type: 'token',
  },
  VYPER_BOOST_AUCTION: {
    name: 'Vyper Boost Auction',
    address: '0x4D994F53FE2d8BdBbF64dC2e53C58Df00b84e713',
    chainId: 1,
    type: 'auction',
  },
  VYPER_BOOST_TREASURY: {
    name: 'Vyper Boost Treasury',
    address: '0x637dfBB5db0cf7B4062cb577E24cfB43c67d72BA',
    chainId: 1,
    type: 'treasury',
  },
  VYPER_CLASSIC_AUCTION: {
    name: 'Vyper Classic Auction',
    address: '0xC1da113c983b26aa2c3f4fFD5f10b47457FC3397',
    chainId: 1,
    type: 'auction',
  },
  VYPER_CLASSIC_TREASURY: {
    name: 'Vyper Classic Treasury',
    address: '0xeb103eb39375077c5Afaa04150B4D334df69128A',
    chainId: 1,
    type: 'treasury',
  },
  VYPER_DRAGONX: {
    name: 'VYPER/DRAGONX Pool',
    address: '0x214CAD3f7FbBe66919968Fa3a1b16E84cFcd457F',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // WETH
  WETH: {
    name: 'Wrapped Ether',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    chainId: 1,
    type: 'token',
  },

  // WETH/USDC Pool
  WETH_USDC: {
    name: 'WETH/USDC Pool',
    address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    chainId: 1,
    type: 'uniswapV3Pool',
  },

  // X28
  X28: {
    name: 'X28 Omnichain Token',
    address: '0x5c47902c8C80779CB99235E42C354E53F38C3B0d',
    chainId: 1,
    type: 'token',
  },
  X28_BUY_AND_BURN: {
    name: 'X28 Buy and Burn',
    address: '0xa3144E7FCceD79Ce6ff6E14AE9d8DF229417A7a2',
    chainId: 1,
    type: 'buyAndBurn',
  },
  X28_TITANX: {
    name: 'X28/TITANX Pool',
    address: '0x99f60479da6A49D55eBA34893958cdAACc710eE9',
    chainId: 1,
    type: 'uniswapV3Pool',
  },
};

export const auctionABI = [
  {
    type: 'function',
    name: 'startTimestamp',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'dailyStats',
    inputs: [{ name: 'day', type: 'uint32' }],
    outputs: [
      { name: 'titanXDeposited', type: 'uint256' },
      { name: 'ethDeposited', type: 'uint256' },
      { name: 'flareEmitted', type: 'uint256' },
      { name: 'depositsLocked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
];

export const flareTokenABI = [
  {
    type: 'function',
    name: 'x28FlarePool',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
];

export const uniswapPoolABI = [
  {
    type: 'function',
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
];

export const uniswapV2PoolABI = [
  {
    type: 'function',
    name: 'getReserves',
    inputs: [],
    outputs: [
      { name: '_reserve0', type: 'uint112' },
      { name: '_reserve1', type: 'uint112' },
      { name: '_blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token0',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'token1',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
];