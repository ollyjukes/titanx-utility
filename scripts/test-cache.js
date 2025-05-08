// test-cache.mjs
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

async function testCache() {
  const cacheDir = join(process.cwd(), 'cache');
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'test.json'), JSON.stringify({ test: 'ok' }));
    console.log('Test file written to cache/test.json');
  } catch (error) {
    console.error('Failed to write test file:', error.message, error.stack);
  }
}

testCache();