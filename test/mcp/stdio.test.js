const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { Client } = require('@modelcontextprotocol/client')
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')
const root = path.resolve(__dirname, '../..')
const fixtureRoot = process.env.JSEE_MCP_FIXTURES_ROOT || root
const nodeRoot = process.env.JSEE_MCP_NODE_ROOT || root
const pythonRoot = process.env.JSEE_MCP_PYTHON_ROOT || path.join(root, 'py')
const python = process.env.JSEE_MCP_PYTHON || 'python'
const cases = require('../fixtures/clean-sales.json')
const runFile = promisify(execFile)

function command (runtime, filename, cwd, extra=[]) {
  return { command: runtime === 'node' ? process.execPath : python,
    args: [path.join(runtime === 'node' ? nodeRoot : pythonRoot, 'bin/jsee'), 'serve', filename, '--mcp-only', ...extra],
    env: { ...process.env, PYTHONPATH: pythonRoot, TMPDIR: cwd }, cwd, stderr: 'pipe' }
}

async function connect (parameters, mode='2026-07-28') {
  const transport = new StdioClientTransport(parameters)
  let diagnostics = ''
  transport.stderr.on('data', data => { diagnostics += data })
  const client = new Client({ name: 'independent-client', version: '1.0.0' }, {
    versionNegotiation: { mode: mode === 'legacy' ? 'legacy' : { pin: mode } }
  })
  try { await client.connect(transport, { timeout: 10000 }) } catch (error) { await transport.close(); throw new Error(error.message + '\n' + diagnostics) }
  return { client, diagnostics: () => diagnostics }
}

