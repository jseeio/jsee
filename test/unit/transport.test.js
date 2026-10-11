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

test.each([
  [undefined, 'undefined'], [() => {}, 'function'], [1n, 'bigint'],
  [Symbol('x'), 'symbol'], [NaN, 'NaN'], [Infinity, 'Infinity'], [-Infinity, '-Infinity'],
  [new Date(0), 'Date'], [Buffer.from([1]), 'bytes'], [new ArrayBuffer(1), 'bytes']
])('output reports the invalid value kind and path (%s)', (value, kind) => {
  const store = new ArtifactStore()
  try {
    const run = formatRun({ outputs: [{ name: 'info', type: 'object' }] },
      { runId: crypto.randomUUID(), status: 'succeeded', result: { info: { rows: [{ 'a.b': value }] } } }, store)
    const hint = kind === 'bytes' ? '; declare binary output as type file' : ''
    expect(run).toMatchObject({ status: 'failed', error: { code: 'JSEE_OUTPUT_INVALID',
      message: 'info.rows[0]["a.b"]: ' + kind + ' is not a JSON value' + hint } })
    expect(store.entries.size).toBe(0)
  } finally { store.close() }
})

test('output rejects cycles and sparse arrays but allows shared JSON values', () => {
  const store = new ArtifactStore()
  const format = info => formatRun({ outputs: [{ name: 'info', type: 'object' }] },
    { runId: crypto.randomUUID(), status: 'succeeded', result: { info } }, store)
  try {
    const shared = { a: null, b: 1 }
    expect(format([shared, shared]).outputs.info).toEqual([shared, shared])
    const cycle = {}; cycle.self = cycle
    expect(format(cycle).error.message).toBe('info.self: circular reference is not a JSON value')
    expect(format(new Array(1)).error.message).toBe('info[0]: undefined is not a JSON value')
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
    fs.writeFileSync(path.join(directory, 'sales.csv'), 'price,quantity\n10,2\n')
    const uploaded = JSON.parse(execute(['artifact-import', 'sales.csv', '--mime', 'text/csv']).stdout)
    const first = JSON.parse(execute(['run', schemaPath], JSON.stringify({ csv: { artifact: uploaded.artifact }, missing: 'drop' })).stdout)
    expect(first.outputs.summary.total_revenue).toBe(20)
    const second = JSON.parse(execute(['run', schemaPath], JSON.stringify({ csv: first.outputs.cleaned_csv, missing: 'drop' })).stdout)
    expect(second.outputs.summary).toEqual(first.outputs.summary)
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
    const uploadResponse = await fetch(base + '/__jsee/artifacts?name=sales.csv', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'price,quantity\n10,2\n' })
    expect(uploadResponse.status).toBe(201)
    const uploaded = await uploadResponse.json()
    expect(uploaded.metadata.name).toBe('sales.csv')
    const call = async csv => (await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, missing: 'drop' }) })).json()
    const first = await call({ artifact: uploaded.artifact })
    expect(first.outputs.summary.total_revenue).toBe(20)
    expect((await call(first.outputs.cleaned_csv)).outputs.summary).toEqual(first.outputs.summary)
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
    fs.writeFileSync(storedPath, 'broken')
    expect((await fetch(base + artifact.uri)).status).toBe(409)
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

