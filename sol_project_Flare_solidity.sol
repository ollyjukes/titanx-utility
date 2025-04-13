// Concatenated Solidity source for Flare contracts
// Generated on Sat 12 Apr 2025 21:04:49 BST

// Source: ./SolidityContracts/Flare/BaseBuyNBurn.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import {wmul} from "../utils/Math.sol";
import {Time} from "../utils/Time.sol";
import {Errors} from "../utils/Errors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title BaseBuyAndBurn
 * @author Decentra
 * @notice This contract manages the buy and burn calculations/allocations
 */
contract BaseBuyAndBurn is Ownable, Errors {
    /// @notice Struct to represent intervals for burning
    struct Interval {
        uint128 amountAllocated;
        uint128 amountBurned;
    }

    /// @notice X28 token contract
    IERC20 internal immutable buyingToken;

    ///@notice The startTimestamp
    uint32 public immutable startTimeStamp;

    /// @notice The v2 router address
    address immutable v2Router;

    /// @notice Timestamp of the last snapshot
    uint32 public lastSnapshotTimestamp;

    /// @notice Timestamp of the last burn call
    uint32 public lastBurnedIntervalStartTimestamp;

    /// @notice Total amount of Flare tokens burnt
    uint256 public totalFlareBurnt;

    /// @notice Mapping from address to boolean to check permissions
    mapping(address => bool) public isPermissioned;

    /// @notice Mapping from interval number to Interval struct
    mapping(uint32 interval => Interval) public intervals;

    /// @notice Last interval number
    uint32 public lastIntervalNumber;

    /// @notice Last burned interval number
    uint32 public lastBurnedInterval;

    /// @notice Total X28 tokens distributed
    uint256 public totalX28Distributed;

    ///@notice - The maximum amount a swap can have for the BnB
    uint128 public swapCap;

    /// @notice True if the contract is in private mode
    bool public privateMode;

    /// @notice Event emitted when tokens are bought and burnt
    event BuyAndBurn(uint256 indexed X28Amount, uint256 indexed flareAmount, address indexed caller);

    /// @notice Error when the contract has not started yet
    error NotStartedYet();

    /// @notice Error when interval has already been called
    error SnapshotDuration();

    /// @notice Error when non permissioned caller
    error OnlyPermissionAdresses();

    /// @notice Error when some user input is considered invalid
    error InvalidInput();

    /// @notice Error when interval has already been burned
    error IntervalAlreadyBurned();

    /// @notice Error when the contract starts is not 2PM UTC
    error MustStartAt2PMUTC();

    /// @notice Error when non EOA caller
    error OnlyEOA();

    /**
     * @notice Constructor initializes the contract
     * @notice Constructor is payable to save gas
     * @param _startTimestamp the start timestamp
     * @param _v2Router the v2 router address
     * @param _buyingToken the buying token address
     * @param _owner the owner address
     */
    constructor(uint32 _startTimestamp, address _v2Router, address _buyingToken, address _owner)
        payable
        Ownable(_owner)
        notExpired(_startTimestamp)
        notAddress0(_v2Router)
        notAddress0(_buyingToken)
    {
        startTimeStamp = _startTimestamp;
        buyingToken = IERC20(_buyingToken);

        v2Router = _v2Router;

        isPermissioned[_owner] = true;

        swapCap = type(uint128).max;
    }

    /**
     * @notice Updates the contract state for intervals
     */
    modifier intervalUpdate() {
        _intervalUpdate();
        _;
    }

    /**
     * @notice Toggles the private mode
     * @param _isPrivate True if the contract is in private mode, false otherwise
     */
    function togglePrivateMode(bool _isPrivate) external onlyOwner {
        privateMode = _isPrivate;
    }

    /**
     * @notice Toggles the permissioned address
     * @param _caller The address to toggle
     * @param _isPermissioned True if the address is permissioned, false otherwise
     */
    function togglePermissionedAddress(address _caller, bool _isPermissioned) external onlyOwner notAddress0(_caller) {
        isPermissioned[_caller] = _isPermissioned;
    }

    /**
     * @notice Changes the swap cap
     * @param _newSwapCap The new swap cap
     */
    function changeSwapCap(uint128 _newSwapCap) external onlyOwner {
        swapCap = _newSwapCap;
    }

    /**
     * @notice Returns the current interval
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

        uint32 currentDay = Time.dayGap(startTimeStamp, Time.blockTs());

        uint32 dayOfLastInterval = lastBurnedIntervalStartTimestamp == 0
            ? currentDay
            : Time.dayGap(startTimeStamp, lastBurnedIntervalStartTimestamp);

        if (currentDay == dayOfLastInterval) {
            uint256 dailyAllocation = wmul(totalX28Distributed, getDailyTokenAllocation(Time.blockTs()));

            uint128 _amountPerInterval = uint128(dailyAllocation / INTERVALS_PER_DAY);

            uint128 additionalAmount = _amountPerInterval * missedIntervals;

            _totalAmountForInterval = _amountPerInterval + additionalAmount;
        } else {
            uint32 _lastBurnedIntervalStartTimestamp = lastBurnedIntervalStartTimestamp;

            uint32 theEndOfTheDay = Time.getDayEnd(_lastBurnedIntervalStartTimestamp);

            uint256 balanceOf = buyingToken.balanceOf(address(this));

            while (currentDay >= dayOfLastInterval) {
                uint32 end = uint32(Time.blockTs() < theEndOfTheDay ? Time.blockTs() : theEndOfTheDay - 1);

                uint32 accumulatedIntervalsForTheDay = (end - _lastBurnedIntervalStartTimestamp) / INTERVAL_TIME;

                uint256 diff = balanceOf > _totalAmountForInterval ? balanceOf - _totalAmountForInterval : 0;

                //@note - If the day we are looping over the same day as the last interval's use the cached allocation, otherwise use the current balance
                uint256 forAllocation = lastSnapshotTimestamp + 1 weeks > end
                    ? totalX28Distributed
                    : balanceOf >= _totalAmountForInterval + wmul(diff, getDailyTokenAllocation(end)) ? diff : 0;

                uint256 dailyAllocation = wmul(forAllocation, getDailyTokenAllocation(end));

                ///@notice ->  minus INTERVAL_TIME minutes since, at the end of the day the new epoch with new allocation
                _lastBurnedIntervalStartTimestamp = theEndOfTheDay - INTERVAL_TIME;

                ///@notice ->  plus INTERVAL_TIME minutes to flip into the next day
                theEndOfTheDay = Time.getDayEnd(_lastBurnedIntervalStartTimestamp + INTERVAL_TIME);

                if (dayOfLastInterval == currentDay) beforeCurrDay = _totalAmountForInterval;

                _totalAmountForInterval +=
                    uint128((dailyAllocation * accumulatedIntervalsForTheDay) / INTERVALS_PER_DAY);

                dayOfLastInterval++;
            }
        }

        Interval memory prevInt = intervals[lastIntervalNumber];

        //@note - If the last interval was only updated, but not burned add its allocation to the next one.
        uint128 additional = prevInt.amountBurned == 0 ? prevInt.amountAllocated : 0;

        if (_totalAmountForInterval + additional > buyingToken.balanceOf(address(this))) {
            _totalAmountForInterval = uint128(buyingToken.balanceOf(address(this)));
        } else {
            _totalAmountForInterval += additional;
        }
    }

    function getDailyTokenAllocation(uint32 from) public pure virtual returns (uint64 dailyWadAllocation) {}

    function _calculateMissedIntervals(uint256 timeElapsedSince) internal view returns (uint16 _missedIntervals) {
        _missedIntervals = uint16(timeElapsedSince / INTERVAL_TIME);

        if (lastBurnedIntervalStartTimestamp != 0) _missedIntervals--;
    }

    /**
     * @notice Updates the snapshot
     */
    function _updateSnapshot(uint256 deltaAmount) internal {
        if (Time.blockTs() < startTimeStamp || lastSnapshotTimestamp + 1 weeks > Time.blockTs()) return;

        uint32 timeElapsed = uint32(Time.blockTs() - startTimeStamp);

        uint32 snapshots = timeElapsed / 1 weeks;

        uint256 balance = buyingToken.balanceOf(address(this));

        totalX28Distributed = deltaAmount > balance ? 0 : balance - deltaAmount;
        lastSnapshotTimestamp = startTimeStamp + (snapshots * 1 weeks);
    }

    /**
     * @notice Updates the contract state for intervals
     */
    function _intervalUpdate() internal {
        require(Time.blockTs() >= startTimeStamp, NotStartedYet());

        if (lastSnapshotTimestamp == 0) _updateSnapshot(0);

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
}

// Source: ./SolidityContracts/Flare/Constant.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

address constant DEAD_ADDR = 0x000000000000000000000000000000000000dEaD;
address constant GENESIS = 0x4B6c91c4cFEf82AE48d57CA38fcBe7F1E70250dC;
address constant GENESIS_TWO = 0x0a71b0F495948C4b3C3b9D0ADa939681BfBEEf30;
address constant OWNER = 0x95E67464cdAb64ABC8628D6eCD8946E53AB360A0;
address constant FlARE_LP = 0x95E67464cdAb64ABC8628D6eCD8946E53AB360A0;
address constant FLARE_LP_WEBBING = 0xF04B1B3f0e94b289CB8D7e19D45136B4B3d3dA3A;

uint64 constant TO_BUY_AND_BURN = 0.28e18; // 28%
uint64 constant TO_AUCTION_BUY = 0.48e18; // 48%
uint64 constant TOTAL_X28_PERCENTAGE_DISTRIBUTION = TO_BUY_AND_BURN + TO_AUCTION_BUY;
uint64 constant TO_GENESIS = 0.08e18; // 8%
uint64 constant INCENTIVE = 0.01e18; // 1%
uint64 constant TO_FLARE_LP = 0.08e18; // 8%
uint64 constant TO_INFERNO_BNB = 0.08e18; // 8%

uint24 constant POOL_FEE = 10_000; // 1%
uint16 constant MAX_DEVIATION_LIMIT = 10_000;

uint64 constant WAD = 1e18;

///@dev The intial FLARE that pairs with the inferno received from the swap
uint256 constant INITIAL_FLARE_FOR_LP = 30_000_000_000e18; // 30 billion FLARE
uint256 constant INITIAL_X28_FLARE_LP = 30_000_000_000e18; // 30 billion X28
uint256 constant INITIAL_FLARE_FOR_AUCTION = 1_000_000_000_000e18; // 1 trillion FLARE

///@dev  The duration of 1 mint cycle
uint32 constant MINT_CYCLE_DURATION = 24 hours;

///@dev The gap between mint cycles
uint32 constant GAP_BETWEEN_CYCLE = 7 days;
uint256 constant FOUR_WEEKS = 4 weeks;
///@dev  The final mint cycle
uint8 constant MAX_MINT_CYCLE = 11;

uint256 constant MINT_BUY_SELL_TAX_BURN = 0.035e18; // 3.5%
uint256 constant AFTER_MINT_BUY_SELL_TAX_BURN = 0.01e18; // 1%

uint256 constant MINT_BUY_SELL_TAX_AUCTION = 0.035e18; // 3.5%
uint256 constant AFTER_MINT_BUY_SELL_TAX_AUCTION = 0.01e18; // 1%

uint256 constant MINT_BUY_SELL_TAX_GENESIS = 0.01e18; // 1%
uint256 constant AFTER_MINT_BUY_SELL_TAX_GENESIS = 0.008e18; // 0.8%

uint32 constant INTERVAL_TIME = 7 minutes + 30 seconds;

uint8 constant INTERVALS_PER_DAY = uint8(24 hours / INTERVAL_TIME);

uint256 constant STARTING_RATIO = 1e18;

uint64 constant SUN_WED_BNB = 0.04e18; // 4%
uint64 constant THUR_BNB = 0.1e18; // 10%
uint64 constant FRI_SAT_BNB = 0.15e18; // 15%

// Source: ./SolidityContracts/Flare/Errors.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Errors {
    error Address0();
    error Amount0();
    error Expired();

    modifier notAmount0(uint256 a) {
        _notAmount0(a);
        _;
    }

    modifier notExpired(uint32 _deadline) {
        if (block.timestamp > _deadline) revert Expired();
        _;
    }

    modifier notAddress0(address a) {
        _notAddress0(a);
        _;
    }

    function _notAddress0(address a) internal pure {
        if (a == address(0)) revert Address0();
    }

    function _notAmount0(uint256 a) internal pure {
        if (a == 0) revert Amount0();
    }
}

// Source: ./SolidityContracts/Flare/Flare.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import {Errors} from "../utils/Errors.sol";
import {sqrt, wmul} from "../utils/Math.sol";
import {FlareMinting} from "../core/FlareMinting.sol";
import "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IUniswapV2Factory} from "v2-core/interfaces/IUniswapV2Factory.sol";

/**
 * @title Flare
 * @author Decentra
 * @dev ERC20 token contract for Flare tokens.
 * @notice It can be minted by FlareMinting during cycles
 */
contract Flare is OFT, Errors {
    /// @notice The address of the auction contract
    address public auction;

    /// @notice The address of the minting contract
    address public minting;

    /// @notice The address of the auction treasury contract
    address public flareAuctionTreasury;

    /// @notice The address of the auction buy contract
    address public flareAuctionBuy;

    /// @notice The address of the X28 contract
    address public x28FlarePool;

    /// @notice The block number when the lp was created
    uint256 public lpCreationBlock;

    /// @notice The total amount of Flare minted
    uint256 totalTaxesBurnt;

    /// @notice Mapping from address to boolean to check whitelisted addresses
    mapping(address => bool) public isWhitelisted;

    /// @notice The address of the Uniswap V2 factory
    address public immutable v2Factory;

    /// @notice throws if the caller is not the minting contract
    error OnlyMinting();

    /**
     * @notice Modifier to check if the caller is the minting contract
     */
    modifier onlyMinting() {
        _onlyMinting();
        _;
    }

    /**
     * @notice Initializes the Flare contract
     * @param _v2Factory The address of the Uniswap V2 factory
     * @param _lzEndpoint The address of the LayerZero endpoint
     * @param _delegate The address of the delegate
     */
    constructor(address _v2Factory, address _lzEndpoint, address _delegate)
        OFT("Flare", "FLARE", _lzEndpoint, _delegate)
        Ownable(msg.sender)
        notAddress0(_v2Factory)
    {
        v2Factory = _v2Factory;
    }

    /**
     * @notice Sets the address of the auction contract
     * @param _auction The address of the auction contract
     */
    function setAuction(address _auction) external onlyOwner notAddress0(_auction) {
        auction = _auction;
        isWhitelisted[_auction] = true;
    }

    /**
     * @notice Sets the address of the minting contract
     * @param _minting The address of the minting contract
     */
    function setMinting(address _minting) external onlyOwner notAddress0(_minting) {
        minting = _minting;
    }

    /**
     * @notice Sets the address of the auction treasury contract
     * @param _flareAuctionTreasury The address of the auction treasury contract
     */
    function setFlareAuctionTreasury(address _flareAuctionTreasury)
        external
        onlyOwner
        notAddress0(_flareAuctionTreasury)
    {
        flareAuctionTreasury = _flareAuctionTreasury;
        isWhitelisted[_flareAuctionTreasury] = true;
    }

    /**
     * @notice Sets the address of the auction buy contract
     * @param _flareAuctionBuy The address of the auction buy contract
     */
    function setFlareAuctionBuy(address _flareAuctionBuy) external onlyOwner notAddress0(_flareAuctionBuy) {
        flareAuctionBuy = _flareAuctionBuy;
    }

    /**
     * @notice Sets the whitelist for a specified address
     * @param _address The address to revoke the whitelist for
     * @param _isWhitelisted Whether the address is to be whitelisted or revoked
     */
    function setWhitelist(address _address, bool _isWhitelisted) external onlyOwner notAddress0(_address) {
        isWhitelisted[_address] = _isWhitelisted;
    }

    /**
     * @notice Mints Flare tokens to a specified address.
     * @notice This is only callable by the Minting contract
     * @param _to The address to mint the tokens to.
     * @param _amount The amount of tokens to mint.
     */
    function mint(address _to, uint256 _amount) external onlyMinting {
        _mint(_to, _amount);
    }

    /**
     * @notice Burns Flare tokens from msg.sender.
     * @param _value The amount of tokens to burn.
     */
    function burn(uint256 _value) public virtual {
        _burn(_msgSender(), _value);
    }

    /**
     * @notice Burns Flare tokens from a specified address.
     * @param _account The address to burn the tokens from.
     * @param _value The amount of tokens to burn.
     */
    function burnFrom(address _account, uint256 _value) public virtual {
        _spendAllowance(_account, _msgSender(), _value);
        _burn(_account, _value);
    }

    /**
     * @notice Only callable by the minting contract
     */
    function _onlyMinting() internal view {
        require(msg.sender == minting, OnlyMinting());
    }

    /**
     * @notice Sets the address of the X28 contract
     * @param _x28FlarePool The address of the X28 contract
     */
    function setLp(address _x28FlarePool) external onlyMinting notAddress0(_x28FlarePool) {
        lpCreationBlock = block.number;
        x28FlarePool = _x28FlarePool;
    }

    /// @inheritdoc ERC20
    function _update(address from, address to, uint256 value) internal override {
        if (isWhitelisted[from] || isWhitelisted[to]) {
            super._update(from, to, value);
            return;
        }
        if (lpCreationBlock != 0 && (from != address(0) && to != address(0))) {
            uint32 timeElapsedSince = uint32(block.timestamp - FlareMinting(minting).startTimestamp());
            uint256 currentCycle = (timeElapsedSince / GAP_BETWEEN_CYCLE) + 1;
            uint256 toBurn;
            uint256 toAuction;
            uint256 toGenesis;

            toBurn = currentCycle > MAX_MINT_CYCLE
                ? wmul(value, AFTER_MINT_BUY_SELL_TAX_BURN)
                : wmul(value, MINT_BUY_SELL_TAX_BURN);
            toAuction = currentCycle > MAX_MINT_CYCLE
                ? wmul(value, AFTER_MINT_BUY_SELL_TAX_AUCTION)
                : wmul(value, MINT_BUY_SELL_TAX_AUCTION);
            toGenesis = currentCycle > MAX_MINT_CYCLE
                ? wmul(value, AFTER_MINT_BUY_SELL_TAX_GENESIS)
                : wmul(value, MINT_BUY_SELL_TAX_GENESIS);

            value -= (toBurn + toAuction + toGenesis);

            totalTaxesBurnt += toBurn;

            _burn(from, (toBurn + toAuction + toGenesis));
            _mint(flareAuctionTreasury, toAuction);
            _mint(GENESIS, toGenesis);
        }
        super._update(from, to, value);
    }

    /// @inheritdoc OFT
    function _debit(address _from, uint256 _amountLD, uint256 _minAmountLD, uint32 _dstEid)
        internal
        virtual
        override
        returns (uint256 amountSentLD, uint256 amountReceivedLD)
    {
        if (isWhitelisted[_from]) {
            return super._debit(_from, _amountLD, _minAmountLD, _dstEid);
        }
        uint256 amountLD_ = _amountLD;
        if (lpCreationBlock != 0 && (_from != address(0))) {
            uint32 timeElapsedSince = uint32(block.timestamp - FlareMinting(minting).startTimestamp());
            uint256 currentCycle = (timeElapsedSince / GAP_BETWEEN_CYCLE) + 1;
            uint256 toBurn;
            uint256 toAuction;
            uint256 toGenesis;

            toBurn = currentCycle > MAX_MINT_CYCLE
                ? wmul(amountLD_, AFTER_MINT_BUY_SELL_TAX_BURN)
                : wmul(amountLD_, MINT_BUY_SELL_TAX_BURN);
            toAuction = currentCycle > MAX_MINT_CYCLE
                ? wmul(amountLD_, AFTER_MINT_BUY_SELL_TAX_AUCTION)
                : wmul(amountLD_, MINT_BUY_SELL_TAX_AUCTION);
            toGenesis = currentCycle > MAX_MINT_CYCLE
                ? wmul(amountLD_, AFTER_MINT_BUY_SELL_TAX_GENESIS)
                : wmul(amountLD_, MINT_BUY_SELL_TAX_GENESIS);

            amountLD_ -= (toBurn + toAuction + toGenesis);

            totalTaxesBurnt += toBurn;

            _burn(_from, (toBurn + toAuction + toGenesis));
            _mint(flareAuctionTreasury, toAuction);
            _mint(GENESIS, toGenesis);
        }
        return super._debit(_from, amountLD_, _minAmountLD, _dstEid);
    }
}

// Source: ./SolidityContracts/Flare/FlareAuction.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import "../interfaces/IX28.sol";
import "../interfaces/IWETH.sol";
import {Time} from "../utils/Time.sol";
import {wmul, wdiv} from "../utils/Math.sol";
import {Flare} from "../core/Flare.sol";
import {FlareMinting} from "../core/FlareMinting.sol";
import {FlareAuctionBuy} from "./FlareAuctionBuy.sol";
import {FlareBuyAndBurn} from "../core/FlareBuyNBurn.sol";
import {FlareAuctionTreasury} from "../core/FlareAuctionTreasury.sol";
import {SwapActions, SwapActionParams} from "../actions/SwapActions.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/**
 * @dev Struct tracking daily auction statistics
 * @param flareEmitted Amount of Flare tokens emitted for the day
 * @param titanXDeposited Total TitanX tokens deposited for the day
 */
struct DailyStatistic {
    uint128 flareEmitted;
    uint128 titanXDeposited;
}

/**
 * @dev Struct tracking user deposits
 * @param ts The timestamp of the deposit
 * @param day The day of the deposit
 * @param amount The amount of tokens deposited
 */
struct UserAuction {
    uint32 ts;
    uint32 day;
    uint256 amount;
}

/**
 * @dev Struct tracking the state of the FlareAuction contract
 * @param titanX Address of the TitanX token
 * @param flare Address of the Flare token
 * @param flareMinting Address of the FlareMinting contract
 * @param flareBnB Address of the FlareBuyAndBurn contract
 * @param titanXInfBnB Address of the InfernoBnb contract
 * @param X28 Address of the X28 contract
 * @param WETH Address of the WETH contract
 * @param v3Router Address of the Uniswap V3 Router
 */
struct AuctionState {
    address titanX;
    Flare flare;
    FlareMinting flareMinting;
    FlareBuyAndBurn flareBnB;
    address titanXInfBnB;
    address X28;
    address WETH;
    address v3Router;
}

/**
 * @title FlareAuction Contract
 * @author Decentra
 * @dev Contract managing the auction of Flare tokens through TitanX/ETH deposits
 * @notice This contract:
 *         - Manages the auction of Flare tokens
 *         - Handles TitanX and ETH deposits
 */
