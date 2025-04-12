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
