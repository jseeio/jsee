const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { Client } = require('@modelcontextprotocol/client')
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')

test('MCP invokes the same scoped branch schema and exposes its file artifact', { timeout: 30000 }, async () => {
  const root = path.resolve(__dirname, '../..')
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(root, 'bin/jsee'), 'serve', path.join(root, 'test/fixtures/composition.json'), '--mcp-only'], stderr: 'pipe' })
  const client = new Client({ name: 'composition-client', version: '1.0.0' })
  try {
    await client.connect(transport)
    const tools = await client.listTools()
    const tool = tools.tools.find(tool => tool.name !== 'upload_artifact')
    assert.ok(tool.inputSchema.properties.source)
    const response = await client.callTool({ name: tool.name, arguments: { source: { count: 4 }, left: { scale: 3 } } })
    assert.equal(response.isError, false)
    assert.equal(response.structuredContent.outputs['left.value'], 30)
    assert.equal(response.structuredContent.outputs['right.value'], 4)
    const file = response.structuredContent.artifacts[0]
    const resource = await client.readResource({ uri: file.uri })
    assert.equal(Buffer.from(resource.contents[0].blob, 'base64').toString(), 'x\n1\n2\n3\n4')
  } finally { await client.close() }
})

test('canonical HTTP hosts the complete composition without creating unnamed legacy endpoints', { timeout: 30000 }, async () => {
  const net = require('node:net')
  const { spawn } = require('node:child_process')
  const { once } = require('node:events')
  const socket = net.createServer()
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const root = path.resolve(__dirname, '../..')
  const child = spawn(process.execPath, [path.join(root, 'bin/jsee'), 'serve', path.join(root, 'test/fixtures/composition.json'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let diagnostics = ''
  child.stdout.on('data', data => { diagnostics += data })
  child.stderr.on('data', data => { diagnostics += data })
  try {
    let ready
    for (let attempt = 0; attempt < 100; attempt++) {
      try { ready = await fetch(`http://127.0.0.1:${port}/schema`); if (ready.ok) break } catch {}
      assert.equal(child.exitCode, null, diagnostics)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(ready?.ok, diagnostics)
    const response = await fetch(`http://127.0.0.1:${port}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: { count: 4 }, left: { scale: 3 } }) })
    const run = await response.json()
    assert.equal(run.status, 'succeeded', JSON.stringify(run))
    assert.equal(run.outputs['left.value'], 30)
    assert.equal(run.outputs['right.value'], 4)
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
  }
})
