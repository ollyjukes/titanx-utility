// app/contracts/abi_vault.js
import element280Vault from '@/abi/element280Vault.json';
import element369Vault from '@/abi/element369Vault.json';
import staxVault from '@/abi/staxVault.json';

// Vault ABI function mappings for each collection
const vaultAbiFunctions = {
  element280: {
    vault: element280Vault,
    functions: {
      E280: {
        name: 'E280',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      E280_NFT: {
        name: 'E280_NFT',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      claimed: {
        name: 'claimed',
        contract: 'vault',
        inputs: ['user'],
        outputs: ['result'],
      },
      claimedCycles: {
        name: 'claimedCycles',
        contract: 'vault',
        inputs: ['tokenId'],
        outputs: ['result'],
      },
      currentCycle: {
        name: 'currentCycle',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      cycles: {
        name: 'cycles',
        contract: 'vault',
        inputs: ['id'],
        outputs: ['timestamp', 'tokensPerMultiplier'],
      },
      devWallet: {
        name: 'devWallet',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      getNextCyclePool: {
        name: 'getNextCyclePool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getNextCycleTime: {
        name: 'getNextCycleTime',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getRewards: {
        name: 'getRewards',
        contract: 'vault',
        inputs: ['tokenIds', 'account'],
        outputs: ['availability', 'totalReward'],
      },
      minCyclePool: {
        name: 'minCyclePool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      owner: {
        name: 'owner',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      pendingOwner: {
        name: 'pendingOwner',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      totalE280Burned: {
        name: 'totalE280Burned',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      totalRewadsPaid: {
        name: 'totalRewadsPaid',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      totalRewardPool: {
        name: 'totalRewardPool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      treasury: {
        name: 'treasury',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      acceptOwnership: {
        name: 'acceptOwnership',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      claimRewards: {
        name: 'claimRewards',
        contract: 'vault',
        inputs: ['tokenIds'],
        outputs: [],
      },
      renounceOwnership: {
        name: 'renounceOwnership',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      setMinCyclePool: {
        name: 'setMinCyclePool',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      setTreasury: {
        name: 'setTreasury',
        contract: 'vault',
        inputs: ['_address'],
        outputs: [],
      },
      transferOwnership: {
        name: 'transferOwnership',
        contract: 'vault',
        inputs: ['newOwner'],
        outputs: [],
      },
      updateCycle: {
        name: 'updateCycle',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
    },
  },
  element369: {
    vault: element369Vault,
    functions: {
      E369_NFT: {
        name: 'E369_NFT',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      FluxHub: {
        name: 'FluxHub',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      _getEndCycleForCycle777: {
        name: '_getEndCycleForCycle777',
        contract: 'vault',
        inputs: ['cycle777Id'],
        outputs: ['result'],
      },
      _getNextCyclePool: {
        name: '_getNextCyclePool',
        contract: 'vault',
        inputs: ['token'],
        outputs: ['result'],
      },
      _getStartCycleForCycle777: {
        name: '_getStartCycleForCycle777',
        contract: 'vault',
        inputs: ['cycle777Id'],
        outputs: ['result'],
      },
      cycle777AmountClaimed: {
        name: 'cycle777AmountClaimed',
        contract: 'vault',
        inputs: ['tokenId', 'token'],
        outputs: ['result'],
      },
      cycle777BackingClaimed: {
        name: 'cycle777BackingClaimed',
        contract: 'vault',
        inputs: ['tokenId', 'token'],
        outputs: ['result'],
      },
      cycles: {
        name: 'cycles',
        contract: 'vault',
        inputs: ['id'],
        outputs: ['initialized', 'infernoPerMulitplier', 'fluxPerMultiplier', 'e280PerMultiplier'],
      },
      cycles777: {
        name: 'cycles777',
        contract: 'vault',
        inputs: ['id'],
        outputs: ['startCycleId', 'endCycleId', 'multiplierPool', 'infernoPool', 'e280Pool'],
      },
      devWallet: {
        name: 'devWallet',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      get777Rewards: {
        name: 'get777Rewards',
        contract: 'vault',
        inputs: ['tokenIds', 'account', 'isBacking'],
        outputs: ['availability', 'burned', 'infernoPool', 'e280Pool'],
      },
      getCurrentCycle777: {
        name: 'getCurrentCycle777',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getCurrentE369Cycle: {
        name: 'getCurrentE369Cycle',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getNextCyclePools: {
        name: 'getNextCyclePools',
        contract: 'vault',
        inputs: [],
        outputs: ['infernoPool', 'fluxPool', 'e280Pool'],
      },
      getRewards: {
        name: 'getRewards',
        contract: 'vault',
        inputs: ['tokenIds', 'account', 'isBacking'],
        outputs: ['availability', 'burned', 'infernoPool', 'fluxPool', 'e280Pool'],
      },
      lastUpdatedCycle: {
        name: 'lastUpdatedCycle',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      minCyclePool: {
        name: 'minCyclePool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      nftLastBacking: {
        name: 'nftLastBacking',
        contract: 'vault',
        inputs: ['tokenId'],
        outputs: ['result'],
      },
      nftLastClaim: {
        name: 'nftLastClaim',
        contract: 'vault',
        inputs: ['tokenId'],
        outputs: ['result'],
      },
      owner: {
        name: 'owner',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      pendingOwner: {
        name: 'pendingOwner',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      totalTokenPaid: {
        name: 'totalTokenPaid',
        contract: 'vault',
        inputs: ['token'],
        outputs: ['result'],
      },
      totalTokenPool: {
        name: 'totalTokenPool',
        contract: 'vault',
        inputs: ['token'],
        outputs: ['result'],
      },
      acceptOwnership: {
        name: 'acceptOwnership',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      claim777Backing: {
        name: 'claim777Backing',
        contract: 'vault',
        inputs: ['tokenIds'],
        outputs: [],
      },
      claim777Rewards: {
        name: 'claim777Rewards',
        contract: 'vault',
        inputs: ['tokenIds'],
        outputs: [],
      },
      claimBacking: {
        name: 'claimBacking',
        contract: 'vault',
        inputs: ['tokenIds'],
        outputs: [],
      },
      claimRewards: {
        name: 'claimRewards',
        contract: 'vault',
        inputs: ['tokenIds'],
        outputs: [],
      },
      register777CycleTokens: {
        name: 'register777CycleTokens',
        contract: 'vault',
        inputs: ['infernoAmount', 'e280Amount'],
        outputs: [],
      },
      renounceOwnership: {
        name: 'renounceOwnership',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      setFluxHub: {
        name: 'setFluxHub',
        contract: 'vault',
        inputs: ['fluxHub'],
        outputs: [],
      },
      setMinCyclePool: {
        name: 'setMinCyclePool',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      transferOwnership: {
        name: 'transferOwnership',
        contract: 'vault',
        inputs: ['newOwner'],
        outputs: [],
      },
      updateCycle: {
        name: 'updateCycle',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      updateStoredMultipliers: {
        name: 'updateStoredMultipliers',
        contract: 'vault',
        inputs: ['cycleId', 'totalMultipliers'],
        outputs: [],
      },
      updateStoredMultipliersOnBurn: {
        name: 'updateStoredMultipliersOnBurn',
        contract: 'vault',
        inputs: ['cycleId', 'totalMultipliers', 'multiplierDeduction'],
        outputs: [],
      },
    },
  },
  stax: {
    vault: staxVault,
    functions: {
      STAX: {
        name: 'STAX',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      STAX_BANK: {
        name: 'STAX_BANK',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      STAX_BUY_BURN: {
        name: 'STAX_BUY_BURN',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      STAX_DEV: {
        name: 'STAX_DEV',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      STAX_NFT: {
        name: 'STAX_NFT',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      diamondHandPool: {
        name: 'diamondHandPool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getCycleDistribution: {
        name: 'getCycleDistribution',
        contract: 'vault',
        inputs: ['cycleId'],
        outputs: ['bankShare', 'buyBurnShare', 'genesisShare', 'nftHolderShare', 'diamondPoolShare'],
      },
      getNextCycleTime: {
        name: 'getNextCycleTime',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getRewards: {
        name: 'getRewards',
        contract: 'vault',
        inputs: ['tokenIds', 'account'],
        outputs: ['availability', 'totalPayout'],
      },
      getTitanXPool: {
        name: 'getTitanXPool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getX28Pool: {
        name: 'getX28Pool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      getX28MintStatus: {
        name: 'getX28MintStatus',
        contract: 'vault',
        inputs: [],
        outputs: ['isNativeMint'],
      },
      incentiveFeeBPS: {
        name: 'incentiveFeeBPS',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      lastClaimed: {
        name: 'lastClaimed',
        contract: 'vault',
        inputs: ['tokenId'],
        outputs: ['result'],
      },
      lastCycleMultipliers: {
        name: 'lastCycleMultipliers',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      lastCycleTs: {
        name: 'lastCycleTs',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      maxSwapValue: {
        name: 'maxSwapValue',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      minCyclePool: {
        name: 'minCyclePool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      owner: {
        name: 'owner',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      pendingOwner: {
        name: 'pendingOwner',
        contract: 'vault',
        inputs: [],
        outputs: ['address'],
      },
      secondsAgo: {
        name: 'secondsAgo',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      tokensPerMultiplier: {
        name: 'tokensPerMultiplier',
        contract: 'vault',
        inputs: ['cycleId'],
        outputs: ['result'],
      },
      totalClaimed: {
        name: 'totalClaimed',
        contract: 'vault',
        inputs: ['user'],
        outputs: ['result'],
      },
      totalRewadsPaid: {
        name: 'totalRewadsPaid',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      totalRewardPool: {
        name: 'totalRewardPool',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      twapDeviation: {
        name: 'twapDeviation',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      x28Deviation: {
        name: 'x28Deviation',
        contract: 'vault',
        inputs: [],
        outputs: ['result'],
      },
      acceptOwnership: {
        name: 'acceptOwnership',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      batchClaimRewards: {
        name: 'batchClaimRewards',
        contract: 'vault',
        inputs: ['tokenIds'],
        outputs: [],
      },
      claimRewards: {
        name: 'claimRewards',
        contract: 'vault',
        inputs: ['tokenId'],
        outputs: [],
      },
      handleStartPresale: {
        name: 'handleStartPresale',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      renounceOwnership: {
        name: 'renounceOwnership',
        contract: 'vault',
        inputs: [],
        outputs: [],
      },
      setIncentiveFee: {
        name: 'setIncentiveFee',
        contract: 'vault',
        inputs: ['bps'],
        outputs: [],
      },
      setMaxSwapValue: {
        name: 'setMaxSwapValue',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      setMinCyclePool: {
        name: 'setMinCyclePool',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      setProtocolAddresses: {
        name: 'setProtocolAddresses',
        contract: 'vault',
        inputs: ['_staxNft', '_staxBank'],
        outputs: [],
      },
      setSecondsAgo: {
        name: 'setSecondsAgo',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      setTwapDeviation: {
        name: 'setTwapDeviation',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      setX28PriceDeviation: {
        name: 'setX28PriceDeviation',
        contract: 'vault',
        inputs: ['limit'],
        outputs: [],
      },
      transferOwnership: {
        name: 'transferOwnership',
        contract: 'vault',
        inputs: ['newOwner'],
        outputs: [],
      },
      updateCycle: {
        name: 'updateCycle',
        contract: 'vault',
        inputs: ['minAmountOut', 'deadline'],
        outputs: [],
      },
    },
  },
};

// Validate vault ABIs at startup
Object.entries(vaultAbiFunctions).forEach(([key, { vault, functions }]) => {
  if (!vault) throw new Error(`Missing vault ABI for ${key}`);
  Object.entries(functions).forEach(([fnName, fn]) => {
    if (!vault.find(f => f.name === fn.name && f.type === 'function')) {
      throw new Error(`Missing vault function ${fnName} for ${key}`);
    }
  });
});

// Utility function to get a specific vault function
export function getVaultFunction(contractKey, functionName) {
  const collection = vaultAbiFunctions[contractKey.toLowerCase()];
  if (!collection) throw new Error(`Unknown contract key: ${contractKey}`);
  return collection.functions[functionName] || null;
}

// Export vault ABI functions and vault ABIs
export const vaultAbis = {
  element280: element280Vault,
  element369: element369Vault,
  stax: staxVault,
};

export default vaultAbiFunctions;