import fs from 'fs/promises';
import path from 'path';

async function sumTokens() {
  const filePath = path.join(process.cwd(), 'ascendant_holders.json');

  try {
    // Check if file exists
    await fs.access(filePath);
    console.log(`Reading ${filePath}...`);

    // Read and parse JSON
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));

    // Validate data
    if (!data.holders || !Array.isArray(data.holders)) {
      throw new Error('Invalid JSON format: "holders" array not found');
    }

    // Sum holder.total
    const total = data.holders.reduce((sum, holder) => {
      if (typeof holder.total !== 'number') {
        console.warn(`Invalid total for wallet ${holder.wallet}: ${holder.total}`);
        return sum;
      }
      return sum + holder.total;
    }, 0);

    console.log('Sum of holder.total:', total);
    console.log(`Total Tokens reported by API: ${data.totalTokens || 'N/A'}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Error: File 'ascendant_holders.json' not found at ${filePath}`);
      console.log('To generate the file, run:');
      console.log('  curl "http://localhost:3000/api/holders/Ascendant?page=0&pageSize=1000" > ascendant_holders.json');
      console.log('Then re-run this script:');
      console.log('  node scripts/sumTokens.js');
    } else {
      console.error('Failed to process file:', error.message);
    }
  }
}

sumTokens().catch(error => console.error('Script failed:', error.message));