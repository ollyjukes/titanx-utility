// Concatenated Solidity source for Ascendant contracts
// Generated on Sat 12 Apr 2025 18:57:12 BST

// Source: ./SolidityContracts/Ascendant/Ascendant.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@const/Constants.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {wdiv, wmul, sub, wpow, sqrt} from "@utils/Math.sol";
import {AscendantPride} from "@core/AscendantPride.sol";
import {FullMath} from "v3-core/contracts/libraries/FullMath.sol";
import {AscendantAuction} from "./AscendantAuction.sol";
import {AscendantBuyAndBurn} from "./AscendantBuyAndBurn.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IUniswapV3Pool} from "v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {IQuoter} from "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {INonfungiblePositionManager} from "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

/**
 * @title Ascendant Token Contract
 * @author Decentra
 * @notice Implementation of a hyper-deflationary token with Uniswap V3 integration and DragonX ecosystem rewards
 * @dev Contract inherits ERC20Burnable for token burns and Ownable2Step for secure ownership management
 *      Integrates with:
 *      - Uniswap V3 for primary liquidity pool (DragonX/Ascendant pair)
 *      - AscendantAuction for daily token distributions
 *      - AscendantPride for post-day-10 auction mechanics
 *      - AscendantBuyAndBurn for deflationary mechanisms
 *      Features:
 *      - Fixed max supply of 1.155B tokens
 *      - Initial liquidity of 5M tokens
 *      - Daily auctions for first 10 days
 *      - Automated buy-and-burn mechanism
 *      - DragonX ecosystem rewards distribution
 */
contract Ascendant is ERC20Burnable, Ownable2Step {
    using FullMath for uint256;

    /* ==== IMMUTABLES ==== */

    /**
     * @notice The immutable address of the Uniswap V3 pool for DragonX/Ascendant pair
     */
    address public immutable dragonXAscendantPool;

    /* ==== STATE ==== */

    /**
     * @notice The auction contract responsible for daily token distributions
     */
    AscendantAuction public auction;

    /**
     * @notice The buy and burn contract that manages token burning mechanics
     */
    AscendantBuyAndBurn public buyAndBurn;

    /**
     * @notice The pride contract that manages tokens for future auctions after day 10
     */
    AscendantPride public ascendantPride;

    /* ==== ERRORS ==== */

    error OnlyAuction();

    /* ==== CONSTRUCTOR ==== */

    /**
     * @notice Initializes the Ascendant token and creates the initial DragonX/Ascendant liquidity pool
     * @dev Sets up initial token supply and creates Uniswap V3 pool for DragonX/Ascendant pair
     * @param _titanX Address of the TitanX token contract used for minting and auctions
     * @param _dragonX Address of the DragonX token contract for liquidity pairing
     * @param _quoter Address of the Uniswap V3 Quoter contract for price calculations
     * @param _uniswapV3PositionManager Address of the Uniswap V3 NonfungiblePositionManager
     */
    constructor(address _titanX, address _dragonX, address _quoter, address _uniswapV3PositionManager)
        payable
        ERC20("Ascendant.win", "Ascend")
        Ownable(msg.sender)
    {
        _mint(LIQUIDITY_BONDING, 50_000_000e18);
        _mint(msg.sender, INITIAL_TO_ASCENDANT_PRIDE);
        dragonXAscendantPool = _createUniswapV3Pool(_titanX, _dragonX, _quoter, _uniswapV3PositionManager);
    }

    //==========================//
    //=========MODIFIERS========//
    //==========================//

    /**
     * @dev Modifier to ensure the function is called only by the Auction contract.
     *      Uses _onlyAuction() instead of inline check for gas optimization.
     */
    modifier onlyAuction() {
        _onlyAuction();
        _;
    }

    //==========================//
    //=========EXTERNAL=========//
    //==========================//

    /**
     * @notice Sets the address of the AscendantAuction contract
     * @dev Updates both the auction contract reference and retrieves the associated pride contract
     * @param _ascendantAuction Address of the new auction contract
     */
    function setAscendantAuction(address payable _ascendantAuction) external onlyOwner {
        auction = AscendantAuction(_ascendantAuction);
        ascendantPride = auction.ascendantPride();
    }

    /**
     * @notice Sets the address of the AscendantBuyAndBurn contract
     * @dev Updates the contract reference for the buy and burn mechanism
     * @param _ascendantBuyAndBurn Address of the new buy and burn contract
     */
    function setAscendantBuyAndBurn(address _ascendantBuyAndBurn) external onlyOwner {
        buyAndBurn = AscendantBuyAndBurn(_ascendantBuyAndBurn);
    }

    /**
     * @notice Mints daily auction tokens
     * @dev Mints AUCTION_EMIT amount of tokens to the auction contract
     * @return emitted Amount of tokens minted for the auction
     */
    function emitForAuction() external onlyAuction returns (uint256 emitted) {
        emitted = AUCTION_EMIT;

        _mint(address(auction), emitted);
    }

    /**
     * @notice Mints initial liquidity tokens
     * @dev Mints INITIAL_ASCENDANT_FOR_LP tokens to the auction contract for LP formation
     * @return emitted Amount of tokens minted for initial liquidity
     */
    function emitForLp() external onlyAuction returns (uint256 emitted) {
        emitted = INITIAL_ASCENDANT_FOR_LP;

        _mint(address(auction), emitted);
    }

    //==========================//
    //=========INTERNAL=========//
    //==========================//

    /**
     * @dev Private method is used instead of inlining into modifier because modifiers are copied into each method,
     *      and the use of immutable means the address bytes are copied in every place the modifier is used.
     */
    function _onlyAuction() internal view {
        if (msg.sender != address(auction)) revert OnlyAuction();
    }

    /**
     * @notice Creates and initializes a Uniswap V3 pool for DragonX/Ascendant pair
     * @dev Sets up initial liquidity ratio and configures pool parameters.
     * @param _titanX Address of the TitanX token used to calculate initial DragonX amount
     * @param _dragonX Address of the DragonX token for pool pairing
     * @param UNISWAP_V3_QUOTER Address of Uniswap V3 Quoter contract for price calculations
     * @param UNISWAP_V3_POSITION_MANAGER Address of Uniswap V3 NonfungiblePositionManager
     * @return _pool Address of the newly created Uniswap V3 pool
     */
    function _createUniswapV3Pool(
        address _titanX,
        address _dragonX,
        address UNISWAP_V3_QUOTER,
        address UNISWAP_V3_POSITION_MANAGER
    ) internal returns (address _pool) {
        address _ascendant = address(this);

        IQuoter quoter = IQuoter(UNISWAP_V3_QUOTER);

        bytes memory path = abi.encodePacked(address(_titanX), POOL_FEE, address(_dragonX));

        uint256 dragonXAmount = quoter.quoteExactInput(path, INITIAL_TITAN_X_FOR_LIQ);

        uint256 ascendantAmount = INITIAL_ASCENDANT_FOR_LP;

        (address token0, address token1) = _ascendant < _dragonX ? (_ascendant, _dragonX) : (_dragonX, _ascendant);

        (uint256 amount0, uint256 amount1) =
            token0 == _dragonX ? (dragonXAmount, ascendantAmount) : (ascendantAmount, dragonXAmount);

        uint160 sqrtPX96 = uint160((sqrt((amount1 * 1e18) / amount0) * 2 ** 96) / 1e9);

        INonfungiblePositionManager manager = INonfungiblePositionManager(UNISWAP_V3_POSITION_MANAGER);

        _pool = manager.createAndInitializePoolIfNecessary(token0, token1, POOL_FEE, sqrtPX96);

        IUniswapV3Pool(_pool).increaseObservationCardinalityNext(uint16(200));
    }
}

// Source: ./SolidityContracts/Ascendant/AscendantAuction.sol
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

// Source: ./SolidityContracts/Ascendant/AscendantBuyAndBurn.sol
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import "@const/Constants.sol";
import {Time} from "@utils/Time.sol";
import {Ascendant} from "@core/Ascendant.sol";
import {AscendantPride} from "@core/AscendantPride.sol";
import {IAscendant} from "@interfaces/IAscendant.sol";
import {wmul} from "@utils/Math.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AscendantNFTMinting} from "@core/AscendantNFTMinting.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SwapActions, SwapActionParams} from "@actions/SwapActions.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title AscendantBuyAndBurn
 * @author Decentra
 * @notice This contract manages the automated buying and burning of Ascendant tokens using DragonX through Uniswap V3 pools
 * @dev Inherits from SwapActions to handle Uniswap V3 swap functionality
 */
