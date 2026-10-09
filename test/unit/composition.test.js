const { Pipeline, validatePipeline, runPipeline } = require('../../src/pipeline')
const { prepareStageInputs } = require('../../src/pipeline-data')
const { invokeSchema } = require('../../src/cli')
const { inspectSchema, ArtifactStore, formatRun } = require('../../src/transport')
const schema = () => ({
  inputs: ['source', 'left', 'right'].map(name => ({ type: 'group', name, elements: [{ name: 'x', type: 'int', default: 1 }] })),
  outputs: ['source', 'left', 'right'].map(name => ({ name: name + '.value', type: 'number' })),
  model: ['source', 'left', 'right'].map(id => ({ id, scope: id, code: 'input => ({value:input.x+1})',
    ...(id !== 'source' ? { bindings: { x: { stage: 'source', path: ['value'] } } } : {}) }))
})
const runtime = (doc=schema(), execute=async (_, input) => ({ value: input.x + 1 })) => new Pipeline(doc, doc.model.map(stage => input => execute(stage.id, input)))
const single = (id, inputs, code, outputs) => ({ inputs: [{ type: 'group', name: id, elements: inputs }],
  model: [{ id, scope: id, type: 'async-function', code }], outputs: outputs.map(output => ({ ...output, name: id + '.' + output.name })) })

test('named stages preserve repeated ports, branches and selected ancestor closure', async () => {
  const calls = [], app = runtime(schema(), async (id, input) => { calls.push(id); return { value: input.x + 1 } })
  expect(await app.run({ source: { x: 3 } }, { target: 'left' })).toEqual({ 'source.value': 4, 'left.value': 5 })
  await app.run({ source: { x: 3 } }, { target: 'right' })
  expect(calls).toEqual(['source', 'left', 'right'])
  await app.run({ source: { x: 5 } }, { target: 'right' })
  expect(calls).toEqual(['source', 'left', 'right', 'source', 'right'])
  expect(app.describe('left').status).toBe('stale')
})

test('default Run reuses every current stage; explicit rerun invalidates descendants', async () => {
  const calls = jest.fn(async (_, input) => ({ value: input.x + 1 })), app = runtime(schema(), calls)
  await app.run({}); await app.run({})
  expect(calls).toHaveBeenCalledTimes(3)
  await app.run({}, { target: 'source', force: true })
  expect(app.describe('left').status).toBe('stale')
  await app.run({}, { force: true })
  expect(calls).toHaveBeenCalledTimes(7)
})

test('cycles, duplicate ids, missing sources and disabled ancestors fail before execution', async () => {
  const cyclic = schema(); cyclic.model[0].bindings = { x: { stage: 'left', path: ['value'] } }
  expect(() => validatePipeline(cyclic)).toThrow('cycle')
  const duplicate = schema(); duplicate.model[1].id = 'source'
  expect(() => validatePipeline(duplicate)).toThrow('unique')
  const missing = schema(); missing.model[1].bindings.x.stage = 'missing'
  expect(() => validatePipeline(missing)).toThrow('missing source')
  const disabled = schema(); disabled.model[0].enabled = false
  const execute = jest.fn(), app = runtime(disabled, execute)
  await expect(app.run({}, { target: 'left' })).rejects.toThrow('Enable stage source')
  expect(execute).not.toHaveBeenCalled()
})

test('file envelopes use the receiver text/raw/stream contract', async () => {
  const blob = new Blob(['x,y\n1,2']), value = { content: blob, filename: 'a.csv', mime: 'text/csv' }
  expect((await prepareStageInputs({ inputs: [{ name: 'file', type: 'file' }] }, { file: value })).file).toBe('x,y\n1,2')
  expect((await prepareStageInputs({ inputs: [{ name: 'file', type: 'file', stream: true }] }, { file: value })).file).toBe(blob)
  expect((await prepareStageInputs({ inputs: [{ name: 'file', type: 'file', raw: true }] }, { file: value })).file).toBe(blob)
})

test('transient overrides reuse ancestors and do not replace a trained result', async () => {
  const calls = [], app = runtime(schema(), async (id, input) => { calls.push([id, input.x]); return { value: input.x + 1 } })
  await app.run({}, { target: 'left' })
  await app.run({}, { target: 'left', transient: true, overrides: { x: 100 } })
  expect(calls).toEqual([['source', 1], ['left', 2], ['left', 100]])
  expect(app.describe('left').result).toEqual({ x: 2, value: 3 })
  expect(app.describe('left').status).toBe('current')
})