contract FlareAuction is SwapActions {
    using SafeERC20 for IERC20;

    /// @notice The struct packing state vars
    AuctionState public state;

    /// @notice The startTimestamp
    uint32 public immutable startTimestamp;

    /// @notice the depositId
    uint64 depositId;

    /// @notice the total amount of X28 burnt
    uint256 public totalX28Burnt;

    /// @notice Mapping to keep track of user deposits
    mapping(address => mapping(uint64 id => UserAuction)) public depositOf;

    /// @notice Mapping to keep track of daily statistics
    mapping(uint32 day => DailyStatistic) public dailyStats;

    /// @notice throws if caller claims before 24 hours of deposit
    error FlareAuction__OnlyClaimableAfter24Hours();

    /// @notice throws if liquidity has already been added
    error FlareAuction__LiquidityAlreadyAdded();

    /// @notice throws if the auction has not started
    error FlareAuction__NotStartedYet();

    /// @notice throws if caller has nothing to claim
    error FlareAuction__NothingToClaim();

    /// @notice throws if the auction has ended
    error FlareAuction__AuctionEnded();

    /// @notice throws if auction is still in minting phase
    error FlareAuction__MintingPhase();

    /// @notice throws if the auction has nothing to emit
    error FlareAuction__NothingToEmit();

    /// @notice throws if genesis transfer fails
    error FlareAuction__GenesisTransferFailed();

    /// @notice Event emitted when a user deposits tokens during auction cycle
    /// @param user Address of the user depositing
    /// @param amount The amount of deposited tokens
    /// @param id The deposit ID
    event UserDeposit(address indexed user, uint256 indexed amount, uint64 indexed id);

    /// @notice Event emitted when a user claims tokens
    /// @param user Address of the user claiming
    /// @param flareAmount The amount of Flare claimed
    /// @param id The deposit ID
    event UserClaimed(address indexed user, uint256 indexed flareAmount, uint64 indexed id);

    /**
     * @notice Initializes the FlareAuction contract
     * @param _state The storage state struct
     * @param _s The swap action parameters
     * @param _startTimestamp Timestamp when the first auction cycle starts
     */
    constructor(AuctionState memory _state, SwapActionParams memory _s, uint32 _startTimestamp)
        notAddress0(_state.titanX)
        notAddress0(address(_state.flare))
        notAddress0(address(_state.flareMinting))
        notAddress0(address(_state.flareBnB))
        notAddress0(_state.titanXInfBnB)
        notAddress0(_state.X28)
        notAddress0(_state.WETH)
        notAddress0(_state.v3Router)
        SwapActions(_s)
    {
        state = _state;
        require((_startTimestamp % Time.SECONDS_PER_DAY) == Time.TURN_OVER_TIME, "_startTimestamp must be 2PM UTC");

        startTimestamp = _startTimestamp;
    }

    /**
     * @notice Mints Flare tokens by depositing TITANX tokens during an ongoing auction cycle.
     * @param _amount The amount of TITANX tokens to deposit.
     */
    function deposit(uint256 _amount) external notAmount0(_amount) {
        _checkCycles();

        _updateAuction();

        uint32 daySinceStart = _daySinceStart();

        UserAuction storage userDeposit = depositOf[msg.sender][++depositId];

        DailyStatistic storage stats = dailyStats[daySinceStart];

        userDeposit.ts = uint32(block.timestamp);
        userDeposit.amount = _amount;
        userDeposit.day = daySinceStart;

        stats.titanXDeposited += uint128(_amount);
        IERC20(state.titanX).safeTransferFrom(msg.sender, address(this), _amount);

        _distributeGenesis(0, _amount, false);
        uint256 remainingAmount = _distributeTitanX(_amount);
        uint256 X28Amount = _deposit(remainingAmount);
        _distribute(X28Amount);

        emit UserDeposit(msg.sender, _amount, depositId);
    }

    /**
     * @notice Mints Flare tokens by depositing ETH tokens during an ongoing auction cycle.
     * @param _minAmount The minimum amount of ETH to deposit.
     * @param _deadline The deadline for the deposit.
     */
    function depositETH(uint256 _minAmount, uint32 _deadline) external payable notAmount0(msg.value) {
        _checkCycles();
        _updateAuction();

        uint256 titanXAmount = getSpotPrice(state.WETH, state.titanX, msg.value);
        checkIsDeviationOutOfBounds(state.WETH, state.titanX, msg.value, titanXAmount);

        IWETH(state.WETH).deposit{value: msg.value}();
        uint256 _genAmount = wmul(msg.value, TO_GENESIS);
        uint256 _swapAmount = msg.value - _genAmount;

        uint256 _titanXToDeposit = _swapWethToTitanX(_swapAmount, _minAmount, _deadline);

        uint32 daySinceStart = _daySinceStart();

        UserAuction storage userDeposit = depositOf[msg.sender][++depositId];

        DailyStatistic storage stats = dailyStats[daySinceStart];

        userDeposit.ts = uint32(block.timestamp);
        userDeposit.amount += titanXAmount;
        userDeposit.day = daySinceStart;

        stats.titanXDeposited += uint128(titanXAmount);

        _distributeGenesis(_genAmount, 0, true);
        uint256 remainingTitanX = _distributeTitanX(_titanXToDeposit);
        uint256 X28Amount = _deposit(remainingTitanX);
        _distribute(X28Amount);

        emit UserDeposit(msg.sender, titanXAmount, depositId);
    }

    /**
     * @notice Claims the minted Flare tokens after the end of the specified auction.
     * @param _id The ID of the auction to claim
     */
    function claim(uint64 _id) public {
        UserAuction storage userDep = depositOf[msg.sender][_id];

        require(block.timestamp >= userDep.ts + 24 hours, FlareAuction__OnlyClaimableAfter24Hours());

        uint256 toClaim = amountToClaim(msg.sender, _id);

        if (toClaim == 0) revert FlareAuction__NothingToClaim();

        emit UserClaimed(msg.sender, toClaim, _id);

        state.flare.transfer(msg.sender, toClaim);

        userDep.amount = 0;
    }

    /**
     * @notice Claims the minted Flare tokens after the end of the specified auction id.
     * @param _ids The IDs of the deposit ids to claim
     */
    function batchClaim(uint32[] calldata _ids) external {
        for (uint256 i; i < _ids.length; ++i) {
            claim(_ids[i]);
        }
    }

    /**
     * @notice Calculates the amount of Flare tokens that can be claimed after the end of the specified auction ids.
     * @param _ids The IDs of the deposit ids to claim
     */
    function batchClaimableAmount(address _user, uint32[] calldata _ids) public view returns (uint256 toClaim) {
        for (uint256 i; i < _ids.length; ++i) {
            toClaim += amountToClaim(_user, _ids[i]);
        }
    }

    /**
     * @notice Calculates the amount of Flare tokens that can be claimed after the end of the specified auction id.
     * @param _id The ID of the deposit id to claim
     */
    function amountToClaim(address _user, uint64 _id) public view returns (uint256 toClaim) {
        UserAuction storage userDep = depositOf[_user][_id];
        DailyStatistic memory stats = dailyStats[userDep.day];

        return (userDep.amount * stats.flareEmitted) / stats.titanXDeposited;
    }

    /**
     * @notice Internal function to distribute X28 tokens to various destinations for burning.
     * @param _amount The amount of X28 tokens to distribute.
     */
    function _distribute(uint256 _amount) internal {
        uint256 _toBuyNBurn = wmul(_amount, wdiv(TO_BUY_AND_BURN, TOTAL_X28_PERCENTAGE_DISTRIBUTION));
        uint256 _toFlareAuctionBuy = wmul(_amount, wdiv(TO_AUCTION_BUY, TOTAL_X28_PERCENTAGE_DISTRIBUTION));

        IX28(state.X28).approve(address(state.flareBnB), _toBuyNBurn);
        state.flareBnB.distributeX28ForBurning(_toBuyNBurn);

        IX28(state.X28).approve(state.flare.flareAuctionBuy(), _toFlareAuctionBuy);
        FlareAuctionBuy(state.flare.flareAuctionBuy()).distribute(_toFlareAuctionBuy);

        totalX28Burnt += _amount;
    }

    /**
     * @notice Internal function to distribute genesis tokens to various destinations.
     * @param _amount The amount of genesis tokens to distribute.
     * @param _titanXAmount The amount of TITANX tokens to distribute.
     * @param _isEth True if the distribution is for ETH, false otherwise.
     */
    function _distributeGenesis(uint256 _amount, uint256 _titanXAmount, bool _isEth) internal {
        if (_isEth) {
            uint256 _toGenesisEth = wmul(_amount, uint256(0.5e18));
            IWETH(state.WETH).transfer(GENESIS, _toGenesisEth);
            IWETH(state.WETH).transfer(GENESIS_TWO, _toGenesisEth);
        } else {
            uint256 _toGenesis = wmul(_titanXAmount, uint256(TO_GENESIS));
            IERC20(state.titanX).transfer(GENESIS, wmul(_toGenesis, uint256(0.75e18)));
            IERC20(state.titanX).transfer(GENESIS_TWO, wmul(_toGenesis, uint256(0.25e18)));
        }
    }

    /**
     * @notice Internal function to distribute TITANX tokens to various destinations.
     * @param _amount The amount of TITANX tokens to distribute.
     */
    function _distributeTitanX(uint256 _amount) internal returns (uint256) {
        if (block.timestamp <= startTimestamp + FOUR_WEEKS) {
            IERC20(state.titanX).transfer(FlARE_LP, wmul(_amount, TO_FLARE_LP));
        } else {
            IERC20(state.titanX).transfer(state.titanXInfBnB, wmul(_amount, TO_INFERNO_BNB));
        }

        IERC20(state.titanX).transfer(FLARE_LP_WEBBING, wmul(_amount, TO_FLARE_LP));

        return IERC20(state.titanX).balanceOf(address(this));
    }

    /**
     * @notice Deposits TITANX tokens into the X28 contract.
     * @param _amount The amount of TITANX tokens to deposit.
     */
    function _deposit(uint256 _amount) internal returns (uint256) {
        IERC20(state.titanX).approve(state.X28, _amount);
        IX28(state.X28).mintX28withTitanX(_amount);
        return _amount;
    }

    /**
     * @notice Swaps WETH for TITANX tokens.
     * @param _amount The amount of WETH tokens to swap.
     * @param _minReturn The minimum amount of TITANX tokens to receive.
     * @param _deadline The deadline for the swap.
     */
    function _swapWethToTitanX(uint256 _amount, uint256 _minReturn, uint32 _deadline)
        internal
        returns (uint256 _titanXAmount)
    {
        _titanXAmount = swapExactInput(state.WETH, state.titanX, _amount, _minReturn, _deadline);
    }

    /**
     * @notice Checks if the auction has started and not in minting phase
     */
    function _checkCycles() internal view {
        require(block.timestamp >= startTimestamp, FlareAuction__NotStartedYet());

        // @notice checks that users can't auction during minting days
        (,, uint32 endsAt) = state.flareMinting.getCurrentMintCycle();
        require(block.timestamp >= endsAt, FlareAuction__MintingPhase());
    }

    /**
     * @notice Gets the current day since the start of the auction.
     * @return daySinceStart The current day since the start of the auction
     */
    function _daySinceStart() internal view returns (uint32 daySinceStart) {
        daySinceStart = uint32(((block.timestamp - startTimestamp) / 24 hours) + 1);
    }

    /**
     * @notice Updates the auction.
     */
    function _updateAuction() internal {
        uint32 daySinceStart = _daySinceStart();

        if (dailyStats[daySinceStart].flareEmitted != 0) return;

        uint256 toEmit = FlareAuctionTreasury(state.flare.flareAuctionTreasury()).emitForAuction();

        require(toEmit != 0, FlareAuction__NothingToEmit());

        dailyStats[daySinceStart].flareEmitted = uint128(toEmit);
    }
}

// Source: ./SolidityContracts/Flare/FlareAuctionBuy.sol
// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import "../const/Constants.sol";
import {Time} from "../utils/Time.sol";
import {wmul} from "../utils/Math.sol";
import {Errors} from "../utils/Errors.sol";
import {Flare} from "../core/Flare.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IUniswapV2Router02} from "v2-periphery/interfaces/IUniswapV2Router02.sol";

/**
 * @title FlareAuctionBuy
 * @author Decentra
 * @dev Contract to buy X28 tokens from Uniswap V2 and send them to FlareAuctionTreasury
 * @notice This contract:
 *         - Manages the X28 tokens distribution to FlareAuctionTreasury
 *         - Feeds the FlareAuctionTreasury
 */
