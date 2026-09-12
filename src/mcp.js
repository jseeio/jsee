// MCP only adapts the computation contract; the SDK owns wire framing and negotiation.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const minimist = require('minimist')
const { Server, ProtocolError, ProtocolErrorCode } = require('@modelcontextprotocol/server')
const { serveStdio, StdioServerTransport } = require('@modelcontextprotocol/server/stdio')
const { invokeSchema } = require('./cli')
const { inspectSchema, runResultSchema, ArtifactStore, formatRun, failedRun, BODY_LIMIT, ARTIFACT_LIMIT } = require('./transport')
const version = require('../package.json').version

function resource (artifact) {
  return { uri: artifact.uri, name: artifact.name, mimeType: artifact.mime, size: artifact.size,
    _meta: { 'io.jsee/sha256': artifact.sha256, 'io.jsee/output': artifact.output } }
}

function serve (args, stdout) {
  const argv = minimist(args.slice(1), { boolean: ['mcp-only'], default: { 'max-body-bytes': BODY_LIMIT, 'max-artifact-bytes': ARTIFACT_LIMIT } })
  if (argv._.length !== 1) throw new Error('Usage: jsee serve schema.json --mcp-only')
  const schemaPath = path.resolve(String(argv._[0]))
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  const description = inspectSchema(schema)
  if (!description.capabilities.invoke) throw new Error(description.capabilities.reason)
  const limit = argv['max-body-bytes']
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('max-body-bytes must be a positive integer')
  const store = new ArtifactStore({ maxBytes: argv['max-artifact-bytes'], uriPrefix: 'jsee-artifact://' + crypto.randomUUID() + '/' })
  const cleanup = () => store.close()
  const transport = new StdioServerTransport(process.stdin, stdout, { maxBufferSize: limit })
  const handle = serveStdio(() => {
    const server = new Server({ name: 'jsee', version }, { capabilities: { tools: {}, resources: {} } })
    server.setRequestHandler('tools/list', async () => ({ tools: [{
      name: description.id, title: description.title, description: description.description,
      inputSchema: description.inputSchema, outputSchema: runResultSchema(schema),
      _meta: { 'io.jsee/capabilities': description.capabilities }
    }] }))
    server.setRequestHandler('tools/call', async request => {
      if (request.params.name !== description.id) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown tool: ' + request.params.name)
      const data = request.params.arguments || {}
      const invoked = Buffer.byteLength(JSON.stringify(data)) > limit
        ? failedRun('JSEE_BODY_TOO_LARGE', 'Input exceeds ' + limit + ' bytes')
        : await invokeSchema(schema, data, { schemaPath, log: console.error })
      const run = formatRun(schema, invoked, store)
      const content = [{ type: 'text', text: JSON.stringify(run) }]
      if (run.status !== 'succeeded') return { content, isError: true }
      content.push(...run.artifacts.map(artifact => ({ type: 'resource_link', ...resource(artifact) })))
      return { content, structuredContent: run, isError: false }
    })
    server.setRequestHandler('resources/list', async () => ({ resources: [...store.entries.values()].map(resource) }))
    server.setRequestHandler('resources/read', async request => {
      const uri = request.params.uri
      const id = uri.startsWith(store.uriPrefix) ? uri.slice(store.uriPrefix.length) : ''
      const artifact = store.get(id)
      if (!artifact) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown artifact')
      try {
        // Binary resource contents retain exact bytes; they are sent only on explicit read.
        return { contents: [{ uri, mimeType: artifact.mime, blob: store.read(id).toString('base64') }] }
      } catch (error) { throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Artifact unavailable') }
    })
    server.onclose = cleanup
    return server
  }, { transport, onerror: error => console.error(error.message) })
  process.once('exit', cleanup)
  process.stdin.once('end', cleanup)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => handle.close().finally(cleanup))
  return handle
}

module.exports = { serve }