test('output handles become text or exact bytes before model execution, including groups and defaults', async () => {
  const store = new ArtifactStore()
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-artifact-input-'))
  const model = path.join(directory, 'model.js')
  fs.writeFileSync(model, 'module.exports = x => ({value: x.group.file instanceof ArrayBuffer ? Array.from(new Uint8Array(x.group.file)) : x.group.file})')
  try {
    const produced = formatRun({ outputs: [{ name: 'file', type: 'file', mime: 'text/csv' }] }, { runId: crypto.randomUUID(), status: 'succeeded', result: { file: 'a,b\n' } }, store)
    const field = { name: 'file', type: 'file', accept: 'text/*', default: produced.outputs.file }
    const descriptor = { model: { url: model }, inputs: [{ name: 'group', type: 'group', elements: [field] }] }
    expect((await gen.invokeSchema(descriptor, { group: {} }, { artifactStore: store })).result.value).toBe('a,b\n')
    field.arrayBuffer = true
    expect((await gen.invokeSchema(descriptor, { group: {} }, { artifactStore: store })).result.value).toEqual([97, 44, 98, 10])
    const ajv = new Ajv({ strict: false })
    expect(ajv.compile(inspectSchema(descriptor).inputSchema)({ group: { file: produced.outputs.file } })).toBe(true)
    field.accept = 'image/*'
    expect((await gen.invokeSchema(descriptor, { group: {} }, { artifactStore: store })).error.code).toBe('JSEE_INPUT_INVALID')
    descriptor.model.url = path.join(directory, 'must-not-import.js')
    expect((await gen.invokeSchema(descriptor, { group: { file: { artifact: 'unknown' } } }, { artifactStore: store })).error.code).toBe('JSEE_INPUT_INVALID')
    expect((await gen.invokeSchema(descriptor, { group: {} })).error.code).toBe('JSEE_INPUT_INVALID')
  } finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('persistent artifact registrations survive reopening and verify bytes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-persistent-artifacts-'))
  try {
    const first = new ArtifactStore({ directory })
    const [artifact] = first.commit(crypto.randomUUID(), [{ bytes: Buffer.from([0, 255, 128]), name: 'test.bin', mime: 'application/octet-stream' }])
    first.close()
    const second = new ArtifactStore({ directory })
    expect(second.read(artifact.id)).toEqual(Buffer.from([0, 255, 128]))
    fs.writeFileSync(second.pathFor(artifact.id), Buffer.from([0, 0, 0]))
    expect(() => second.read(artifact.id)).toThrow(/integrity/i)
    second.close()
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('bounded chunk ingestion publishes only completed uploads and rejects offsets and excess bytes', () => {
  const store = new ArtifactStore({ maxBytes: 5 })
  try {
    const part = store.upload({ data: 'AP8=', offset: 0, name: 'test.bin', mime: 'application/octet-stream' })
    expect(store.entries.size).toBe(0)
    expect(() => store.upload({ upload: part.upload, offset: 0, data: 'gA==' })).toThrow(/offset/)
    const complete = store.upload({ upload: part.upload, offset: 2, data: 'gA==', final: true })
    expect(store.read(complete.artifact)).toEqual(Buffer.from([0, 255, 128]))
    expect(() => store.upload({ data: 'AAAA', final: true })).toThrow(/limit/)
    expect(() => store.upload({ data: '!!!!', final: true })).toThrow(/base64/)
    expect(store.entries.size).toBe(1)
  } finally { store.close() }
})

test.each(require('../fixtures/structured-inputs.json'))('$name input is discoverable and validated consistently', fixture => {
  const { prepareInputs } = require('../../src/schema')
  const inputs = [{ name: 'value', type: fixture.type }]
  const descriptor = { model: { url: 'model.js' }, inputs }
  expect(validateDescriptor(descriptor).valid).toBe(true)
  const valid = new Ajv({ strict: false }).compile(inspectSchema(descriptor).inputSchema)({ value: fixture.value })
  expect(valid).toBe(fixture.valid)
  if (fixture.valid) expect(prepareInputs(inputs, { value: fixture.value }).value).toEqual(fixture.value)
  else expect(() => prepareInputs(inputs, { value: fixture.value })).toThrow()
})

test.each(['image', 'audio', 'video'])('%s bytes are reusable artifacts while URL outputs retain their form', async type => {
  const store = new ArtifactStore()
  try {
    const schema = { outputs: [{ name: 'value', type, mime: type + '/example' }] }
    const result = formatRun(schema, { runId: crypto.randomUUID(), status: 'succeeded', result: { value: Buffer.from([0, 255, 128]) } }, store)
    expect(result.status).toBe('succeeded')
    expect(store.read(result.outputs.value.artifact)).toEqual(Buffer.from([0, 255, 128]))
    const descriptor = { inputs: [{ name: 'value', type }], model: { code: 'function model(x) { return Array.from(new Uint8Array(x.value)) }' } }
    expect((await gen.invokeSchema(descriptor, result.outputs, { artifactStore: store })).result).toEqual([0, 255, 128])
    const url = formatRun(schema, { runId: crypto.randomUUID(), status: 'succeeded', result: { value: 'https://example.test/file' } }, store)
    expect(url.outputs.value).toBe('https://example.test/file')
    expect(url.artifacts).toEqual([])
  } finally { store.close() }
})

test('40 MiB enters through upload and invokes through a small handle, without copying bytes into JSON', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-large-input-'))
  const descriptor = path.join(directory, 'schema.json')
  fs.writeFileSync(path.join(directory, 'model.js'), 'module.exports = ({file}) => ({size:file.byteLength, hash:require("crypto").createHash("sha256").update(Buffer.from(file)).digest("hex")})')
  fs.writeFileSync(descriptor, JSON.stringify({ model: { name: 'measure', url: 'model.js' }, inputs: [{ name: 'file', type: 'file', arrayBuffer: true }], outputs: [{ name: 'size', type: 'int' }, { name: 'hash', type: 'string' }] }))
  const server = await gen(['serve', descriptor, '--port', '0'])
  if (!server.listening) await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const bytes = Buffer.alloc(40 * 1024 * 1024, 255)
    const uploaded = await (await fetch(base + '/__jsee/artifacts?name=data.bin', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).json()
    const body = JSON.stringify({ file: { artifact: uploaded.artifact } })
    expect(Buffer.byteLength(body)).toBeLessThan(100)
    console.info('Artifact input measurement:', JSON.stringify({ uploadBytes: bytes.length, invocationBytes: Buffer.byteLength(body) }))
    const result = await (await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json()
    expect(result.outputs).toEqual({ size: bytes.length, hash: crypto.createHash('sha256').update(bytes).digest('hex') })
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('artifact reads reject invalid encoding, modified bytes, foreign and malformed references before imports', async () => {
  const store = new ArtifactStore()
  try {
    const uploaded = store.ingest(Buffer.from([255]), { mime: 'application/octet-stream' })
    const schema = { model: { url: '/must-not-import.js' }, inputs: [{ name: 'file', type: 'file' }] }
    for (const file of [{ artifact: uploaded.artifact }, { artifact: 'unknown' }, { artifact: 123 }, { artifact: uploaded.artifact, mime: 'text/plain' }]) {
      const result = await gen.invokeSchema(schema, { file }, { artifactStore: store })
      expect(result.error.code).toBe('JSEE_INPUT_INVALID')
    }
    const pending = store.upload({ data: 'AA==' })
    expect(store.pendingBytes).toBe(1)
    expect(store.upload({ upload: pending.upload, cancel: true })).toEqual({ cancelled: true })
    expect(store.pendingBytes).toBe(0)
  } finally { store.close() }
})

test('maximum-size upload chunks, cancellation and failed finalization do not leak quota', () => {
  const store = new ArtifactStore({ maxBytes: 524288 })
  try {
    const bytes = Buffer.alloc(262144, 255)
    const first = store.upload({ data: bytes.toString('base64') })
    const done = store.upload({ upload: first.upload, offset: bytes.length, data: bytes.toString('base64'), final: true })
    expect(store.read(done.artifact)).toEqual(Buffer.concat([bytes, bytes]))
    expect(store.pendingBytes).toBe(0)
    expect(() => store.upload({ data: 'AA==' })).toThrow(/limit/)
  } finally { store.close() }
})

test.each([new Date(), { value: undefined }, [NaN], [() => 1]])('structured input rejects non-JSON runtime values', value => {
  expect(() => require('../../src/schema').prepareInputs([{ name: 'value', type: 'object' }], { value })).toThrow()
})

test('Node and Python share persistent artifact registrations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-artifact-cross-runtime-'))
  try {
    const first = new ArtifactStore({ directory })
    const uploaded = first.ingest(Buffer.from([0, 255, 128]), { name: 'node.bin' })
    const script = 'import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom jsee.transport import ArtifactStore\ns=ArtifactStore(directory=sys.argv[2])\nassert s.read(sys.argv[3]) == bytes([0,255,128])\nprint(json.dumps(s.ingest(bytes([128,255,0]),name="python.bin")))\n'
    const child = spawnSync('python', ['-c', script, path.join(root, 'py'), directory, uploaded.artifact], { encoding: 'utf8' })
    expect(child.status).toBe(0)
    const result = JSON.parse(child.stdout)
    const reopened = new ArtifactStore({ directory })
    expect(reopened.read(result.artifact)).toEqual(Buffer.from([128, 255, 0]))
    expect(reopened.entries.size).toBe(2)
    expect(fs.existsSync(path.join(directory, '.write-lock'))).toBe(false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('concurrent readers never observe an incomplete registration manifest', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-manifest-publication-'))
  const write = fs.writeFileSync
  const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation((filename, data, options) => {
    if (/\/manifest\.(json|pending)$/.test(filename)) {
      write(filename, '[', options)
      expect(new ArtifactStore({ directory }).entries.size).toBe(0)
      write(filename, data, { ...options, flag: 'w' })
    } else write(filename, data, options)
  })
  try {
    const store = new ArtifactStore({ directory })
    store.ingest(Buffer.from('complete'))
    expect(new ArtifactStore({ directory }).entries.size).toBe(1)
  } finally { spy.mockRestore(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test.each(require('../fixtures/value-schema.json'))('valueSchema: $name', fixture => {
  const { prepareInputs } = require('../../src/schema')
  const field = { name: 'info', type: 'object', valueSchema: fixture.schema }
  const schema = { model: { code: 'function model(data) { return data }' }, inputs: [field], outputs: [field] }
  const store = new ArtifactStore()
  try {
    expect(validateDescriptor(schema).valid).toBe(true)
    const description = inspectSchema(schema)
    expect(description.inputSchema.properties.info).toEqual(fixture.schema)
    expect(description.outputSchema.properties.info).toEqual(fixture.schema)
    const accepts = new Ajv({ strict: false }).compile(fixture.schema)
    for (const [values, valid] of [[fixture.valid, true], [fixture.invalid, false]]) {
      for (const info of values) {
        expect(accepts(info)).toBe(valid)
        if (valid) expect(prepareInputs([field], { info })).toEqual({ info })
        else expect(() => prepareInputs([field], { info })).toThrow()
        const run = formatRun(schema, { runId: crypto.randomUUID(), status: 'succeeded', result: { info } }, store)
        expect(run.status).toBe(valid ? 'succeeded' : 'failed')
      }
    }
  } finally { store.close() }
})

test.each([{ $ref: 'https://example.com/schema' }, { type: 'wat' }, { items: [] }, { required: 'x' }, { extra: true }, { properties: { x: { pattern: 'x' } } }, { minimum: '0' }])('reject unsupported valueSchema %j', valueSchema => {
  const field = { name: 'x', type: 'object', valueSchema }
  expect(validateDescriptor({ model: { code: 'function model() {}' }, inputs: [field], outputs: [field] }).valid).toBe(false)
})

test('scores discovery describes rows, independently of display range and format', () => {
  const schema = { model: { code: 'function model() {}' }, outputs: [
    { name: 'predictions', type: 'scores', min: -1, max: 1, format: 'percent', precision: 1 }
  ] }
  expect(inspectSchema(schema).outputSchema.properties.predictions).toEqual({
    type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, score: { type: 'number' } }, required: ['label', 'score'], additionalProperties: true }
  })
})

test.each(require('../fixtures/scores-options.json'))('scores display options %j', fixture => {
  const schema = { model: { code: 'function model() {}' }, outputs: [{ name: 'scores', type: 'scores', ...fixture.options }] }
  expect(validateDescriptor(schema).valid).toBe(fixture.valid)
  expect(require('../../src/utils').validateSchema(schema).errors.length === 0).toBe(fixture.valid)
})

test('scores example runs through the JSON CLI without reordering or scaling', () => {
  const child = spawnSync(process.execPath, [path.join(root, 'bin/jsee'), 'run', path.join(root, 'examples/scores/schema.json'), '--input', '-'], {
    input: JSON.stringify({ alpha: 0.2, beta: 0.9 }), encoding: 'utf8'
  })
  expect(child.status).toBe(0)
  expect(JSON.parse(child.stdout).outputs.scores).toEqual([{ label: 'Alpha', score: 0.2 }, { label: 'Beta', score: 0.9 }])
})