contract AscendantBuyAndBurn is SwapActions {
    using SafeERC20 for IERC20;
    using Math for uint256;

    //=============STRUCTS============//

    /**
     * @notice Represents an interval for token burning operations
     * @param amountAllocated Amount of tokens allocated for burning in this interval
     * @param amountBurned Amount of tokens that have been burned in this interval
     */
    struct Interval {
        uint128 amountAllocated;
        uint128 amountBurned;
    }

    //===========IMMUTABLE===========//

    IAscendant immutable ascendant;
    IERC20 public immutable dragonX;
    ERC20Burnable public immutable titanX;
    uint32 public immutable startTimeStamp;
    AscendantNFTMinting public immutable nftMinting;

    //===========STATE===========//

    uint256 public totalAscendantBurnt;
    uint256 public lastBurnedInterval;
    uint256 public totalTitanXDistributed;
    uint256 public currentBnBPressure;

    uint128 public swapCap;

    mapping(uint32 interval => Interval) public intervals;

    uint32 public lastIntervalNumber;
    uint32 public lastBurnedIntervalStartTimestamp;
    uint32 public lastSnapshot;

    AscendantPride public ascendantPride;

    //===========EVENTS===========//

    /**
     * @notice Emitted when tokens are bought and burned
     * @param dragonXAmount Amount of DragonX tokens used in the operation
     * @param ascendantBurnt Amount of Ascendant tokens that were burned
     * @param caller Address that initiated the buy and burn operation
     */
    event BuyAndBurn(uint256 indexed dragonXAmount, uint256 indexed ascendantBurnt, address indexed caller);

    //===========ERRORS===========//

    error AscendantBuyAndBurn__NotStartedYet();
    error AscendantBuyAndBurn__IntervalAlreadyBurned();
    error AscendantBuyAndBurn__OnlySlippageAdmin();
    error AscendantBuyAndBurn__OnlyEOA();
    error AscendantBuyAndBurn__InvalidStartTime();

    //========CONSTRUCTOR========//
    /**
     * @notice Initializes the AscendantBuyAndBurn contract with required parameters and contracts
     * @param _startTimestamp The Unix timestamp when the contract should begin operations
     * @param _dragonX The address of the DragonX ERC20 token contract
     * @param _titanX The address of the TitanX burnable token contract
     * @param _ascendant The address of the Ascendant token contract
     * @param _params Parameters for initializing the SwapActions base contract
     * @param _ascendantRecycle The AscendantPride contract address for recycling operations
     * @param _nftMinting The address of the NFT minting contract for reward distributions
     * @dev Initializes the contract with the following operations:
     * - Inherits SwapActions with provided swap parameters
     * - Verifies all address parameters are non-zero
     * - Sets initial state variables and contract references
     * - Approves NFT minting contract to spend DragonX tokens
     * - Sets initial swap cap to maximum uint128 value
     */
    constructor(
        uint32 _startTimestamp,
        address _dragonX,
        address _titanX,
        address _ascendant,
        SwapActionParams memory _params,
        AscendantPride _ascendantRecycle,
        address _nftMinting
    )
        SwapActions(_params)
        notAddress0(_ascendant)
        notAddress0(_dragonX)
        notAddress0(_titanX)
        notAddress0(address(_ascendantRecycle))
        notAddress0(_nftMinting)
    {
        require(_startTimestamp % Time.SECONDS_PER_DAY == Time.TURN_OVER_TIME, AscendantBuyAndBurn__InvalidStartTime());

        startTimeStamp = _startTimestamp;
        ascendant = IAscendant(_ascendant);
        dragonX = IERC20(_dragonX);
        titanX = ERC20Burnable(_titanX);
        nftMinting = AscendantNFTMinting(_nftMinting);
        ascendantPride = _ascendantRecycle;
        swapCap = type(uint128).max;

        dragonX.approve(address(nftMinting), type(uint256).max); // to save from fees
    }

    //========MODIFIERS=======//

    /**
     * @notice Ensures interval state is updated before executing the modified function
     * @dev Calls _intervalUpdate() before function execution and allows function to proceed
     */
    modifier intervalUpdate() {
        _intervalUpdate();
        _;
    }

    /**
     * @notice Restricts function access to the slippage admin
     * @dev Calls _onlySlippageAdmin() to verify caller before function execution
     */
    modifier onlySlippageAdmin() {
        _onlySlippageAdmin();
        _;
    }

    //==========================//
    //=========EXTERNAL=========//
    //==========================//

    /**
     * @notice Sets the maximum amount that can be swapped in a single interval
     * @param _newCap New cap value (0 sets to max uint128)
     * @dev Only callable by slippage admin
     */
    function setSwapCap(uint128 _newCap) external onlySlippageAdmin {
        swapCap = _newCap == 0 ? type(uint128).max : _newCap;
    }

    /**
     * @notice Executes the buy and burn process
     * @param _deadline Timestamp by which the transaction must be executed
     */
    function swapDragonXForAscendantAndBurn(uint32 _deadline) external intervalUpdate notExpired(_deadline) {
        if (msg.sender != tx.origin) {
            revert AscendantBuyAndBurn__OnlyEOA();
        }

        if (Time.blockTs() < startTimeStamp) revert AscendantBuyAndBurn__NotStartedYet();

        Interval storage currInterval = intervals[lastIntervalNumber];

        if (currInterval.amountBurned != 0) {
            revert AscendantBuyAndBurn__IntervalAlreadyBurned();
        }

        if (currInterval.amountAllocated > swapCap) {
            currInterval.amountAllocated = swapCap;
        }

        currInterval.amountBurned = currInterval.amountAllocated;

        uint256 incentive = wmul(currInterval.amountAllocated, INCENTIVE_FEE);

        uint256 titanXToSwapAndBurn = currInterval.amountAllocated - incentive;

        uint256 dragonXAmount = swapExactInput(address(titanX), address(dragonX), titanXToSwapAndBurn, 0, _deadline);

        uint256 dragonXToUseForAscendantBnB = wmul(dragonXAmount, DRAGONX_TO_ASCENDANT_RATIO);
        uint256 dragonXToSentToRewardPool = wmul(dragonXAmount, DRAGONX_TO_REWARD_POOL_RATIO);

        titanX.transfer(msg.sender, incentive);

        uint256 ascendantAmount =
            swapExactInput(address(dragonX), address(ascendant), dragonXToUseForAscendantBnB, 0, _deadline);

        nftMinting.distribute(dragonXToSentToRewardPool); // 20% of that is sent to the dragonX rewards pool

        uint256 ascendantToBeBurned = wmul(ascendantAmount, THIRTY_PERCENT);

        uint256 ascendantPrideForFutureAuctions = wmul(ascendantAmount, SEVENTY_PERCENT);

        ascendant.transfer(address(ascendantPride), ascendantPrideForFutureAuctions);

        burnAscendant(ascendantToBeBurned);

        lastBurnedInterval = lastIntervalNumber;

        emit BuyAndBurn(titanXToSwapAndBurn, ascendantAmount, msg.sender);
    }

    /**
     * @notice Allows external parties to provide TitanX tokens for burning
     * @param _amount Amount of TitanX tokens to distribute
     * @dev Updates intervals if necessary before accepting new tokens
     */
    function distributeTitanXForBurning(uint256 _amount) external notAmount0(_amount) {
        ///@dev - If there are some missed intervals update the accumulated allocation before depositing new DragonX

        titanX.transferFrom(msg.sender, address(this), _amount);

        if (Time.blockTs() > startTimeStamp && Time.blockTs() - lastBurnedIntervalStartTimestamp > INTERVAL_TIME) {
            _intervalUpdate();
        }
    }

    //==========================//
    //=========GETTERS==========//
    //==========================//

    /**
     * @notice Retrieves current interval information
     * @return _lastInterval Current interval number
     * @return _amountAllocated Amount allocated for current interval
     * @return _missedIntervals Number of missed intervals
     * @return _lastIntervalStartTimestamp Start of last interval
     * @return beforeCurrday Amount allocated before current day
     * @return updated Whether the interval was updated
     */
    function getCurrentInterval()
        public
        view
        returns (
            uint32 _lastInterval,
            uint128 _amountAllocated,
            uint16 _missedIntervals,
            uint32 _lastIntervalStartTimestamp,
            uint256 beforeCurrday,
            bool updated
        )
    {
        if (startTimeStamp > Time.blockTs()) return (0, 0, 0, 0, 0, false);

        uint32 startPoint = lastBurnedIntervalStartTimestamp == 0 ? startTimeStamp : lastBurnedIntervalStartTimestamp;
        uint32 timeElapseSinceLastBurn = Time.blockTs() - startPoint;

        if (lastBurnedIntervalStartTimestamp == 0 || timeElapseSinceLastBurn > INTERVAL_TIME) {
            (_lastInterval, _amountAllocated, _missedIntervals, beforeCurrday) =
                _calculateIntervals(timeElapseSinceLastBurn);
            _lastIntervalStartTimestamp = startPoint;
            _missedIntervals += timeElapseSinceLastBurn > INTERVAL_TIME && lastBurnedIntervalStartTimestamp != 0 ? 1 : 0;
            updated = true;
        }
    }

    /**
     * @notice Calculates daily TitanX allocation
     * @param t Timestamp to calculate allocation for
     * @return dailyWadAllocation Daily allocation in WAD format
     * @dev Allocation decreases linearly over first 10 days then remains constant
     */
    function getDailyTitanXAllocation(uint32 t) public view returns (uint256 dailyWadAllocation) {
        uint256 STARTING_ALOCATION = 0.42e18;
        uint256 MIN_ALOCATION = 0.15e18;
        uint256 daysSinceStart = Time.daysSinceAndFrom(startTimeStamp, t);

        dailyWadAllocation = daysSinceStart >= 10 ? MIN_ALOCATION : STARTING_ALOCATION - (daysSinceStart * 0.03e18);
    }

    //==========================//
    //=========INTERNAL=========//
    //==========================//

    /**
     * @notice Updates the contract's snapshot of TitanX distribution
     * @param deltaAmount Amount to subtract from current balance when calculating distribution
     */
    function _updateSnapshot(uint256 deltaAmount) internal {
        if (Time.blockTs() < startTimeStamp || lastSnapshot + 24 hours > Time.blockTs()) return;

        uint32 timeElapsed = Time.blockTs() - startTimeStamp;

        uint32 snapshots = timeElapsed / 24 hours;

        uint256 balance = titanX.balanceOf(address(this));

        totalTitanXDistributed = deltaAmount > balance ? 0 : balance - deltaAmount;
        lastSnapshot = startTimeStamp + (snapshots * 24 hours);
    }

    /**
     * @notice Calculates interval amounts and numbers based on elapsed time
     * @dev Processes daily allocations and handles interval transitions
     * @param timeElapsedSince Time elapsed since last update
     * @return _lastIntervalNumber The calculated last interval number
     * @return _totalAmountForInterval Total amount allocated for the interval
     * @return missedIntervals Number of intervals that were missed
     * @return beforeCurrDay Amount allocated before the current day
     */
    function _calculateIntervals(uint256 timeElapsedSince)
        internal
        view
        returns (
            uint32 _lastIntervalNumber,
            uint128 _totalAmountForInterval,
            uint16 missedIntervals,
            uint256 beforeCurrDay
        )
    {
        missedIntervals = _calculateMissedIntervals(timeElapsedSince);

        _lastIntervalNumber = lastIntervalNumber + missedIntervals + 1;

        uint32 currentDay = Time.dayCountByT(uint32(block.timestamp));

        uint32 dayOfLastInterval =
            lastBurnedIntervalStartTimestamp == 0 ? currentDay : Time.dayCountByT(lastBurnedIntervalStartTimestamp);

        if (currentDay == dayOfLastInterval) {
            uint256 dailyAllocation = wmul(totalTitanXDistributed, getDailyTitanXAllocation(Time.blockTs()));

            uint128 _amountPerInterval = uint128(dailyAllocation / INTERVALS_PER_DAY);

            uint128 additionalAmount = _amountPerInterval * missedIntervals;

            _totalAmountForInterval = additionalAmount + _amountPerInterval;
        } else {
            uint32 _lastBurnedIntervalStartTimestamp = lastBurnedIntervalStartTimestamp;

            uint32 theEndOfTheDay = Time.getDayEnd(_lastBurnedIntervalStartTimestamp);

            uint256 alreadyAllocated;

            uint256 balanceOf = titanX.balanceOf(address(this));

            while (currentDay >= dayOfLastInterval) {
                uint32 end = uint32(Time.blockTs() < theEndOfTheDay ? Time.blockTs() : theEndOfTheDay - 1);

                uint32 accumulatedIntervalsForTheDay = (end - _lastBurnedIntervalStartTimestamp) / INTERVAL_TIME;

                uint256 diff = balanceOf > alreadyAllocated ? balanceOf - alreadyAllocated : 0;

                //@note - If the day we are looping over the same day as the last interval's use the cached allocation, otherwise use the current balance
                uint256 forAllocation = Time.dayCountByT(lastBurnedIntervalStartTimestamp) == dayOfLastInterval
                    ? totalTitanXDistributed
                    : balanceOf >= alreadyAllocated + wmul(diff, getDailyTitanXAllocation(end)) ? diff : 0;

                uint256 dailyAllocation = wmul(forAllocation, getDailyTitanXAllocation(end));

                uint128 _amountPerInterval = uint128(dailyAllocation / INTERVALS_PER_DAY);

                _totalAmountForInterval += _amountPerInterval * accumulatedIntervalsForTheDay;

                ///@notice ->  minus 15 minutes since, at the end of the day the new epoch with new allocation
                _lastBurnedIntervalStartTimestamp = theEndOfTheDay - INTERVAL_TIME;

                ///@notice ->  plus 15 minutes to flip into the next day
                theEndOfTheDay = Time.getDayEnd(_lastBurnedIntervalStartTimestamp + INTERVAL_TIME);

                if (dayOfLastInterval == currentDay) beforeCurrDay = alreadyAllocated;

                alreadyAllocated += dayOfLastInterval == currentDay
                    ? _amountPerInterval * accumulatedIntervalsForTheDay
                    : dailyAllocation;

                dayOfLastInterval++;
            }
        }

        Interval memory prevInt = intervals[lastIntervalNumber];

        //@note - If the last interval was only updated, but not burned add its allocation to the next one.
        uint128 additional = prevInt.amountBurned == 0 ? prevInt.amountAllocated : 0;

        if (_totalAmountForInterval + additional > titanX.balanceOf(address(this))) {
            _totalAmountForInterval = uint128(titanX.balanceOf(address(this)));
        } else {
            _totalAmountForInterval += additional;
        }
    }

    /**
     * @notice Calculates the number of missed intervals
     * @dev Subtracts one from the total if lastBurnedIntervalStartTimestamp is set
     * @param timeElapsedSince Time elapsed since last update
     * @return _missedIntervals Number of intervals that were missed
     */
    function _calculateMissedIntervals(uint256 timeElapsedSince) internal view returns (uint16 _missedIntervals) {
        _missedIntervals = uint16(timeElapsedSince / INTERVAL_TIME);

        if (lastBurnedIntervalStartTimestamp != 0) _missedIntervals--;
    }

    //==========================//
    //=========PRIVATE=========//
    //==========================//

    /**
     * @notice Updates the contract state for intervals
     * @dev Updates snapshots and interval information based on current time
     */
    function _intervalUpdate() private {
        if (Time.blockTs() < startTimeStamp) revert AscendantBuyAndBurn__NotStartedYet();

        if (lastSnapshot == 0) _updateSnapshot(0);

        (
            uint32 _lastInterval,
            uint128 _amountAllocated,
            uint16 _missedIntervals,
            uint32 _lastIntervalStartTimestamp,
            uint256 beforeCurrentDay,
            bool updated
        ) = getCurrentInterval();

        _updateSnapshot(beforeCurrentDay);

        if (updated) {
            lastBurnedIntervalStartTimestamp = _lastIntervalStartTimestamp + (uint32(_missedIntervals) * INTERVAL_TIME);
            intervals[_lastInterval] = Interval({amountAllocated: _amountAllocated, amountBurned: 0});
            lastIntervalNumber = _lastInterval;
        }
    }

    /**
     * @notice Burns a specified amount of Ascendant tokens
     * @dev Updates totalAscendantBurnt and calls burn on the Ascendant token
     * @param _amount Amount of Ascendant tokens to burn
     */
    function burnAscendant(uint256 _amount) private {
        totalAscendantBurnt += _amount;
        ascendant.burn(_amount);
    }

    /**
     * @notice Checks if the caller is the slippage admin
     * @dev Reverts if the caller is not the slippage admin
     */
    function _onlySlippageAdmin() private view {
        if (msg.sender != slippageAdmin) revert AscendantBuyAndBurn__OnlySlippageAdmin();
    }
}