contract FlareAuctionBuy is Ownable, Errors {
    /// @notice Struct to represent intervals
    struct Interval {
        uint128 amountAllocated;
        uint128 amountSentToFlareAuctionTreasury;
    }

    ///@notice The startTimestamp
    uint32 public immutable startTimeStamp;

    /// @notice The X28 contract
    ERC20Burnable immutable X28;

    /// @notice The Flare contract
    Flare immutable flare;

    /// @notice The Uniswap V2 router address
    address immutable v2Router;

    /// @notice Timestamp of the last update
    uint32 public lastUpdatedIntervalTimestamp;

    /// @notice Last interval number
    uint32 public lastIntervalNumber;

    /// @notice  Last called interval
    uint32 public lastCalledIntervalTimestamp;

    /// @notice That last snapshot timestamp
    uint32 public lastSnapshot;

    ///@notice X28 Swap cap
    uint128 public swapCap;

    /// @notice Mapping from interval number to Interval struct
    mapping(uint32 interval => Interval) public intervals;

    /// @notice Mapping from permissioned address to bool
    mapping(address => bool) public isPermissioned;

    /// @notice Total X28 tokens distributed
    uint256 public totalX28Distributed;

    /// @notice X28 tokens to distribute
    uint256 public toDistribute;

    /// @notice Private mode
    bool public privateMode;

    /// @notice Event emitted when tokens are bought and sent to FlareAuctionTreasury
    event SentToFlareAuctionTreasury(
        uint256 indexed x28Amount, uint256 indexed flareSentToFlareAuctionTreasury, address indexed caller
    );

    /// @notice Error when the contract has not started yet
    error NotStartedYet();

    /// @notice Error when interval has already been called
    error IntervalAlreadyCalled();

    /// @notice Error when non EOA caller
    error OnlyEOA();

    /// @notice Error when non permissioned caller
    error OnlyPermissionAdresses();

    /**
     * @notice Constructor initializes the contract
     */
    constructor(uint32 _startTimestamp, address _X28, Flare _flare, address _v2Router, address _owner)
        Ownable(_owner)
    {
        require((_startTimestamp % Time.SECONDS_PER_DAY) == Time.TURN_OVER_TIME, "_startTimestamp must be 2PM UTC");

        swapCap = type(uint128).max;
        flare = _flare;
        v2Router = _v2Router;
        X28 = ERC20Burnable(_X28);
        startTimeStamp = _startTimestamp;
    }

    /**
     * @notice Updates the contract state for intervals
     */
    modifier intervalUpdate() {
        _intervalUpdate();
        _;
    }

    /**
     * @notice Changes the swap cap
     * @param _newSwapCap The new swap cap
     */
    function changeSwapCap(uint128 _newSwapCap) external onlyOwner {
        swapCap = _newSwapCap == 0 ? type(uint128).max : _newSwapCap;
    }

    /**
     * @notice Swaps X28 for Flare and feeds the FlareAuctionTreasury
     * @param _amountFlareMin Minimum amount of Flare tokens expected
     * @param _deadline The deadline for which the passes should pass
     */
    function swapX28ToflareAndFeedTheAuction(uint256 _amountFlareMin, uint32 _deadline) external intervalUpdate {
        if (msg.sender != tx.origin) revert OnlyEOA();

        Interval storage currInterval = intervals[lastIntervalNumber];

        if (privateMode) {
            if (!isPermissioned[msg.sender]) revert OnlyPermissionAdresses();
        }

        if (currInterval.amountSentToFlareAuctionTreasury != 0) revert IntervalAlreadyCalled();

        _updateSnapshot();
        if (currInterval.amountAllocated > swapCap) {
            uint256 difference = currInterval.amountAllocated - swapCap;

            //@note - Add the difference for the next day
            toDistribute += difference;

            currInterval.amountAllocated = swapCap;
        }

        uint256 incentive = wmul(currInterval.amountAllocated, INCENTIVE);

        currInterval.amountSentToFlareAuctionTreasury = currInterval.amountAllocated;

        uint256 prevFlareBalance = flare.balanceOf(address(this));
        _swapX28ForFlare(currInterval.amountAllocated - incentive, _amountFlareMin, _deadline);
        uint256 currFlareBalance = flare.balanceOf(address(this));

        uint256 flareAmount = currFlareBalance - prevFlareBalance;

        flare.transfer(address(flare.flareAuctionTreasury()), flareAmount);

        X28.transfer(msg.sender, incentive);

        lastCalledIntervalTimestamp = lastIntervalNumber;

        emit SentToFlareAuctionTreasury(currInterval.amountAllocated - incentive, flareAmount, msg.sender);
    }

    /**
     * @notice Distributes X28 tokens to swap for flare and send to FlareAuctionTreasury
     * @param _amount The amount of X28 tokens
     */
    function distribute(uint256 _amount) external {
        ///@dev - If there are some missed intervals update the accumulated allocation before depositing new X28

        if (Time.blockTs() > startTimeStamp && Time.blockTs() - lastUpdatedIntervalTimestamp > INTERVAL_TIME) {
            _intervalUpdate();
        }

        X28.transferFrom(msg.sender, address(this), _amount);

        _updateSnapshot();

        toDistribute += _amount;
    }

    /**
     * @notice Toggles the permissioned address
     * @param _caller The address to toggle
     * @param _isPermissioned True if the address is permissioned, false otherwise
     */
    function togglePermissionedAddress(address _caller, bool _isPermissioned) external onlyOwner notAddress0(_caller) {
        isPermissioned[_caller] = _isPermissioned;
    }

    /**
     * @notice Toggles the private mode
     * @param _isPrivate True if the mode is private, false otherwise
     */
    function togglePrivateMode(bool _isPrivate) external onlyOwner {
        privateMode = _isPrivate;
    }

    /**
     * @notice Get the day count for a timestamp
     * @param _t The timestamp from which to get the timestamp
     */
    function dayCountByT(uint32 _t) public pure returns (uint32) {
        // Adjust the timestamp to the cut-off time (2 PM UTC)
        uint32 adjustedTime = _t - 14 hours;
        // Calculate the number of days since Unix epoch
        return adjustedTime / 86400;
    }

    /**
     * @notice Gets the end of the day with a cut-off hour of 2 PM UTC
     * @param _t The time from where to get the day end
     */
    function getDayEnd(uint32 _t) public pure returns (uint32) {
        // Adjust the timestamp to the cutoff time (2 PM UTC)
        uint32 adjustedTime = _t - 14 hours;
        // Calculate the number of days since Unix epoch
        uint32 daysSinceEpoch = adjustedTime / 86400;
        // Calculate the start of the next day at 2 PM UTC
        uint32 nextDayStartAt2PM = (daysSinceEpoch + 1) * 86400 + 14 hours;
        // Return the timestamp for 14:00:00 PM UTC of the given day
        return nextDayStartAt2PM;
    }

    /**
     * @notice internal function to calculate the intervals
     * @param _timeElapsedSince The time elapsed since the last update
     */
    function _calculateIntervals(uint32 _timeElapsedSince)
        internal
        view
        returns (uint32 _lastIntervalNumber, uint128 _totalAmountForInterval, uint32 missedIntervals)
    {
        missedIntervals = _calculateMissedIntervals(_timeElapsedSince);

        _lastIntervalNumber = lastIntervalNumber + missedIntervals + 1;

        uint32 currentDay = dayCountByT(uint32(block.timestamp));

        uint32 _lastCalledIntervalTimestampTimestamp = lastUpdatedIntervalTimestamp;

        uint32 dayOfLastInterval =
            _lastCalledIntervalTimestampTimestamp == 0 ? currentDay : dayCountByT(_lastCalledIntervalTimestampTimestamp);

        uint256 _totalX28Distributed = totalX28Distributed;

        if (currentDay == dayOfLastInterval) {
            uint128 _amountPerInterval = uint128(_totalX28Distributed / INTERVALS_PER_DAY);

            uint128 additionalAmount = _amountPerInterval * missedIntervals;

            _totalAmountForInterval = _amountPerInterval + additionalAmount;
        } else {
            uint32 _lastUpdatedIntervalTimestamp = _lastCalledIntervalTimestampTimestamp;

            uint32 theEndOfTheDay = getDayEnd(_lastUpdatedIntervalTimestamp);

            uint32 accumulatedIntervalsForTheDay = (theEndOfTheDay - _lastUpdatedIntervalTimestamp) / INTERVAL_TIME;

            //@note - Calculate the remaining intervals from the last one's day
            _totalAmountForInterval += uint128(_totalX28Distributed / INTERVALS_PER_DAY) * accumulatedIntervalsForTheDay;

            //@note - Calculate the upcoming intervals with the to distribute shares
            uint128 _intervalsForNewDay = missedIntervals >= accumulatedIntervalsForTheDay
                ? (missedIntervals - accumulatedIntervalsForTheDay) + 1
                : 0;
            _totalAmountForInterval += (_intervalsForNewDay > INTERVALS_PER_DAY)
                ? uint128(toDistribute)
                : uint128(toDistribute / INTERVALS_PER_DAY) * _intervalsForNewDay;
        }

        Interval memory prevInt = intervals[lastIntervalNumber];

        //@note - If the last interval was only updated, but not called add its allocation to the next one.
        uint128 additional =
            prevInt.amountSentToFlareAuctionTreasury == 0 && prevInt.amountAllocated != 0 ? prevInt.amountAllocated : 0;

        if (_totalAmountForInterval + additional > X28.balanceOf(address(this))) {
            _totalAmountForInterval = uint128(X28.balanceOf(address(this)));
        } else {
            _totalAmountForInterval += additional;
        }
    }

    /**
     * @notice Calculate the number of missed intervals
     * @param _timeElapsedSince The time elapsed since the last update
     */
    function _calculateMissedIntervals(uint32 _timeElapsedSince) internal view returns (uint32 _missedIntervals) {
        _missedIntervals = _timeElapsedSince / INTERVAL_TIME;

        if (lastUpdatedIntervalTimestamp != 0) _missedIntervals--;
    }

    /**
     * @notice Updates the snapshot
     */
    function _updateSnapshot() internal {
        if (Time.blockTs() < startTimeStamp || lastSnapshot + 24 hours > Time.blockTs()) return;

        if (lastSnapshot != 0 && lastSnapshot + 48 hours <= Time.blockTs()) {
            // If we have missed entire snapshot of interacting with the contract
            toDistribute = 0;
        }

        totalX28Distributed = toDistribute;

        toDistribute = 0;

        uint32 timeElapsed = Time.blockTs() - startTimeStamp;

        uint32 snapshots = timeElapsed / 24 hours;

        lastSnapshot = startTimeStamp + (snapshots * 24 hours);
    }

    /**
     * @notice Updates the contract state for intervals
     */
    function _intervalUpdate() private {
        if (Time.blockTs() < startTimeStamp) revert NotStartedYet();

        if (lastSnapshot == 0) _updateSnapshot();

        (
            uint32 _lastInterval,
            uint128 _amountAllocated,
            uint32 _missedIntervals,
            uint32 _lastIntervalStartTimestamp,
            bool updated
        ) = getCurrentInterval();

        if (updated) {
            lastUpdatedIntervalTimestamp = _lastIntervalStartTimestamp + (uint32(_missedIntervals) * INTERVAL_TIME);
            intervals[_lastInterval] =
                Interval({amountAllocated: _amountAllocated, amountSentToFlareAuctionTreasury: 0});
            lastIntervalNumber = _lastInterval;
        }
    }

    /**
     * @notice Returns the current interva
     * @return _lastInterval the last interval
     * @return _amountAllocated the amount allocated
     * @return _missedIntervals the number of missed intervals
     * @return _lastIntervalStartTimestamp the start timestamp of the last interval
     * @return updated true if the interval was updated
     */
    function getCurrentInterval()
        public
        view
        returns (
            uint32 _lastInterval,
            uint128 _amountAllocated,
            uint32 _missedIntervals,
            uint32 _lastIntervalStartTimestamp,
            bool updated
        )
    {
        if (startTimeStamp > Time.blockTs()) return (0, 0, 0, 0, false);

        uint32 startPoint = lastUpdatedIntervalTimestamp == 0 ? startTimeStamp : lastUpdatedIntervalTimestamp;

        uint32 timeElapseSinceLastCall = Time.blockTs() - startPoint;

        if (lastUpdatedIntervalTimestamp == 0 || timeElapseSinceLastCall > INTERVAL_TIME) {
            (_lastInterval, _amountAllocated, _missedIntervals) = _calculateIntervals(timeElapseSinceLastCall);
            _lastIntervalStartTimestamp = startPoint;
            _missedIntervals += timeElapseSinceLastCall > INTERVAL_TIME && lastUpdatedIntervalTimestamp != 0 ? 1 : 0;
            updated = true;
        }
    }

    /**
     * @notice Swaps X28 tokens for Flare tokens
     * @param _amountX28 The amount of X28 tokens
     * @param _amountFlareMin Minimum amount of Flare tokens expected
     */
    function _swapX28ForFlare(uint256 _amountX28, uint256 _amountFlareMin, uint256 _deadline) private {
        X28.approve(v2Router, _amountX28);

        address[] memory path = new address[](2);
        path[0] = address(X28);
        path[1] = address(flare);

        IUniswapV2Router02(v2Router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _amountX28, _amountFlareMin, path, address(this), _deadline
        );
    }
}

// Source: ./SolidityContracts/Flare/FlareAuctionTreasury.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import {wmul} from "../utils/Math.sol";
import {Errors} from "../utils/Errors.sol";
import {Flare} from "../core/Flare.sol";
import {FlareMinting} from "../core/FlareMinting.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FlareAuctionTreasury
 * @author Decentra
 * @notice This contract acumulates Flare from the buy and burn and later distributes them to the auction for recycling
 */
contract FlareAuctionTreasury is Errors {
    using SafeERC20 for Flare;

    /// @notice Flare contract
    Flare immutable flare;

    /// @notice Auction contract
    address immutable auction;

    /// @notice FlareMinting contract
    FlareMinting public minting;

    /// @notice throws if the caller is not the auction
    error FlareAuctionTreasury__OnlyAuction();

    /**
     * @notice intializes the auction treasury contract
     * @param _auction Address of the auction
     * @param _flare Address of the Flare contract
     * @param _flareMinting Address of the FlareMinting contract
     */
    constructor(address _auction, address _flare, address _flareMinting)
        notAddress0(_auction)
        notAddress0(_flare)
        notAddress0(_flareMinting)
    {
        auction = _auction;
        flare = Flare(_flare);

        minting = FlareMinting(_flareMinting);
    }

    // @notice Modifier to check if the caller is the auction
    modifier onlyAuction() {
        _onlyAuction();
        _;
    }

    // @notice Distribute Flare to the auction
    function emitForAuction() external onlyAuction returns (uint256 emitted) {
        uint256 balanceOf = flare.balanceOf(address(this));
        uint32 timeElapsedSince = uint32(block.timestamp - minting.startTimestamp());
        uint256 currentCycle = (timeElapsedSince / GAP_BETWEEN_CYCLE) + 1;

        uint256 auctionAllocation = currentCycle > MAX_MINT_CYCLE ? 0.05e18 : 0.11e18;
        emitted = wmul(balanceOf, auctionAllocation);
        flare.safeTransfer(msg.sender, emitted);
    }

    // @notice checks if the caller is the auction
    function _onlyAuction() internal view {
        if (msg.sender != auction) revert FlareAuctionTreasury__OnlyAuction();
    }
}

// Source: ./SolidityContracts/Flare/FlareBuyNBurn.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import {wmul} from "../utils/Math.sol";
import {Time} from "../utils/Time.sol";
import {Flare} from "../core/Flare.sol";
import "../BuyNBurn/BaseBuyNBurn.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV2Router02} from "v2-periphery/interfaces/IUniswapV2Router02.sol";

/**
 *  @title FlareBuyAndBurn
 *  @author Decentra
 *  @notice This contract manages the automated buying and burning of Flare tokens using X28 through Uniswap V2 pools
 */
