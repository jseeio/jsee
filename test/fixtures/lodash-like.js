(function (root) {
  function kebabCase (input) {
    if (typeof input !== 'string') {
      return ''
    }
    return input
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
  }

  root._ = root._ || {}
  root._.kebabCase = kebabCase
})(typeof self !== 'undefined' ? self : window)
