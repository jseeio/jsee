const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..', '..')
const probes = [
  'doc-runtime-surface.js',
  'release-fuzz.js',
  'npm-pack-hygiene.js',
  'api-json-body-limit.js',
  'log-dom-xss.js'
]

for (const probe of probes) {
  const probePath = path.join(__dirname, probe)
  console.log(`[probe] node ${path.relative(root, probePath)}`)
  const result = spawnSync(process.execPath, [probePath], {
    cwd: root,
    stdio: 'inherit'
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}
