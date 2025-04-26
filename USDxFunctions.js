// usdxFunctions.js
// Extracted functions from the USDx contract ABI for later use

const usdxFunctions = [
    {
      name: 'DOMAIN_SEPARATOR',
      inputs: [],
      outputs: [{ type: 'bytes32', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'allowance',
      inputs: [
        { type: 'address', name: 'owner' },
        { type: 'address', name: 'spender' },
      ],
      outputs: [{ type: 'uint256', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'approve',
      inputs: [
        { type: 'address', name: 'spender' },
        { type: 'uint256', name: 'amount' },
      ],
      outputs: [{ type: 'bool', name: '' }],
      stateMutability: 'nonpayable',
    },
    {
      name: 'backstopPoolAddress',
      inputs: [],
      outputs: [{ type: 'address', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'balanceOf',
      inputs: [{ type: 'address', name: 'account' }],
      outputs: [{ type: 'uint256', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'burn',
      inputs: [
        { type: 'address', name: '_account' },
        { type: 'uint256', name: '_amount' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'collateralController',
      inputs: [],
      outputs: [{ type: 'address', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'decimals',
      inputs: [],
      outputs: [{ type: 'uint8', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'decreaseAllowance',
      inputs: [
        { type: 'address', name: 'spender' },
        { type: 'uint256', name: 'subtractedValue' },
      ],
      outputs: [{ type: 'bool', name: '' }],
      stateMutability: 'nonpayable',
    },
    {
      name: 'eip712Domain',
      inputs: [],
      outputs: [
        { type: 'bytes1', name: 'fields' },
        { type: 'string', name: 'name' },
        { type: 'string', name: 'version' },
        { type: 'uint256', name: 'chainId' },
        { type: 'address', name: 'verifyingContract' },
        { type: 'bytes32', name: 'salt' },
        { type: 'uint256[]', name: 'extensions' },
      ],
      stateMutability: 'view',
    },
    {
      name: 'increaseAllowance',
      inputs: [
        { type: 'address', name: 'spender' },
        { type: 'uint256', name: 'addedValue' },
      ],
      outputs: [{ type: 'bool', name: '' }],
      stateMutability: 'nonpayable',
    },
    {
      name: 'mint',
      inputs: [
        { type: 'address', name: '_account' },
        { type: 'uint256', name: '_amount' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'name',
      inputs: [],
      outputs: [{ type: 'string', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'nonces',
      inputs: [{ type: 'address', name: 'owner' }],
      outputs: [{ type: 'uint256', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'permit',
      inputs: [
        { type: 'address', name: 'owner' },
        { type: 'address', name: 'spender' },
        { type: 'uint256', name: 'value' },
        { type: 'uint256', name: 'deadline' },
        { type: 'uint8', name: 'v' },
        { type: 'bytes32', name: 'r' },
        { type: 'bytes32', name: 's' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'positionControllerAddress',
      inputs: [],
      outputs: [{ type: 'address', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'returnFromPool',
      inputs: [
        { type: 'address', name: '_poolAddress' },
        { type: 'address', name: '_receiver' },
        { type: 'uint256', name: '_amount' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'sendToPool',
      inputs: [
        { type: 'address', name: '_sender' },
        { type: 'address', name: '_poolAddress' },
        { type: 'uint256', name: '_amount' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'symbol',
      inputs: [],
      outputs: [{ type: 'string', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'totalSupply',
      inputs: [],
      outputs: [{ type: 'uint256', name: '' }],
      stateMutability: 'view',
    },
    {
      name: 'transfer',
      inputs: [
        { type: 'address', name: 'recipient' },
        { type: 'uint256', name: 'amount' },
      ],
      outputs: [{ type: 'bool', name: '' }],
      stateMutability: 'nonpayable',
    },
    {
      name: 'transferForRedemptionEscrow',
      inputs: [
        { type: 'address', name: '_sender' },
        { type: 'address', name: '_positionManager' },
        { type: 'uint256', name: '_amount' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
    {
      name: 'transferFrom',
      inputs: [
        { type: 'address', name: 'sender' },
        { type: 'address', name: 'recipient' },
        { type: 'uint256', name: 'amount' },
      ],
      outputs: [{ type: 'bool', name: '' }],
      stateMutability: 'nonpayable',
    },
  ];
  
  export default usdxFunctions;