var ethers = require('ethers');
var crypto = require('crypto');

module.exports = function ethgen (_, log) {
  var id = crypto.randomBytes(32).toString('hex');
  var privateKey = "0x"+id;
  var wallet = new ethers.Wallet(privateKey);

  return {
    'Address': wallet.address,
    'Private key': privateKey
  }
}
