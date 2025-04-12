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
