const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.pw.js',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8484',
    headless: process.env.HEADLESS !== 'false'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } }
  ],
  webServer: {
    command: 'npx http-server -p 8484 --silent',
    port: 8484,
    reuseExistingServer: true
  }
})
