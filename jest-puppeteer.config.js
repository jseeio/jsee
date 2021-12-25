module.exports = {
  launch: {
    dumpio: false, // dump browser errors to jest
    headless: process.env.HEADLESS !== 'false',
    product: 'chrome',
  },
  // server: {
  //   command: 'http-server',
  //   port: 8081,
  // },
  browserContext: 'default',
}
