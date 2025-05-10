// app/lib/logger.js
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

const logDir = path.join(process.cwd(), 'logs');
const isDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production';

async function ensureLogDir() {
  try {
    await fs.mkdir(logDir, { recursive: true });
    await fs.chmod(logDir, 0o755);
    console.log(chalk.cyan('[Logger] Created or verified log directory:'), logDir);
  } catch (error) {
    console.error(chalk.red('[Logger] Failed to create log directory:'), error.message);
  }
}

ensureLogDir().catch(error => {
  console.error(chalk.red('[Logger] ensureLogDir error:'), error.message);
});

export const logger = {
  info: async (scope, message, chain = 'eth', collection = 'general') => {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${scope}] [INFO] ${message}`;
    console.log(chalk.green(log));
    try {
      const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
      await fs.appendFile(logFile, `${log}\n`);
    } catch (error) {
      console.error(chalk.red('[Logger] Failed to write INFO log:'), error.message);
    }
  },
  warn: async (scope, message, chain = 'eth', collection = 'general') => {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${scope}] [WARN] ${message}`;
    console.log(chalk.yellow(log));
    try {
      const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
      await fs.appendFile(logFile, `${log}\n`);
    } catch (error) {
      console.error(chalk.red('[Logger] Failed to write WARN log:'), error.message);
    }
  },
  error: async (scope, message, details = {}, chain = 'eth', collection = 'general') => {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${scope}] [ERROR] ${message} ${JSON.stringify(details)}`;
    console.error(chalk.red(log));
    try {
      const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
      await fs.appendFile(logFile, `${log}\n`);
    } catch (error) {
      console.error(chalk.red('[Logger] Failed to write ERROR log:'), error.message);
    }
  },
  debug: async (scope, message, chain = 'eth', collection = 'general') => {
    if (!isDebug) return;
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${scope}] [DEBUG] ${message}`;
    console.log(chalk.blue(log));
    try {
      const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
      await fs.appendFile(logFile, `${log}\n`);
    } catch (error) {
      console.error(chalk.red('[Logger] Failed to write DEBUG log:'), error.message);
    }
  },
};

logger.info('startup', 'Logger module loaded').catch(error => {
  console.error(chalk.red('[Logger] Startup log error:'), error.message);
});