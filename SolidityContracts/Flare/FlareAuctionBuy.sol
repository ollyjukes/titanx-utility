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
