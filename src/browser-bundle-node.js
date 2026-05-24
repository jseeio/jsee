'use strict'

function browserBundleOnly () {
  throw new Error('@jseeio/jsee browser bundles require a browser DOM. Use require("@jseeio/jsee") for the Node CLI/API, or load dist/jsee.core.js / dist/jsee.full.js in a browser.')
}

browserBundleOnly.browserOnly = true

module.exports = browserBundleOnly
