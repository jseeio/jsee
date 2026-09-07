const fs = require('fs')
const path = require('path')
const vm = require('vm')

test('GPT-2 uses its declared dependency and forwards the requested token limit', async () => {
  const filename = path.join(__dirname, '../fixtures/real-apps/gpt2/src/gpt2.js')
  const source = fs.readFileSync(filename, 'utf8')
    .replace("import h5wasm from 'h5wasm'", "const h5wasm = require('h5wasm')")
    .replace('export default gpt2', 'module.exports = gpt2')
  const imports = []
  let options
  const context = {
    console: { log: () => {} }, module: { exports: {} },
    window: { panel: { span: {} }, stats: {}, gpt2model: {} },
    require: name => {
      imports.push(name)
      if (name === 'gpt-tokenizer') return { encode: () => [1], decode: () => 'generated' }
      if (name.endsWith('gpt-tfjs')) return { model: {
        generate: async (model, tokens, maxNewTokens, temperature, doSample) => {
          options = { maxNewTokens, temperature, doSample }
          return { array: async () => [[1, 2]] }
        }
      } }
      if (name === 'h5wasm') return { ready: Promise.resolve({ FS: {} }) }
      return {}
    }
  }
  vm.runInNewContext(source, context)
  await context.module.exports({ input: 'prompt', maxLength: 1, temperature: 1, model: 'gpt2' })
  expect(options.maxNewTokens).toBe(1)
  expect(imports).toContain('gpt-tfjs')
  expect(imports.some(name => name.startsWith('..'))).toBe(false)
})
