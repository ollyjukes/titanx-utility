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
