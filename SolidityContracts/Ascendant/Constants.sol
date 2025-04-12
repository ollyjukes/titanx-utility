// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

address constant DEAD_ADDR = 0x000000000000000000000000000000000000dEaD;
address constant LIQUIDITY_BONDING = 0xC3F351f58b4CAF38fd76623c1bED015E59107506;
address constant GENESIS_WALLET_1 = 0x7671fd00048aB79C7D2aeCd035a3712C8eD52Aa5;
address constant GENESIS_WALLET_2 = 0x0a71b0F495948C4b3C3b9D0ADa939681BfBEEf30;
address constant TITANX_WETH_POOL = 0xc45A81BC23A64eA556ab4CdF08A86B61cdcEEA8b;

// Percentages in basis points
uint64 constant GENESIS = 0.08e18; // 8%
uint64 constant INCENTIVE_FEE = 0.015e18; //1.5%
uint64 constant HALF = 0.5e18; // 50%
uint64 constant THIRTY_PERCENT = 0.3e18; // 30%
uint64 constant SEVENTY_PERCENT = 0.7e18; // 70%
uint64 constant DRAGONX_TO_ASCENDANT_RATIO = 0.8e18; // 80%
uint64 constant DRAGONX_TO_REWARD_POOL_RATIO = 0.2e18; // 20%
uint64 constant TITANX_TO_TINC_RATIO = 0.2e18; // 20%
uint64 constant TITANX_TO_DRAGONX_RATIO = 0.72e18; // 72%
uint64 constant ASCENDANT_REDEEM_TAX = 0.06e18; // 6%
uint64 constant ASCENDANT_NFT_SALE_FEE = 0.01e18; // 1%
uint64 constant TITAN_X_LP_TAX = 0.01e18; // 1%

uint8 constant DAY_10 = 10;

uint8 constant TIER_1 = 1;
uint8 constant TIER_2 = 2;
uint8 constant TIER_3 = 3;
uint8 constant TIER_4 = 4;
uint8 constant TIER_5 = 5;
uint8 constant TIER_6 = 6;
uint8 constant TIER_7 = 7;
uint8 constant TIER_8 = 8;
uint8 constant NUMBER_OF_NFT_IMAGES_PER_TIER = 10;

uint64 constant TIER_1_PERCENTAGE = 1.01e18; // 1%
uint64 constant TIER_2_PERCENTAGE = 1.02e18; // 2%
uint64 constant TIER_3_PERCENTAGE = 1.03e18; // 3%
uint64 constant TIER_4_PERCENTAGE = 1.04e18; // 4%
uint64 constant TIER_5_PERCENTAGE = 1.05e18; // 5%
uint64 constant TIER_6_PERCENTAGE = 1.06e18; // 6%
uint64 constant TIER_7_PERCENTAGE = 1.07e18; // 7%
uint64 constant TIER_8_PERCENTAGE = 1.08e18; // 8%

uint32 constant MIN_DURATION = 8 days;
uint32 constant THREE_MONTHS_DURATION = 90 days;

uint256 constant INITIAL_TO_ASCENDANT_PRIDE = 288_000_000e18;

uint256 constant ASCENDANT_TIER_1 = 7_812.5e18; // 7,812.5 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_2 = 15_625e18; // 15,625 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_3 = 31_250e18; // 31,250 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_4 = 62_500e18; // 62,500 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_5 = 125_000e18; // 125,000 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_6 = 250_000e18; // 250,000 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_7 = 500_000e18; // 500,000 Ascendant with 18 decimals
uint256 constant ASCENDANT_TIER_8 = 1_000_000e18; // 1,000,000 Ascendant with 18 decimals

// Reward pools distribution
uint64 constant DAY8POOL_DIST = 0.5e18; // 50%
uint64 constant DAY28POOL_DIST = 0.25e18; // 25%
uint64 constant DAY90POOL_DIST = 0.25e18; // 25%

uint64 constant DISTRIBUTION_FROM_THE_ASCENDANT = 0.08e18; // 8%
uint64 constant WAD = 1e18;
uint32 constant NFT_ATTRIBUTE_RANDOM_NUMBER = 144;

/// @dev 288 * 5 = 24 hours
uint16 constant INTERVAL_TIME = 5 minutes;
uint16 constant INTERVALS_PER_DAY = uint16(24 hours / INTERVAL_TIME);

uint24 constant POOL_FEE = 10_000; // 1%
int16 constant TICK_SPACING = 200; // Uniswap's tick spacing for 1% pools is 200

///@dev The initial titanX amount needed to create liquidity pool
uint256 constant INITIAL_TITAN_X_FOR_LIQ = 14_000_000_000e18;
uint256 constant AUCTION_EMIT = 100_000_000e18;

///@dev The intial Ascendant that pairs with the initial TitanX
uint256 constant INITIAL_ASCENDANT_FOR_LP = 5_000_000e18;
