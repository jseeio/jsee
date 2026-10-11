const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const gen = require('../../src/cli')

const cli = path.resolve(__dirname, '../../bin/jsee')
const optionNames = ['inputs', 'outputs', 'description', 'port', 'version', 'fetch', 'bundle', 'execute', 'cdn', 'runtime', 'serve', 'host', 'verbose', 'run', 'help', 'html', 'client', 'max-body-bytes', 'max-artifact-bytes']

let directory
let schemaPath
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-argv-'))
  schemaPath = path.join(directory, 'schema.json')
  fs.writeFileSync(path.join(directory, 'model.js'), 'module.exports = function multiply ({ a, b }) { return { product: a * b } }')
})
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

function descriptor (inputs) {
  const schema = { model: { url: 'model.js', name: 'multiply' }, inputs, outputs: [{ name: 'product', type: 'number' }] }
  fs.writeFileSync(schemaPath, JSON.stringify(schema))
  return schema
}
async function rendered (args) {
  const html = await gen(args, true)
  return JSON.parse(html.match(/var schemaServer = ([^\n]+)/)[1])
}

test.each(['defaults', 'explicit options'])('CLI %s cannot overwrite any letter or long-option input', async mode => {
  const names = [...'abcdefghijklmnopqrstuvwxyz', ...optionNames]
  const inputs = names.map(name => ({ name, type: 'float', default: 42 }))
  descriptor(inputs)
  const args = ['--inputs', schemaPath, '--runtime', 'inline']
  if (mode === 'explicit options') {
    const description = path.join(directory, 'description.md')
    fs.writeFileSync(description, 'Example')
    args.push('-p', '8791', '-c', 'https://assets.example.test/', '--client',
      '-o', path.join(directory, 'app.html'), '-d', description, '-v', 'dev',
      '--max-body-bytes', '2048', '--max-artifact-bytes', '4096')
  }
  expect((await rendered(args)).inputs).toEqual(inputs)
})

test('canonical serve accepts the same a/b descriptor as validate and run', async () => {
  const { inputs } = descriptor([{ name: 'a', type: 'float', default: 3 }, { name: 'b', type: 'float', default: 4 }])
  expect(JSON.parse(execFileSync(process.execPath, [cli, 'validate', schemaPath], { encoding: 'utf8' }))).toEqual({ valid: true, errors: [], warnings: [] })
  const run = JSON.parse(execFileSync(process.execPath, [cli, 'run', schemaPath], { input: '{}', encoding: 'utf8', cwd: directory }))
  expect(run.outputs.product).toBe(12)
  expect((await rendered(['serve', schemaPath, '--port', '8791', '--runtime', 'inline'])).inputs).toEqual(inputs)
})

test('input aliases cannot consume host options or change their values', async () => {
  descriptor([{ name: 'amount', alias: 'p', type: 'int', default: 2 }, { name: 'port', alias: 'model-port', type: 'int', default: 3 }])
  const html = await gen(['--inputs', schemaPath, '-p', '8791', '--model-port', '9', '--runtime', 'inline'], true)
  const schema = JSON.parse(html.match(/var schemaServer = ([^\n]+)/)[1])
  expect(html).toContain('localhost:8791')
  expect(schema.inputs[0]).toEqual({ name: 'amount', alias: 'p', type: 'int', default: 2 })
  expect(schema.inputs[1].default).toBe(9)
  expect(schema.inputs[1].disabled).toBe(true)
})

test('ordinary named inputs, aliases and explicit false still override and lock only supplied fields', async () => {
  descriptor([
    { name: 'nSamples', alias: ['n', 'count'], type: 'int', default: 1 },
    { name: 'enabled', type: 'bool', default: true },
    { name: 'untouched', type: 'int', default: 2 }
  ])
  const schema = await rendered(['--inputs', schemaPath, '--nSamples', '4', '--no-enabled', '--runtime', 'inline'])
  expect(schema.inputs.map(input => [input.default, input.disabled])).toEqual([[4, true], [false, true], [2, undefined]])
  const alias = await rendered(['--inputs', schemaPath, '--count', '7', '--runtime', 'inline'])
  expect(alias.inputs[0].default).toBe(7)
})

test('unnamed groups share the explicit-input override rules', async () => {
  descriptor([{ type: 'group', elements: [{ name: 'b', type: 'float', default: 4 }, { name: 'x', alias: 'value', type: 'float', default: 2 }] }])
  const schema = await rendered(['--inputs', schemaPath, '--value', '8', '--runtime', 'inline'])
  expect(schema.inputs[0].elements[0]).toEqual({ name: 'b', type: 'float', default: 4 })
  expect(schema.inputs[0].elements[1]).toEqual({ name: 'x', alias: 'value', type: 'float', default: 8, disabled: true })
})

test.each(['positional schema', 'explicit schema', 'attached short option'])('legacy CLI with %s maps positional a/b data independently of CLI flags', mode => {
  descriptor([{ name: 'a', type: 'float', default: 1 }, { name: 'b', type: 'float', default: 2 }])
  const args = mode === 'positional schema' ? [schemaPath] : mode === 'attached short option' ? [`-i${schemaPath}`] : ['--inputs', schemaPath]
  const result = execFileSync(process.execPath, [cli, ...args, '3', '4', '--run'], { encoding: 'utf8', cwd: directory })
  expect(JSON.parse(result)).toBe(12)
})

test('canonical serve accepts positional overrides without consuming its first input', async () => {
  descriptor([{ name: 'a', type: 'float', default: 1 }, { name: 'b', type: 'float', default: 2 }])
  const schema = await rendered(['serve', schemaPath, '3', '4', '--runtime', 'inline'])
  expect(schema.inputs.map(input => [input.default, input.disabled])).toEqual([[3, true], [4, true]])
})


test.each(['canonical', 'legacy'])('%s HTTP uses request inputs rather than internal CLI flags', async mode => {
  descriptor([{ name: 'a', type: 'float', default: 3 }, { name: 'b', type: 'float', default: 4 }])
  const http = require('http')
  const express = require('express')
  let server
  const listen = jest.spyOn(express.application, 'listen').mockImplementation(function () {
    server = http.createServer(this)
    return server.listen(0, '127.0.0.1')
  })
  try {
    await gen(mode === 'canonical' ? ['serve', schemaPath] : ['--inputs', schemaPath, '--serve'])
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${mode === 'canonical' ? 'run' : 'multiply'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 3, b: 8 })
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(mode === 'canonical' ? result.outputs.product : result.product).toBe(24)
  } finally {
    listen.mockRestore()
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  }
})