contract FlareBuyAndBurn is BaseBuyAndBurn {
    /// @notice The Flare token contract
    Flare private immutable flare;

    /// @notice The X28 contract
    IERC20 private immutable X28;

    /**
     * @notice Constructor initializes the contract
     * @notice Constructor is payable to save gas
     */
    constructor(uint32 _startTimestamp, address _X28, address _flare, address _v2Router, address _owner)
        payable
        BaseBuyAndBurn(_startTimestamp, _v2Router, _X28, _owner)
        notAddress0(_flare)
    {
        require((_startTimestamp % Time.SECONDS_PER_DAY) == Time.TURN_OVER_TIME, "_startTimestamp must be 2PM UTC");
        flare = Flare(_flare);
        X28 = IERC20(_X28);
    }

    /**
     * @notice Swaps X28 for Flare and burns the Flare tokens
     * @param _amountFlareMin Minimum amount of Flare tokens expected
     * @param _deadline The deadline for which the passes should pass
     */
    function swapX28ForFlareAndBurn(uint256 _amountFlareMin, uint32 _deadline)
        external
        intervalUpdate
        notAmount0(_amountFlareMin)
        notExpired(_deadline)
    {
        if (msg.sender != tx.origin) revert OnlyEOA();
        Interval storage currInterval = intervals[lastIntervalNumber];

        if (privateMode) {
            if (!isPermissioned[msg.sender]) revert OnlyPermissionAdresses();
        }

        if (currInterval.amountBurned != 0) revert IntervalAlreadyBurned();

        if (currInterval.amountAllocated > swapCap) currInterval.amountAllocated = swapCap;

        currInterval.amountBurned = currInterval.amountAllocated;

        uint256 incentive = wmul(currInterval.amountAllocated, INCENTIVE);

        uint256 X28ToSwapAndBurn = currInterval.amountAllocated - incentive;

        _swapX28ForFlare(X28ToSwapAndBurn, _amountFlareMin, _deadline);
        uint256 balanceAfter = flare.balanceOf(address(this));

        burnFlare();

        X28.transfer(msg.sender, incentive);

        lastBurnedInterval = lastIntervalNumber;

        emit BuyAndBurn(X28ToSwapAndBurn, balanceAfter, msg.sender);
    }

    /**
     * @notice Burns flare tokens held by the contract
     */
    function burnFlare() public {
        uint256 flareToBurn = flare.balanceOf(address(this));

        totalFlareBurnt = totalFlareBurnt + flareToBurn;
        flare.burn(flareToBurn);
    }

    /**
     * @notice Distributes X28 tokens for burning
     * @param _amount The amount of X28 tokens
     */
    function distributeX28ForBurning(uint256 _amount) external {
        ///@dev - If there are some missed intervals update the accumulated allocation before depositing new X28
        if (Time.blockTs() > startTimeStamp && Time.blockTs() - lastBurnedIntervalStartTimestamp > INTERVAL_TIME) {
            _intervalUpdate();
        }

        X28.transferFrom(msg.sender, address(this), _amount);
    }

    /**
     * @notice Gets the current week day (0=Sunday, 1=Monday etc etc) wtih a cut-off hour at 2pm UTC
     */
    function currWeekDay() public view returns (uint8 weekDay) {
        weekDay = Time.weekDayByT(uint32(block.timestamp));
    }

    /**
     * @notice Gets the daily X28 allocation
     * @param _timestamp The timestamp
     * @return dailyWadAllocation The daily allocation in WAD
     */
    function getDailyTokenAllocation(uint32 _timestamp) public pure override returns (uint64 dailyWadAllocation) {
        uint256 weekDay = Time.weekDayByT(_timestamp);
        dailyWadAllocation = SUN_WED_BNB; // 4%

        if (weekDay == 5 || weekDay == 6) {
            dailyWadAllocation = FRI_SAT_BNB; // 15%
        } else if (weekDay == 4) {
            dailyWadAllocation = THUR_BNB; // 10%
        }
    }

    /**
     * @notice Swaps X28 tokens for Flare tokens
     * @param _amountX28 The amount of X28 tokens
     * @param _amountFlareMin Minimum amount of Flare tokens expected
     */
    function _swapX28ForFlare(uint256 _amountX28, uint256 _amountFlareMin, uint256 _deadline) private {
        X28.approve(v2Router, _amountX28);

        address[] memory path = new address[](2);
        path[0] = address(X28);
        path[1] = address(flare);

        IUniswapV2Router02(v2Router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            _amountX28, _amountFlareMin, path, address(this), _deadline
        );
    }
}

// Source: ./SolidityContracts/Flare/FlareMinting.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import "../interfaces/IX28.sol";
import "../interfaces/IWETH.sol";
import "../utils/Time.sol";
import {Flare} from "./Flare.sol";
import {FlareBuyAndBurn} from "./FlareBuyNBurn.sol";
import {FlareAuctionBuy} from "./FlareAuctionBuy.sol";
import {SwapActions, SwapActionParams} from "../actions/SwapActions.sol";
import {wdiv, wmul, sub, wpow, wdivUp} from "../utils/Math.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV2Pair} from "v2-core/interfaces/IUniswapV2Pair.sol";
import {IUniswapV2Router02} from "v2-periphery/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "v2-core/interfaces/IUniswapV2Factory.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

/**
 * @notice Struct to store minting state
 * @param titanX TITANX token contract
 * @param titanXInfBnB Address of the InfernoBnb contract
 * @param bnb FlareBuyAndBurn contract
 * @param flare Flare token contract
 * @param v2Router Address of the Uniswap V2 Router
 * @param X28 Address of the X28 contract
 * @param WETH Address of the WETH contract
 * @param v3Router Address of the Uniswap V3 Router
 */
struct MintingState {
    IERC20 titanX;
    address titanXInfBnB;
    FlareBuyAndBurn bnb;
    Flare flare;
    address v2Router;
    IX28 X28;
    IWETH WETH;
    address v3Router;
}

/**
 * @title FlareMinting
 * @author Decentra
 * @dev The contract enforces minting and claiming based on time-locked cycles and automatically burns part of the deposited tokens.
 * @notice This contract allows users to mint Flare tokens by depositing TITANX tokens during specific minting cycles.
 */