// Source: ./SolidityContracts/Ascendant/AscendantNFTMarketplace.sol
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

import "@const/Constants.sol";
import {Errors} from "@utils/Errors.sol";
import {wmul} from "@utils/Math.sol";
import {OracleLibrary} from "@libs/OracleLibrary.sol";
import {IAscendantNFTMinting} from "@interfaces/IAscendant.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

/**
 * @title Ascendant NFT Marketplace Contract
 * @author Decentra
 * @notice Marketplace for trading Ascendant Hybrid NFTs
 * @dev Implements:
 *      - ERC721Holder for NFT escrow capabilities
 *      - ReentrancyGuard for protection against reentrancy attacks
 *      - Ownable2Step for secure ownership management
 *      - Errors for custom error handling
 *      Uses:
 *      - SafeERC20 for secure token transfers
 *      - Math for mathematical operations
 *      - EnumerableSet for managing NFT collections
 */
contract AscendantNFTMarketplace is ERC721Holder, ReentrancyGuard, Ownable2Step, Errors {
    using SafeERC20 for IERC20;
    using Math for uint256;
    using EnumerableSet for EnumerableSet.UintSet;

    //==========STRUCTS==========//

    /**
     * @dev Represents an NFT listing in the marketplace
     * @param tokenId The ID of the listed NFT
     * @param price The listing price in either TitanX or ETH
     * @param seller Address of the NFT seller
     */
    struct Listing {
        uint256 tokenId;
        uint256 price;
        address seller;
    }

    /**
     * @dev Tracks marketplace payouts for sellers
     * @param payoutInTitanX Amount to be paid out in TitanX tokens
     * @param payoutInETH Amount to be paid out in ETH
     */
    struct Payout {
        uint256 payoutInTitanX;
        uint256 payoutInETH;
    }

    /* == ERRORS == */
    error NftMarketplace__NftNotApprovedForMarketplace();
    error NftMarketplace__AlreadyListed(uint256 tokenId);
    error NftMarketplace__NotListed(uint256 tokenId);
    error NftMarketplace__TransferFailed();
    error NftMarketplace__InvalidPrice();
    error NftMarketplace__IncorrectInput();
    error NftMarketplace__NoPayout();
    error NftMarketplace__PaymentForNFTIsInTitanX();
    error NftMarketplace__PaymentForNFTIsInETH();
    error NftMarketplace__NotOwner();
    error NftMarketplace__DeviationOutOfBounds();
    error NftMarketplace__InsufficientEth();
    error NftMarketplace__ContractCallsProhibited();

    //==========EVENTS==========//

    /**
     * @dev Emitted when a new NFT is listed for sale
     * @param seller Address of the NFT seller
     * @param tokenId ID of the listed NFT
     * @param listingId Unique identifier for the listing
     * @param price Listed price in TitanX or ETH
     */
    event ItemListed(address indexed seller, uint256 indexed tokenId, uint256 listingId, uint256 price);

    /**
     * @dev Emitted when a listing's price is updated
     * @param seller Address of the NFT seller
     * @param tokenId ID of the listed NFT
     * @param listingId Unique identifier for the listing
     * @param price Updated price in TitanX or ETH
     */
    event ItemUpdated(address indexed seller, uint256 indexed tokenId, uint256 listingId, uint256 price);

    /**
     * @dev Emitted when an NFT is purchased
     * @param buyer Address of the NFT buyer
     * @param tokenId ID of the purchased NFT
     * @param listingId Unique identifier for the listing
     * @param price Final sale price in TitanX or ETH
     */
    event ItemPurchased(address indexed buyer, uint256 indexed tokenId, uint256 listingId, uint256 price);

    /**
     * @dev Emitted when a listing is cancelled
     * @param buyer Address of the NFT owner
     * @param tokenId ID of the delisted NFT
     * @param listingId Unique identifier for the cancelled listing
     */
    event ItemCancelled(address indexed buyer, uint256 indexed tokenId, uint256 listingId);

    //==========MODIFIER==========//

    /**
     * @dev Ensures the NFT is currently listed in the marketplace
     * @param _listingId The ID of the listing to check
     * @notice Reverts with NftMarketplace__NotListed if the listing is not active
     */
    modifier isListed(uint256 _listingId) {
        if (!isListingActive(_listingId)) {
            revert NftMarketplace__NotListed(_listingId);
        }
        _;
    }

    /**
     * @dev Validates that msg.sender is the owner of the listed NFT
     * @param _listingId The ID of the listing to check ownership
     * @notice Reverts with NftMarketplace__NotOwner if msg.sender is not the seller
     */
    modifier isOwner(uint256 _listingId) {
        if (listings[_listingId].seller != msg.sender) {
            revert NftMarketplace__NotOwner();
        }

        _;
    }

    /**
     * @dev Prevents smart contracts from interacting with the marketplace
     * @notice Reverts with NftMarketplace__ContractCallsProhibited if caller is a contract
     */
    modifier noContract() {
        if (address(msg.sender).code.length > 0) revert NftMarketplace__ContractCallsProhibited();
        _;
    }

    //=========IMMUTABLE=========//

    /**
     * @notice TitanX token contract used for NFT payments
     * @dev Immutable reference set in constructor
     */
    IERC20 public immutable titanX;

    /**
     * @notice WETH9 contract address for ETH payments
     * @dev Immutable reference set in constructor
     */
    address public immutable weth9;

    /**
     * @notice Ascendant NFT minting contract interface
     * @dev Immutable reference set in constructor, used to claim NFT rewards before listing
     */
    IAscendantNFTMinting immutable ascendantNFTMinting;

    //==========STATE==========//

    /**
     * @notice Maps listing IDs to their full listing details
     * @dev Stores active and historical listings
     */
    mapping(uint256 => Listing) public listings;

    /**
     * @notice Maps seller addresses to their accumulated payouts
     * @dev Private mapping for tracking owed TitanX and ETH
     */
    mapping(address => Payout) private payouts;

    /**
     * @notice NFT collection contract interface
     * @dev Reference to the Ascendant NFT collection being traded
     */
    IERC721 public immutable collection;

    /**
     * @notice Set of currently active listing IDs
     * @dev Uses EnumerableSet for efficient listing management
     */
    EnumerableSet.UintSet private activeListings;

    /**
     * @notice Time window for price comparisons (in seconds)
     * @dev Defaults to 900 seconds (15 minutes)
     */
    uint32 public secondsAgo = 15 * 60;

    /**
     * @notice Maximum allowed price deviation in basis points
     * @dev Defaults to 300 (3.00%)
     */
    uint32 public deviation = 300;

    /**
     * @notice Monotonically increasing identifier for marketplace listings
     * @dev Increments by 1 for each new listing
     */
    uint256 public currentListingId;

    //==========CONSTANTS==========//

    /**
     * @notice Maximum allowable deviation value in basis points
     * @dev Set to 10000 (100.00%)
     */
    uint16 constant MAX_DEVIATION_LIMIT = 10_000;

    //==========CONSTRUCTOR==========//

    /**
     * @notice Initializes the NFT marketplace contract
     * @dev Sets up immutable contract references and initializes the marketplace state
     * @param _initialOwner Address that will own the marketplace contract
     * @param _titanX Address of the TitanX token contract used for payments
     * @param _weth9 Address of the WETH9 contract for ETH payments
     * @param _ascendantNFTMinting Address of the Ascendant NFT contract
     */
    constructor(address _initialOwner, address _titanX, address _weth9, address _ascendantNFTMinting)
        Ownable(_initialOwner)
        notAddress0(_titanX)
        notAddress0(_weth9)
        notAddress0(_ascendantNFTMinting)
    {
        weth9 = _weth9;
        titanX = IERC20(_titanX);
        collection = IERC721(_ascendantNFTMinting);
        ascendantNFTMinting = IAscendantNFTMinting(_ascendantNFTMinting);
    }

    //==========================//
    //==========PUBLIC==========//
    //==========================//

    /**
     * @notice Calculates the royalty fee for an NFT sale
     * @dev Applies ASCENDANT_NFT_SALE_FEE percentage to the given amount
     * @param _amount The sale amount to calculate fee from
     * @return The calculated royalty fee amount
     */
    function getNFTSaleRoyaltyFee(uint256 _amount) public pure returns (uint256) {
        return wmul(_amount, ASCENDANT_NFT_SALE_FEE);
    }

    //==========================//
    //=========EXTERNAL=========//
    //==========================//

    /**
     * @notice Lists an NFT for sale in the marketplace
     * @dev Implements checks-effects-interactions pattern with reentrancy and contract interaction protection.
     *      The function will:
     *      1. Verify NFT ownership and price validity
     *      2. Create a new listing with a unique ID
     *      3. Transfer NFT to the marketplace contract
     *      4. Claim any associated Ascendant tokens
     *
     * @dev ItemListed Emitted when an item is successfully listed
     *       - seller: Address of the NFT seller
     *       - tokenId: ID of the listed NFT
     *       - listingId: Unique identifier for the listing
     *       - price: Listed price of the NFT
     *
     * @param _tokenId The ID of the NFT to list
     * @param _price The listing price in platform's native token (must be > 0)
     */
    function listItem(uint256 _tokenId, uint256 _price) external nonReentrant noContract {
        if (collection.ownerOf(_tokenId) != msg.sender) {
            revert NftMarketplace__NotOwner();
        }

        if (_price == 0) {
            revert NftMarketplace__InvalidPrice();
        }

        uint256 listingId = currentListingId++;

        listings[listingId] = Listing(_tokenId, _price, msg.sender);
        activeListings.add(listingId);

        collection.transferFrom(msg.sender, address(this), _tokenId);

        ascendantNFTMinting.claim(_tokenId, msg.sender);

        emit ItemListed(msg.sender, _tokenId, listingId, _price);
    }

    /**
     * @notice Allows a user to purchase a listed NFT using ETH
     * @dev Implements checks-effects-interactions pattern with royalty handling and price deviation checks.
     *      The function will:
     *      1. Verify listing exists and price matches
     *      2. Check price deviation is within bounds
     *      3. Calculate ETH amount including spot price conversion
     *      4. Handle royalty fee distribution
     *      5. Process seller payout
     *      6. Transfer NFT to buyer
     *
     * @dev ItemPurchased Emitted when an item is successfully purchased
     *       - buyer: Address of the NFT buyer
     *       - tokenId: ID of the purchased NFT
     *       - listingId: ID of the completed listing
     *       - price: Final price in ETH
     * @param _listingId The ID of the listing to purchase
     * @param _price The expected price of the listing in platform's native token
     */
    function buyItemWithETH(uint256 _listingId, uint256 _price)
        external
        payable
        nonReentrant
        isListed(_listingId)
        noContract
    {
        Listing memory _listedItem = listings[_listingId];

        if (_listedItem.price != _price) revert NftMarketplace__InvalidPrice();

        uint256 spotPrice = getSpotPrice();

        checkIsDeviationOutOfBounds(spotPrice);

        uint256 priceInEth = FullMath.mulDiv(_price, spotPrice, WAD);

        if (msg.value < priceInEth) revert NftMarketplace__InsufficientEth();

        uint256 _royaltyFee = getNFTSaleRoyaltyFee(priceInEth);
        uint256 _payout = priceInEth - _royaltyFee;

        payouts[_listedItem.seller].payoutInETH += _payout;

        delete (listings[_listingId]);

        activeListings.remove(_listingId);

        sendETHToGenesisWallets(_royaltyFee);

        collection.safeTransferFrom(address(this), msg.sender, _listedItem.tokenId);

        if (priceInEth < msg.value) {
            (bool refundTx,) = msg.sender.call{value: msg.value - priceInEth}("");
            if (!refundTx) revert NftMarketplace__TransferFailed();
        }

        emit ItemPurchased(msg.sender, _listedItem.tokenId, _listingId, _listedItem.price);
    }

    /**
     * @notice Allows a user to purchase a listed NFT using TitanX tokens
     * @dev Implements checks-effects-interactions pattern with royalty handling.
     *      The function will:
     *      1. Verify listing exists and price matches
     *      2. Calculate and handle royalty fee
     *      3. Process seller payout in TitanX
     *      4. Transfer TitanX tokens from buyer
     *      5. Transfer NFT to buyer
     *
     * @dev ItemPurchased Emitted when an item is successfully purchased
     *       - buyer: Address of the NFT buyer
     *       - tokenId: ID of the purchased NFT
     *       - listingId: ID of the completed listing
     *       - price: Final price in TitanX
     * @param _listingId The ID of the listing to purchase
     * @param _price The expected price of the listing in TitanX
     */
    function buyItemWithTitanX(uint256 _listingId, uint256 _price)
        external
        nonReentrant
        isListed(_listingId)
        noContract
    {
        Listing memory _listedItem = listings[_listingId];

        if (_listedItem.price != _price) {
            revert NftMarketplace__InvalidPrice();
        }

        uint256 _royaltyFee = getNFTSaleRoyaltyFee(_listedItem.price);
        uint256 _payout = _listedItem.price - _royaltyFee;

        payouts[_listedItem.seller].payoutInTitanX += _payout;

        delete (listings[_listingId]);

        activeListings.remove(_listingId);

        titanX.transferFrom(msg.sender, address(this), _price);

        sendToGenesisWallets(titanX, _royaltyFee);

        collection.safeTransferFrom(address(this), msg.sender, _listedItem.tokenId);

        emit ItemPurchased(msg.sender, _listedItem.tokenId, _listingId, _listedItem.price);
    }

    /**
     * @notice Allows the original seller to cancel their NFT listing
     * @dev Implements checks-effects-interactions pattern and includes reentrancy protection.
     *      The function will:
     *      1. Verify caller is the original seller
     *      2. Remove the listing from storage
     *      3. Remove from active listings set
     *      4. Return the NFT to the seller
     *
     * @dev ItemCancelled Emitted when a listing is successfully cancelled
     *       - seller: Address of the original NFT seller
     *       - tokenId: ID of the NFT being delisted
     *       - listingId: ID of the cancelled listing
     *
     * @param _listingId The ID of the listing to cancel
     */
    function cancelListing(uint256 _listingId) external nonReentrant isOwner(_listingId) isListed(_listingId) {
        Listing memory _listedItem = listings[_listingId];

        delete (listings[_listingId]);

        activeListings.remove(_listingId);

        collection.safeTransferFrom(address(this), msg.sender, _listedItem.tokenId);

        emit ItemCancelled(msg.sender, _listedItem.tokenId, _listingId);
    }

    /**
     * @notice Allows the original seller to update the price of their NFT listing
     * @dev The function will:
     *      1. Verify caller is the original seller
     *      2. Validate the new price
     *      3. Update the listing price
     *
     * @dev ItemUpdated Emitted when a listing price is successfully updated
     *       - seller: Address of the NFT seller
     *       - tokenId: ID of the listed NFT
     *       - listingId: ID of the updated listing
     *       - price: New price in TitanX or ETH
     *
     * @param _listingId The ID of the listing to update
     * @param _newPrice The new listing price in TitanX or ETH (must be > 0)
     */
    function updateListing(uint256 _listingId, uint256 _newPrice)
        external
        nonReentrant
        isOwner(_listingId)
        isListed(_listingId)
    {
        if (_newPrice == 0) {
            revert NftMarketplace__InvalidPrice();
        }

        Listing storage _listedItem = listings[_listingId];

        _listedItem.price = _newPrice;

        emit ItemUpdated(msg.sender, _listedItem.tokenId, _listingId, _newPrice);
    }

    /**
     * @notice Allows sellers to withdraw their accumulated payouts from NFT sales
     * @dev Implements checks-effects-interactions pattern with reentrancy protection.
     *      Handles both TitanX token and ETH payouts in a single transaction.
     *      The function will:
     *      1. Check if caller has any pending payouts
     *      2. Clear payout records before transfers
     *      3. Transfer TitanX tokens if applicable
     *      4. Transfer ETH if applicable
     *
     * @notice The function handles two types of payouts:
     *         - TitanX tokens from sales in TitanX
     *         - ETH from sales in ETH
     *         Both balances are cleared after successful withdrawal
     */
    function withdrawPayout() external nonReentrant {
        Payout memory _payout = payouts[msg.sender];

        if (_payout.payoutInTitanX == 0 && _payout.payoutInETH == 0) {
            revert NftMarketplace__NoPayout();
        }

        delete payouts[msg.sender];

        if (_payout.payoutInTitanX > 0) {
            titanX.safeTransfer(msg.sender, _payout.payoutInTitanX);
        }

        if (_payout.payoutInETH > 0) {
            (bool success,) = payable(msg.sender).call{value: _payout.payoutInETH}("");
            if (!success) {
                revert NftMarketplace__TransferFailed();
            }
        }
    }

    //==========================//
    //==========PRIVATE=========//
    //==========================//

    /**
     * @notice Checks if the current spot price deviation from TWAP is within acceptable bounds
     * @dev Calculates the difference between spot and TWAP prices and compares against
     *      maximum allowed deviation threshold.
     *
     * @param _spotPrice Current spot price to check against TWAP
     *
     * @notice This is a critical price protection mechanism to prevent:
     *         - Market manipulation
     *         - Extreme price volatility
     *         - Unfair trading conditions
     */
    function checkIsDeviationOutOfBounds(uint256 _spotPrice) private view {
        uint256 _twapPrice = getTwapPrice();
        uint256 _diff = _twapPrice >= _spotPrice ? _twapPrice - _spotPrice : _spotPrice - _twapPrice;

        if (FullMath.mulDiv(_spotPrice, deviation, MAX_DEVIATION_LIMIT) < _diff) {
            revert NftMarketplace__DeviationOutOfBounds();
        }
    }

    function sendToGenesisWallets(IERC20 erc20Token, uint256 _amount) private {

		uint256 genesisHalf = wmul(_amount, HALF);

		erc20Token.safeTransfer(GENESIS_WALLET_1, genesisHalf);
		erc20Token.safeTransfer(GENESIS_WALLET_2, genesisHalf);
	}

    function sendETHToGenesisWallets(uint256 _amount) private {

        uint256 genesisHalf = wmul(_amount, HALF);

        (bool genesisFirstHalfFundTransferSuccess,) = payable(GENESIS_WALLET_1).call{value: genesisHalf}("");
        if (!genesisFirstHalfFundTransferSuccess) {
            revert NftMarketplace__TransferFailed();
        }

        (bool genesisSecondHalfFundTransferSuccess,) = payable(GENESIS_WALLET_2).call{value: genesisHalf}("");
        if (!genesisSecondHalfFundTransferSuccess) {
            revert NftMarketplace__TransferFailed();
        }
        
	}

    //==========================//
    //=====EXTERNAL SETTERS=====//
    //==========================//

    /**
     * @notice Sets the time window for TWAP calculation
     * @dev Only callable by contract owner. Updates the time period used for calculating
     *      Time Weighted Average Price (TWAP) for price deviation checks.
     *
     * @param _secondsAgoLimit New time window in seconds for TWAP calculation
     *
     * @notice This parameter affects price protection mechanisms by determining:
     *         - How far back in time the TWAP calculation looks
     *         - The responsiveness vs stability of price checks
     */
    function setSecondsAgo(uint32 _secondsAgoLimit) external onlyOwner {
        if (_secondsAgoLimit == 0) revert NftMarketplace__IncorrectInput();
        secondsAgo = _secondsAgoLimit;
    }

    /**
     * @notice Sets the maximum allowed price deviation threshold
     * @dev Only callable by contract owner. Controls how much spot price can deviate
     *      from TWAP before transactions are rejected.
     *
     * @param _deviationLimit New maximum deviation limit (must be > 0 and <= MAX_DEVIATION_LIMIT)
     *
     * @notice This parameter is critical for market stability:
     *         - Lower values = stricter price movement restrictions
     *         - Higher values = more price flexibility
     *         - Must be below MAX_DEVIATION_LIMIT for system safety
     */
    function setDeviation(uint32 _deviationLimit) external onlyOwner {
        if (_deviationLimit == 0) revert NftMarketplace__IncorrectInput();
        if (_deviationLimit > MAX_DEVIATION_LIMIT) revert NftMarketplace__IncorrectInput();
        deviation = _deviationLimit;
    }

    //==========================//
    //========PUBLIC VIEW=======//
    //==========================//

    /**
     * @notice Calculates the Time Weighted Average Price (TWAP) of TitanX in WETH
     *
     * @return quote The TWAP price of 1 WAD (1e18) TitanX in WETH
     *
     * @dev Calculation process:
     *      1. Get oldest available observation
     *      2. Adjust seconds ago if needed
     *      3. Compute arithmetic mean tick
     *      4. Convert tick to sqrt price
     *      5. Calculate final quote
     *
     * @notice The returned price:
     *         - Is denominated in WETH
     *         - Is time-weighted over the configured period
     */
    function getTwapPrice() public view returns (uint256 quote) {
        uint32 _secondsAgo = secondsAgo;
        uint32 oldestObservation = OracleLibrary.getOldestObservationSecondsAgo(TITANX_WETH_POOL);
        if (oldestObservation < _secondsAgo) _secondsAgo = oldestObservation;

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(TITANX_WETH_POOL, _secondsAgo);
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        quote = OracleLibrary.getQuoteForSqrtRatioX96(sqrtPriceX96, WAD, address(titanX), weth9);
    }

    /**
     * @notice Gets the current spot price of TitanX in WETH from Uniswap V3
     * @dev Reads directly from the pool's slot0 for current sqrt price
     *
     * @return uint256 The current spot price of 1 WAD (1e18) TitanX in WETH
     *
     * @dev Calculation process:
     *      1. Read sqrt price from pool slot0
     *      2. Convert to quote using OracleLibrary
     *
     * @notice The returned price:
     *         - Is instantaneous (not time-weighted)
     *         - Is denominated in WETH
     */
    function getSpotPrice() public view returns (uint256) {
        IUniswapV3Pool pool = IUniswapV3Pool(TITANX_WETH_POOL);
        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        return OracleLibrary.getQuoteForSqrtRatioX96(sqrtPriceX96, WAD, address(titanX), weth9);
    }

    /**
     * @notice Checks if a listing is currently active
     * @dev Uses EnumerableSet to efficiently check listing status
     *
     * @param _listingId The ID of the listing to check
     * @return bool True if listing is active, false otherwise
     *
     * @notice A listing is considered active if:
     *         - It has been created
     *         - Has not been cancelled
     *         - Has not been purchased
     */
    function isListingActive(uint256 _listingId) public view returns (bool) {
        return activeListings.contains(_listingId);
    }

    //==========================//
    //======EXTERNAL VIEW=======//
    //==========================//

    /**
     * @notice Retrieves detailed information about a specific listing
     * @dev Returns a Listing struct containing tokenId, price, and seller information
     *
     * @param _listingId The ID of the listing to query
     * @return Listing struct containing listing details:
     *         - tokenId: The ID of the listed NFT
     *         - price: The listing price in USD
     *         - seller: Address of the seller
     *
     * @notice Returns empty values if listing doesn't exist
     */
    function getListing(uint256 _listingId) external view returns (Listing memory) {
        return listings[_listingId];
    }

    /**
     * @notice Retrieves pending payout information for a seller
     * @dev Returns a Payout struct containing both TitanX and ETH payout amounts
     *
     * @param seller The address of the seller to check payouts for
     * @return Payout struct containing:
     *         - payoutInTitanX: Amount of TitanX tokens pending withdrawal
     *         - payoutInETH: Amount of ETH pending withdrawal
     */
    function getPayout(address seller) external view returns (Payout memory) {
        return payouts[seller];
    }

    /**
     * @notice Returns an array of all currently active listing IDs
     * @dev Uses EnumerableSet to maintain and return active listings
     *
     * @return uint256[] Array of active listing IDs
     *
     * @notice The returned array contains all non-cancelled, non-purchased listing IDs
     */
    function getActiveListings() external view returns (uint256[] memory) {
        return activeListings.values();
    }
}
// Source: ./SolidityContracts/Ascendant/AscendantNFTMinting.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@const/Constants.sol";
import {Time} from "@utils/Time.sol";
import {Errors} from "@utils/Errors.sol";
import {wdiv, wmul} from "@utils/Math.sol";
import {IAscendant} from "@interfaces/IAscendant.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/**
 * @title AscendantNFTMinting
 * @author Decentra
 * @notice A contract for minting, burning, and managing Ascendant NFTs with reward distribution
 * @dev Inherits from ERC721 and Errors contracts
 * Main features:
 * - NFT minting with multiple tiers
 * - Reward distribution across different time pools
 * - NFT fusion mechanism
 * - Batch operations for minting, claiming, and burning
 */
