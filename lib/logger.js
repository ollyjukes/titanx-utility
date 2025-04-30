// lib/logger.js
import fs from 'fs/promises';
import path from 'path';

const isDebug = process.env.DEBUG === 'true';
const logDir = path.join(process.cwd(), 'logs');

export const logger = {
  info: async (scope, message) => {
    const log = `[${scope}] [INFO] ${message}`;
    console.log(log);
    if (isDebug) {
      await fs.appendFile(
        path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`),
        `${new Date().toISOString()} ${log}\n`
      );
    }
  },
  error: async (scope, message, details = {}) => {
    const log = `[${scope}] [ERROR] ${message} ${JSON.stringify(details)}`;
    console.error(log);
    if (isDebug) {
      await fs.appendFile(
        path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`),
        `${new Date().toISOString()} ${log}\n`
      );
    }
  },
  debug: async (scope, message) => {
    if (!isDebug) return;
    const log = `[${scope}] [DEBUG] ${message}`;
    console.log(log);
    await fs.appendFile(
      path.join(logDir, `app-${new Date().toISOString().split('T')[0]}.log`),
      `${new Date().toISOString()} ${log}\n`
    );
  },
};