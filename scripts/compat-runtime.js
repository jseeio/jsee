// Produce dist/jsee.runtime.js as a backward-compatible alias for jsee.core.js
// with a deprecation warning so existing apps keep working.
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'dist', 'jsee.core.js')
const dest = path.join(__dirname, '..', 'dist', 'jsee.runtime.js')

const code = fs.readFileSync(src, 'utf8')
const warning = 'console.warn("[JSEE] jsee.runtime.js is deprecated and will be removed in a future version. Please use jsee.core.js instead.");\n'

fs.writeFileSync(dest, warning + code)
