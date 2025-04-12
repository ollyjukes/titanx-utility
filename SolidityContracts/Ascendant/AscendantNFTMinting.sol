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