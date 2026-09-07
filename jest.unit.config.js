// Separate config for unit tests (no browser/puppeteer needed)
const config = {
  verbose: true,
  roots: ['<rootDir>/test/unit'],
  testTimeout: 10000,
  testMatch: ['**/test/unit/**/*.test.js']
}

module.exports = config