test('cancellation cannot publish a late result or run descendants', async () => {
  let finish
  const execute = jest.fn(() => new Promise(resolve => { finish = resolve })), app = runtime(schema(), execute)
  const result = app.run({}, { target: 'left' })
  await new Promise(resolve => setImmediate(resolve))
  app.cancel(); finish({ value: 2 })
  await expect(result).rejects.toThrow('cancelled')
  expect(app.describe('source').result).toBeUndefined()
  expect(execute).toHaveBeenCalledTimes(1)
})

test('retained results use bounded digests and reject changed code or bindings', async () => {
  const doc = schema(); doc.model[0].code += ' '.repeat(100000)
  const execute = jest.fn(async (_, input) => ({ value: input.x })), original = runtime(doc, execute)
  await original.run({}, { target: 'left' })
  const saved = original.snapshot()
  expect(saved.stages.source.definition).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(saved).length).toBeLessThan(2000)
  const restored = runtime(doc, execute); restored.restore(saved)
  await restored.run({}, { target: 'right' })
  expect(execute).toHaveBeenCalledTimes(3)
  doc.model[0].code = 'input => ({value:0})'
  const changed = runtime(doc, execute); changed.restore(saved); changed.refresh({})
  expect(changed.describe('source').status).toBe('idle')
  expect(changed.describe('left').status).toBe('stale')
})

test('legacy lists retain record merge, binary replacement and stop', async () => {
  expect(await runPipeline([x => ({ a: x.x + 1 }), x => ({ value: x.a * 2 })], { x: 2 })).toEqual({ x: 2, a: 3, value: 6 })
  const never = jest.fn()
  expect(await runPipeline([() => ({ stop: true }), never], { x: 2 })).toEqual({ x: 2, stop: true })
  expect(never).not.toHaveBeenCalled()
  expect(await runPipeline([() => [1,2], x => x.map(n => n * 2)], {})).toEqual([2,4])
})

test('an internal from chain stops without suppressing an independent branch', async () => {
  const doc = schema(); doc.model[1].from = 'source'; delete doc.model[1].bindings
  const calls = [], app = runtime(doc, async (id, input) => { calls.push(id); return { value: input.x, ...(id === 'source' ? { stop: true } : {}) } })
  await app.run({})
  expect(calls).toEqual(['source', 'right'])
  expect(app.describe('left').result.stop).toBe(true)
})

test('Node canonical invocation executes flat stages and advertises scoped ports', async () => {
  const doc = require('../fixtures/composition.json'), description = inspectSchema(doc)
  expect(description.capabilities.invoke).toBe(true)
  expect(description.inputSchema.properties.source.properties.count).toBeDefined()
  const run = await invokeSchema(doc, { source: { count: 4 }, left: { scale: 3 } })
  expect(run.status).toBe('succeeded')
  expect(run.result['left.value']).toBe(30)
  expect(run.result['right.value']).toBe(4)
})

test('restoration compares file bytes once and ignores presentation changes', async () => {
  const doc = single('a', [{ name: 'file', type: 'file', raw: true }], 'x=>x', [{ name: 'size', type: 'number' }])
  const original = runtime(doc, async (_, values) => ({ size: values.file.size }))
  await original.run({ a: { file: new Blob(['old']) } })
  doc.inputs[0].label = 'Renamed'
  const restored = runtime(doc, jest.fn()); restored.restore(original.snapshot())
  await restored.reconcile({ a: { file: new Blob(['old']) } })
  expect(restored.describe('a').status).toBe('current')
  await restored.reconcile({ a: { file: new Blob(['new']) } })
  expect(restored.describe('a').status).toBe('stale')
})

test('canonical output materializes Blob files and permits optional outputs', async () => {
  const doc = single('download', [], "() => ({file:{content:new Blob(['exact bytes']),filename:'data.txt',mime:'text/plain'}})", [{ name: 'file', type: 'file' }, { name: 'optional', type: 'string', required: false }])
  const store = new ArtifactStore()
  try { const run = formatRun(doc, await invokeSchema(doc, {}), store); expect(run.status).toBe('succeeded'); expect(run.artifacts[0].size).toBe(11) }
  finally { store.close() }
})

