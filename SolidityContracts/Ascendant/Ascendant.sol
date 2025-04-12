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
