const { test, expect } = require('@playwright/test')
const { prepareAssets } = require('./prepare-assets')

test.beforeAll(async () => {
  test.setTimeout(900000)
  await prepareAssets('ml')
})

// Keep the original app's fetch paths, but resolve weights and tokenizer to verified local assets.
async function pinNetwork (context) {
  const requests = []
  const mappings = {
    'https://huggingface.co/gpt2/resolve/main/tf_model.h5': 'ml/gpt2.h5',
    'https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/tf_model.h5': 'ml/clip.h5',
    'https://cdn.jsdelivr.net/npm/modelzoo@latest/bpe_simple_vocab_16e6.txt': 'ml/bpe-vocab.txt'
  }
  await context.route('**/*', route => {
    const url = route.request().url()
    if (new URL(url).hostname === 'localhost') return route.continue()
    requests.push(url)
    if (mappings[url]) return route.fulfill({
      status: 302,
      headers: { location: 'http://localhost:8484/tmp/test-assets/' + mappings[url], 'access-control-allow-origin': '*' }
    })
    return route.abort()
  })
  return requests
}

test('GPT-2 generates from pinned weights and reuses its model', async ({ page, context }) => {
  test.setTimeout(600000)
  const requests = await pinNetwork(context)
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto('/load/')
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const schema = await (await fetch('/test/fixtures/real-apps/gpt2/schema.json')).json()
    schema.model.url = '/tmp/test-assets/ml/gpt2-repaired.js'
    window.app = new JSEE({ container: '#app', schema, verbose: false })
    await window.app._initPromise
    const pipeline = window.app.pipeline
    window.app.pipeline = async data => {
      try { return await pipeline(data) } catch (error) {
        window.modelError = String(error)
        throw error
      }
    }
  })
  try {
    await page.fill('#input', 'The capital of France is')
    await page.fill('#maxLength', '1')
    await page.fill('#temperature', '1')
    const run = () => page.evaluate(async () => ({
      succeeded: await window.app.run(), value: window.app.data.outputs[0].value, error: window.modelError || null
    }))
    const first = await run()
    expect(first, JSON.stringify(errors)).toMatchObject({ succeeded: true, error: null })
    expect(first.value).toMatch(/^The capital of France is\S* .+/)
    const { encode } = require('./fixtures/real-apps/gpt2/node_modules/gpt-tokenizer/cjs/main.js')
    expect(encode(first.value).length).toBe(encode('The capital of France is').length + 1)
    expect(await run()).toEqual(first)
    expect(errors).toEqual([])
    expect(requests).toEqual(['https://huggingface.co/gpt2/resolve/main/tf_model.h5'])
    console.log('GPT-2 result:', JSON.stringify(first.value))
  } finally { await page.evaluate(() => window.app.destroy()) }
})

test('detect runs its camera, CLIP worker, and view with pinned weights', async ({ page, context }) => {
  test.setTimeout(600000)
  const requests = await pinNetwork(context)
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', error => errors.push(String(error)))
  // A deterministic camera frame exercises the capture path without requiring physical hardware.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'blue'
      ctx.fillRect(0, 0, 320, 240)
      return canvas.captureStream(1)
    }
  })
  await page.goto('/load/')
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const root = '/test/fixtures/real-apps/detect/'
    const schema = await (await fetch(root + 'schema.json')).json()
    schema.interval = 0
    for (const model of schema.model) model.url = root + model.url
    // Observe resource ownership around the real predictor without replacing its computation.
    schema.model[1].code = await (await fetch(root + 'clip.js')).text() + `
      const originalPredict = CLIP.prototype.predict
      CLIP.prototype.predict = async function (data, app) {
        const tensorsBefore = tf.memory().numTensors
        const result = await originalPredict.call(this, data, app)
        return { ...result, tensorsBefore, tensorsAfter: tf.memory().numTensors }
      }
    `
    delete schema.model[1].url
    schema.model[1].imports = ['tf-4.10.0.js', 'h5wasm-0.4.11.js', 'modelzoo-0.0.4.js']
      .map(name => '/tmp/test-assets/ml/' + name)
    schema.model[1].timeout = 300000
    window.app = new JSEE({ container: '#app', schema, verbose: false })
    await window.app._initPromise
    window.results = []
    const pipeline = window.app.pipeline
    window.app.pipeline = async data => {
      try {
        const result = await pipeline(data)
        window.results.push(result)
        return result
      } catch (error) {
        window.modelError = String(error)
        throw error
      }
    }
  })
  try {
    await page.fill('#classes', 'a blue image, a red image')
    await page.fill('#detect', 'a red image')
    const loaded = await page.evaluate(() => window.app.runOnce('load'))
    expect(loaded, JSON.stringify(errors)).toBe(true)
    const result = await page.evaluate(async () => ({
      succeeded: await window.app.run(), result: window.results[window.results.length - 1], error: window.modelError || null
    }))
    expect(result, JSON.stringify(errors)).toMatchObject({ succeeded: true, error: null })
    expect(result.result.logits).toHaveLength(2)
    expect(result.result.logits.every(Number.isFinite)).toBe(true)
    expect(result.result.logits[0]).toBeGreaterThan(result.result.logits[1])
    console.log('CLIP tensors:', result.result.tensorsBefore, result.result.tensorsAfter)
    expect(result.result.tensorsBefore).toBeGreaterThan(0)
    const repeated = await page.evaluate(async () => ({
      succeeded: await window.app.runOnce('interval'),
      result: window.results[window.results.length - 1], error: window.modelError || null
    }))
    expect(repeated).toMatchObject({ succeeded: true, error: null })
    expect(repeated.result.logits[0]).toBeCloseTo(result.result.logits[0], 4)
    expect(result.result.tensorsAfter).toBe(result.result.tensorsBefore)
    expect(repeated.result.tensorsAfter).toBe(repeated.result.tensorsBefore)
    expect(errors).toEqual([])
    expect(requests.sort()).toEqual([
      'https://cdn.jsdelivr.net/npm/modelzoo@latest/bpe_simple_vocab_16e6.txt',
      'https://huggingface.co/openai/clip-vit-base-patch32/resolve/main/tf_model.h5'
    ].sort())
    console.log('CLIP logits:', JSON.stringify(result.result.logits))
  } finally { await page.evaluate(() => window.app.destroy()) }
})