contract AscendantNFTMinting is ERC721URIStorage, Ownable, Errors {
    using SafeERC20 for IERC20;
    using Math for uint256;

    //===========STRUCTS===========//

    /**
     * @notice Record of user's NFT position and rewards
     * @param shares Amount of shares owned by the NFT
     * @param lockedAscendant Amount of Ascendant tokens locked in the NFT
     * @param rewardDebt Used to calculate correct reward distribution
     * @param startTime Timestamp when the NFT was minted
     * @param endTime Timestamp when the lock period ends
     */
    struct UserRecord {
        uint256 shares;
        uint256 lockedAscendant;
        uint256 rewardDebt;
        uint32 startTime;
        uint32 endTime;
    }

    /**
     * @notice Attributes associated with each NFT
     * @param rarityNumber Pseudo-random number generated during minting
     * @param tier NFT tier level (1-8)
     * @param NftRarity NFT rarity level (COMMON, RARE, LEGENDARY)
     */
    struct NftAttributes {
        uint256 rarityNumber;
        uint8 tier;
        Rarity rarity;
    }

    //===========ENUMS===========//

    /**
     * @notice Different reward distribution pools based on time periods
     * @param DAY8 8-day reward distribution pool
     * @param DAY28 28-day reward distribution pool
     * @param DAY90 90-day reward distribution pool
     */
    enum POOLS {
        DAY8,
        DAY28,
        DAY90
    }

    /**
     * @notice NFT Rarity levels for NFTs
     * @param COMMON Basic NFT rarity level (Tiers 1-4)
     * @param RARE Medium NFT rarity level (Tiers 5-7)
     * @param LEGENDARY Highest NFT rarity level (Tier 8)
     */
     enum Rarity {
        COMMON,
        RARE,
        LEGENDARY
    }

    //=========IMMUTABLE=========//
    IAscendant immutable ascendant;
    IERC20 immutable dragonX;

    //===========STATE===========//
    uint256 public totalShares;
    uint256 public tokenId;
    uint256 public rewardPerShare;

    uint32 public startTimestamp;
    uint32 public lastDistributedDay;

    address public ascendantPride;

    string[10][8] public tokenURIs;

    /**
     * @notice Mapping of reward pools to their pending distribution amounts
     */
    mapping(POOLS => uint256) public toDistribute;

    /**
     * @notice Mapping of token IDs to their user records
     */
    mapping(uint256 id => UserRecord record) public userRecords;

    /**
     * @notice Mapping of token IDs to their NFT attributes
     */
    mapping(uint256 => NftAttributes) public nftAttributes;

    //==========ERRORS==========//
    error AscendantMinting__FusionTokenIdsCannotBeTheSame();
    error AscendantMinting__InvalidNFTOwner();
    error AscendantMinting__InvalidTokenID(uint256 _tokenId);
    error AscendantMinting__AmountForNewMintNotReached();
    error AscendantMinting__ExpiredNFT();
    error AscendantMinting__TierOfNFTsMustBeTheSame();
    error AscendantMinting__MaxTierReached();
    error AscendantMinting__InitialLockPeriod();
    error AscendantMinting__InvalidDuration();
    error AscendantMinting__NoSharesToClaim();
    error AscendantMinting__LockPeriodNotOver();
    error AscendantMinting__OnlyMintingAndBurning();
    error AscendantMinting__InvalidNftCount();
    error AscendantMinting__MaxBatchNftThresholdReached();
    error AscendantMinting__TierAmountMismatch();
    error AscendantMinting__InvalidLegendaryTierImageIndex();

    //==========EVENTS==========//

    /**
     * @notice Emitted when a new NFT is minted
     * @param minter Address that minted the NFT
     * @param ascendant Amount of Ascendant tokens locked
     * @param id Token ID of the minted NFT
     * @param _shares Number of shares assigned to the NFT
     */
    event Minted(address indexed minter, uint256 indexed ascendant, uint256 indexed id, uint256 _shares);

    /**
     * @notice Emitted when an NFT is burned
     * @param shares Amount of shares burned
     * @param ascendantAmountReceived Amount of Ascendant tokens returned
     * @param _tokenId Token ID of the burned NFT
     * @param recepient Address receiving the Ascendant tokens
     */
    event Burnt(
        uint256 indexed shares, uint256 indexed ascendantAmountReceived, uint256 indexed _tokenId, address recepient
    );

    /**
     * @notice Emitted when an NFT is burned during fusion
     * @param shares Amount of shares fusion burned
     * @param _tokenId Token ID of the fusion burned NFT
     * @param recepient Address receiving the Ascendant tokens
     */
    event FusionBurnt(uint256 indexed shares, uint256 indexed _tokenId, address recepient);

    /**
     * @notice Event emitted when rewards are claimed for an NFT
     * @param id The token ID of the NFT
     * @param rewards Amount of rewards claimed
     * @param newRewardDebt Updated reward debt after claiming
     * @param ownerOfMint Address of the NFT owner
     */
    event Claimed(uint256 indexed id, uint256 indexed rewards, uint256 indexed newRewardDebt, address ownerOfMint);

    /**
     * @notice Event emitted when rewards are distributed to a pool
     * @param pool The pool receiving the distribution (DAY8, DAY28, or DAY90)
     * @param amount Amount of tokens distributed
     */
    event Distributed(POOLS indexed pool, uint256 indexed amount);

    /**
     * @notice Event emitted when NFT attributes are generated
     * @param tokenId The ID of the NFT
     * @param nftAttribute Random number generated for the NFT
     * @param nftTier Tier level of the NFT
     */
    event AscendantMinting__NFTAttributeGenerated(uint256 tokenId, uint256 nftAttribute, uint64 nftTier);

    /**
     * @notice Event emitted when two NFTs are fused
     * @param firstTokenId ID of the first NFT being fused
     * @param secondTokenId ID of the second NFT being fused
     * @param newTokenId ID of the newly created NFT
     * @param shares Number of shares assigned to the new NFT
     * @param oldTier Tier level of the original NFTs
     * @param newTier Tier level of the newly created NFT
     */
    event NFTFusion(
        uint256 indexed firstTokenId,
        uint256 indexed secondTokenId,
        uint256 indexed newTokenId,
        uint256 shares,
        uint8 oldTier,
        uint8 newTier
    );

    //==========CONSTRUCTOR==========//

    /**
     * @param _dragonX Address of the DragonX token contract
     * @param _ascendant Address of the Ascendant token contract
     * @param _ascendantPride Address of the AscendantPride contract
     * @param _startTimestamp Timestamp when the contract becomes operational
     */
    constructor(address _dragonX, address _ascendant, address _ascendantPride, uint32 _startTimestamp, string[10][8] memory _tokenURIs) 
        ERC721("Ascendant.win", "ASCNFT")
        Ownable(msg.sender)
    {
        startTimestamp = _startTimestamp;
        ascendant = IAscendant(_ascendant);
        dragonX = IERC20(_dragonX);
        ascendantPride = _ascendantPride;
        lastDistributedDay = 1;
        tokenURIs = _tokenURIs;
    }

    //==========================//
    //==========PUBLIC==========//
    //==========================//

    /**
    * @notice Returns metadata URI for given token ID 
    * @dev Overrides ERC721URIStorage tokenURI()
    */
    function tokenURI(uint256 _tokenId) public view override returns (string memory) {
        address owner = _ownerOf(_tokenId);
        if (owner == address(0)) {
            revert AscendantMinting__InvalidTokenID(_tokenId);
        }

        NftAttributes memory currentNftAttributes = nftAttributes[_tokenId];
    
        return tokenURIs[currentNftAttributes.tier - 1][currentNftAttributes.rarityNumber];
    }    

    /**
     * @notice Burns an NFT and returns locked Ascendant tokens
     * @param _tokenId ID of the NFT to burn
     * @param _receiver Address to receive the Ascendant tokens
     * @dev Requires lock period to be over
     */
    function burn(uint256 _tokenId, address _receiver) public notAddress0(_receiver) notAmount0(_tokenId) {
        UserRecord memory record = userRecords[_tokenId];

        if (record.shares == 0) revert AscendantMinting__NoSharesToClaim();
        if (record.endTime > Time.blockTs()) revert AscendantMinting__LockPeriodNotOver();

        _normalClaimAndBurn(_tokenId, _receiver);
    }

    /**
     * @notice Claims accumulated rewards for an NFT
     * @param _tokenId ID of the NFT to claim rewards for
     * @param _receiver Address to receive the rewards
     */
    function claim(uint256 _tokenId, address _receiver) public notAddress0(_receiver) notAmount0(_tokenId) {
        isApprovedOrOwner(_tokenId, msg.sender);

        _claim(_tokenId, _receiver);
    }

    /**
     * @notice Updates rewards across all pools if conditions are met
     * @dev Checks and distributes rewards for 8-day, 28-day, and 90-day pools
     */
    function updateRewardsIfNecessary() public {
        if (totalShares == 0) return;

        uint32 currentDay = _getCurrentDay();

        // Calculate how many periods have passed for each interval
        bool distributeDay8 = (currentDay / 8 > lastDistributedDay / 8);
        bool distributeDay28 = (currentDay / 28 > lastDistributedDay / 28);
        bool distributeDay90 = (currentDay / 90 > lastDistributedDay / 90);

        // Distribute for the 8-day pool if necessary
        if (distributeDay8) _updateRewards(POOLS.DAY8, toDistribute);

        // Distribute for the 28-day pool if necessary
        if (distributeDay28) _updateRewards(POOLS.DAY28, toDistribute);

        // Distribute for the 90-day pool if necessary
        if (distributeDay90) _updateRewards(POOLS.DAY90, toDistribute);

        // Update the last distributed day to the current day
        lastDistributedDay = currentDay;
    }

    /**
     * @notice Verifies if an address is authorized to handle a token
     * @param _tokenId The ID of the token to check
     * @param _spender The address to verify authorization for
     * @dev Wraps _checkAuthorized function from ERC721
     */
    function isApprovedOrOwner(uint256 _tokenId, address _spender) public view {
        _checkAuthorized(ownerOf(_tokenId), _spender, _tokenId);
    }

    /**
     * @notice Retrieves Ascendant token amount and tier percentage based on tier
     * @param _tier The tier level to get data for
     * @return tierValue The amount of Ascendant tokens required for the tier
     * @return multiplier The percentage multiplier for the tier (Ranging from 1.01e18 to 1.08e18)
     * @dev Reverts if tier is invalid
     */
    function getAscendantDataBasedOnTier(uint8 _tier) public pure returns (uint256 tierValue, uint64 multiplier) {
        require(_tier >= TIER_1 && _tier <= TIER_8, AscendantMinting__TierAmountMismatch());

        tierValue = ASCENDANT_TIER_1 << (_tier - 1); // Multiplies ASCENDANT_TIER_1 by 2^(_tier - 1)
        multiplier = WAD + (uint64(_tier) * 1e16); // WAD = 1e18, adds 0.01e18 per tier
    }

    //==========================//
    //==========EXTERNAL========//
    //==========================//

    /**
     * @notice Allows the contract owner to update the image URIs
     * @param _newTokenURIs New array of image URIs to set
     * @dev Must maintain the same structure: 8 tiers with 10 images each
     */
     function setTokenURIs(string[10][8] memory _newTokenURIs) external onlyOwner {
        tokenURIs = _newTokenURIs;
        emit BatchMetadataUpdate(0, type(uint256).max); // because it is required for OpenSea metadata update
    }

    /**
    * @notice Allows the contract owner to update a single token URI
    * @param _tier The tier level to update (1-8)
    * @param _index The index within the tier to update (0-9)
    * @param _newUri The new image URI to set
    * @dev Tier is 1-based but storage array is 0-based
    */
    function setSingleTokenURI(
        uint8 _tier, 
        uint256 _index, 
        string memory _newUri
    ) external onlyOwner {
        require(_tier >= 1 && _tier <= 8, "Invalid tier");
        require(_index < 10, "Invalid index");
    
        // tier - 1 because array is 0-based
        tokenURIs[_tier - 1][_index] = _newUri;

        emit BatchMetadataUpdate(0, type(uint256).max); // because it is required for OpenSea metadata update
    }


    /**
     * @notice Mints multiple NFTs of the same tier
     * @param _numOfNfts Number of NFTs to mint
     * @param _ascendantTier Tier level for all NFTs
     * @return tokenIds Array of minted token IDs
     * @return batchMintTotalShares Total shares assigned across all minted NFTs
     */
    function batchMint(uint8 _numOfNfts, uint8 _ascendantTier)
        public
        notAmount0(_numOfNfts)
        notAmount0(_ascendantTier)
        returns (uint256[] memory tokenIds, uint256 batchMintTotalShares)
    {
        tokenIds = new uint256[](_numOfNfts);

        for (uint8 i = 0; i < _numOfNfts; i++) {
            (uint256 _tokenId, uint256 shares) = mint(_ascendantTier);
            tokenIds[i] = _tokenId;
            batchMintTotalShares += shares;
        }

        return (tokenIds, batchMintTotalShares);
    }

    /**
     * @notice Mints a new NFT with the specified tier
     * @param _tier Tier level for the new NFT
     * @return _tokenId The ID of the newly minted NFT
     * @return shares The number of shares assigned to the NFT
     * @dev Transfers required Ascendant tokens from sender, creates NFT attributes, and updates total shares
     */
    function mint(uint8 _tier) public notAmount0(_tier) returns (uint256 _tokenId, uint256 shares) {
        (uint256 _ascendantAmount, uint64 _ascendantTierPercentage) = getAscendantDataBasedOnTier(_tier);

        updateRewardsIfNecessary();

        _tokenId = ++tokenId;

        shares = wmul(_ascendantAmount, _ascendantTierPercentage);

        userRecords[_tokenId] = UserRecord({
            startTime: Time.blockTs(),
            endTime: Time.blockTs() + MIN_DURATION,
            shares: shares,
            rewardDebt: rewardPerShare,
            lockedAscendant: _ascendantAmount
        });

        _generateNFTAttribute(_tokenId, _tier);

        totalShares += shares;

        ascendant.transferFrom(msg.sender, address(this), _ascendantAmount);

        emit Minted(msg.sender, _ascendantAmount, _tokenId, shares);

        _mint(msg.sender, _tokenId);

        emit MetadataUpdate(_tokenId); // because OpenSea listens for this type of events and once detected OpenSea refreshes the data
    }

    /**
     * @notice Calculates total claimable rewards for multiple NFTs
     * @param _ids Array of NFT IDs to check
     * @return toClaim Total amount of rewards claimable
     */
    function batchClaimableAmount(uint256[] calldata _ids) external view returns (uint256 toClaim) {
        uint32 currentDay = _getCurrentDay();

        uint256 m_rewardsPerShare = rewardPerShare;

        bool distributeDay8 = (currentDay / 8 > lastDistributedDay / 8);
        bool distributeDay28 = (currentDay / 28 > lastDistributedDay / 28);
        bool distributeDay90 = (currentDay / 90 > lastDistributedDay / 90);

        if (distributeDay8) m_rewardsPerShare += wdiv(toDistribute[POOLS.DAY8], totalShares);
        if (distributeDay28) m_rewardsPerShare += wdiv(toDistribute[POOLS.DAY28], totalShares);
        if (distributeDay90) m_rewardsPerShare += wdiv(toDistribute[POOLS.DAY90], totalShares);

        for (uint256 i; i < _ids.length; ++i) {
            uint256 _id = _ids[i];

            UserRecord memory _rec = userRecords[_id];
            toClaim += wmul(_rec.shares, m_rewardsPerShare - _rec.rewardDebt);
        }
    }

    /**
     * @notice Burns multiple NFTs
     * @param _ids Array of NFT IDs to burn
     * @param _receiver Address to receive the Ascendant tokens
     */
    function batchBurn(uint256[] calldata _ids, address _receiver) external {
        for (uint256 i; i < _ids.length; ++i) {
            burn(_ids[i], _receiver);
        }
    }

    /**
     * @notice Claims rewards for multiple NFTs
     * @param _ids Array of NFT IDs to claim rewards for
     * @param _receiver Address to receive the rewards
     */
    function batchClaim(uint256[] calldata _ids, address _receiver) external {
        for (uint256 i; i < _ids.length; ++i) {
            claim(_ids[i], _receiver);
        }
    }

    /**
     * @notice Distributes DragonX rewards to the reward pools
     * @param _amount Amount of DragonX tokens to distribute
     * @dev Transfers tokens from sender and updates reward pools
     */
    function distribute(uint256 _amount) external notAmount0(_amount) {
        dragonX.transferFrom(msg.sender, address(this), _amount);

        _distribute(_amount);
    }

    /**
     * @notice Combines two NFTs of the same tier to create a higher tier NFT
     * @param _firstTokenId First NFT to fuse
     * @param _secondTokenId Second NFT to fuse
     * @dev Both NFTs must be of the same tier and not expired
     */
    function fusion(uint256 _firstTokenId, uint256 _secondTokenId) external {
        if (_firstTokenId == _secondTokenId) revert AscendantMinting__FusionTokenIdsCannotBeTheSame();
        if (ownerOf(_firstTokenId) != msg.sender) revert AscendantMinting__InvalidNFTOwner();
        if (ownerOf(_secondTokenId) != msg.sender) revert AscendantMinting__InvalidNFTOwner();

        NftAttributes memory firstAttributes = nftAttributes[_firstTokenId];
        NftAttributes memory secondAttributes = nftAttributes[_secondTokenId];

        if (firstAttributes.tier != secondAttributes.tier) revert AscendantMinting__TierOfNFTsMustBeTheSame();
        if (firstAttributes.tier == TIER_8) revert AscendantMinting__MaxTierReached();

        _fusionClaimAndBurn(_firstTokenId, msg.sender);
        _fusionClaimAndBurn(_secondTokenId, msg.sender);

        uint8 incrementedTier = firstAttributes.tier + 1;

        (uint256 newTokenId, uint256 shares) = _fusionMint(incrementedTier);

        emit NFTFusion(_firstTokenId, _secondTokenId, newTokenId, shares, firstAttributes.tier, incrementedTier);
    }

    //==========================//
    //=========INTERNAL=========//
    //==========================//

    /**
     * @notice Internal function to process claims
     * @param _tokenId The ID of the NFT to claim rewards for
     * @param _receiver Address to receive the rewards
     * @dev Updates reward debt and transfers DragonX tokens
     */
    function _claim(uint256 _tokenId, address _receiver) internal {
        UserRecord storage _rec = userRecords[_tokenId];

        updateRewardsIfNecessary();

        uint256 amountToClaim = wmul(_rec.shares, rewardPerShare - _rec.rewardDebt);

        _rec.rewardDebt = rewardPerShare;

        dragonX.transfer(_receiver, amountToClaim);

        emit Claimed(_tokenId, amountToClaim, rewardPerShare, ownerOf(_tokenId));
    }

    /**
     * @notice Internal function to distribute rewards across pools
     * @param amount Amount of DragonX tokens to distribute
     * @dev Handles different distribution ratios based on current day
     */
    function _distribute(uint256 amount) internal {
        uint32 currentDay = _getCurrentDay();

        updateRewardsIfNecessary();

        if (currentDay == 1) {
            toDistribute[POOLS.DAY8] += amount;
        } else {
            toDistribute[POOLS.DAY8] += wmul(amount, DAY8POOL_DIST);
            toDistribute[POOLS.DAY28] += wmul(amount, DAY28POOL_DIST);
            toDistribute[POOLS.DAY90] += wmul(amount, DAY90POOL_DIST);
        }
    }

    /**
     * @notice Generates attributes for a newly minted NFT
     * @param _tokenId The ID of the NFT
     * @param _ascendantTier The tier level of the NFT
     * @dev Generates random number and sets rarity based on tier
     */
    function _generateNFTAttribute(uint256 _tokenId, uint8 _ascendantTier) internal {
        uint256 randomNumber = _generatePseudoRandom(_tokenId) % NUMBER_OF_NFT_IMAGES_PER_TIER;

        nftAttributes[_tokenId] =
            NftAttributes({
                tier: _ascendantTier,
                rarity: getRarity(randomNumber),
                rarityNumber: randomNumber
            });

        emit AscendantMinting__NFTAttributeGenerated(_tokenId, randomNumber, _ascendantTier);
    }

    /**
     * @notice Generates a pseudo-random number for NFT attributes
     * @param _tokenId The ID of the NFT to generate random number for
     * @return uint256 A pseudo-random number
     * @dev Uses block data and transaction data for randomness
     */
    function _generatePseudoRandom(uint256 _tokenId) internal view returns (uint256) {
        return uint256(
            keccak256(
                abi.encodePacked(
                    block.timestamp, block.prevrandao, blockhash(block.number - 1), tx.gasprice, msg.sender, _tokenId
                )
            )
        ) % NFT_ATTRIBUTE_RANDOM_NUMBER;
    }

    /**
     * @notice Updates rewards for a specific pool
     * @param pool The pool to update rewards for
     * @param toDist Storage mapping of distribution amounts
     * @dev Updates rewardPerShare and emits Distributed event
     */
    function _updateRewards(POOLS pool, mapping(POOLS => uint256) storage toDist) internal {
        if (toDist[pool] == 0) return;

        rewardPerShare += wdiv(toDist[pool], totalShares);

        emit Distributed(pool, toDist[pool]);

        toDistribute[pool] = 0;
    }

    /**
     * @notice Gets the current day number since contract start
     * @return currentDay The current day number (1-based)
     * @dev Returns 1 if contract hasn't started yet
     */
    function _getCurrentDay() internal view returns (uint32 currentDay) {
        if (startTimestamp > Time.blockTs()) {
            return 1;
        }
        return Time.dayGap(startTimestamp, Time.blockTs()) + 1;
    }

    /**
     * @notice Retrieves the NFT attributes for a given token ID
     * @param _tokenId The ID of the NFT
     * @return NftAttributes struct containing the NFT's attributes
     */
    function getNFTAttribute(uint256 _tokenId) external view returns (NftAttributes memory) {
        return nftAttributes[_tokenId];
    }

    //==========================//
    //=========PRIVATE==========//
    //==========================//

    /**
     * @notice Internal function to mint a new NFT during fusion
     * @param _tier The tier level of the new NFT
     * @return _tokenId The ID of the newly minted NFT
     * @return shares The number of shares assigned to the NFT
     * @dev Similar to public mint but skips token transfer as tokens are already in contract
     */
     function _fusionMint(uint8 _tier) private notAmount0(_tier) returns (uint256 _tokenId, uint256 shares) {
        (uint256 _ascendantAmount, uint64 _ascendantTierPercentage) = getAscendantDataBasedOnTier(_tier);

        updateRewardsIfNecessary();

        _tokenId = ++tokenId;

        shares = wmul(_ascendantAmount, _ascendantTierPercentage);

        userRecords[_tokenId] = UserRecord({
            startTime: Time.blockTs(),
            endTime: Time.blockTs() + MIN_DURATION,
            shares: shares,
            rewardDebt: rewardPerShare,
            lockedAscendant: _ascendantAmount
        });

        _generateNFTAttribute(_tokenId, _tier);

        totalShares += shares;

        // no need to transfer Ascendant tokens to the current contract
        // because this function is used only for fusion which means
        // that the ascendant is already in the contract

        emit Minted(msg.sender, _ascendantAmount, _tokenId, shares);

        _mint(msg.sender, _tokenId);

        emit MetadataUpdate(_tokenId); // because OpenSea listens for this type of events and once detected OpenSea refreshes the data
    }

    /**
     * @notice Burns an NFT and sends Ascendant tokens back to receiver after subtracting redeem tax
     * @param _tokenId The ID of the NFT to burn
     * @param _receiver Address to receive the Ascendant tokens and rewards
     * @dev Handles the standard burn process where Ascendant tokens are returned
     *      minus the redeem tax which is sent to AscendantPride
     */
    function _normalClaimAndBurn(uint256 _tokenId, address _receiver) private {
        _claimAndBurn(_tokenId, _receiver, false);
    }

    /**
     * @notice Burns an NFT during the fusion process without returning Ascendant tokens
     * @param _tokenId The ID of the NFT to burn
     * @param _receiver Address to receive only the DragonX rewards
     * @dev Used during fusion where Ascendant tokens remain in the contract
     *      to be used for minting the new higher tier NFT
     */
    function _fusionClaimAndBurn(uint256 _tokenId, address _receiver) private {
        _claimAndBurn(_tokenId, _receiver, true);
    }

    /**
     * @notice Internal function that handles the process of claiming rewards and burning an NFT
     * @param _tokenId The ID of the NFT to process
     * @param _receiver Address to receive tokens (DragonX rewards and optionally Ascendant tokens)
     * @param _isFusion Boolean indicating if this burn is part of a fusion operation
     * @dev This function:
     *      - Verifies ownership or approval
     *      - Claims any accumulated DragonX rewards
     *      - Cleans up NFT data (userRecords and nftAttributes)
     *      - Updates total shares
     *      - If not fusion: calculates and applies redeem tax, sends remaining Ascendant to receiver
     *      - If fusion: retains Ascendant tokens in contract
     *      - Burns the NFT
     *      - Emits either Burnt or FusionBurnt event depending on _isFusion
     */
    function _claimAndBurn(uint256 _tokenId, address _receiver, bool _isFusion)
        private
        notAddress0(_receiver)
        notAmount0(_tokenId)
    {
        UserRecord memory record = userRecords[_tokenId];

        isApprovedOrOwner(_tokenId, msg.sender);

        _claim(_tokenId, _receiver);

        uint256 _shares = record.shares;

        delete userRecords[_tokenId];

        delete nftAttributes[_tokenId];

        totalShares -= record.shares;

        if (!_isFusion) {
            uint256 _ascendantRedeemTax = wmul(record.lockedAscendant, ASCENDANT_REDEEM_TAX);

            uint256 _ascendantToReturn = record.lockedAscendant - _ascendantRedeemTax;

            ascendant.transfer(ascendantPride, _ascendantRedeemTax);

            ascendant.transfer(_receiver, _ascendantToReturn);

            emit Burnt(_shares, _ascendantToReturn, _tokenId, _receiver);
        } else {
            emit FusionBurnt(_shares, _tokenId, _receiver);
        }

        _burn(_tokenId);
    }

    /**
    * @notice Determines rarity based on a pseudo-random number 0-9
    * @param number The pseudo-random number input (must be 0-9)
    * @return Rarity enum value (LEGENDARY for 0, COMMON for 1-7, RARE for 8-9)
    * @dev Used for weighted rarity distribution:
    *      - 10% chance for LEGENDARY (number = 0)
    *      - 70% chance for COMMON (numbers 1-7) 
    *      - 20% chance for RARE (numbers 8-9)
    */    
    function getRarity(uint256 number) private pure returns (Rarity) {
        if (number == 0) return Rarity.LEGENDARY;    // 10% chance
        if (number <= 7) return Rarity.COMMON;       // 70% chance
        return Rarity.RARE;                          // 20% chance
    }

}
// Source: ./SolidityContracts/Ascendant/AscendantPride.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@const/Constants.sol";
import {wmul} from "@utils/Math.sol";
import {IAscendant} from "@interfaces/IAscendant.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AscendantPride Contract
 * @author Decentra
 * @notice Contract that manages the accumulation and distribution of Ascendant tokens for the auction system
 */
