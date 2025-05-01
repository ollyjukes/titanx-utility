import { Alchemy } from 'alchemy-sdk';
import dotenv from 'dotenv';
dotenv.config();

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: 'eth-mainnet',
});

async function testOwners(contractAddress, contractName) {
  try {
    console.log(`Testing ${contractName} at ${contractAddress}`);
    const response = await alchemy.nft.getOwnersForContract(contractAddress, {
      withTokenBalances: true,
    });
    console.log(`[${contractName}] Owners exists: ${!!response.owners}, Is array: ${Array.isArray(response.owners)}, Length: ${response.owners?.length || 0}`);
    if (!response.owners || !Array.isArray(response.owners)) {
      console.log(`[${contractName}] Response keys: ${Object.keys(response || {})}`);
    }
  } catch (error) {
    console.log(`[${contractName}] Error: ${error.message}`);
  }
}

async function runTests() {
  const contracts = [
    { name: 'Stax', address: '0x74270Ca3a274B4dbf26be319A55188690CACE6E1' },
    { name: 'element369', address: '0x024D64E2F65747d8bB02dFb852702D588A062575' },
    { name: 'element280', address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9' },
    { name: 'ascendant', address: '0x9da95c32c5869c84ba2c020b5e87329ec0adc97f' },
  ];
  for (const { name, address } of contracts) {
    await testOwners(address, name);
    console.log('---');
  }
}

runTests();