contract FlareMinting is SwapActions {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @notice struct storage pointer
    MintingState public mintingState;

    /// @notice Timestamp when the minting cycle starts
    uint32 public immutable startTimestamp;

    /// @notice Address of the auction treasury
    address public flareAuctionTreasury;

    /// @notice Total amount of X28 burned
    uint256 public totalX28Burnt;

    /// @notice Tracks if liquidity has been added to the pool
    bool public addedLiquidity;

    /// @notice Total amount of TITANX deposited
    uint256 public totalTitanXDeposited;

    /// @notice Total amount of Flare claimed
    uint256 public totalFlareClaimed;

    /// @notice Total amount of Flare minted
    uint256 public totalFlareMinted;

    /// @notice Checks if initial flare has been minted for treasury
    bool mintedForTreasury;

    /// @notice Mapping to track user claims across cycles
    mapping(address user => mapping(uint32 cycleId => uint256 amount)) public amountToClaim;

    /// @notice Throws if the mint cycle is still ongoing
    error CycleStillOngoing();

    /// @notice Throws if the minting has not started
    error NotStartedYet();

    /// @notice Throws if the cycle is over
    error CycleIsOver();

    /// @notice Throws if the caller has nothing to claim
    error NoFlareToClaim();

    /// @notice Throws if the start time is invalid
    error InvalidStartTime();

    /// @notice Throws if the contract does not have enough balance for lp creation
    error NotEnoughBalanceForLp();

    /// @notice Throws if liquidity has already been added
    error LiquidityAlreadyAdded();

    /// @notice Throws if genesis transfer failed
    error GenesisTransferFailed();

    /// @notice Event emitted when a user mints Flare tokens during a mint cycle
    /// @param user Address of the user minting Flare
    /// @param flareAmount The amount of Flare minted
    /// @param titanXAmount The amount of TITANX deposited
    /// @param mintCycleId The mint cycle ID
    event MintExecuted(
        address indexed user, uint256 flareAmount, uint256 indexed titanXAmount, uint32 indexed mintCycleId
    );

    /// @notice Event emitted when a user claims Flare tokens after a mint cycle ends
    /// @param user Address of the user claiming Flare
    /// @param flareAmount The amount of Flare claimed
    /// @param mintCycleId The mint cycle ID
    event ClaimExecuted(address indexed user, uint256 flareAmount, uint8 indexed mintCycleId);

    /**
     * @notice Initializes the FlareMinting contract
     * @param _mintingState MintingState struct
     * @param _startTimestamp Timestamp when the first mint cycle starts
     * @param _s SwapActionParams
     */
    constructor(MintingState memory _mintingState, uint32 _startTimestamp, SwapActionParams memory _s)
        SwapActions(_s)
        notAddress0(address(_mintingState.titanX))
        notAddress0(_mintingState.titanXInfBnB)
        notAddress0(address(_mintingState.bnb))
        notAddress0(address(_mintingState.flare))
        notAddress0(_mintingState.v2Router)
        notAddress0(address(_mintingState.X28))
        notAddress0(address(_mintingState.WETH))
        notAddress0(_mintingState.v3Router)
    {
        require((_startTimestamp % Time.SECONDS_PER_DAY) == Time.TURN_OVER_TIME, "_startTimestamp must be 2PM UTC");

        mintingState = _mintingState;
        startTimestamp = _startTimestamp;
    }

    /**
     * @notice Mints Flare tokens by depositing TITANX tokens during an ongoing mint cycle.
     * @param _amount The amount of TITANX tokens to deposit.
     * @dev The amount of Flare minted is proportional to the deposited TITANX and decreases over cycles.
     */
    function mint(uint256 _amount) external notAmount0(_amount) {
        uint32 currentCycle = _checkCycles();

        mintingState.titanX.safeTransferFrom(msg.sender, address(this), _amount);

        _distributeGenesis(0, _amount, false);
        uint256 remainingAmount = _distributeTitanX(_amount);
        uint256 X28Amount = _deposit(remainingAmount);
        _distribute(X28Amount);

        uint256 flareAmount = (_amount * getRatioForCycle(currentCycle)) / 1e18;

        amountToClaim[msg.sender][currentCycle] += flareAmount;

        emit MintExecuted(msg.sender, flareAmount, _amount, currentCycle);

        totalFlareMinted = totalFlareMinted + flareAmount;
        totalTitanXDeposited = totalTitanXDeposited + _amount;
    }

    /**
     * @notice Mints Flare tokens by depositing ETH tokens during an ongoing mint cycle.
     * @dev The amount of Flare minted is proportional to the deposited ETH and decreases over cycles.
     */
    function mintETH(uint256 _minAmount, uint32 _deadline) external payable notAmount0(msg.value) {
        uint32 currentCycle = _checkCycles();

        uint256 titanXAmount = getSpotPrice(address(mintingState.WETH), address(mintingState.titanX), msg.value);
        checkIsDeviationOutOfBounds(address(mintingState.WETH), address(mintingState.titanX), msg.value, titanXAmount);

        IWETH((mintingState.WETH)).deposit{value: msg.value}();
        uint256 _genAmount = wmul(msg.value, TO_GENESIS);
        uint256 _swapAmount = addedLiquidity ? msg.value - _genAmount : msg.value;

        uint256 _titanXToDeposit = _swapWethToTitanX(_swapAmount, _minAmount, _deadline);

        _distributeGenesis(_genAmount, 0, true);
        uint256 remainingTitanX = _distributeTitanX(_titanXToDeposit);
        uint256 X28Amount = _deposit(remainingTitanX);

        _distribute(X28Amount);

        uint256 flareAmount = (titanXAmount * getRatioForCycle(currentCycle)) / 1e18;

        amountToClaim[msg.sender][currentCycle] += flareAmount;

        emit MintExecuted(msg.sender, flareAmount, titanXAmount, currentCycle);

        totalFlareMinted = totalFlareMinted + flareAmount;
        totalTitanXDeposited = totalTitanXDeposited + titanXAmount;
    }

    /**
     * @notice Claims the minted Flare tokens after the end of the specified mint cycle.
     * @param _cycleId The ID of the mint cycle to claim tokens from.
     * @dev Users can only claim after the mint cycle has ended.
     */
    function claim(uint8 _cycleId) external {
        if (_getCycleEndTime(_cycleId) > block.timestamp) revert CycleStillOngoing();

        uint256 toClaim = amountToClaim[msg.sender][_cycleId];
        if (toClaim == 0) revert NoFlareToClaim();

        delete amountToClaim[msg.sender][_cycleId];

        emit ClaimExecuted(msg.sender, toClaim, _cycleId);

        totalFlareClaimed = totalFlareClaimed + toClaim;
        mintingState.flare.mint(msg.sender, toClaim);
    }

    /**
     * @notice Sets the address of the auction treasury.
     * @param _flareAuctionTreasury The address of the auction treasury.
     */
    function setFlareAuctionTreasury(address _flareAuctionTreasury)
        external
        onlyOwner
        notAddress0(_flareAuctionTreasury)
    {
        flareAuctionTreasury = _flareAuctionTreasury;
        if (!mintedForTreasury) {
            mintedForTreasury = true;
            mintingState.flare.mint(_flareAuctionTreasury, INITIAL_FLARE_FOR_AUCTION);
        }
    }

    /**
     * @notice Internal function to distribute X28 tokens to various destinations for burning.
     * @param _amount The amount of X28 tokens to distribute.
     */
    function _distribute(uint256 _amount) internal {
        uint256 X28Balance = mintingState.X28.balanceOf(address(this));

        if (!addedLiquidity) {
            if (X28Balance <= (INITIAL_X28_FLARE_LP + 1)) return;
            _amount = uint192(X28Balance - (INITIAL_X28_FLARE_LP + 1));
        }

        if (_amount == 0) return;

        uint256 _toBuyNBurn = wmul(_amount, wdiv(TO_BUY_AND_BURN, TOTAL_X28_PERCENTAGE_DISTRIBUTION));
        uint256 _toFlareAuctionBuy = wmul(_amount, wdiv(TO_AUCTION_BUY, TOTAL_X28_PERCENTAGE_DISTRIBUTION));

        mintingState.X28.approve(address(mintingState.bnb), _toBuyNBurn);
        mintingState.bnb.distributeX28ForBurning(_toBuyNBurn);

        mintingState.X28.approve(mintingState.flare.flareAuctionBuy(), _toFlareAuctionBuy);
        FlareAuctionBuy(mintingState.flare.flareAuctionBuy()).distribute(_toFlareAuctionBuy);

        totalX28Burnt += _amount;
    }

    /**
     * @notice Internal function to distribute genesis tokens to various destinations.
     * @param _amount The amount of genesis tokens to distribute.
     * @param _titanXAmount The amount of TITANX tokens to distribute.
     * @param _isEth True if the distribution is for ETH, false otherwise.
     */
    function _distributeGenesis(uint256 _amount, uint256 _titanXAmount, bool _isEth) internal {
        if (addedLiquidity) {
            if (_isEth) {
                uint256 _toGenesisEth = wmul(_amount, uint256(0.5e18));
                mintingState.WETH.transfer(GENESIS, _toGenesisEth);
                mintingState.WETH.transfer(GENESIS_TWO, _toGenesisEth);
            } else {
                uint256 _toGenesis = wmul(_titanXAmount, uint256(TO_GENESIS));
                mintingState.titanX.transfer(GENESIS, wmul(_toGenesis, uint256(0.5e18)));
                mintingState.titanX.transfer(GENESIS_TWO, wmul(_toGenesis, uint256(0.5e18)));
            }
        }
    }

    /**
     * @notice Internal function to distribute TITANX tokens to various destinations.
     * @param _amount The amount of TITANX tokens to distribute.
     */
    function _distributeTitanX(uint256 _amount) internal returns (uint256) {
        if (addedLiquidity) {
            if (block.timestamp <= startTimestamp + FOUR_WEEKS) {
                mintingState.titanX.transfer(FlARE_LP, wmul(_amount, TO_FLARE_LP));
            } else {
                mintingState.titanX.transfer(mintingState.titanXInfBnB, wmul(_amount, TO_INFERNO_BNB));
            }

            mintingState.titanX.transfer(FLARE_LP_WEBBING, wmul(_amount, TO_FLARE_LP));
        }
        return mintingState.titanX.balanceOf(address(this));
    }

    /**
     * @notice Deposits TITANX tokens into the X28 contract.
     * @param _amount The amount of TITANX tokens to deposit.
     */
    function _deposit(uint256 _amount) internal returns (uint256) {
        mintingState.titanX.approve(address(mintingState.X28), _amount);
        mintingState.X28.mintX28withTitanX(_amount);
        return _amount;
    }

    /**
     * @notice Internal function to check the current mint cycle.
     * @return currentCycle The current mint cycle ID
     */
    function _checkCycles() internal view returns (uint32 currentCycle) {
        if (block.timestamp < startTimestamp) revert NotStartedYet();

        (uint32 _currentCycle,, uint32 endsAt) = getCurrentMintCycle();
        currentCycle = _currentCycle;
        if (block.timestamp > endsAt) revert CycleIsOver();
    }

    /**
     * @notice Swaps WETH for TITANX tokens.
     * @param _amount The amount of WETH tokens to swap.
     * @param _minReturn The minimum amount of TITANX tokens to receive.
     * @param _deadline The deadline for the swap.
     */
    function _swapWethToTitanX(uint256 _amount, uint256 _minReturn, uint32 _deadline)
        internal
        returns (uint256 _titanXAmount)
    {
        _titanXAmount =
            swapExactInput(address(mintingState.WETH), address(mintingState.titanX), _amount, _minReturn, _deadline);
    }

    /**
     * @notice Gets the current mint cycle based on the block timestamp.
     * @return currentCycle The current mint cycle ID
     * @return startsAt Timestamp when the current cycle starts
     * @return endsAt Timestamp when the current cycle ends
     */
    function getCurrentMintCycle() public view returns (uint32 currentCycle, uint32 startsAt, uint32 endsAt) {
        uint32 timeElapsedSince = uint32(block.timestamp - startTimestamp);
        currentCycle = uint32(timeElapsedSince / GAP_BETWEEN_CYCLE) + 1;

        if (currentCycle > MAX_MINT_CYCLE) currentCycle = MAX_MINT_CYCLE;

        startsAt = startTimestamp + ((currentCycle - 1) * GAP_BETWEEN_CYCLE);
        endsAt = startsAt + MINT_CYCLE_DURATION;
    }

    /**
     * @notice Gets the minting ratio for a specific cycle.
     * @param _cycleId The mint cycle ID
     * @return ratio The ratio of Flare to TITANX for the given cycle
     */
    function getRatioForCycle(uint32 _cycleId) public pure returns (uint256 ratio) {
        unchecked {
            uint256 adjustedRatioDiscount = _cycleId == 1 ? 0 : uint256(_cycleId - 1) * 0.01e18;
            ratio = STARTING_RATIO - adjustedRatioDiscount;
        }
    }

    /**
     * @notice Gets the end time of a specific mint cycle.
     * @param _cycleNumber The mint cycle number
     * @return endsAt The timestamp when the cycle ends
     */
    function _getCycleEndTime(uint8 _cycleNumber) internal view returns (uint32 endsAt) {
        uint32 cycleStartTime = startTimestamp + ((_cycleNumber - 1) * GAP_BETWEEN_CYCLE);
        endsAt = cycleStartTime + MINT_CYCLE_DURATION;
    }

    ////////////////////////////////
    ////////// LIQUIDITY ///////////
    ////////////////////////////////

    /**
     * @notice Creates and funds liquidity pool with Flare and X28 tokens.
     * @param _deadline The deadline for the liquidity creation transaction
     * @param _amountFlareMin The minimum amount of Flare tokens expected
     * @param _amountX28Min The minimum amount of X28 tokens expected
     * @dev This function can only be called once, and only by the contract owner.
     */
    function createAndFundLP(uint32 _deadline, uint256 _amountFlareMin, uint256 _amountX28Min)
        external
        onlyOwner
        notExpired(_deadline)
        notAmount0(_amountFlareMin)
        notAmount0(_amountX28Min)
    {
        uint256 deadline = _deadline;
        if (mintingState.X28.balanceOf(address(this)) < INITIAL_X28_FLARE_LP + 1) {
            revert NotEnoughBalanceForLp();
        }

        if (addedLiquidity) revert LiquidityAlreadyAdded();
        addedLiquidity = true;

        address x28FlarePool = _createPairIfNeccessary(address(mintingState.flare), address(mintingState.X28));

        (uint256 pairBalance1,) = _checkPoolValidity(x28FlarePool);
        if (pairBalance1 > 0) _fixPool(x28FlarePool, INITIAL_X28_FLARE_LP, INITIAL_FLARE_FOR_LP, pairBalance1);

        mintingState.flare.mint(address(this), INITIAL_FLARE_FOR_LP);
        mintingState.flare.approve(mintingState.v2Router, INITIAL_FLARE_FOR_LP);

        IUniswapV2Router02 r = IUniswapV2Router02(mintingState.v2Router);
        mintingState.X28.approve(address(r), INITIAL_X28_FLARE_LP);
        r.addLiquidity(
            address(mintingState.X28),
            address(mintingState.flare),
            INITIAL_X28_FLARE_LP,
            INITIAL_FLARE_FOR_LP,
            _amountX28Min,
            _amountFlareMin,
            address(this),
            deadline
        );

        mintingState.flare.setLp(x28FlarePool);
    }

    /**
     * @notice Checks the validity of a liquidity pool.
     * @param _pairAddress The address of the liquidity pool
     * @return pairBalance The balance of the liquidity pool
     * @return pairAddress The address of the liquidity pool
     */
    function _checkPoolValidity(address _pairAddress) internal returns (uint256, address) {
        IUniswapV2Pair pair = IUniswapV2Pair(_pairAddress);

        pair.skim(address(this));
        (uint112 reserve0, uint112 reserve1,) = pair.getReserves();
        if (reserve0 != 0) return (reserve0, _pairAddress);
        if (reserve1 != 0) return (reserve1, _pairAddress);
        return (0, _pairAddress);
    }

    /**
     * @notice Fixes a liquidity pool.
     * @param _pairAddress The address of the liquidity pool
     * @param _tokenAmount The amount of the token to be minted
     * @param _flareAmount The amount of Flare tokens to be minted
     * @param _currentBalance The current balance of the liquidity pool
     */
    function _fixPool(address _pairAddress, uint256 _tokenAmount, uint256 _flareAmount, uint256 _currentBalance)
        internal
    {
        uint256 mulAmount = wmul(_currentBalance, _flareAmount);
        uint256 requiredFlare = wdivUp(mulAmount, _tokenAmount);
        mintingState.flare.mint(_pairAddress, requiredFlare);
        IUniswapV2Pair(_pairAddress).sync();
    }

    /**
     * @notice Creates a liquidity pool pair if it doesn't exist.
     * @param _tokenA The address of the first token
     * @param _tokenB The address of the second token
     * @return pair The address of the liquidity pool
     */
    function _createPairIfNeccessary(address _tokenA, address _tokenB) internal returns (address pair) {
        IUniswapV2Factory factory = IUniswapV2Factory(mintingState.flare.v2Factory());

        (address token0, address token1) = _tokenA < _tokenB ? (_tokenA, _tokenB) : (_tokenB, _tokenA);

        pair = factory.getPair(token0, token1);

        if (pair == address(0)) pair = factory.createPair(token0, token1);
    }
}

// Source: ./SolidityContracts/Flare/IWETH.sol
// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity 0.8.28;

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint256 value) external returns (bool);
    function withdraw(uint256) external;
}

// Source: ./SolidityContracts/Flare/IX28.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IX28 is IERC20 {
    function mintX28withTitanX(uint256) external;
}

// Source: ./SolidityContracts/Flare/Math.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/* solhint-disable func-visibility, no-inline-assembly */

error Math__toInt256_overflow();
error Math__toUint64_overflow();
error Math__add_overflow_signed();
error Math__sub_overflow_signed();
error Math__mul_overflow_signed();
error Math__mul_overflow();
error Math__div_overflow();

uint256 constant WAD = 1e18;

