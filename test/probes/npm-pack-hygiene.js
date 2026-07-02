const { execFileSync } = require('child_process')

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
})
const pack = JSON.parse(output)[0]
const files = pack.files.map(file => file.path)

const required = [
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'package.json',
  'bin/jsee',
  'dist/jsee.core.js',
  'dist/jsee.full.js',
  'dist/jsee.runtime.js',
  'src/cli.js',
  'src/browser-bundle-node.js'
]

required.forEach(file => {
  assert(files.includes(file), `npm package is missing ${file}`)
})

const forbiddenPrefixes = [
  'tmp/',
  'test/',
  'test-results/',
  'apps/',
  'py/',
  '.claude/',
  'node_modules/'
]

files.forEach(file => {
  assert(!forbiddenPrefixes.some(prefix => file.startsWith(prefix)), `npm package includes ${file}`)
  assert(!/^PLAN/.test(file), `npm package includes plan file ${file}`)
  assert(!/^MEMORY/.test(file), `npm package includes memory file ${file}`)
})

const coreBundle = pack.files.find(file => file.path === 'dist/jsee.core.js')
const hasDevBundle = coreBundle && coreBundle.size > 1000000
const maxPackedSize = hasDevBundle ? 5000000 : 1500000
const maxUnpackedSize = hasDevBundle ? 15000000 : 5000000

assert(pack.size < maxPackedSize, `npm package tarball is unexpectedly large: ${pack.size}`)
assert(pack.unpackedSize < maxUnpackedSize, `npm package unpacked size is unexpectedly large: ${pack.unpackedSize}`)

console.log(`probe-npm-pack-hygiene: ok ${pack.entryCount} files ${pack.size} bytes${hasDevBundle ? ' (dev bundle)' : ''}`)
