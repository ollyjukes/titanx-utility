// clear-redis.js
import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local explicitly
dotenv.config({ path: path.resolve(__dirname, '.env.local') });

// Validate environment variables
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!redisUrl || !redisToken) {
  console.error('Error: Missing Upstash Redis credentials.');
  console.error('Ensure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set in .env.local.');
  console.error('Expected .env.local contents:');
  console.error('UPSTASH_REDIS_REST_URL=https://splendid-sunbird-26504.upstash.io');
  console.error('UPSTASH_REDIS_REST_TOKEN=AWeIAAIjcDE5ODI2M2QyMGMzNWU0MmE1YWZmYjRhNTljZmQwMzU0YXAxMA');
  console.error('Verify these in the Upstash console: https://console.upstash.com/redis/splendid-sunbird-26504');
  process.exit(1);
}

console.log('Connecting to Upstash Redis:', redisUrl.replace(/\/[^/]+$/, '/<redacted>'));

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

async function clearRedis() {
  try {
    // Delete holders cache
    await redis.del('element280_element280_holders');
    console.log('Deleted element280_element280_holders');
    // Delete cache state
    await redis.del('element280_element280_cache_state');
    console.log('Deleted element280_element280_cache_state');
    // Delete all event caches
    const eventKeys = await redis.keys('element280_events_*');
    if (eventKeys.length > 0) {
      await redis.del(...eventKeys);
      console.log(`Deleted ${eventKeys.length} event keys (element280_events_*)`);
    } else {
      console.log('No element280_events_* keys found');
    }
    console.log('Redis cache cleared for element280');
  } catch (error) {
    console.error('Failed to clear Redis cache:', error.message);
    console.error('Stack:', error.stack);
    console.error('Check your Upstash Redis credentials and network connectivity.');
    console.error('Verify URL and token in the Upstash console: https://console.upstash.com/redis/splendid-sunbird-26504');
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

clearRedis();