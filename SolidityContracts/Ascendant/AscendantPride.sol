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