test('portable file defaults preserve bytes and filenames, including Node without global File', async () => {
  const doc = single('load', [{ name: 'source', type: 'file', raw: true, default: { encoding: 'base64', content: btoa('x\n1'), filename: 'data.csv', mime: 'text/csv' } }],
    'async input => ({name:input.source.name,text:await input.source.text()})', [{ name: 'name', type: 'string' }, { name: 'text', type: 'string' }])
  expect(inspectSchema(doc).capabilities.invoke).toBe(true)
  const run = await invokeSchema(doc, {})
  expect(run.status).toBe('succeeded')
  expect(run.result).toEqual({ 'load.name': 'data.csv', 'load.text': 'x\n1' })
})

test('one declared port accepts an atomic array result', async () => {
  const doc = single('one', [], '() => [1,2]', [{ name: 'rows', type: 'table' }])
  expect(await runtime(doc, async () => [1,2]).run({})).toEqual({ 'one.rows': [1,2] })
})

test('invalid retained state is rejected before replacing stages', async () => {
  const app = runtime(); await app.run({}); const saved = app.snapshot()
  delete saved.stages.left.dependencies
  expect(() => app.restore(saved)).toThrow('Invalid stage state')
  expect(app.describe('left').status).toBe('current')
})

test('canonical table outputs accept the matrix rendered by JSEE', async () => {
  const doc = single('one', [], '() => ({table:[["name","score"],["linear",1.2]]})', [{ name: 'table', type: 'table' }]), store = new ArtifactStore()
  try { expect(formatRun(doc, await invokeSchema(doc, {}), store).status).toBe('succeeded') } finally { store.close() }
})

test('browser render stages are nonpersistent and omitted from headless runs', async () => {
  const doc = schema(); doc.model.push({ id: 'view', from: 'left', render: true, type: 'function', code: '() => document.body' })
  const calls = [], app = new Pipeline(doc, doc.model.map(model => async input => { calls.push(model.id); return { value: input.x, render: () => {} } }))
  await app.run({}, { target: 'left' })
  expect(calls).toEqual(['source','left','view'])
  expect(app.snapshot().stages.view).toBeUndefined()
  expect(inspectSchema(doc).capabilities.invoke).toBe(true)
  const headless = await invokeSchema(doc, {})
  expect(headless.status).toBe('succeeded')
})

test('SHA-256 cache identity matches the Node implementation for padding and UTF-8', () => {
  const { fingerprint } = require('../../src/fingerprint'), { createHash } = require('crypto')
  for (const text of ['', 'abc', 'é😀', ...[55,56,63,64,65,1000000].map(n => 'a'.repeat(n))]) expect(fingerprint(text)).toBe(createHash('sha256').update(text).digest('hex'))
})

test('pinned remote stages verify code and imports before execution, respecting network policy', async () => {
  const { createServer } = require('http'), { createHash } = require('crypto')
  const source = 'input => ({value:input.x+1})', hash = createHash('sha256').update(source).digest('hex')
  const server = createServer((req, res) => res.end(source))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const doc = single('one', [{ name: 'x', type: 'int', default: 2 }], source, [{ name: 'value', type: 'number' }])
    delete doc.model[0].code
    doc.model[0].url = `http://127.0.0.1:${server.address().port}/model.js`
    doc.model[0].sha256 = hash
    expect((await invokeSchema(doc, {})).result).toEqual({ 'one.value': 3 })
    doc.model[0].sha256 = '0'.repeat(64)
    expect((await invokeSchema(doc, {})).error.message).toContain('SHA-256 mismatch')
    doc.model[0].sha256 = hash
    doc.security = { allowNetwork: false }
    expect((await invokeSchema(doc, {})).error.message).toContain('allowNetwork is false')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('disabled stages retain cached state but omit their public outputs', async () => {
  const doc = schema(), original = runtime(doc)
  await original.run({})
  doc.model[1].enabled = false
  const disabled = runtime(doc); disabled.restore(original.snapshot())
  const result = await disabled.run({})
  expect(result['left.value']).toBeUndefined()
  expect(disabled.describe('left').status).toBe('current')
})

test('restoring the original inputs revalidates cached results without executing', async () => {
  const execute = jest.fn(async (_, input) => ({ value: input.x })), app = runtime(schema(), execute)
  await app.run({ source: { x: 3 } })
  app.refresh({ source: { x: 4 } })
  expect(app.describe('left').status).toBe('stale')
  app.refresh({ source: { x: 3 } })
  expect(app.describe('source').status).toBe('current')
  expect(app.describe('left').status).toBe('current')
  await app.run({ source: { x: 3 } })
  expect(execute).toHaveBeenCalledTimes(3)
})