contract AscendantPride {
    using SafeERC20 for IAscendant;

    /* === IMMUTABLES === */

    /**
     * @notice Interface to the Ascendant token contract for token transfers and balance checks
     */
    IAscendant immutable ascendant;

    /**
     * @notice Address of the auction contract authorized to call emitForAuction
     * @dev Immutable reference set in constructor, used for access control validation
     */
    address immutable auction;

    /* === ERRORS === */
    error AscendantPride__OnlyAuction();

    /* === CONSTRUCTOR === */

    /**
     * @notice Initializes the AscendantPride contract
     * @param _auction Address of the auction contract that will receive distributed tokens
     * @param _ascendant Address of the Ascendant token contract
     */
    constructor(address _auction, address _ascendant) {
        auction = _auction;
        ascendant = IAscendant(_ascendant);
    }

    //==========================//
    //=========MODIFIERS========//
    //==========================//

    /**
     * @dev Modifier to restrict function access to auction contract only
     */
    modifier onlyAuction() {
        _onlyAuction();
        _;
    }

    //==========================//
    //=========EXTERNAL=========//
    //==========================//

    /**
     * @notice Distributes tokens to the auction contract
     * @return emitted Amount of tokens transferred to the auction
     */
    function emitForAuction() external onlyAuction returns (uint256 emitted) {
        uint256 balanceOf = ascendant.balanceOf(address(this));

        emitted = wmul(balanceOf, DISTRIBUTION_FROM_THE_ASCENDANT);

        ascendant.safeTransfer(msg.sender, emitted);
    }

    //==========================//
    //=========INTERNAL=========//
    //==========================//

    /**
     * @dev Internal function to validate caller is auction contract
     */
    function _onlyAuction() internal view {
        if (msg.sender != auction) revert AscendantPride__OnlyAuction();
    }
}

