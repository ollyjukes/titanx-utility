// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@utils/Errors.sol";
import "@const/Constants.sol";
import {Time} from "@utils/Time.sol";
import {IWETH9} from "@interfaces/IWETH.sol";
import {Ascendant} from "@core/Ascendant.sol";
import {AscendantPride} from "@core/AscendantPride.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AscendantBuyAndBurn} from "@core/AscendantBuyAndBurn.sol";
import {wmul} from "@utils/Math.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SwapActions, SwapActionParams} from "@actions/SwapActions.sol";
import {IAscendant, IAscendantBuyAndBurn} from "@interfaces/IAscendant.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {INonfungiblePositionManager} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

/**
 * @dev Struct representing Uniswap V3 Liquidity Position details
 * @param hasLP Boolean indicating if liquidity has been added
 * @param isAscendantToken0 Boolean indicating if Ascendant is token0 in the pair
 * @param tokenId Uniswap V3 NFT position ID
 */
struct LP {
    bool hasLP;
    bool isAscendantToken0;
    uint256 tokenId;
}

/**
 * @dev Struct tracking daily auction statistics
 * @param ascendantEmitted Amount of Ascendant tokens emitted for the day
 * @param titanXDeposited Total TitanX tokens deposited for the day
 */
struct DailyStatistic {
    uint256 ascendantEmitted;
    uint256 titanXDeposited;
}

/**
 * @title AscendantAuction
 * @author Decentra
 * @dev Contract managing the auction of Ascendant tokens through TitanX deposits
 *      and subsequent liquidity management in Uniswap V3.
 *
 * @notice This contract:
 *         - Manages daily auctions for Ascendant tokens
 *         - Handles TitanX and ETH deposits
 *         - Manages Uniswap V3 liquidity
 *         - Processes fee collection and distribution
 *         - Tracks daily statistics and user deposits
 */