/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/SafeCastLib.sol#L367
function toInt256(uint256 x) pure returns (int256) {
    if (x >= 1 << 255) revert Math__toInt256_overflow();
    return int256(x);
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/SafeCastLib.sol#L53
function toUint64(uint256 x) pure returns (uint64) {
    if (x >= 1 << 64) revert Math__toUint64_overflow();
    return uint64(x);
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/FixedPointMathLib.sol#L602
function abs(int256 x) pure returns (uint256 z) {
    assembly ("memory-safe") {
        let mask := sub(0, shr(255, x))
        z := xor(mask, add(mask, x))
    }
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/FixedPointMathLib.sol#L620
function min(uint256 x, uint256 y) pure returns (uint256 z) {
    assembly ("memory-safe") {
        z := xor(x, mul(xor(x, y), lt(y, x)))
    }
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/FixedPointMathLib.sol#L628
function min(int256 x, int256 y) pure returns (int256 z) {
    assembly ("memory-safe") {
        z := xor(x, mul(xor(x, y), slt(y, x)))
    }
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/FixedPointMathLib.sol#L636
function max(uint256 x, uint256 y) pure returns (uint256 z) {
    assembly ("memory-safe") {
        z := xor(x, mul(xor(x, y), gt(y, x)))
    }
}

/// @dev Taken from https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/vat.sol#L74
function add(uint256 x, int256 y) pure returns (uint256 z) {
    assembly ("memory-safe") {
        z := add(x, y)
    }
    if ((y > 0 && z < x) || (y < 0 && z > x)) {
        revert Math__add_overflow_signed();
    }
}

/// @dev Taken from https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/vat.sol#L79
function sub(uint256 x, int256 y) pure returns (uint256 z) {
    assembly ("memory-safe") {
        z := sub(x, y)
    }
    if ((y > 0 && z > x) || (y < 0 && z < x)) {
        revert Math__sub_overflow_signed();
    }
}

/// @dev Taken from https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/vat.sol#L84
function mul(uint256 x, int256 y) pure returns (int256 z) {
    unchecked {
        z = int256(x) * y;
        if (int256(x) < 0 || (y != 0 && z / y != int256(x))) {
            revert Math__mul_overflow_signed();
        }
    }
}

/// @dev Equivalent to `(x * y) / WAD` rounded down.
/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/FixedPointMathLib.sol#L54
function wmul(uint256 x, uint256 y) pure returns (uint256 z) {
    assembly ("memory-safe") {
        // Equivalent to `require(y == 0 || x <= type(uint256).max / y)`.
        if mul(y, gt(x, div(not(0), y))) {
            // Store the function selector of `Math__mul_overflow()`.
            mstore(0x00, 0xc4c5d7f5)

            // Revert with (offset, size).
            revert(0x1c, 0x04)
        }
        z := div(mul(x, y), WAD)
    }
}

function wmul(uint256 x, int256 y) pure returns (int256 z) {
    unchecked {
        z = mul(x, y) / int256(WAD);
    }
}

/// @dev Equivalent to `(x * y) / WAD` rounded up.
/// @dev Taken from https://github.com/Vectorized/solady/blob/969a78905274b32cdb7907398c443f7ea212e4f4/src/utils/FixedPointMathLib.sol#L69C22-L69C22
function wmulUp(uint256 x, uint256 y) pure returns (uint256 z) {
    /// @solidity memory-safe-assembly
    assembly {
        // Equivalent to `require(y == 0 || x <= type(uint256).max / y)`.
        if mul(y, gt(x, div(not(0), y))) {
            // Store the function selector of `Math__mul_overflow()`.
            mstore(0x00, 0xc4c5d7f5)
            // Revert with (offset, size).
            revert(0x1c, 0x04)
        }
        z := add(iszero(iszero(mod(mul(x, y), WAD))), div(mul(x, y), WAD))
    }
}

/// @dev Equivalent to `(x * WAD) / y` rounded down.
/// @dev Taken from https://github.com/Vectorized/solady/blob/6d706e05ef43cbed234c648f83c55f3a4bb0a520/src/utils/FixedPointMathLib.sol#L84
function wdiv(uint256 x, uint256 y) pure returns (uint256 z) {
    assembly ("memory-safe") {
        // Equivalent to `require(y != 0 && (WAD == 0 || x <= type(uint256).max / WAD))`.
        if iszero(mul(y, iszero(mul(WAD, gt(x, div(not(0), WAD)))))) {
            // Store the function selector of `Math__div_overflow()`.
            mstore(0x00, 0xbcbede65)

            // Revert with (offset, size).
            revert(0x1c, 0x04)
        }
        z := div(mul(x, WAD), y)
    }
}

/// @dev Equivalent to `(x * WAD) / y` rounded up.
/// @dev Taken from https://github.com/Vectorized/solady/blob/969a78905274b32cdb7907398c443f7ea212e4f4/src/utils/FixedPointMathLib.sol#L99
function wdivUp(uint256 x, uint256 y) pure returns (uint256 z) {
    /// @solidity memory-safe-assembly
    assembly {
        // Equivalent to `require(y != 0 && (WAD == 0 || x <= type(uint256).max / WAD))`.
        if iszero(mul(y, iszero(mul(WAD, gt(x, div(not(0), WAD)))))) {
            // Store the function selector of `Math__div_overflow()`.
            mstore(0x00, 0xbcbede65)
            // Revert with (offset, size).
            revert(0x1c, 0x04)
        }
        z := add(iszero(iszero(mod(mul(x, WAD), y))), div(mul(x, WAD), y))
    }
}

/// @dev Taken from https://github.com/makerdao/dss/blob/fa4f6630afb0624d04a003e920b0d71a00331d98/src/jug.sol#L62
function wpow(uint256 x, uint256 n, uint256 b) pure returns (uint256 z) {
    unchecked {
        assembly ("memory-safe") {
            switch n
            case 0 { z := b }
            default {
                switch x
                case 0 { z := 0 }
                default {
                    switch mod(n, 2)
                    case 0 { z := b }
                    default { z := x }
                    let half := div(b, 2) // for rounding.
                    for { n := div(n, 2) } n { n := div(n, 2) } {
                        let xx := mul(x, x)
                        if shr(128, x) { revert(0, 0) }
                        let xxRound := add(xx, half)
                        if lt(xxRound, xx) { revert(0, 0) }
                        x := div(xxRound, b)
                        if mod(n, 2) {
                            let zx := mul(z, x)
                            if and(iszero(iszero(x)), iszero(eq(div(zx, x), z))) { revert(0, 0) }
                            let zxRound := add(zx, half)
                            if lt(zxRound, zx) { revert(0, 0) }
                            z := div(zxRound, b)
                        }
                    }
                }
            }
        }
    }
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/cde0a5fb594da8655ba6bfcdc2e40a7c870c0cc0/src/utils/FixedPointMathLib.sol#L110
/// @dev Equivalent to `x` to the power of `y`.
/// because `x ** y = (e ** ln(x)) ** y = e ** (ln(x) * y)`.
function wpow(int256 x, int256 y) pure returns (int256) {
    // Using `ln(x)` means `x` must be greater than 0.
    return wexp((wln(x) * y) / int256(WAD));
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/cde0a5fb594da8655ba6bfcdc2e40a7c870c0cc0/src/utils/FixedPointMathLib.sol#L116
/// @dev Returns `exp(x)`, denominated in `WAD`.
function wexp(int256 x) pure returns (int256 r) {
    unchecked {
        // When the result is < 0.5 we return zero. This happens when
        // x <= floor(log(0.5e18) * 1e18) ~ -42e18
        if (x <= -42139678854452767551) return r;

        /// @solidity memory-safe-assembly
        assembly {
            // When the result is > (2**255 - 1) / 1e18 we can not represent it as an
            // int. This happens when x >= floor(log((2**255 - 1) / 1e18) * 1e18) ~ 135.
            if iszero(slt(x, 135305999368893231589)) {
                mstore(0x00, 0xa37bfec9) // `ExpOverflow()`.
                revert(0x1c, 0x04)
            }
        }

        // x is now in the range (-42, 136) * 1e18. Convert to (-42, 136) * 2**96
        // for more intermediate precision and a binary basis. This base conversion
        // is a multiplication by 1e18 / 2**96 = 5**18 / 2**78.
        x = (x << 78) / 5 ** 18;

        // Reduce range of x to (-½ ln 2, ½ ln 2) * 2**96 by factoring out powers
        // of two such that exp(x) = exp(x') * 2**k, where k is an integer.
        // Solving this gives k = round(x / log(2)) and x' = x - k * log(2).
        int256 k = ((x << 96) / 54916777467707473351141471128 + 2 ** 95) >> 96;
        x = x - k * 54916777467707473351141471128;

        // k is in the range [-61, 195].

        // Evaluate using a (6, 7)-term rational approximation.
        // p is made monic, we'll multiply by a scale factor later.
        int256 y = x + 1346386616545796478920950773328;
        y = ((y * x) >> 96) + 57155421227552351082224309758442;
        int256 p = y + x - 94201549194550492254356042504812;
        p = ((p * y) >> 96) + 28719021644029726153956944680412240;
        p = p * x + (4385272521454847904659076985693276 << 96);

        // We leave p in 2**192 basis so we don't need to scale it back up for the division.
        int256 q = x - 2855989394907223263936484059900;
        q = ((q * x) >> 96) + 50020603652535783019961831881945;
        q = ((q * x) >> 96) - 533845033583426703283633433725380;
        q = ((q * x) >> 96) + 3604857256930695427073651918091429;
        q = ((q * x) >> 96) - 14423608567350463180887372962807573;
        q = ((q * x) >> 96) + 26449188498355588339934803723976023;

        /// @solidity memory-safe-assembly
        assembly {
            // Div in assembly because solidity adds a zero check despite the unchecked.
            // The q polynomial won't have zeros in the domain as all its roots are complex.
            // No scaling is necessary because p is already 2**96 too large.
            r := sdiv(p, q)
        }

        // r should be in the range (0.09, 0.25) * 2**96.

        // We now need to multiply r by:
        // * the scale factor s = ~6.031367120.
        // * the 2**k factor from the range reduction.
        // * the 1e18 / 2**96 factor for base conversion.
        // We do this all at once, with an intermediate result in 2**213
        // basis, so the final right shift is always by a positive amount.
        r = int256((uint256(r) * 3822833074963236453042738258902158003155416615667) >> uint256(195 - k));
    }
}

/// @dev Taken from https://github.com/Vectorized/solady/blob/cde0a5fb594da8655ba6bfcdc2e40a7c870c0cc0/src/utils/FixedPointMathLib.sol#L184
/// @dev Returns `ln(x)`, denominated in `WAD`.
function wln(int256 x) pure returns (int256 r) {
    unchecked {
        /// @solidity memory-safe-assembly
        assembly {
            if iszero(sgt(x, 0)) {
                mstore(0x00, 0x1615e638) // `LnWadUndefined()`.
                revert(0x1c, 0x04)
            }
        }

        // We want to convert x from 10**18 fixed point to 2**96 fixed point.
        // We do this by multiplying by 2**96 / 10**18. But since
        // ln(x * C) = ln(x) + ln(C), we can simply do nothing here
        // and add ln(2**96 / 10**18) at the end.

        // Compute k = log2(x) - 96, t = 159 - k = 255 - log2(x) = 255 ^ log2(x).
        int256 t;
        /// @solidity memory-safe-assembly
        assembly {
            t := shl(7, lt(0xffffffffffffffffffffffffffffffff, x))
            t := or(t, shl(6, lt(0xffffffffffffffff, shr(t, x))))
            t := or(t, shl(5, lt(0xffffffff, shr(t, x))))
            t := or(t, shl(4, lt(0xffff, shr(t, x))))
            t := or(t, shl(3, lt(0xff, shr(t, x))))
            // forgefmt: disable-next-item
            t := xor(
                t,
                byte(
                    and(
                        0x1f,
                        shr(shr(t, x), 0x8421084210842108cc6318c6db6d54be)
                    ),
                    0xf8f9f9faf9fdfafbf9fdfcfdfafbfcfef9fafdfafcfcfbfefafafcfbffffffff
                )
            )
        }

        // Reduce range of x to (1, 2) * 2**96
        // ln(2^k * x) = k * ln(2) + ln(x)
        x = int256(uint256(x << uint256(t)) >> 159);

        // Evaluate using a (8, 8)-term rational approximation.
        // p is made monic, we will multiply by a scale factor later.
        int256 p = x + 3273285459638523848632254066296;
        p = ((p * x) >> 96) + 24828157081833163892658089445524;
        p = ((p * x) >> 96) + 43456485725739037958740375743393;
        p = ((p * x) >> 96) - 11111509109440967052023855526967;
        p = ((p * x) >> 96) - 45023709667254063763336534515857;
        p = ((p * x) >> 96) - 14706773417378608786704636184526;
        p = p * x - (795164235651350426258249787498 << 96);

        // We leave p in 2**192 basis so we don't need to scale it back up for the division.
        // q is monic by convention.
        int256 q = x + 5573035233440673466300451813936;
        q = ((q * x) >> 96) + 71694874799317883764090561454958;
        q = ((q * x) >> 96) + 283447036172924575727196451306956;
        q = ((q * x) >> 96) + 401686690394027663651624208769553;
        q = ((q * x) >> 96) + 204048457590392012362485061816622;
        q = ((q * x) >> 96) + 31853899698501571402653359427138;
        q = ((q * x) >> 96) + 909429971244387300277376558375;
        /// @solidity memory-safe-assembly
        assembly {
            // Div in assembly because solidity adds a zero check despite the unchecked.
            // The q polynomial is known not to have zeros in the domain.
            // No scaling required because p is already 2**96 too large.
            r := sdiv(p, q)
        }

        // r is in the range (0, 0.125) * 2**96

        // Finalization, we need to:
        // * multiply by the scale factor s = 5.549…
        // * add ln(2**96 / 10**18)
        // * add k * ln(2)
        // * multiply by 10**18 / 2**96 = 5**18 >> 78

        // mul s * 5e18 * 2**96, base is now 5**18 * 2**192
        r *= 1677202110996718588342820967067443963516166;
        // add ln(2) * k * 5e18 * 2**192
        r += 16597577552685614221487285958193947469193820559219878177908093499208371 * (159 - t);
        // add ln(2**96 / 10**18) * 5e18 * 2**192
        r += 600920179829731861736702779321621459595472258049074101567377883020018308;
        // base conversion: mul 2**18 / 2**192
        r >>= 174;
    }
}

/// @dev Returns the square root of `x`, rounded down.
function sqrt(uint256 x) pure returns (uint256 z) {
    /// @solidity memory-safe-assembly
    assembly {
        // `floor(sqrt(2**15)) = 181`. `sqrt(2**15) - 181 = 2.84`.
        z := 181 // The "correct" value is 1, but this saves a multiplication later.

        // This segment is to get a reasonable initial estimate for the Babylonian method. With a bad
        // start, the correct # of bits increases ~linearly each iteration instead of ~quadratically.

        // Let `y = x / 2**r`. We check `y >= 2**(k + 8)`
        // but shift right by `k` bits to ensure that if `x >= 256`, then `y >= 256`.
        let r := shl(7, lt(0xffffffffffffffffffffffffffffffffff, x))
        r := or(r, shl(6, lt(0xffffffffffffffffff, shr(r, x))))
        r := or(r, shl(5, lt(0xffffffffff, shr(r, x))))
        r := or(r, shl(4, lt(0xffffff, shr(r, x))))
        z := shl(shr(1, r), z)

        // Goal was to get `z*z*y` within a small factor of `x`. More iterations could
        // get y in a tighter range. Currently, we will have y in `[256, 256*(2**16))`.
        // We ensured `y >= 256` so that the relative difference between `y` and `y+1` is small.
        // That's not possible if `x < 256` but we can just verify those cases exhaustively.

        // Now, `z*z*y <= x < z*z*(y+1)`, and `y <= 2**(16+8)`, and either `y >= 256`, or `x < 256`.
        // Correctness can be checked exhaustively for `x < 256`, so we assume `y >= 256`.
        // Then `z*sqrt(y)` is within `sqrt(257)/sqrt(256)` of `sqrt(x)`, or about 20bps.

        // For `s` in the range `[1/256, 256]`, the estimate `f(s) = (181/1024) * (s+1)`
        // is in the range `(1/2.84 * sqrt(s), 2.84 * sqrt(s))`,
        // with largest error when `s = 1` and when `s = 256` or `1/256`.

        // Since `y` is in `[256, 256*(2**16))`, let `a = y/65536`, so that `a` is in `[1/256, 256)`.
        // Then we can estimate `sqrt(y)` using
        // `sqrt(65536) * 181/1024 * (a + 1) = 181/4 * (y + 65536)/65536 = 181 * (y + 65536)/2**18`.

        // There is no overflow risk here since `y < 2**136` after the first branch above.
        z := shr(18, mul(z, add(shr(r, x), 65536))) // A `mul()` is saved from starting `z` at 181.

        // Given the worst case multiplicative error of 2.84 above, 7 iterations should be enough.
        z := shr(1, add(z, div(x, z)))
        z := shr(1, add(z, div(x, z)))
        z := shr(1, add(z, div(x, z)))
        z := shr(1, add(z, div(x, z)))
        z := shr(1, add(z, div(x, z)))
        z := shr(1, add(z, div(x, z)))
        z := shr(1, add(z, div(x, z)))

        // If `x+1` is a perfect square, the Babylonian method cycles between
        // `floor(sqrt(x))` and `ceil(sqrt(x))`. This statement ensures we return floor.
        // See: https://en.wikipedia.org/wiki/Integer_square_root#Using_only_integer_division
        z := sub(z, lt(div(x, z), z))
    }
}

// Source: ./SolidityContracts/Flare/OracleLibrary.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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

// Source: ./SolidityContracts/Flare/PoolAddress.sol
// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

/// @title Provides functions for deriving a pool address from the factory, tokens, and the fee
library PoolAddress {
    bytes32 internal constant POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54; // TODO update??

    /// @notice The identifying key of the pool
    struct PoolKey {
        address token0;
        address token1;
        uint24 fee;
    }

    /// @notice Returns PoolKey: the ordered tokens with the matched fee levels
    /// @param tokenA The first token of a pool, unsorted
    /// @param tokenB The second token of a pool, unsorted
    /// @param fee The fee level of the pool
    /// @return Poolkey The pool details with ordered token0 and token1 assignments
    function getPoolKey(address tokenA, address tokenB, uint24 fee) internal pure returns (PoolKey memory) {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        return PoolKey({token0: tokenA, token1: tokenB, fee: fee});
    }

    /// @notice Deterministically computes the pool address given the factory and PoolKey
    /// @param factory The Uniswap V3 factory contract address
    /// @param key The PoolKey
    /// @return pool The contract address of the V3 pool
    function computeAddress(address factory, PoolKey memory key) internal pure returns (address pool) {
        require(key.token0 < key.token1);
        pool = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            factory,
                            keccak256(abi.encode(key.token0, key.token1, key.fee)),
                            POOL_INIT_CODE_HASH
                        )
                    )
                )
            )
        );
    }
}

// Source: ./SolidityContracts/Flare/SwapActions.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "../const/Constants.sol";
import {Errors} from "../utils/Errors.sol";
import {wmul, min} from "../utils/Math.sol";
import {PoolAddress} from "../libs/PoolAddress.sol";
import {OracleLibrary} from "../libs/OracleLibrary.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

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
 * @author Decentra
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

    uint32 public deviation = 300;

    /// @notice Mapping of pool addresses to their respective slippage settings
    mapping(address pool => Slippage) public slippageConfigs;

    /// @notice Thrown when an invalid slippage is provided
    error SwapActions__InvalidSlippage();

    /// @notice Thrown when a non-admin/non-owner attempts to perform slippage actions
    error SwapActions__OnlySlippageAdmin();

    /// @notice Thrown when an invalid TWA lookback is passed
    error SwapActions__InvalidLookBack();

    /// @notice Thrown when the deviation is out of bounds
    error SwapActions__DeviationOutOfBounds();

    /// @notice Thrown when an invalid input is provided
    error SwapActions__IncorrectInput();

    /// @notice event emitted when the slippage admin is changed
    /// @param oldAdmin the old slippage admin
    /// @param newAdmin the new slippage admin
    event SlippageAdminChanged(address indexed oldAdmin, address indexed newAdmin);

    /// @notice event emitted when the slippage config is changed
    /// @param pool the pool address
    /// @param newSlippage the new slippage value
    /// @param newLookback the new lookback period
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
     * @param _pool Address of the Uniswap V3 pool.
     * @param _newSlippage New slippage value (in WAD).
     * @param _newLookBack New TWAP lookback period (in minutes).
     * @dev Only callable by the slippage admin or the owner.
     */
    function changeSlippageConfig(address _pool, uint224 _newSlippage, uint32 _newLookBack)
        external
        notAmount0(_newLookBack)
        onlySlippageAdminOrOwner
    {
        require(_newLookBack >= 5 && _newLookBack <= 30, SwapActions__InvalidLookBack());
        require(_newSlippage <= WAD, SwapActions__InvalidSlippage());

        emit SlippageConfigChanged(_pool, _newSlippage, _newLookBack);

        slippageConfigs[_pool] = Slippage({slippage: _newSlippage, twapLookback: _newLookBack});
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
        if (_deviationLimit == 0) revert SwapActions__IncorrectInput();
        if (_deviationLimit > MAX_DEVIATION_LIMIT) revert SwapActions__IncorrectInput();
        deviation = _deviationLimit;
    }

    /**
     * @notice Perform an exact input swap on Uniswap V3.
     * @param _tokenIn Address of the input token.
     * @param _tokenOut Address of the output token.
     * @param _tokenInAmount Amount of the input token to swap.
     * @param _minAmountOut Optional minimum amount out, if it's 0 it uses the twap
     * @param _deadline Deadline timestamp for the swap.
     * @return amountReceived Amount of the output token received.
     * @dev The function uses the TWAP (Time-Weighted Average Price) to ensure the swap is performed within slippage tolerance.
     */
    function swapExactInput(
        address _tokenIn,
        address _tokenOut,
        uint256 _tokenInAmount,
        uint256 _minAmountOut,
        uint32 _deadline
    ) internal returns (uint256 amountReceived) {
        IERC20(_tokenIn).approve(uniswapV3Router, _tokenInAmount);

        bytes memory path = abi.encodePacked(_tokenIn, POOL_FEE, _tokenOut);

        (uint256 twapAmount, uint224 slippage) = getTwapAmount(_tokenIn, _tokenOut, _tokenInAmount);

        uint256 minAmount = _minAmountOut == 0 ? wmul(twapAmount, slippage) : _minAmountOut;

        ISwapRouter.ExactInputParams memory params = ISwapRouter.ExactInputParams({
            path: path,
            recipient: address(this),
            deadline: _deadline,
            amountIn: _tokenInAmount,
            amountOutMinimum: minAmount
        });

        return ISwapRouter(uniswapV3Router).exactInput(params);
    }

    /**
     * @notice Get the TWAP (Time-Weighted Average Price) and slippage for a given token pair.
     * @param _tokenIn Address of the input token.
     * @param _tokenOut Address of the output token.
     * @param _amount Amount of the input token.
     * @return twapAmount The TWAP amount of the output token for the given input.
     * @return slippage The slippage tolerance for the pool.
     */
    function getTwapAmount(address _tokenIn, address _tokenOut, uint256 _amount)
        public
        view
        returns (uint256 twapAmount, uint224 slippage)
    {
        address poolAddress =
            PoolAddress.computeAddress(v3Factory, PoolAddress.getPoolKey(_tokenIn, _tokenOut, POOL_FEE));

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
        twapAmount = OracleLibrary.getQuoteForSqrtRatioX96(sqrtPriceX96, _amount, _tokenIn, _tokenOut);
    }

    /**
     * @notice Checks if the current spot price deviation from TWAP is within acceptable bounds
     * @dev Calculates the difference between spot and TWAP prices and compares against
     *      maximum allowed deviation threshold.
     * @param _tokenIn Address of the input token.
     * @param _tokenOut Address of the output token.
     * @param _amount Amount of the input token
     * @param _spotPrice Current spot price to check against TWAP
     *
     * @notice This is a critical price protection mechanism to prevent:
     *         - Market manipulation
     *         - Extreme price volatility
     *         - Unfair trading conditions
     */
    function checkIsDeviationOutOfBounds(address _tokenIn, address _tokenOut, uint256 _amount, uint256 _spotPrice)
        internal
        view
    {
        (uint256 _twapPrice,) = getTwapAmount(_tokenIn, _tokenOut, _amount);
        uint256 _diff = _twapPrice >= _spotPrice ? _twapPrice - _spotPrice : _spotPrice - _twapPrice;

        if (FullMath.mulDiv(_spotPrice, deviation, MAX_DEVIATION_LIMIT) < _diff) {
            revert SwapActions__DeviationOutOfBounds();
        }
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
    function getSpotPrice(address _tokenIn, address _tokenOut, uint256 _amountIn) public view returns (uint256) {
        IUniswapV3Pool pool =
            IUniswapV3Pool(PoolAddress.computeAddress(v3Factory, PoolAddress.getPoolKey(_tokenIn, _tokenOut, POOL_FEE)));

        (uint160 sqrtPriceX96,,,,,,) = pool.slot0();
        return OracleLibrary.getQuoteForSqrtRatioX96(sqrtPriceX96, _amountIn, _tokenIn, _tokenOut);
    }

    /**
     * @dev Internal function to check if the caller is the slippage admin or contract owner.
     */
    function _onlySlippageAdminOrOwner() private view {
        require(msg.sender == slippageAdmin || msg.sender == owner(), SwapActions__OnlySlippageAdmin());
    }
}

// Source: ./SolidityContracts/Flare/Time.sol
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library Time {
    ///@notice The cut-off time in seconds from the start of the day for a day turnover, equivalent to 14 hours (50,400 seconds).
    uint32 constant TURN_OVER_TIME = 50400;

    ///@notice The total number of seconds in a day.
    uint32 constant SECONDS_PER_DAY = 86400;

    /**
     * @notice Returns the current block timestamp.
     * @dev This function retrieves the timestamp using assembly for gas efficiency.
     * @return ts The current block timestamp.
     */
    function blockTs() internal view returns (uint32 ts) {
        assembly {
            ts := timestamp()
        }
    }

    /**
     * @notice Calculates the number of weeks passed since a given timestamp.
     * @dev Uses assembly to retrieve the current timestamp and calculates the number of turnover time periods passed.
     * @param t The starting timestamp.
     * @return weeksPassed The number of weeks that have passed since the provided timestamp.
     */
    function weekSince(uint32 t) internal view returns (uint32 weeksPassed) {
        assembly {
            let currentTime := timestamp()
            let timeElapsed := sub(currentTime, t)

            weeksPassed := div(timeElapsed, TURN_OVER_TIME)
        }
    }

    /**
     * @notice Calculates the number of full days between two timestamps.
     * @dev Subtracts the start time from the end time and divides by the seconds per day.
     * @param start The starting timestamp.
     * @param end The ending timestamp.
     * @return daysPassed The number of full days between the two timestamps.
     */
    function dayGap(uint32 start, uint256 end) public pure returns (uint32 daysPassed) {
        assembly {
            daysPassed := div(sub(end, start), SECONDS_PER_DAY)
        }
    }

    function weekDayByT(uint32 t) public pure returns (uint8 weekDay) {
        assembly {
            // Subtract 14 hours from the timestamp
            let adjustedTimestamp := sub(t, TURN_OVER_TIME)

            // Divide by the number of seconds in a day (86400)
            let days := div(adjustedTimestamp, SECONDS_PER_DAY)

            // Add 4 to align with weekday and calculate mod 7
            let result := mod(add(days, 4), 7)

            // Store result as uint8
            weekDay := result
        }
    }

    /**
     * @notice Calculates the end of the day at 2 PM UTC based on a given timestamp.
     * @dev Adjusts the provided timestamp by subtracting the turnover time, calculates the next day's timestamp at 2 PM UTC.
     * @param t The starting timestamp.
     * @return nextDayStartAt2PM The timestamp for the next day ending at 2 PM UTC.
     */
    function getDayEnd(uint32 t) public pure returns (uint32 nextDayStartAt2PM) {
        // Adjust the timestamp to the cutoff time (2 PM UTC)
        uint32 adjustedTime = t - 14 hours;

        // Calculate the number of days since Unix epoch
        uint32 daysSinceEpoch = adjustedTime / 86400;

        // Calculate the start of the next day at 2 PM UTC
        nextDayStartAt2PM = (daysSinceEpoch + 1) * 86400 + 14 hours;
    }
}