// Source: ./SolidityContracts/Ascendant/Constants.sol
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

// Source: ./SolidityContracts/Ascendant/IAscendant.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

import {AscendantAuction} from "@core/AscendantAuction.sol";
import {Ascendant} from "@core/Ascendant.sol";

interface IAscendantBuyAndBurn {
    function distributeTitanXForBurning(uint256 _amount) external;
}

interface IAscendantNFTMinting {
    function claim(uint256 _tokenId, address _receiver) external;
}

interface IAscendant is IERC20 {
    /* == ERRORS == */
    error Ascendant__OnlyAuction();

    /* == VIEW FUNCTIONS == */
    function auction() external view returns (AscendantAuction);
    function buyAndBurn() external view returns (IAscendantBuyAndBurn);
    function pool() external view returns (address);

    /* == EXTERNAL FUNCTIONS == */
    function burn(uint256 amount) external;

    function emitForAuction() external returns (uint256 emitted);

    function emitForLp() external returns (uint256 emitted);
}

// Source: ./SolidityContracts/Ascendant/IWETH.sol
// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.27;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title Interface for WETH9
interface IWETH9 is IERC20 {
    /// @notice Deposit ether to get wrapped ether
    function deposit() external payable;

    /// @notice Withdraw wrapped ether to get ether
    function withdraw(uint256) external;
}