for (const runtime of ['node', 'python']) {
  for (const mode of ['legacy', '2026-07-28']) {
    test(`Node SDK → ${runtime} server (${mode}): sales, discovery and resource bytes`, { timeout: 30000 }, async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-mcp-test-'))
      const filename = path.join(fixtureRoot, 'examples/clean-sales', runtime === 'node' ? 'schema.json' : 'schema-python.json')
      let client
      try {
        const connection = await connect(command(runtime, filename, directory), mode)
        client = connection.client
        const tools = (await client.listTools()).tools
        assert.equal(tools.length, 1)
        assert.equal(tools[0].name, 'clean_sales')
        assert.deepEqual(tools[0].inputSchema.properties.missing.enum, ['drop', 'error'])
        assert.deepEqual(tools[0].outputSchema.properties.outputs.required, ['summary', 'table', 'cleaned_csv'])
        assert.deepEqual((await client.listResources()).resources, [])
        for (const fixture of cases) {
          const result = await client.callTool({ name: 'clean_sales', arguments: fixture.data })
          const run = JSON.parse(result.content[0].text)
          if (fixture.error) {
            assert.equal(result.isError, true)
            assert.equal(run.error.code, fixture.error)
          } else {
            assert.equal(result.isError, false)
            assert.deepEqual(result.structuredContent, run)
            assert.deepEqual(run.outputs.summary, fixture.summary)
            assert.equal(run.result, undefined)
            const artifact = run.artifacts[0]
            assert.equal(result.content[1].type, 'resource_link')
            assert.equal(result.content[1].uri, artifact.uri)
            const resource = (await client.readResource({ uri: artifact.uri })).contents[0]
            const bytes = Buffer.from(resource.blob, 'base64')
            assert.equal(bytes.toString('utf8'), fixture.csv)
            assert.equal(artifact.size, bytes.length)
            assert.equal(artifact.sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
          }
        }
        assert.equal((await client.listResources()).resources.length, cases.filter(f => !f.error).length)
        await assert.rejects(client.callTool({ name: 'unknown', arguments: {} }), { code: -32602 })
        await assert.rejects(client.readResource({ uri: 'file:///etc/passwd' }), { code: -32602 })
      } finally {
        if (client) await client.close()
        const leftovers = fs.readdirSync(directory).filter(name => name.startsWith('jsee-artifacts-'))
        fs.rmSync(directory, { recursive: true, force: true })
        assert.deepEqual(leftovers, [], 'Session close must remove its artifacts')
      }
    })
    test(`Python SDK → ${runtime} server (${mode})`, { timeout: 30000 }, async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-mcp-cross-'))
      const filename = path.join(fixtureRoot, 'examples/clean-sales', runtime === 'node' ? 'schema.json' : 'schema-python.json')
      const config = command(runtime, filename, directory)
      delete config.stderr
      try {
        const result = await runFile(python, [path.join(__dirname, 'python_client.py'), JSON.stringify({ ...config, mode, fixtures: path.join(root, 'test/fixtures/clean-sales.json') })], { timeout: 25000, maxBuffer: 1024 * 1024 })
        assert.equal(JSON.parse(result.stdout).cases, cases.length)
        assert.deepEqual(fs.readdirSync(directory).filter(name => name.startsWith('jsee-artifacts-')), [])
      } finally { fs.rmSync(directory, { recursive: true, force: true }) }
    })
  }
  test(`${runtime}: artifact quota rejects the complete file batch`, { timeout: 15000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-mcp-quota-'))
    const filename = path.join(fixtureRoot, 'examples/clean-sales', runtime === 'node' ? 'schema.json' : 'schema-python.json')
    let client
    try {
      const connection = await connect(command(runtime, filename, directory, ['--max-artifact-bytes', '1']))
      client = connection.client
      const result = await client.callTool({ name: 'clean_sales', arguments: cases.find(f => !f.error).data })
      assert.equal(result.isError, true)
      assert.equal(result.structuredContent, undefined)
      assert.equal(JSON.parse(result.content[0].text).error.code, 'JSEE_ARTIFACT_LIMIT')
      assert.deepEqual((await client.listResources()).resources, [])
      const store = fs.readdirSync(directory).find(name => name.startsWith('jsee-artifacts-'))
      assert.deepEqual(fs.readdirSync(path.join(directory, store)), [])
    } finally {
      if (client) await client.close()
      const leftovers = fs.readdirSync(directory).filter(name => name.startsWith('jsee-artifacts-'))
      fs.rmSync(directory, { recursive: true, force: true })
      assert.deepEqual(leftovers, [])
    }
  })
  test(`${runtime}: typed outputs, binary files, diagnostics, and artifact containment`, { timeout: 30000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-mcp-values-'))
    const modelName = runtime === 'node' ? 'model.js' : 'model.py'
    fs.writeFileSync(path.join(directory, modelName), runtime === 'node'
      ? 'console.log("import diagnostic"); module.exports = ({n, bad}) => {console.log("run diagnostic"); return {["__proto__"]: bad ? "wrong" : n, file: Buffer.from([0,128,255])}}'
      : 'print("import diagnostic")\ndef compute(n, bad=False):\n    print("run diagnostic")\n    return {"__proto__": "wrong" if bad else n, "file": bytes([0,128,255])}\n')
    const filename = path.join(directory, 'schema.json')
    fs.writeFileSync(filename, JSON.stringify({ id: 'values', model: { url: modelName }, inputs: [{ name: 'n', type: 'int', min: 1 }, { name: 'bad', type: 'bool', default: false }], outputs: [{ name: '__proto__', type: 'number' }, { name: 'file', type: 'file' }] }))
    let client
    try {
      const connection = await connect(command(runtime, filename, directory))
      client = connection.client
      await client.listTools()
      assert.equal(connection.diagnostics(), '')
      const invalidInput = await client.callTool({ name: 'values', arguments: { n: 'wrong' } })
      assert.equal(JSON.parse(invalidInput.content[0].text).error.code, 'JSEE_INPUT_INVALID')
      assert.equal(connection.diagnostics(), '', 'Invalid input must not import the model')
      const invalidOutput = await client.callTool({ name: 'values', arguments: { n: 3, bad: true } })
      assert.equal(JSON.parse(invalidOutput.content[0].text).error.code, 'JSEE_OUTPUT_INVALID')
      assert.deepEqual((await client.listResources()).resources, [])
      const result = await client.callTool({ name: 'values', arguments: { n: 3 } })
      assert.equal(result.structuredContent.outputs.__proto__, 3)
      const artifact = result.structuredContent.artifacts[0]
      assert.deepEqual(Buffer.from((await client.readResource({ uri: artifact.uri })).contents[0].blob, 'base64'), Buffer.from([0, 128, 255]))
      assert.match(connection.diagnostics(), /import diagnostic/)
      assert.match(connection.diagnostics(), /run diagnostic/)
      const storeRoot = path.join(directory, fs.readdirSync(directory).find(name => name.startsWith('jsee-artifacts-')))
      const file = path.join(storeRoot, artifact.id)
      const outside = path.join(directory, 'outside')
      fs.writeFileSync(outside, 'outside-canary')
      fs.unlinkSync(file)
      fs.symlinkSync(outside, file)
      await assert.rejects(client.readResource({ uri: artifact.uri }), /Artifact unavailable/)
      await assert.rejects(client.readResource({ uri: artifact.uri.replace(/\/\d+$/, '/../outside') }))
    } finally {
      if (client) await client.close()
      const leftovers = fs.readdirSync(directory).filter(name => name.startsWith('jsee-artifacts-'))
      fs.rmSync(directory, { recursive: true, force: true })
      assert.deepEqual(leftovers, [])
    }
  })
}

for (const runtime of ['node', 'python']) {
  test(`${runtime}: stdio rejects HTTP-only policy flags`, async () => {
    const config = command(runtime, 'unused.json', os.tmpdir(), ['--auth-token-env', 'JSEE_TEST_MISSING_HOST_TOKEN'])
    await assert.rejects(runFile(config.command, config.args, { env: config.env, cwd: config.cwd, timeout: 10000 }), error => {
      assert.equal(error.code, 1)
      assert.equal(error.stdout, '')
      assert.match(error.stderr, /HTTP host options require/)
      return true
    })
  })
}
