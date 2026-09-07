var hashjs = require('hash.js')

function hash (params) {
  if (params.file && params.file.length) {
    return hashjs[params.method]().update(params.file).digest('hex')
  } else {
    return 'Error. No file selected'
  }
}

module.exports = hash
