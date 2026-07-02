const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

async function getFreePort () {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

async function waitForServer (baseUrl, childState) {
  const deadline = Date.now() + 10000
  let lastError = null
  while (Date.now() < deadline) {
    if (childState.closed) {
      throw new Error(`JSEE API server exited before readiness: code=${childState.code} signal=${childState.signal}\nstdout:\n${childState.stdout}\nstderr:\n${childState.stderr}`)
    }
    try {
      const res = await fetch(baseUrl + '/api')
      if (res.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for JSEE API server${lastError ? ': ' + lastError.message : ''}\nstdout:\n${childState.stdout}\nstderr:\n${childState.stderr}`)
}

async function main () {
  const root = path.resolve(__dirname, '..', '..')
  const appDir = path.join(root, 'tmp', 'probe-api-json-body-limit-app')
  fs.rmSync(appDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  fs.writeFileSync(path.join(appDir, 'model.js'), `
function echoPayload (inputs) {
  return { len: inputs.payload.length }
}
`)
  fs.writeFileSync(path.join(appDir, 'schema.json'), JSON.stringify({
    model: {
      name: 'echoPayload',
      url: 'model.js',
      worker: false
    },
    inputs: [
      { name: 'payload', type: 'text', default: '' }
    ],
    outputs: [
      { name: 'len', type: 'number' }
    ]
  }, null, 2))

  const port = await getFreePort()
  const child = spawn('node', [path.join(root, 'bin', 'jsee'), 'schema.json', '--serve', '--execute', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const childState = {
    closed: false,
    code: null,
    signal: null,
    stdout: '',
    stderr: ''
  }
  child.stdout.on('data', chunk => { childState.stdout += chunk.toString() })
  child.stderr.on('data', chunk => { childState.stderr += chunk.toString() })
  const childClosed = new Promise(resolve => {
    child.once('close', (code, signal) => {
      childState.closed = true
      childState.code = code
      childState.signal = signal
      resolve()
    })
  })
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    await waitForServer(baseUrl, childState)
    const payload = 'x'.repeat(2 * 1024 * 1024)
    const res = await fetch(baseUrl + '/echoPayload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload })
    })
    const text = await res.text()
    assert(res.status === 200, `expected 2MB JSON body to be accepted, got ${res.status}: ${text || childState.stderr}`)
    const body = JSON.parse(text)
    assert(body.len === payload.length, `expected len ${payload.length}, got ${text}`)

    const invalid = await fetch(baseUrl + '/echoPayload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json'
    })
    const invalidText = await invalid.text()
    assert(invalid.status === 400, `expected malformed JSON to return 400, got ${invalid.status}: ${invalidText}`)
    assert((invalid.headers.get('content-type') || '').includes('application/json'), `expected JSON parse error response, got ${invalid.headers.get('content-type')}: ${invalidText}`)
    assert(JSON.parse(invalidText).error, `expected parse error body, got ${invalidText}`)
    fs.writeSync(1, 'probe-api-json-body-limit: ok\n')
  } finally {
    if (!childState.closed) {
      child.kill()
      await childClosed
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
