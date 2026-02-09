module.exports = {
  launch: {
    dumpio: false, // dump browser errors to jest
    headless: process.env.HEADLESS === 'false' ? false : 'new', // Use new headless mode by default
    product: 'chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  server: {
    command: 'npx http-server -p 8484 --silent',
    port: 8484,
    launchTimeout: 10000,
  },
  browserContext: 'default',
}
