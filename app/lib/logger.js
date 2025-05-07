import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

// Use process.cwd() to reference the project root
const logDir = path.join(process.cwd(), 'logs');

console.log(chalk.cyan('[Logger] Initializing logger...'));
console.log(chalk.cyan('[Logger] process.env.DEBUG:'), process.env.DEBUG);
console.log(chalk.cyan('[Logger] process.env.NODE_ENV:'), process.env.NODE_ENV);
console.log(chalk.cyan('[Logger] Log directory:'), logDir);

const isDebug = process.env.DEBUG === 'true';
console.log(chalk.cyan('[Logger] isDebug:'), isDebug);

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
    if (isDebug) {
      try {
        const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
        await fs.appendFile(logFile, `${log}\n`);
        console.log(chalk.cyan('[Logger] Wrote INFO log to:'), logFile);
      } catch (error) {
        console.error(chalk.red('[Logger] Failed to write INFO log:'), error.message);
      }
    }
  },
  warn: async (scope, message, chain = 'eth', collection = 'general') => {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${scope}] [WARN] ${message}`;
    console.log(chalk.yellow(log));
    if (isDebug) {
      try {
        const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
        await fs.appendFile(logFile, `${log}\n`);
        console.log(chalk.cyan('[Logger] Wrote WARN log to:'), logFile);
      } catch (error) {
        console.error(chalk.red('[Logger] Failed to write WARN log:'), error.message);
      }
    }
  },
  error: async (scope, message, details = {}, chain = 'eth', collection = 'general') => {
    const timestamp = new Date().toISOString();
    const log = `[${timestamp}] [${scope}] [ERROR] ${message} ${JSON.stringify(details)}`;
    console.error(chalk.red(log));
    if (isDebug) {
      try {
        const logFile = path.join(logDir, `cache-${chain}-${collection.toLowerCase()}-${timestamp.split('T')[0]}.log`);
        await fs.appendFile(logFile, `${log}\n`);
        console.log(chalk.cyan('[Logger] Wrote ERROR log to:'), logFile);
      } catch (error) {
        console.error(chalk.red('[Logger] Failed to write ERROR log:'), error.message);
      }
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
      console.log(chalk.cyan('[Logger] Wrote DEBUG log to:'), logFile);
    } catch (error) {
      console.error(chalk.red('[Logger] Failed to write DEBUG log:'), error.message);
    }
  },
};

try {
  logger.info('startup', 'Logger module loaded').catch(error => {
    console.error(chalk.red('[Logger] Startup log error:'), error.message);
  });
} catch (error) {
  console.error(chalk.red('[Logger] Immediate log error:'), error.message);
}