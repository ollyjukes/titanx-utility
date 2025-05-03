// lib/clientLogger.js
export const clientLogger = {
    info: (scope, message, chain = 'eth', collection = 'general') => {
      console.log(`[${new Date().toISOString()}] [${scope}] [INFO] ${message}`);
    },
    warn: (scope, message, chain = 'eth', collection = 'general') => {
      console.warn(`[${new Date().toISOString()}] [${scope}] [WARN] ${message}`);
    },
    error: (scope, message, details = {}, chain = 'eth', collection = 'general') => {
      console.error(`[${new Date().toISOString()}] [${scope}] [ERROR] ${message}`, details);
    },
    debug: (scope, message, chain = 'eth', collection = 'general') => {
      if (process.env.DEBUG === 'true') {
        console.log(`[${new Date().toISOString()}] [${scope}] [DEBUG] ${message}`);
      }
    },
  };