// Source: ./SolidityContracts/Ascendant/OracleLibrary.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

/**
 * @notice Adapted Uniswap V3 OracleLibrary computation to be compliant with Solidity 0.8.x and later.
 *
 * Documentation for Auditors:
 *
 * Solidity Version: Updated the Solidity version pragma to ^0.8.0. This change ensures compatibility
 * with Solidity version 0.8.x.
 *
 * Safe Arithmetic Operations: Solidity 0.8.x automatically checks for arithmetic overflows/underflows.
 * Therefore, the code no longer needs to use SafeMath library (or similar) for basic arithmetic operations.
 * This change simplifies the code and reduces the potential for errors related to manual overflow/underflow checking.
 *
 * Overflow/Underflow: With the introduction of automatic overflow/underflow checks in Solidity 0.8.x, the code is inherently
 * safer and less prone to certain types of arithmetic errors.
 *
 * Removal of SafeMath Library: Since Solidity 0.8.x handles arithmetic operations safely, the use of SafeMath library
 * is omitted in this update.
 *
 * Git-style diff for the `consult` function:
 *
 * ```diff
 * function consult(address pool, uint32 secondsAgo)
 *     internal
 *     view
 *     returns (int24 arithmeticMeanTick, uint128 harmonicMeanLiquidity)
 * {
 *     require(secondsAgo != 0, 'BP');
 *
 *     uint32[] memory secondsAgos = new uint32[](2);
 *     secondsAgos[0] = secondsAgo;
 *     secondsAgos[1] = 0;
 *
 *     (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) =
 *         IUniswapV3Pool(pool).observe(secondsAgos);
 *
 *     int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
 *     uint160 secondsPerLiquidityCumulativesDelta =
 *         secondsPerLiquidityCumulativeX128s[1] - secondsPerLiquidityCumulativeX128s[0];
 *
 * -   arithmeticMeanTick = int24(tickCumulativesDelta / secondsAgo);
 * +   int56 secondsAgoInt56 = int56(uint56(secondsAgo));
 * +   arithmeticMeanTick = int24(tickCumulativesDelta / secondsAgoInt56);
 *     // Always round to negative infinity
 * -   if (tickCumulativesDelta < 0 && (tickCumulativesDelta % secondsAgo != 0)) arithmeticMeanTick--;
 * +   if (tickCumulativesDelta < 0 && (tickCumulativesDelta % secondsAgoInt56 != 0)) arithmeticMeanTick--;
 *
 * -   uint192 secondsAgoX160 = uint192(secondsAgo) * type(uint160).max;
 * +   uint192 secondsAgoUint192 = uint192(secondsAgo);
 * +   uint192 secondsAgoX160 = secondsAgoUint192 * type(uint160).max;
 *     harmonicMeanLiquidity = uint128(secondsAgoX160 / (uint192(secondsPerLiquidityCumulativesDelta) << 32));
 * }
 * ```
 */

