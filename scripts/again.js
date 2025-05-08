import { getAddress } from 'viem';

const address = '0x58aD6ef28BfB092635454D02303aBbd4D87b503C';
console.log('Checksummed address:', getAddress(address));