// jest.config.js
export default {
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transform: { '^.+\\.(js|mjs)$': 'babel-jest' },
  transformIgnorePatterns: [
    '/node_modules/(?!(@upstash/redis|viem|alchemy-sdk|node-cache|p-limit|chalk|node-fetch|ansi-styles|supports-color|strip-ansi|has-flag)/)',
  ],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testPathIgnorePatterns: ['/tests/e2e/frontend.test.js'],
};