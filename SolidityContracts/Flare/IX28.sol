// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

interface IX28 is IERC20 {
    function mintX28withTitanX(uint256) external;
}
