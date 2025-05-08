// scripts/verifyContracts.js
import { tokenContracts } from '../app/token_contracts.js';

Object.entries(tokenContracts).forEach(([key, config]) => {
  console.log(`${key}: ${config.address}`);
});