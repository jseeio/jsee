module.exports = {
  launch: {
    dumpio: false, // dump browser errors to jest
    headless: process.env.HEADLESS === 'false' ? false : 'new', // Use new headless mode by default
    product: 'chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
  // server: {
  //   command: 'http-server',
  //   port: 8081,
  // },
  browserContext: 'default',
}
