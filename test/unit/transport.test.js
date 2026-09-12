const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { once } = require('events')
const { spawnSync } = require('child_process')
const { fileURLToPath } = require('url')
const Ajv = require('ajv')
const gen = require('../../src/cli')
const { ArtifactStore, formatRun, inspectSchema, validateDescriptor } = require('../../src/transport')
const contracts = require('../fixtures/transport-contracts.json')
const sales = require('../fixtures/clean-sales.json')
const root = path.resolve(__dirname, '../..')
const schemaPath = path.join(root, 'examples/clean-sales/schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath))

test.each(contracts)('$name', fixture => {
  const store = new ArtifactStore()
  try {
    const result = formatRun({ outputs: fixture.outputs }, { runId: crypto.randomUUID(), status: 'succeeded', result: fixture.result }, store)
    if (fixture.error) expect(result.error.code).toBe(fixture.error)
    else {
      expect(result).toMatchObject({ status: 'succeeded', outputs: fixture.expected, artifacts: [] })
      const description = inspectSchema({ model: { code: 'function model() {}' }, outputs: fixture.outputs })
      const ajv = new Ajv({ strict: false })
      expect(ajv.compile(description.outputSchema)(result.outputs)).toBe(true)
    }
    expect(fs.readdirSync(store.root)).toEqual([])
  } finally { store.close() }
})

test('artifact bytes, name sanitization, quotas and cleanup', () => {
  const store = new ArtifactStore({ maxBytes: 3, http: true })
  const directory = store.root
  const schema = { outputs: [{ name: 'file', type: 'file' }] }
  try {
    const source = new Uint8Array([0, 1, 255, 2])
    const run = formatRun(schema, { runId: crypto.randomUUID(), status: 'succeeded', result: { file: { content: source.subarray(1, 3), filename: '../unsafe\n.bin' } } }, store)
    expect(run.status).toBe('succeeded')
    const artifact = run.artifacts[0]
    expect(artifact.name).toBe('unsafe_.bin')
    expect(artifact.size).toBe(2)
    expect(fs.readFileSync(store.get(artifact.id).path)).toEqual(Buffer.from([1, 255]))
    const next = formatRun(schema, { runId: crypto.randomUUID(), status: 'succeeded', result: { file: 'ab' } }, store)
    expect(next.error.code).toBe('JSEE_ARTIFACT_LIMIT')
    expect(store.entries.size).toBe(1)
    expect(store.get('../outside')).toBeUndefined()
  } finally { store.close() }
  expect(fs.existsSync(directory)).toBe(false)
})

test('inspection does not load model code, and IDs do not depend on titles', () => {
  const descriptor = { id: 'fixed', title: 'Before', model: { code: 'throw Error("must not execute")' }, inputs: [{ name: 'x', type: 'int', default: 2 }] }
  expect(inspectSchema(descriptor).id).toBe(inspectSchema({ ...descriptor, title: 'After' }).id)
  expect(inspectSchema(descriptor).inputSchema.properties.x.default).toBe(2)
  expect(validateDescriptor({ ...descriptor, inputs: [{ name: 'x', type: 'int', default: 'wrong' }] }).valid).toBe(false)
  expect(validateDescriptor({ ...descriptor, outputs: [{ name: 'x' }, { name: 'x' }] }).valid).toBe(false)
  expect(inspectSchema({ ...descriptor, model: { type: 'py', url: 'missing.py' } }).capabilities.invoke).toBe(false)
})

test('descriptor validation rejects null/false collections and retains prototype output names', () => {
  const descriptor = { model: { code: 'function model(data) { return data }' } }
  for (const field of ['inputs', 'outputs']) {
    for (const value of [null, false, 0, '']) expect(validateDescriptor({ ...descriptor, [field]: value }).valid).toBe(false)
  }
  const report = inspectSchema({ ...descriptor, outputs: [{ name: '__proto__', type: 'file' }] })
  expect(Object.keys(report.outputSchema.properties)).toEqual(['__proto__'])
  expect(JSON.parse(JSON.stringify(report.outputSchema)).properties.__proto__).toHaveProperty('required', ['artifact'])
})

test('inspection rejects malformed discovery metadata', () => {
  for (const key of ['title', 'description']) {
    expect(validateDescriptor({ model: { url: 'model.js' }, [key]: { invalid: true } }).valid).toBe(false)
  }
})

test('JSON CLI uses stdin/files and separates model diagnostics', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-command-'))
  try {
    const execute = (args, input='') => spawnSync(process.execPath, [path.join(root, 'bin/jsee'), ...args], { cwd: directory, input, encoding: 'utf8' })
    for (const fixture of sales) {
      const child = execute(['run', schemaPath, '--input', '-', '--json'], JSON.stringify(fixture.data))
      const run = JSON.parse(child.stdout)
      if (fixture.error) { expect(child.status).not.toBe(0); expect(run.error.code).toBe(fixture.error) }
      else {
        expect(child.status).toBe(0)
        expect(Object.keys(run.outputs)).toEqual(['summary', 'table', 'cleaned_csv'])
        expect(run.outputs.summary).toEqual(fixture.summary)
        expect(fs.readFileSync(fileURLToPath(run.artifacts[0].uri), 'utf8')).toBe(fixture.csv)
      }
    }
    fs.writeFileSync(path.join(directory, 'loud.js'), 'console.log("import diagnostic"); module.exports = data => { console.log("run diagnostic"); return {answer:data.x} }')
    fs.writeFileSync(path.join(directory, 'schema.json'), JSON.stringify({ model: { url: 'loud.js' }, inputs: [{ name: 'x', type: 'int' }], outputs: [{ name: 'answer', type: 'number' }] }))
    fs.writeFileSync(path.join(directory, 'input.json'), '{"x":42}')
    const child = execute(['run', 'schema.json', '--input', 'input.json'])
    expect(JSON.parse(child.stdout).outputs).toEqual({ answer: 42 })
    expect(child.stderr).toContain('import diagnostic')
    expect(child.stderr).toContain('run diagnostic')
    const inspect = execute(['inspect', 'schema.json'])
    expect(JSON.parse(inspect.stdout).capabilities.invoke).toBe(true)
    expect(inspect.stderr).toBe('')
    expect(execute(['validate', 'schema.json']).status).toBe(0)
    expect(execute(['run', 'schema.json'], '{').status).toBe(2)
    expect(JSON.parse(execute(['run', 'schema.json', '--max-body-bytes', '1'], '{}').stdout).error.code).toBe('JSEE_BODY_TOO_LARGE')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('canonical HTTP runs whole sales pipeline, preserves stages and retrieves artifacts', async () => {
  const server = await gen(['serve', schemaPath, '--port', '0', '--max-body-bytes', '2048'])
  if (!server.listening) await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const source = await (await fetch(base + '/schema')).json()
    expect(source.model.map(m => m.url)).toEqual(['model.js', 'model.js', 'model.js'])
    const spec = await (await fetch(base + '/openapi.json')).json()
    expect(spec.paths['/run'].post.requestBody.content['application/json'].schema).toEqual(inspectSchema(schema).inputSchema)
    for (const fixture of sales) {
      const response = await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fixture.data) })
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
      const run = await response.json()
      if (fixture.error) expect(run.error.code).toBe(fixture.error)
      else {
        expect(response.status).toBe(200)
        expect(run.outputs.summary).toEqual(fixture.summary)
        expect(run.result).toBeUndefined()
        const artifact = run.artifacts[0]
        const download = await fetch(base + artifact.uri)
        expect(download.headers.get('content-disposition')).toContain('attachment')
        expect(download.headers.get('x-content-type-options')).toBe('nosniff')
        expect(await download.text()).toBe(fixture.csv)
        expect(artifact.sha256).toBe(crypto.createHash('sha256').update(fixture.csv).digest('hex'))
      }
    }
    expect((await fetch(base + '/')).status).toBe(200)
    const stage = await fetch(base + '/parse_sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sales[0].data) })
    expect((await stage.json()).rows_read).toBe(3)
    for (const [body, type, status] of [['{', 'application/json', 400], ['x', 'text/plain', 415], [' '.repeat(2049), 'application/json', 413]]) {
      expect((await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': type }, body })).status).toBe(status)
    }
    expect((await fetch(base + '/__jsee/artifacts/unknown/0')).status).toBe(404)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('canonical calls share initialized state with legacy stages and enforce file containment', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-state-'))
  const appRoot = path.join(directory, 'app')
  fs.mkdirSync(appRoot)
  const descriptor = path.join(appRoot, 'schema.json')
  fs.writeFileSync(path.join(appRoot, 'counter.js'), 'let count = 0; module.exports = () => ({answer: ++count, file: "inside"})')
  fs.writeFileSync(descriptor, JSON.stringify({ model: { name: 'counter', url: 'counter.js' }, outputs: [{ name: 'answer', type: 'number' }, { name: 'file', type: 'file' }] }))
  let store
  const commit = ArtifactStore.prototype.commit
  const capture = jest.spyOn(ArtifactStore.prototype, 'commit').mockImplementation(function (...args) { store = this; return commit.apply(this, args) })
  let server
  try {
    server = await gen(['serve', descriptor, '--port', '0'])
    if (!server.listening) await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port
    let artifact
    for (const answer of [1, 2]) {
      const run = await (await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
      expect(run.outputs.answer).toBe(answer)
      artifact = run.artifacts[0]
    }
    const stage = await (await fetch(base + '/counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()
    expect(stage.answer).toBe(3)
    const outside = path.join(directory, 'outside.txt')
    fs.writeFileSync(outside, 'outside-canary')
    const storedPath = store.get(artifact.id).path
    fs.unlinkSync(storedPath)
    fs.symlinkSync(outside, storedPath)
    fs.symlinkSync(outside, path.join(appRoot, 'escape.txt'))
    for (const route of [artifact.uri, '/escape.txt', '/__jsee/file?path=escape.txt']) {
      const response = await fetch(base + route)
      expect(response.status).toBe(403)
      expect(await response.text()).not.toContain('outside-canary')
    }
  } finally {
    capture.mockRestore()
    if (server) await new Promise(resolve => server.close(resolve))
    if (store) expect(fs.existsSync(store.root)).toBe(false)
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('canonical serving rejects reserved and inferred duplicate endpoints before loading models', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-conflicts-'))
  const filename = path.join(directory, 'schema.json')
  try {
    fs.writeFileSync(path.join(directory, 'run.js'), 'throw Error("must not load")')
    for (const [model, message] of [[{ name: 'run', url: 'run.js' }, 'Model endpoint /run conflicts'], [{ url: 'run.js' }, 'Model endpoint /run conflicts'], [[{ url: 'missing.js' }, { url: 'missing.js' }], '.name is duplicated']]) {
      fs.writeFileSync(filename, JSON.stringify({ model }))
      await expect(gen(['serve', filename, '--port', '0'])).rejects.toThrow(message)
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
