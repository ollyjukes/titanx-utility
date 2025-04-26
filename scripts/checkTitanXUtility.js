// scripts/checkTitanXUtility.js
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import glob from 'glob';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE_URL = 'http://localhost:3000';
const CONTRACTS = ['Element280', 'Element369', 'Stax', 'Ascendant', 'E280'];
const EXPECTED_TIERS_FORMAT = {
  Element280: 'zero-based',
  Element369: 'zero-based',
  Stax: 'one-based',
  Ascendant: 'one-based',
  E280: 'zero-based',
};

async function checkApiResponse(contract) {
  console.log(`Checking API for ${contract}...`);
  try {
    const response = await fetch(`${API_BASE_URL}/api/holders/${contract}?page=0&pageSize=10`);
    if (!response.ok) {
      console.error(`API error for ${contract}: ${response.status} ${response.statusText}`);
      return false;
    }
    const data = await response.json();
    if (!data.holders || !Array.isArray(data.holders)) {
      console.error(`Invalid response format for ${contract}: Missing holders array`);
      return false;
    }

    const expectedFormat = EXPECTED_TIERS_FORMAT[contract];
    for (const holder of data.holders) {
      if (!holder.tiers || !Array.isArray(holder.tiers)) {
        console.error(`Invalid tiers format for ${contract} holder ${holder.wallet}: tiers is not an array`);
        return false;
      }
      if (expectedFormat === 'zero-based') {
        if (holder.tiers[0] === undefined) {
          console.error(`Zero-based tiers expected for ${contract} but tiers[0] is undefined for ${holder.wallet}`);
          return false;
        }
      } else {
        if (holder.tiers[0] !== 0 && holder.tiers[0] !== undefined) {
          console.error(`One-based tiers expected for ${contract} but tiers[0] is not zero for ${holder.wallet}`);
          return false;
        }
      }
      const totalFromTiers = holder.tiers.reduce((sum, count) => sum + (count || 0), 0);
      if (totalFromTiers !== holder.total) {
        console.error(
          `Tiers sum mismatch for ${contract} holder ${holder.wallet}: tiers sum=${totalFromTiers}, total=${holder.total}`
        );
        return false;
      }
    }
    console.log(`API check passed for ${contract}`);
    return true;
  } catch (error) {
    console.error(`API check failed for ${contract}: ${error.message}`);
    return false;
  }
}

async function checkFrontendRendering(contract) {
  console.log(`Checking frontend rendering for ${contract}...`);
  try {
    const response = await fetch(`${API_BASE_URL}/nft/ETH/${contract}`);
    if (!response.ok) {
      console.error(`Frontend error for ${contract}: ${response.status} ${response.statusText}`);
      return false;
    }
    const text = await response.text();
    if (!text.includes(`HolderTable`)) {
      console.error(`Frontend rendering failed for ${contract}: HolderTable not found in response`);
      return false;
    }
    console.log(`Frontend rendering check passed for ${contract}`);
    return true;
  } catch (error) {
    console.error(`Frontend rendering check failed for ${contract}: ${error.message}`);
    return false;
  }
}

async function checkImports() {
  console.log('Checking imports for deprecated nft-contracts...');
  const files = glob.sync('**/*.{js,jsx,ts,tsx}', { cwd: path.join(__dirname, '../'), ignore: ['node_modules/**', 'scripts/**'] });
  let issues = 0;
  for (const file of files) {
    const content = await fs.readFile(path.join(__dirname, '../', file), 'utf8');
    if (content.includes('@/app/nft-contracts')) {
      console.error(`Deprecated import found in ${file}: @/app/nft-contracts`);
      issues++;
    }
  }
  if (issues === 0) {
    console.log('No deprecated imports found');
  }
  return issues === 0;
}

async function checkConfig() {
  console.log('Checking config.js...');
  try {
    const config = await import('../config.js');
    const requiredKeys = ['contractAddresses', 'vaultAddresses', 'contractDetails', 'contractTiers', 'abis', 'cache', 'alchemy'];
    for (const key of requiredKeys) {
      if (!config.default[key]) {
        console.error(`Missing key in config.js: ${key}`);
        return false;
      }
    }
    for (const contract of CONTRACTS) {
      if (!config.default.contractTiers[contract.toLowerCase()]) {
        console.error(`Missing contractTiers for ${contract}`);
        return false;
      }
    }
    console.log('Config check passed');
    return true;
  } catch (error) {
    console.error(`Config check failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Running TitanX Utility checks...');
  let allPassed = true;

  // Check APIs
  for (const contract of CONTRACTS) {
    const apiPassed = await checkApiResponse(contract);
    allPassed = allPassed && apiPassed;
  }

  // Check frontend rendering
  for (const contract of CONTRACTS) {
    if (contract === 'E280') continue; // Skip E280 as it’s disabled
    const frontendPassed = await checkFrontendRendering(contract);
    allPassed = allPassed && frontendPassed;
  }

  // Check imports
  const importsPassed = await checkImports();
  allPassed = allPassed && importsPassed;

  // Check config
  const configPassed = await checkConfig();
  allPassed = allPassed && configPassed;

  console.log(`\nAll checks ${allPassed ? 'PASSED' : 'FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(error => {
  console.error(`Script failed: ${error.message}`);
  process.exit(1);
});