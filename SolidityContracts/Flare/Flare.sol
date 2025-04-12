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
