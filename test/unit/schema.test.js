const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const Ajv = require('ajv')
const descriptor = require('../../schema.json')
const { validateSchema } = require('../../src/utils')
const contracts = require('../fixtures/input-contracts.json')
const validation = require('../fixtures/input-validation.json')

const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(descriptor)

describe('descriptor authoring schema', () => {
  test('TypeScript and JSON vocabularies agree in both directions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-type-vocabulary-'))
    const source = path.join(directory, 'vocabulary.cts')
    const pairs = [['InputType', 'inputType'], ['ModelType', 'modelType'], ['OutputType', 'outputType']]
    const declarations = path.resolve(__dirname, '../../src/schema')
    const checks = pairs.map(([type, definition]) => {
      return `const ${type}Values = ${JSON.stringify(descriptor.definitions[definition].enum)} as const
const ${type}Equal: [${type}] extends [typeof ${type}Values[number]] ? [typeof ${type}Values[number]] extends [${type}] ? true : false : false = true`
    })
    fs.writeFileSync(source, `import type { InputType, ModelType, OutputType } from ${JSON.stringify(declarations)}\n${checks.join('\n')}\n`)
    try {
      const compilerRoot = path.dirname(require.resolve('typescript/package.json'))
      execFileSync(process.execPath, [path.join(compilerRoot, 'lib/tsc.js'), '--strict', '--noEmit', '--skipLibCheck', '--target', 'ES2020', '--module', 'NodeNext', source], { stdio: 'pipe' })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  test.each(['hash', 'ethgen', 'keygen', 'ulam', 'detect', 'gpt2', 'pytest', 'pysummary'])('accepts the pinned %s descriptor without loading models', name => {
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/real-apps', name, 'schema.json'), 'utf8'))
    expect({ valid: validate(schema), errors: validate.errors }).toEqual({ valid: true, errors: null })
  })

  test.each([...contracts, ...validation])('accepts the supported descriptor in $name', ({ inputs }) => {
    expect({ valid: validate({ inputs }), errors: validate.errors }).toEqual({ valid: true, errors: null })
  })

  test.each([
    ['empty descriptor', {}],
    ['unsupported version', { schemaVersion: 2, inputs: [] }],
    ['non-array inputs', { inputs: {} }],
    ['unnamed value', { inputs: [{ type: 'int' }] }],
    ['missing group elements', { inputs: [{ type: 'group' }] }],
    ['invalid nested type', { inputs: [{ type: 'group', elements: [{ name: 'x', type: 'strnig' }] }] }],
    ['negative step', { inputs: [{ name: 'x', step: -1 }] }],
    ['non-boolean required', { inputs: [{ name: 'x', required: 'yes' }] }],
    ['non-array output groups', { model: {}, outputs: [{ type: 'group', elements: {} }] }],
    ['unknown model type', { model: { type: 'tf' } }],
    ['invalid timeout', { model: { timeout: 0 } }],
    ['invalid security flag', { model: {}, security: { allowNetwork: 'false' } }]
  ])('rejects %s', (_name, schema) => {
    expect(validate(schema)).toBe(false)
  })

  test('permits extension metadata without weakening known fields', () => {
    const schema = { inputs: [{ name: 'x', extension: { color: 'red' } }], extension: { runtime: 'custom' } }
    expect(validate(schema)).toBe(true)
    expect(validate({ ...schema, inputs: [{ name: 'x', required: 'true' }] })).toBe(false)
  })

  test('retains advisory runtime validation for legacy unknown options', () => {
    const schema = { model: { type: 'custom' }, inputs: [{ name: 'x', type: 'custom' }] }
    expect(validate(schema)).toBe(false)
    const report = validateSchema(schema)
    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(2)
  })
})

test.each(require('../fixtures/value-schema.json'))('authoring accepts valueSchema: $name', fixture => {
  expect(validate({ inputs: [{ name: 'info', type: 'object', valueSchema: fixture.schema }] })).toBe(true)
})

test.each([{ $ref: 'remote' }, { type: 'invalid' }, { properties: { x: { pattern: 'x' } } }, { items: [] }])('authoring rejects unsupported valueSchema %j', valueSchema => {
  expect(validate({ inputs: [{ name: 'info', type: 'object', valueSchema }] })).toBe(false)
})

test('renderer selection preserves the declared computation output schema', () => {
  const { jseeOutputsToJsonSchema } = require('../../src/utils')
  const fields = [{ name: 'scores', type: 'table', renderer: 'ranked' }]
  expect(validate({ inputs: [], outputs: fields })).toBe(true)
  expect(jseeOutputsToJsonSchema(fields)).toEqual(jseeOutputsToJsonSchema([{ name: 'scores', type: 'table' }]))
  expect(validate({ inputs: [], outputs: [{ name: 'scores', type: 'table', renderer: 1 }] })).toBe(false)
  expect(validate({ inputs: [], outputs: [{ name: 'scores', type: 'table', renderer: '' }] })).toBe(false)
})