contract AscendantAuction is SwapActions {
    using SafeERC20 for IERC20;
    using SafeERC20 for IAscendant;
    using Math for uint256;

    /* == IMMUTABLES == */

    IAscendant immutable ascendant; // Ascendant token contract
    IERC20 public immutable titanX; // TitanX token contract
    IERC20 public immutable dragonX; // DragonX token contract
    IWETH9 public immutable weth; // Wrapped ETH contract
    uint32 public immutable startTimestamp;
    address public immutable tincBnB;
    address public immutable uniswapV3PositionManager;

    /* == STATE == */
    uint256 public totalTitanXDeposited;
    uint128 lpSlippage = WAD - 0.2e18; // Liquidity provision slippage tolerance (default: WAD - 0.2e18)

    LP public lp;
    AscendantPride public immutable ascendantPride;

    /**
     * @notice Mapping for user deposits and daily statistics
     */
    mapping(address => mapping(uint32 day => uint256 amount)) public depositOf;
    mapping(uint32 day => DailyStatistic) public dailyStats;

    /* == ERRORS == */
    error AscendantAuction__InvalidInput();
    error AscendantAuction__OnlyClaimableTheNextDay();
    error AscendantAuction__LiquidityAlreadyAdded();
    error AscendantAuction__NotStartedYet();
    error AscendantAuction__NothingToClaim();
    error AscendantAuction__InvalidSlippage();
    error AscendantAuction__NotEnoughTitanXForLiquidity();
    error AscendantAuction__TreasuryAscendantIsEmpty();

    /* == EVENTS === */

    event Deposit(address indexed user, uint256 indexed titanXAmount, uint32 indexed day);
    event UserClaimed(address indexed user, uint256 indexed ascendantAmount, uint32 indexed day);

    /* == CONSTRUCTOR == */
    /**
     * @notice Constructor for AscendantAuction
     * @dev Initializes core contract references and auction parameters
     * @param _ascendant Address of the Ascendant token contract
     * @param _dragonX Address of the DragonX token contract
     * @param _titanX Address of the TitanX token contract
     * @param _weth Address of the WETH contract
     * @param _tincBnB Address of the TincBnB contract
     * @param _uniswapV3PositionManager Address of Uniswap V3 position manager
     * @param _params SwapActions initialization parameters
     * @param _startTimestamp Timestamp when the auction starts
     */
    constructor(
        address _ascendant,
        address _dragonX,
        address _titanX,
        address _weth,
        address _tincBnB,
        address _uniswapV3PositionManager,
        SwapActionParams memory _params,
        uint32 _startTimestamp
    )
        payable
        SwapActions(_params)
        notAddress0(_ascendant)
        notAddress0(_dragonX)
        notAddress0(_titanX)
        notAddress0(_weth)
        notAddress0(_tincBnB)
        notAddress0(_uniswapV3PositionManager)
    {
        // nftCollection address
        ascendant = IAscendant(_ascendant);
        dragonX = IERC20(_dragonX);
        titanX = IERC20(_titanX);
        weth = IWETH9(_weth);
        tincBnB = _tincBnB;
        ascendantPride = new AscendantPride(address(this), _ascendant);
        uniswapV3PositionManager = _uniswapV3PositionManager;
        startTimestamp = _startTimestamp;
    }

    //==========================//
    //==========PUBLIC==========//
    //==========================//

    /**
     * @notice Claims Ascendant tokens for a specific day
     * @param _day The day to claim tokens for
     */
    function claim(uint32 _day) public {
        uint32 daySinceStart = Time.daysSince(startTimestamp) + 1;
        if (_day == daySinceStart) revert AscendantAuction__OnlyClaimableTheNextDay();

        uint256 toClaim = amountToClaim(msg.sender, _day);

        if (toClaim == 0) revert AscendantAuction__NothingToClaim();

        emit UserClaimed(msg.sender, toClaim, _day);

        ascendant.safeTransfer(msg.sender, toClaim);

        depositOf[msg.sender][_day] = 0;
    }

    /**
     * @notice Calculates claimable Ascendant tokens for a user on a specific day
     * @param _user Address of the user
     * @param _day Day to check
     * @return toClaim Amount of Ascendant tokens claimable
     */
    function amountToClaim(address _user, uint32 _day) public view returns (uint256 toClaim) {
        uint256 depositAmount = depositOf[_user][_day];
        DailyStatistic memory stats = dailyStats[_day];

        return (depositAmount * stats.ascendantEmitted) / stats.titanXDeposited;
    }

    /**
     * @notice Calculates total claimable Ascendant tokens for a user across multiple days
     * @dev Sums up all claimable amounts for the specified days
     * @param _user Address of the user to check
     * @param _days Array of days to check for claimable amounts
     * @return toClaim Total amount of Ascendant tokens claimable across all specified days
     */
    function batchClaimableAmount(address _user, uint32[] calldata _days) public view returns (uint256 toClaim) {
        for (uint256 i; i < _days.length; ++i) {
            toClaim += amountToClaim(_user, _days[i]);
        }
    }

    //==========================//
    //=========EXTERNAL=========//
    //==========================//

    /**
     * @notice Updates LP slippage tolerance
     * @param _newSlippage New slippage value
     */
    function changeLPSlippage(uint128 _newSlippage) external onlyOwner notAmount0(_newSlippage) {
        if (_newSlippage > WAD) revert AscendantAuction__InvalidSlippage();
        lpSlippage = _newSlippage;
    }

    /**
     * @notice Batch claims Ascendant tokens for multiple days at once
     * @dev Executes claim function for each specified day
     * @param _days Array of days to claim tokens for
     */
    function batchClaim(uint32[] calldata _days) external {
        for (uint256 i; i < _days.length; ++i) {
            claim(_days[i]);
        }
    }

    /**
     * @notice Deposits TitanX tokens for auction participation
     * @param _amount Amount of TitanX to deposit
     */
    function depositTitanX(uint256 _amount) external {
        if (_amount == 0) revert AscendantAuction__InvalidInput();

        if (startTimestamp > Time.blockTs()) revert AscendantAuction__NotStartedYet();

        _updateAuction();

        uint32 daySinceStart = Time.daysSince(startTimestamp) + 1;

        DailyStatistic storage stats = dailyStats[daySinceStart];

        titanX.transferFrom(msg.sender, address(this), _amount);

        _deposit(_amount);

        depositOf[msg.sender][daySinceStart] += _amount;

        stats.titanXDeposited += _amount;
        totalTitanXDeposited += _amount;

        emit Deposit(msg.sender, _amount, daySinceStart);
    }

    /**
     * @notice Deposits ETH which is converted to TitanX for auction participation
     * @dev Converts ETH to WETH, then swaps for TitanX using Uniswap
     * @param _amountTitanXMin Minimum amount of TitanX to receive after swap
     * @param _deadline Deadline for the swap transaction
     */
    function depositETH(uint256 _amountTitanXMin, uint32 _deadline) external payable notExpired(_deadline) {
        if (msg.value == 0) revert AscendantAuction__InvalidInput();

        if (startTimestamp > Time.blockTs()) revert AscendantAuction__NotStartedYet();

        _updateAuction();

        weth.deposit{value: msg.value}();

        uint256 titanXAmount = swapExactInput(address(weth), address(titanX), msg.value, _amountTitanXMin, _deadline);

        uint32 daySinceStart = Time.daysSince(startTimestamp) + 1;

        DailyStatistic storage stats = dailyStats[daySinceStart];

        _deposit(titanXAmount);

        depositOf[msg.sender][daySinceStart] += titanXAmount;

        stats.titanXDeposited += titanXAmount;
        totalTitanXDeposited += titanXAmount;

        emit Deposit(msg.sender, titanXAmount, daySinceStart);
    }

    /**
     * @notice Creates and adds initial liquidity to Uniswap V3 pool
     * @dev Only owner can call this once
     * @param _deadline Deadline for the liquidity addition
     */
    function addLiquidityToAscendantDragonXPool(uint32 _deadline) external onlyOwner notExpired(_deadline) {
        if (lp.hasLP) revert AscendantAuction__LiquidityAlreadyAdded();

        if (titanX.balanceOf(address(this)) < INITIAL_TITAN_X_FOR_LIQ) {
            revert AscendantAuction__NotEnoughTitanXForLiquidity();
        }

        uint256 _excessAmount = titanX.balanceOf(address(this)) - INITIAL_TITAN_X_FOR_LIQ;

        uint256 _dragonXAmount =
            swapExactInput(address(titanX), address(dragonX), INITIAL_TITAN_X_FOR_LIQ, 0, _deadline);

        ascendant.emitForLp();

        (uint256 amount0, uint256 amount1, uint256 amount0Min, uint256 amount1Min, address token0, address token1) =
            _sortAmounts(_dragonXAmount, INITIAL_ASCENDANT_FOR_LP);

        ERC20Burnable(token0).approve(uniswapV3PositionManager, amount0);
        ERC20Burnable(token1).approve(uniswapV3PositionManager, amount1);

        // wake-disable-next-line
        INonfungiblePositionManager.MintParams memory params = INonfungiblePositionManager.MintParams({
            token0: token0,
            token1: token1,
            fee: POOL_FEE,
            tickLower: (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING,
            tickUpper: (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING,
            amount0Desired: amount0,
            amount1Desired: amount1,
            amount0Min: amount0Min,
            amount1Min: amount1Min,
            recipient: address(this),
            deadline: _deadline
        });

        // wake-disable-next-line
        (uint256 tokenId,,,) = INonfungiblePositionManager(uniswapV3PositionManager).mint(params);

        bool isAscendantToken0 = token0 == address(ascendant);

        lp = LP({hasLP: true, tokenId: tokenId, isAscendantToken0: isAscendantToken0});

        if (_excessAmount > 0) {
            titanX.transfer(owner(), _excessAmount);
        }

        _transferOwnership(address(0));
    }

    /**
     * @notice Collects the accrued fees from the UniswapV3 position
     * @return amount0 The amount of token0 collected
     * @return amount1 The amount of token1 collected
     */
    function collectFees() external returns (uint256 amount0, uint256 amount1) {
        LP memory _lp = lp;

        INonfungiblePositionManager.CollectParams memory params = INonfungiblePositionManager.CollectParams({
            tokenId: _lp.tokenId,
            recipient: address(this),
            amount0Max: type(uint128).max,
            amount1Max: type(uint128).max
        });

        (amount0, amount1) = INonfungiblePositionManager(uniswapV3PositionManager).collect(params);

        (uint256 ascendantAmount, uint256 dragonXAmount) =
            _lp.isAscendantToken0 ? (amount0, amount1) : (amount1, amount0);

        dragonX.transfer(LIQUIDITY_BONDING, dragonXAmount);

        sendToGenesisWallets(ascendant, ascendantAmount);
    }

    //==========================//
    //=========INTERNAL=========//
    //==========================//

    /**
     * @dev Internal function to distribute deposited TitanX tokens
     * @param _amount Amount of TitanX to distribute
     */
    function _deposit(uint256 _amount) internal {
        //@note - If there is no added liquidity, but the balance exceeds the initial for liquidity, we should distribute the difference
        if (!lp.hasLP) {
            uint256 titanXBalance = titanX.balanceOf(address(this));

            if (titanXBalance <= INITIAL_TITAN_X_FOR_LIQ) return;

            _amount = titanXBalance - INITIAL_TITAN_X_FOR_LIQ;
        }

        uint256 titanXLPTax = wmul(_amount, TITAN_X_LP_TAX);

        _amount -= titanXLPTax;

        uint256 titanXToConvertToDragonX = wmul(_amount, TITANX_TO_DRAGONX_RATIO);
        uint256 titanXToSendToTincBnB = wmul(_amount, TITANX_TO_TINC_RATIO);
        uint256 titanXToSendToGenesisWallet = wmul(_amount, GENESIS);

        titanX.safeTransfer(LIQUIDITY_BONDING, titanXLPTax); // 1% titanX send to the LP

        IAscendantBuyAndBurn bnb = ascendant.buyAndBurn();

        titanX.approve(address(bnb), titanXToConvertToDragonX); // 72% of that is approved to the ascendant BnB

        bnb.distributeTitanXForBurning(titanXToConvertToDragonX);

        titanX.safeTransfer(tincBnB, titanXToSendToTincBnB); // 20% titanX send to dragonX TINC BnB

        sendToGenesisWallets(titanX, titanXToSendToGenesisWallet); // 8% titanX send to genesis wallets
    }

    /**
     * @dev Updates the auction state for the current day
     * @notice Handles Ascendant token emission for the current auction day
     */
    function _updateAuction() internal {
        uint32 daySinceStart = Time.daysSince(startTimestamp) + 1;

        if (dailyStats[daySinceStart].ascendantEmitted != 0) return;

        if (daySinceStart > DAY_10 && ascendant.balanceOf(address(ascendantPride)) == 0) {
            revert AscendantAuction__TreasuryAscendantIsEmpty();
        }

        uint256 emitted = (daySinceStart <= DAY_10) ? ascendant.emitForAuction() : ascendantPride.emitForAuction();

        dailyStats[daySinceStart].ascendantEmitted = emitted;
    }

    /**
     * @dev Sorts token amounts for liquidity provision
     * @param _dragonXAmount Amount of DragonX tokens
     * @param _ascendantAmount Amount of Ascendant tokens
     * @return amount0 Amount of token0
     * @return amount1 Amount of token1
     * @return amount0Min Minimum amount of token0 accounting for slippage
     * @return amount1Min Minimum amount of token1 accounting for slippage
     * @return token0 Address of token0 (lower address between Ascendant and DragonX)
     * @return token1 Address of token1 (higher address between Ascendant and DragonX)
     */
    function _sortAmounts(uint256 _dragonXAmount, uint256 _ascendantAmount)
        internal
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            uint256 amount0Min,
            uint256 amount1Min,
            address token0,
            address token1
        )
    {
        address _ascendant = address(ascendant);
        address _dragonX = address(dragonX);

        (token0, token1) = _ascendant < _dragonX ? (_ascendant, _dragonX) : (_dragonX, _ascendant);
        (amount0, amount1) =
            token0 == _ascendant ? (_ascendantAmount, _dragonXAmount) : (_dragonXAmount, _ascendantAmount);

        (amount0Min, amount1Min) = (wmul(amount0, lpSlippage), wmul(amount1, lpSlippage));
    }

    //==========================//
    //==========PRIVATE=========//
    //==========================//

    function sendToGenesisWallets(IERC20 erc20Token, uint256 _amount) private {
        uint256 genesisHalf = wmul(_amount, HALF);

        erc20Token.safeTransfer(GENESIS_WALLET_1, genesisHalf);
        erc20Token.safeTransfer(GENESIS_WALLET_2, genesisHalf);
    }
}
