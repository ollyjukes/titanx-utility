import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: 'https://splendid-sunbird-26504.upstash.io',
  token: 'AWeIAAIjcDE5ODI2M2QyMGMzNWU0MmE1YWZmYjRhNTljZmQwMzU0YXAxMA',
})

async function test() {
  try {
    await redis.set('test-key', 'test-value');
    const value = await redis.get('test-key');
    console.log('Success:', value); // Should print "test-value"
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();