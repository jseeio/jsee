const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable, Transform } = require('stream')
const { pipeline } = require('stream/promises')
const { execFileSync } = require('child_process')
const manifest = require('./fixtures/runtime-assets.json')

const assetRoot = path.resolve(__dirname, '../tmp/test-assets')

async function hashFile (filename) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function prepareAssets (group='python') {
  const assets = manifest.assets.filter(asset => group === 'all' || asset.group === group)
  if (!assets.length) throw new Error(`No fixture assets for ${group}`)
  for (const asset of assets) {
    const filename = path.resolve(assetRoot, asset.path)
    if (!filename.startsWith(assetRoot + path.sep)) throw new Error(`Invalid fixture asset path: ${asset.path}`)
    if (fs.existsSync(filename) && await hashFile(filename) === asset.sha256) continue
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    // Only promote complete, verified downloads; large model files stay out of the source tree.
    const partial = filename + '.part'
    const hash = crypto.createHash('sha256')
    let bytes = 0
    try {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(900000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${asset.url}`)
      await pipeline(Readable.fromWeb(response.body), new Transform({
        transform (chunk, encoding, done) {
          bytes += chunk.length
          hash.update(chunk)
          done(null, chunk)
        }
      }), fs.createWriteStream(partial))
      if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) {
        throw new Error(`Fixture asset integrity mismatch: ${asset.path}`)
      }
      fs.renameSync(partial, filename)
      console.log(`Fetched ${asset.path} (${bytes} bytes)`)
    } finally {
      fs.rmSync(partial, { force: true })
    }
  }
  if (group === 'all' || group === 'ml') {
    const app = path.join(__dirname, 'fixtures/real-apps/gpt2')
    const lockHash = await hashFile(path.join(app, 'package-lock.json'))
    const stamp = path.join(assetRoot, 'ml/gpt-dependencies.sha256')
    if (!fs.existsSync(path.join(app, 'node_modules/gpt-tfjs')) ||
        !fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== lockHash) {
      // The historical dependency tree includes native GPU install hooks; browser builds need none.
      execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', app], { stdio: 'inherit' })
      fs.writeFileSync(stamp, lockHash)
    }
    // Use the app's original bundler with the repository's installed toolchain.
    await new Promise((resolve, reject) => {
      const compiler = require('webpack')({
        mode: 'none', target: 'web', entry: path.join(app, 'src/gpt2.js'),
        output: {
          path: path.join(assetRoot, 'ml'), filename: 'gpt2-repaired.js',
          library: { name: 'gpt2', type: 'var', export: 'default' }
        },
        performance: { hints: false }
      })
      compiler.run((error, stats) => {
        compiler.close(closeError => {
          if (error || closeError) return reject(error || closeError)
          if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
          resolve()
        })
      })
    })
  }
  return assetRoot
}

if (require.main === module) {
  prepareAssets(process.argv[2]).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}

module.exports = { prepareAssets, assetRoot }
