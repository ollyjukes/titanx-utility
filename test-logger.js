import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDir = path.join(__dirname, '../logs');

async function testLogger() {
  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.chmod(logDir, 0o755);
    console.log('Created log directory:', logDir);

    const logFile = path.join(logDir, `test-${new Date().toISOString().split('T')[0]}.log`);
    await fs.appendFile(logFile, 'Test log entry\n');
    console.log('Wrote to log file:', logFile);

    await fs.chmod(logFile, 0o644);
    console.log('Set file permissions for:', logFile);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLogger();