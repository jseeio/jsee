const fs = require('fs')
const path = require('path')
const { invokeSchema } = require('../../src/cli')
const contracts = require('../fixtures/invocation-contracts.json')

test.each(contracts)('$name', async fixture => {
  const schema = {
    inputs: fixture.inputs || [],
    model: fixture.steps.map(step => ({ name: 'step', code: step.js, container: step.container }))
  }
  const before = JSON.stringify({ schema, data: fixture.data })
  const result = await invokeSchema(schema, fixture.data)
  expect(result.runId).toMatch(/^[0-9a-f-]{36}$/)
  if (fixture.error) {
    expect(result).toEqual({ runId: result.runId, status: 'failed', error: { code: fixture.error, message: expect.any(String) } })
    if (fixture.message) expect(result.error.message).toBe(fixture.message)
  } else expect(result).toEqual({ runId: result.runId, status: 'succeeded', result: fixture.result })
  expect(JSON.stringify({ schema, data: fixture.data })).toBe(before)
})

test('single models and concurrent invocations have distinct run identities', async () => {
  const schema = { model: { name: 'step', code: 'async function step(data) { return data.value }' } }
  const results = await Promise.all([invokeSchema(schema, { value: 1 }), invokeSchema(schema, { value: 2 })])
  expect(results.map(r => r.result)).toEqual([1, 2])
  expect(results[0].runId).not.toBe(results[1].runId)
})

test('empty import declarations need no import capability', async () => {
  const schema = { imports: [], model: { imports: [], code: data => data } }
  expect(await invokeSchema(schema, { value: 1 })).toMatchObject({ status: 'succeeded', result: { value: 1 } })
})

test.each([null, { model: [] }, { model: null }, { schemaVersion: 2, model: {} }, { model: {}, inputs: {} }])('rejects an invalid invocation descriptor: %p', async schema => {
  expect(await invokeSchema(schema, {})).toMatchObject({ status: 'failed', error: { code: 'JSEE_SCHEMA_INVALID' } })
})

test.each([{ type: 'py', url: 'model.py' }, { type: 'get', url: 'https://example.com' }, { stream: true }])('preflights every stage before loading any: %p', async unsupported => {
  const initialize = jest.fn(() => { throw Error('must not initialize') })
  const result = await invokeSchema({ model: [{ code: initialize, type: 'async-init' }, unsupported] }, {})
  expect(result).toMatchObject({ status: 'failed', error: { code: 'JSEE_CAPABILITY_UNSUPPORTED' } })
  expect(initialize).not.toHaveBeenCalled()
})

test('clean_sales agrees with shared native Python cases', async () => {
  const schemaPath = path.resolve(__dirname, '../../examples/clean-sales/schema.json')
  const schema = JSON.parse(fs.readFileSync(schemaPath))
  for (const fixture of require('../fixtures/clean-sales.json')) {
    const result = await invokeSchema(schema, fixture.data, { schemaPath })
    if (fixture.error) expect(result).toMatchObject({ status: 'failed', error: { code: fixture.error } })
    else {
      expect(result.status).toBe('succeeded')
      expect(result.result.summary).toEqual(fixture.summary)
      expect(result.result.cleaned_csv).toEqual({ filename: 'cleaned-sales.csv', mime: 'text/csv', content: fixture.csv })
    }
  }
})