/// @title Oracle library
/// @notice Provides functions to integrate with V3 pool oracle
library OracleLibrary {
    /// @notice Calculates time-weighted means of tick and liquidity for a given Uniswap V3 pool
    /// @param pool Address of the pool that we want to observe
    /// @param secondsAgo Number of seconds in the past from which to calculate the time-weighted means
    /// @return arithmeticMeanTick The arithmetic mean tick from (block.timestamp - secondsAgo) to block.timestamp
    /// @return harmonicMeanLiquidity The harmonic mean liquidity from (block.timestamp - secondsAgo) to block.timestamp
    function consult(address pool, uint32 secondsAgo)
        internal
        view
        returns (int24 arithmeticMeanTick, uint128 harmonicMeanLiquidity)
    {
        require(secondsAgo != 0, "BP");

        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = secondsAgo;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) =
            IUniswapV3Pool(pool).observe(secondsAgos);

        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        uint160 secondsPerLiquidityCumulativesDelta;
        unchecked {
            secondsPerLiquidityCumulativesDelta =
                secondsPerLiquidityCumulativeX128s[1] - secondsPerLiquidityCumulativeX128s[0];
        }

        // Safe casting of secondsAgo to int56 for division
        int56 secondsAgoInt56 = int56(uint56(secondsAgo));
        arithmeticMeanTick = int24(tickCumulativesDelta / secondsAgoInt56);
        // Always round to negative infinity
        if (tickCumulativesDelta < 0 && (tickCumulativesDelta % secondsAgoInt56 != 0)) arithmeticMeanTick--;

        // Safe casting of secondsAgo to uint192 for multiplication
        uint192 secondsAgoUint192 = uint192(secondsAgo);
        harmonicMeanLiquidity = uint128(
            (secondsAgoUint192 * uint192(type(uint160).max)) / (uint192(secondsPerLiquidityCumulativesDelta) << 32)
        );
    }

    /// @notice Given a pool, it returns the number of seconds ago of the oldest stored observation
    /// @param pool Address of Uniswap V3 pool that we want to observe
    /// @return secondsAgo The number of seconds ago of the oldest observation stored for the pool
    function getOldestObservationSecondsAgo(address pool) internal view returns (uint32 secondsAgo) {
        (,, uint16 observationIndex, uint16 observationCardinality,,,) = IUniswapV3Pool(pool).slot0();
        require(observationCardinality > 0, "NI");

        (uint32 observationTimestamp,,, bool initialized) =
            IUniswapV3Pool(pool).observations((observationIndex + 1) % observationCardinality);

        // The next index might not be initialized if the cardinality is in the process of increasing
        // In this case the oldest observation is always in index 0
        if (!initialized) {
            (observationTimestamp,,,) = IUniswapV3Pool(pool).observations(0);
        }

        secondsAgo = uint32(block.timestamp) - observationTimestamp;
    }

    /// @notice Given a tick and a token amount, calculates the amount of token received in exchange
    /// a slightly modified version of the UniSwap library getQuoteAtTick to accept a sqrtRatioX96 as input parameter
    /// @param sqrtRatioX96 The sqrt ration
    /// @param baseAmount Amount of token to be converted
    /// @param baseToken Address of an ERC20 token contract used as the baseAmount denomination
    /// @param quoteToken Address of an ERC20 token contract used as the quoteAmount denomination
    /// @return quoteAmount Amount of quoteToken received for baseAmount of baseToken
    function getQuoteForSqrtRatioX96(uint160 sqrtRatioX96, uint256 baseAmount, address baseToken, address quoteToken)
        internal
        pure
        returns (uint256 quoteAmount)
    {
        // Calculate quoteAmount with better precision if it doesn't overflow when multiplied by itself
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) ** 2;
            quoteAmount = baseToken < quoteToken
                ? Math.mulDiv(ratioX192, baseAmount, 1 << 192)
                : Math.mulDiv(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = Math.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? Math.mulDiv(ratioX128, baseAmount, 1 << 128)
                : Math.mulDiv(1 << 128, baseAmount, ratioX128);
        }
    }
}

// Source: ./SolidityContracts/Ascendant/SwapActions.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "@const/Constants.sol";
import {Errors} from "@utils/Errors.sol";
import {wmul, min} from "@utils/Math.sol";
import {PoolAddress} from "@libs/PoolAddress.sol";
import {OracleLibrary} from "@libs/OracleLibrary.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/// @notice Struct representing slippage settings for a pool.
struct Slippage {
    uint224 slippage; //< Slippage in WAD (scaled by 1e18)
    uint32 twapLookback; //< TWAP lookback period in minutes (used as seconds in code)
}

struct SwapActionParams {
    address _v3Router;
    address _v3Factory;
    address _owner;
}

/**
 * @title SwapActions
 * @notice A contract that facilitates token swapping on Uniswap V3 with slippage management.
 * @dev Uses Uniswap V3 Router and Oracle libraries for swap actions and TWAP calculations.
 */
contract SwapActions is Ownable2Step, Errors {
    /// @notice Address of the Uniswap V3 Router
    address public immutable uniswapV3Router;

    /// @notice Address of the Uniswap V3 Factory
    address public immutable v3Factory;

    /// @notice Address of the admin responsible for managing slippage
    address public slippageAdmin;

    /// @notice Mapping of pool addresses to their respective slippage settings
    mapping(address pool => Slippage) public slippageConfigs;

    /// @notice Thrown when an invalid slippage is provided
    error SwapActions__InvalidSlippage();

    /// @notice Thrown when a non-admin/non-owner attempts to perform slippage actions
    error SwapActions__OnlySlippageAdmin();

    /// @notice Thrown when an invalid TWA lookback is passed
    error SwapActions__InvalidLookBack();

    event SlippageAdminChanged(address indexed oldAdmin, address indexed newAdmin);
    event SlippageConfigChanged(address indexed pool, uint224 indexed newSlippage, uint32 indexed newLookback);

    /**
     * @dev Ensures the caller is either the slippage admin or the contract owner.
     */
    modifier onlySlippageAdminOrOwner() {
        _onlySlippageAdminOrOwner();
        _;
    }

    /**
     * @param params The aprams to initialize the SwapAcitons contract.
     */
    constructor(SwapActionParams memory params) Ownable(params._owner) {
        uniswapV3Router = params._v3Router;
        v3Factory = params._v3Factory;
        slippageAdmin = params._owner;
    }

    /**
     * @notice Change the address of the slippage admin.
     * @param _new New slippage admin address.
     * @dev Only callable by the contract owner.
     */
    function changeSlippageAdmin(address _new) external notAddress0(_new) onlyOwner {
        emit SlippageAdminChanged(slippageAdmin, _new);

        slippageAdmin = _new;
    }

    /**
     * @notice Change slippage configuration for a specific pool.
     * @param pool Address of the Uniswap V3 pool.
     * @param _newSlippage New slippage value (in WAD).
     * @param _newLookBack New TWAP lookback period (in minutes).
     * @dev Only callable by the slippage admin or the owner.
     */
    function changeSlippageConfig(address pool, uint224 _newSlippage, uint32 _newLookBack)
        external
        notAmount0(_newLookBack)
        onlySlippageAdminOrOwner
    {
        require(_newLookBack >= 5 && _newLookBack <= 30, SwapActions__InvalidLookBack());
        require(_newSlippage <= WAD, SwapActions__InvalidSlippage());

        emit SlippageConfigChanged(pool, _newSlippage, _newLookBack);

        slippageConfigs[pool] = Slippage({slippage: _newSlippage, twapLookback: _newLookBack});
    }

    /**
     * @notice Perform an exact input swap on Uniswap V3.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param tokenInAmount Amount of the input token to swap.
     * @param minAmountOut Optional minimum amount out, if it's 0 it uses the twap
     * @param deadline Deadline timestamp for the swap.
     * @return amountReceived Amount of the output token received.
     * @dev The function uses the TWAP (Time-Weighted Average Price) to ensure the swap is performed within slippage tolerance.
     */
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 tokenInAmount,
        uint256 minAmountOut,
        uint32 deadline
    ) internal returns (uint256 amountReceived) {
        IERC20(tokenIn).approve(uniswapV3Router, tokenInAmount);

        bytes memory path = abi.encodePacked(tokenIn, POOL_FEE, tokenOut);

        (uint256 twapAmount, uint224 slippage) = getTwapAmount(tokenIn, tokenOut, tokenInAmount);

        uint256 minAmount = minAmountOut == 0 ? wmul(twapAmount, slippage) : minAmountOut;

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: deadline,
            amountIn: tokenInAmount,
            amountOutMinimum: minAmount
        });

        return ISwapRouter(uniswapV3Router).exactInput(params);
    }

    /**
     * @notice Get the TWAP (Time-Weighted Average Price) and slippage for a given token pair.
     * @param tokenIn Address of the input token.
     * @param tokenOut Address of the output token.
     * @param amount Amount of the input token.
     * @return twapAmount The TWAP amount of the output token for the given input.
     * @return slippage The slippage tolerance for the pool.
     */
    function getTwapAmount(address tokenIn, address tokenOut, uint256 amount)
        public
        view
        returns (uint256 twapAmount, uint224 slippage)
    {
        address poolAddress = PoolAddress.computeAddress(v3Factory, PoolAddress.getPoolKey(tokenIn, tokenOut, POOL_FEE));

        Slippage memory slippageConfig = slippageConfigs[poolAddress];

        if (slippageConfig.twapLookback == 0 && slippageConfig.slippage == 0) {
            slippageConfig = Slippage({twapLookback: 15, slippage: WAD - 0.2e18});
        }

        uint32 secondsAgo = slippageConfig.twapLookback * 60;
        uint32 oldestObservation = OracleLibrary.getOldestObservationSecondsAgo(poolAddress);
        if (oldestObservation < secondsAgo) secondsAgo = oldestObservation;

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(poolAddress, secondsAgo);
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        slippage = slippageConfig.slippage;
        twapAmount = OracleLibrary.getQuoteForSqrtRatioX96(sqrtPriceX96, amount, tokenIn, tokenOut);
    }

    /**
     * @dev Internal function to check if the caller is the slippage admin or contract owner.
     */
    function _onlySlippageAdminOrOwner() private view {
        require(msg.sender == slippageAdmin || msg.sender == owner(), SwapActions__OnlySlippageAdmin());
    }
}

