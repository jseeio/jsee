const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './test',
  testMatch: '**/*.pw.js',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8484',
    headless: process.env.HEADLESS !== 'false',
    launchOptions: process.env.JSEE_TEST_NO_GPU === '1'
      ? { args: ['--disable-gpu', '--disable-webgl', '--disable-features=WebGPU'] }
      : {}
  },
  projects: [
    { name: process.env.JSEE_TEST_BROWSER || 'chromium', use: { browserName: process.env.JSEE_TEST_BROWSER || 'chromium' } }
  ],
  webServer: {
    command: 'npx http-server -p 8484 --silent --cors',
    port: 8484,
    reuseExistingServer: true
  }
})
