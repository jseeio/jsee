const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const os = require('os')
const http = require('http')
const { pathToFileURL } = require('url')
const gen = require('../src/cli')

const fixtures = path.join(__dirname, 'fixtures/real-apps')
const manifest = require('./fixtures/real-apps/manifest.json')

test('clean_sales generated form runs the complete pipeline offline and downloads exact CSV', async ({ page }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-clean-sales-'))
  const output = path.join(directory, 'index.html')
  const fixture = require('./fixtures/clean-sales.json')[0]
  const requests = []
  try {
    await gen(['--inputs', path.resolve(__dirname, '../examples/clean-sales/schema.json'), '-o', output, '-f', '--runtime', 'inline'])
    await page.route(/^https?:\/\//, route => {
      requests.push(route.request().url())
      return route.abort()
    })
    await page.goto(pathToFileURL(output).href)
    await page.evaluate(() => window.env._initPromise)
    await page.setInputFiles('input[type="file"]', { name: 'sales.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture.data.csv) })
    await expect.poll(() => page.evaluate(() => window.env.data.inputs[0].value)).toBe(fixture.data.csv)
    await page.getByRole('button', { name: /^Run/ }).click()
    await expect(page.locator('#outputs')).toContainText('total_revenue')
    await expect(page.locator('#outputs')).toContainText('40')
    await expect(page.locator('#outputs table tbody tr')).toHaveCount(2)
    const downloadPromise = page.waitForEvent('download')
    await page.locator('#outputs').getByRole('button', { name: /Download/ }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('cleaned-sales.csv')
    expect(fs.readFileSync(await download.path(), 'utf8')).toBe(fixture.csv)
    expect(requests).toEqual([])
  } finally {
    if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('detector view renders category labels as text on repeated calls', async ({ page }) => {
  await page.goto('/load/')
  const label = '<img src=x onerror="window.categoryExecuted=true">'
  await page.evaluate(async label => {
    document.body.innerHTML = '<div id="app"></div>'
    window.app = new JSEE({ container: '#app', verbose: false, schema: {
      model: { name: 'View', type: 'class', method: 'run', worker: false,
        url: '/test/fixtures/real-apps/detect/view.js' },
      inputs: [
        { name: 'classes', type: 'text', default: label },
        { name: 'detect', type: 'text', default: 'no alarm' }
      ], outputs: []
    } })
    await window.app._initPromise
    await window.app.pipeline({ caller: 'run', classes: label, detect: 'no alarm', logits: [90] })
  }, label)
  try {
    await expect(page.locator('#outputs table td').first()).toHaveText(label)
    await expect(page.locator('#outputs table img')).toHaveCount(0)
    await page.evaluate(() => window.app.pipeline({ caller: 'interval', classes: 'updated', detect: 'no alarm', logits: [80] }))
    await expect(page.locator('#outputs table td').first()).toHaveText('updated')
  } finally { await page.evaluate(() => window.app.destroy()) }
})

for (const phase of ['immediate', 'schema', 'model', 'async-init']) {
  test(`destroy prevents initialization and progress from reviving the app: ${phase}`, async ({ page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch
      window.fetch = (...args) => window.delayedFetch ? window.delayedFetch(...args) : originalFetch(...args)
    })
    await page.goto('/load/')
    const result = await page.evaluate(async phase => {
      document.body.innerHTML = '<div id="app"></div>'
      let entered
      let release
      let signal
      const started = new Promise(resolve => { entered = resolve })
      const pending = new Promise(resolve => { release = resolve })
      const schema = {
        model: { worker: false, code: 'function compute (data) { return data }' },
        inputs: [], outputs: []
      }
      if (phase === 'schema' || phase === 'model') {
        window.delayedFetch = async (url, options) => {
          signal = options && options.signal
          entered()
          await pending
          return new window.Response(phase === 'schema' ? JSON.stringify(schema) : schema.model.code)
        }
      }
      const config = phase === 'schema' ? '/dispose/schema.json' : phase === 'model'
        ? { ...schema, model: { worker: false, url: '/dispose/model.js', name: 'compute' } }
        : phase === 'async-init'
          ? { ...schema, model: { worker: false, type: 'async-init', code: async () => {
            entered()
            await pending
            return data => data
          } } }
          : schema
      const app = new JSEE({ container: '#app', schema: config, verbose: false })
      const initialized = app._initPromise.then(() => null, error => error.message)
      try {
        if (phase !== 'immediate') await started
        app.destroy()
        release()
        const error = await initialized
        // A model may retain the instance and report progress after disposal.
        app.progress(25)
        app.output({ result: 'late' })
        const run = await app.run().catch(error => error.message)
        const result = {
          error, run, schema: app.schema, model: app.model, pipeline: app.pipeline,
          workers: app._workers.length, children: document.querySelector('#app').childElementCount,
          progress: !!document.getElementById(app.progressId),
          fetchAborted: signal ? signal.aborted : null
        }
        app.destroy()
        return result
      } finally {
        delete window.delayedFetch
      }
    }, phase)
    expect(result).toEqual({
      error: null, run: false, schema: null, model: null, pipeline: null,
      workers: 0, children: 0, progress: false,
      fetchAborted: phase === 'schema' || phase === 'model' ? true : null
    })
  })
}

test('destroy settles pending worker initialization and leaves no workers or UI', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    let entered
    const started = new Promise(resolve => { entered = resolve })
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      inputs: [], model: { worker: true, type: 'async-init', code: `async function setup () {
        postMessage({ _status: 'log', _log: ['blocked-init'] })
        return await new Promise(() => {})
      }` }
    } })
    app.log = message => { if (message === 'blocked-init') entered() }
    const initialized = app._initPromise.then(() => null, error => error.message)
    await started
    const workersBefore = app._workers.length
    app.destroy()
    return { error: await initialized, workersBefore, workersAfter: app._workers.length,
      children: document.querySelector('#app').childElementCount, pipeline: app.pipeline }
  })
  expect(result).toEqual({ error: null, workersBefore: 1, workersAfter: 0, children: 0, pipeline: null })
})

test('failed initial pipeline setup releases workers created by earlier stages', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      inputs: [], model: [
        { worker: true, code: 'function first (data) { return data }' },
        { worker: false, type: 'async-init', code: 'async function setup () { throw new Error("setup failed") }' }
      ]
    } })
    const error = await app._initPromise.catch(error => error.message)
    const workers = app._workers.length
    app.destroy()
    return { error, workers }
  })
  expect(result).toEqual({ error: 'setup failed', workers: 0 })
})

test('pinned app snapshots match their recorded source hashes', () => {
  for (const app of manifest) {
    for (const [file, digest] of Object.entries(app.files)) {
      const bytes = fs.readFileSync(path.join(fixtures, app.id, file))
      expect(crypto.createHash('sha256').update(bytes).digest('hex'), `${app.id}/${file}`).toBe(digest)
    }
  }
})

test('instances keep caller descriptors and mutable UI values separate', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="first"></div><div id="second"></div>'
    const schema = {
      model: { worker: false, code: 'function twice (data) { return { result: data.x * 2 } }' },
      inputs: [{ name: 'x', type: 'int', default: 3 }],
      outputs: [{ name: 'result', type: 'number' }]
    }
    const original = JSON.stringify(schema)
    const first = new JSEE({ container: '#first', schema, verbose: false })
    await first._initPromise
    const second = new JSEE({ container: '#second', schema, verbose: false })
    await second._initPromise
    first.data.inputs[0].value = 9
    await first.run()
    const result = {
      unchanged: JSON.stringify(schema) === original,
      descriptorHasValue: Object.prototype.hasOwnProperty.call(first.schema.inputs[0], 'value'),
      first: first.data.outputs[0].value,
      second: second.data.inputs[0].value
    }
    first.destroy()
    second.destroy()
    return result
  })
  expect(result).toEqual({ unchanged: true, descriptorHasValue: false, first: 18, second: 3 })
})

for (const entry of ['button', 'programmatic']) {
  test(`nested control validation applies to ${entry} runs and clears on correction`, async ({ page }) => {
    await page.goto('/load/')
    await page.evaluate(async () => {
      document.body.innerHTML = '<div id="app"></div>'
      window.validationCalls = 0
      window.validationApp = new JSEE({ container: '#app', verbose: false, schema: {
        persist: false,
        model: { worker: false, code: 'function model () { window.validationCalls++; return {} }' },
        inputs: [{ type: 'group', elements: [{ name: 'settings', type: 'group', elements: [
          { name: 'name', type: 'string', required: true, validate: 'value != "forbidden"', error: 'Enter a name', default: '' }
        ] }] }]
      } })
      await window.validationApp._initPromise
    })
    const run = async () => {
      if (entry === 'button') await page.getByRole('button', { name: /^Run/ }).click()
      else await page.evaluate(() => window.validationApp.run())
      // Flush the model promise and Vue rendering after either entry point.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)))
    }
    await run()
    expect(await page.evaluate(() => window.validationCalls)).toBe(0)
    await expect(page.getByText('Enter a name', { exact: true })).toBeVisible()
    await page.evaluate(() => { window.validationApp.data.inputs[0].elements[0].elements[0].value = 'allowed' })
    await run()
    expect(await page.evaluate(() => window.validationCalls)).toBe(1)
    await expect(page.getByText('Enter a name', { exact: true })).toHaveCount(0)
    await page.evaluate(() => window.validationApp.destroy())
  })
}

test('instances own their verbosity and local log sinks', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="first"></div><div id="second"></div>'
    const schema = { inputs: [{ name: 'x', default: 'a' }] }
    const first = new JSEE({ container: '#first', schema, verbose: true })
    await first._initPromise
    const second = new JSEE({ container: '#second', schema, verbose: false })
    await second._initPromise
    document.querySelector('#first').insertAdjacentHTML('beforeend', '<pre id="log"></pre>')
    document.querySelector('#second').insertAdjacentHTML('beforeend', '<pre id="log"></pre>')
    first.log('first-only')
    second.log('second-hidden')
    const result = Array.from(document.querySelectorAll('#log'), element => element.textContent)
    first.destroy()
    second.destroy()
    return result
  })
  expect(result).toEqual(['\nfirst-only', ''])
})

test('labeled options initialize and reset to their declared values', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      model: { worker: false, code: 'function choice (data) { return { result: data.choice } }' },
      inputs: [{ name: 'choice', type: 'select', options: [{ label: 'Two', value: 2 }, { label: 'Three', value: 3 }] }],
      outputs: [{ name: 'result', type: 'number' }]
    } })
    await app._initPromise
    const initial = app.data.inputs[0].value
    const succeeded = await app.run()
    const output = app.data.outputs[0].value
    app.data.inputs[0].value = 3
    app.app.reset()
    const result = { initial, succeeded, reset: app.data.inputs[0].value, output }
    app.destroy()
    return result
  })
  expect(result).toEqual({ initial: 2, succeeded: true, reset: 2, output: 2 })
})

for (const worker of [false, true]) {
  test.describe(`execution characterization, worker=${worker}`, () => {
    for (const fixture of require('./fixtures/output-contracts.json')) {
      test(`output contract: ${fixture.name}`, async ({ page }) => {
        await page.goto('/load/')
        const result = await page.evaluate(async ({ worker, fixture }) => {
          document.body.innerHTML = '<div id="app"></div>'
          const app = new JSEE({ container: '#app', verbose: false, schema: {
            inputs: [], outputs: fixture.outputs,
            model: { worker, code: 'function compute () { return ' + JSON.stringify(fixture.result) + ' }' }
          } })
          try {
            await app._initPromise
            const succeeded = await app.run()
            const values = {}
            function collect (outputs) {
              outputs.forEach(output => {
                if (output.type === 'group') collect(output.elements)
                else values[output.name] = output.value
              })
            }
            collect(app.data.outputs)
            return { succeeded, values }
          } finally { app.destroy() }
        }, { worker, fixture })
        expect(result).toEqual({ succeeded: true, values: fixture.expected })
      })
    }

    test('declared caller and history inputs survive browser metadata injection', async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async worker => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          inputs: [{ type: 'group', elements: [
            { name: 'caller', type: 'string', default: 'customer' },
            { name: 'history', type: 'string', default: 'archive' }
          ] }],
          outputs: [{ name: 'result', type: 'object' }, { name: 'chat', type: 'chat' }],
          model: { worker, code: 'function compute (data) { return { result: { caller: data.caller, history: data.history } } }' }
        } })
        try {
          await app._initPromise
          const succeeded = await app.run('button')
          return { succeeded, value: { ...app.data.outputs[0].value } }
        } finally { app.destroy() }
      }, worker)
      expect(result).toEqual({ succeeded: true, value: { caller: 'customer', history: 'archive' } })
    })

    test('collects nested layout groups consistently with named groups', async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async worker => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          model: { worker, code: 'function groups (data) { return { result: data.x + data.settings.y } }' },
          inputs: [
            { type: 'group', elements: [{ type: 'group', elements: [{ name: 'x', type: 'int', default: 7 }] }] },
            { name: 'settings', type: 'group', elements: [{ type: 'group', elements: [{ name: 'y', type: 'int', default: 3 }] }] }
          ],
          outputs: [{ name: 'result', type: 'number' }]
        } })
        await app._initPromise
        const succeeded = await app.run()
        const result = { succeeded, value: app.data.outputs[0].value }
        app.destroy()
        return result
      }, worker)
      expect(result).toEqual({ succeeded: true, value: 10 })
    })

    test('merges stages, passes undefined through, and stops before the next stage', async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async worker => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          model: [
            { worker, code: 'function first (data) { return { result: data.x + 1, flag: false } }' },
            { worker, code: 'function pass () {}' },
            { worker, code: 'function stop (data) { return { stop: true, result: data.result + 1 } }' },
            { worker, code: 'function unreachable () { throw new Error("must not run") }' }
          ],
          inputs: [{ name: 'x', type: 'int', default: 3 }],
          outputs: [{ name: 'result', type: 'number' }, { name: 'flag', type: 'code' }]
        } })
        await app._initPromise
        const pipeline = await app.pipeline({ x: 5 })
        const succeeded = await app.run()
        const result = { pipeline, succeeded, outputs: app.data.outputs.map(output => output.value), running: app.running }
        app.destroy()
        return result
      }, worker)
      expect(result).toEqual({
        pipeline: { x: 5, result: 7, flag: false, stop: true },
        succeeded: true, outputs: [5, false], running: false
      })
    })

    test('preserves scalar and array stage results and respects an initial stop flag', async ({ page }) => {
      await page.goto('/load/')
      const results = await page.evaluate(async worker => {
        const results = []
        for (const value of [null, false, 0, [], [1, 2], { _cmd: 'cancel' }, { _jsee: 'cancel' }]) {
          document.body.innerHTML = '<div id="app"></div>'
          const app = new JSEE({ container: '#app', verbose: false, schema: {
            model: [
              { worker, code: 'function value () { return ' + JSON.stringify(value) + ' }' },
              { worker, timeout: 300, code: 'function receive (value) { return { value } }' }
            ], inputs: []
          } })
          await app._initPromise
          results.push(await app.pipeline({}))
          results.push(await app.pipeline({ stop: true }))
          app.destroy()
        }
        return results
      }, worker)
      expect(results).toEqual([null, false, 0, [], [1, 2], { _cmd: 'cancel' }, { _jsee: 'cancel' }].flatMap(value => [value && !Array.isArray(value) ? { ...value, value } : { value }, { stop: true }]))
    })

    test('keeps binary stage results as binary values', async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async worker => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          model: [
            { worker, code: 'function binary () { return new Uint8Array([2, 3]) }' },
            { worker, code: 'function receive (data) { return { isView: ArrayBuffer.isView(data), values: Array.from(data) } }' }
          ], inputs: []
        } })
        await app._initPromise
        const result = await app.pipeline({})
        app.destroy()
        return result
      }, worker)
      expect(result).toEqual({ isView: true, values: [2, 3] })
    })

    test('preserves ImageData as a stage result and a nested worker input', async ({ page }) => {
      await page.goto('/load/')
      const results = await page.evaluate(async worker => {
        const results = []
        for (const nested of [false, true]) {
          document.body.innerHTML = '<div id="app"></div>'
          const app = new JSEE({ container: '#app', verbose: false, schema: {
            model: [
              { worker: false, code: `function image () {
                const image = new ImageData(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1)
                return ${nested ? '{ image }' : 'image'}
              }` },
              { worker, code: `function receive (value) {
                const image = ${nested ? 'value.image' : 'value'}
                return { valid: image instanceof ImageData, pixels: Array.from(image.data || []), width: image.width }
              }` }
            ], inputs: []
          } })
          try {
            await app._initPromise
            const result = await app.pipeline({})
            results.push({ valid: result.valid, pixels: result.pixels, width: result.width })
          } finally { app.destroy() }
        }
        return results
      }, worker)
      expect(results).toEqual(Array(2).fill({ valid: true, pixels: [10, 20, 30, 255], width: 1 }))
    })

    test('run returns false on failure and later invocation succeeds', async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async worker => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          model: { worker, code: 'function maybe (data) { if (data.fail) throw new Error("expected failure"); return { result: 0 } }' },
          inputs: [{ name: 'fail', type: 'checkbox', default: true }],
          outputs: [{ name: 'result', type: 'number' }]
        } })
        await app._initPromise
        const failed = await app.run()
        app.data.inputs[0].value = false
        const succeeded = await app.run()
        const result = { failed, succeeded, value: app.data.outputs[0].value, running: app.running }
        app.destroy()
        return result
      }, worker)
      expect(result).toEqual({ failed: false, succeeded: true, value: 0, running: false })
    })

    test('queues one manual run and drops overlapping reactive calls', async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async worker => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          model: { worker, code: 'async function wait (data) { await new Promise(resolve => setTimeout(resolve, 50)); return { value: data.caller } }' },
          inputs: [], outputs: [{ name: 'value', type: 'code' }]
        } })
        await app._initPromise
        const events = []
        const output = app.output.bind(app)
        let completed
        const queued = new Promise(resolve => { completed = resolve })
        app.output = value => {
          events.push(value.value)
          output(value)
          if (value.value === 'manual') completed()
        }
        const first = app.run('first')
        const reactive = await app.run('reactive')
        const manual = await app.run('manual')
        const succeeded = await first
        await queued
        app.destroy()
        return { succeeded, reactive, manual, events }
      }, worker)
      expect(result).toEqual({ succeeded: true, reactive: false, manual: false, events: ['first', 'manual'] })
    })
  })
}

test('worker rebuilding reserves the run before asynchronous initialization', async ({ page }) => {
  await page.goto('/load/')
  const state = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = window.rebuildApp = new JSEE({ container: '#app', verbose: false, schema: {
      model: { worker: true, timeout: 100, code: 'function model (data) { return { value: data.caller } }' },
      inputs: [], outputs: [{ name: 'value', type: 'code' }]
    } })
    await app._initPromise
    app.cancelCurrentRun()
    let entered
    let release
    const started = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const initModel = app.initModel.bind(app)
    app.initModel = async () => { entered(); await gate; return initModel() }
    window.rebuildOutputs = []
    const output = app.output.bind(app)
    app.output = value => { window.rebuildOutputs.push(value.value); output(value) }
    window.rebuildRun = app.run('first')
    await started
    const reserved = app.running === true
    const reactive = app.run('reactive')
    const manual = app.run('manual')
    const state = { reserved, running: app.running, queued: app._pendingRun }
    release()
    return { ...state, reactive: await reactive, manual: await manual }
  })
  expect(state).toEqual({ reserved: true, reactive: false, manual: false, running: true, queued: 'manual' })
  await page.waitForFunction(() => window.rebuildOutputs.length === 2)
  expect(await page.evaluate(async () => {
    const result = { first: await window.rebuildRun, outputs: window.rebuildOutputs }
    window.rebuildApp.destroy()
    return result
  })).toEqual({ first: true, outputs: ['first', 'manual'] })
})

for (const failure of ['stop', 'load-error']) {
  test(`worker rebuilding recovers after ${failure}`, async ({ page }) => {
    await page.goto('/load/')
    const result = await page.evaluate(async failure => {
      document.body.innerHTML = '<div id="app"></div>'
      const app = new JSEE({ container: '#app', verbose: false, schema: {
        model: { worker: true, timeout: 100, code: 'function model (data) { return { value: data.caller } }' },
        inputs: [], outputs: [{ name: 'value', type: 'code' }]
      } })
      await app._initPromise
      app.cancelCurrentRun()
      let entered
      let release
      const started = new Promise(resolve => { entered = resolve })
      const gate = new Promise(resolve => { release = resolve })
      const initModel = app.initModel.bind(app)
      app.initModel = async () => {
        entered()
        await gate
        if (failure === 'load-error') throw new Error('model load failed')
        return initModel()
      }
      const first = app.run('cancelled').catch(error => error.message)
      await started
      if (failure === 'stop') app.cancelCurrentRun()
      release()
      const failed = await first
      const state = { failed, retry: app._needsModelReinit, running: app.running === true,
        workers: app._workers.length, value: app.data.outputs[0].value }
      app.initModel = initModel
      const recovered = await app.run('recovered')
      const result = { state, recovered, value: app.data.outputs[0].value }
      app.destroy()
      return result
    }, failure)
    expect(result).toEqual({
      state: { failed: false, retry: true, running: false, workers: 0, value: undefined },
      recovered: true, value: 'recovered'
    })
  })
}

for (const worker of [false, true]) {
  test(`completed model contexts cannot report into the next run, worker=${worker}`, async ({ page }) => {
    await page.goto('/load/')
    const result = await page.evaluate(async worker => {
      document.body.innerHTML = '<div id="app"></div>'
      const app = new JSEE({ container: '#app', verbose: false, schema: {
        model: { worker, code: `function model (data, ctx) {
          if (data.caller === 'first') { globalThis.previousContext = ctx; return {} }
          globalThis.previousContext.progress(99)
          ctx.progress(25)
          return { oldCancelled: globalThis.previousContext.isCancelled(), currentCancelled: ctx.isCancelled() }
        }` }, inputs: [], outputs: [{ name: 'oldCancelled', type: 'object' }, { name: 'currentCancelled', type: 'object' }]
      } })
      await app._initPromise
      const progress = []
      app.progress = value => { if (value > 0) progress.push(value) }
      await app.run('first')
      const succeeded = await app.run('second')
      const result = { succeeded, progress, cancelled: app.data.outputs.map(output => output.value) }
      app.destroy()
      return result
    }, worker)
    expect(result).toEqual({ succeeded: true, progress: [25], cancelled: [true, false] })
  })
}

for (const failure of ['stop', 'load-error']) {
  test(`partially rebuilt pipelines dispose workers after ${failure}`, async ({ page }) => {
    await page.goto('/load/')
    const result = await page.evaluate(async failure => {
      document.body.innerHTML = '<div id="app"></div>'
      let entered
      let release
      const started = new Promise(resolve => { entered = resolve })
      window.reinitGate = new Promise(resolve => { release = resolve })
      window.reinitStarted = entered
      window.pauseReinit = false
      window.failReinit = false
      const app = new JSEE({ container: '#app', verbose: false, schema: {
        inputs: [], outputs: [{ name: 'value', type: 'code' }], model: [
          { worker: true, code: 'function first (data) { return data }' },
          { worker: false, type: 'async-init', code: `async function setup () {
            if (window.pauseReinit) { window.reinitStarted(); await window.reinitGate }
            if (window.failReinit) throw new Error('initialization failed')
            return data => data
          }` },
          { worker: true, code: 'function last (data) { return { value: data.caller } }' }
        ]
      } })
      await app._initPromise
      app.cancelCurrentRun()
      window.pauseReinit = true
      const first = app.run('first')
      await started
      const partialWorkers = app._workers.length
      if (failure === 'stop') app.cancelCurrentRun()
      else window.failReinit = true
      release()
      const failed = await first
      const state = { failed, partialWorkers, workers: app._workers.length, retry: app._needsModelReinit }
      window.pauseReinit = window.failReinit = false
      const recovered = await app.run('recovered')
      const result = { state, recovered, workers: app._workers.length, value: app.data.outputs[0].value }
      app.destroy()
      return result
    }, failure)
    expect(result).toEqual({ state: { failed: false, partialWorkers: 1, workers: 0, retry: true },
      recovered: true, workers: 2, value: 'recovered' })
  })
}

test('Stop aborts a model fetch during worker rebuilding', async ({ page }) => {
  await page.addInitScript(() => {
    const fetch = window.fetch
    window.fetch = (...args) => window.rebuildFetch ? window.rebuildFetch(...args) : fetch(...args)
  })
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    let entered
    const started = new Promise(resolve => { entered = resolve })
    let hold = false
    let signal
    window.rebuildFetch = async (url, options) => {
      if (!hold) return new window.Response('function model () { return { value: 42 } }')
      signal = options.signal
      entered()
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    }
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      model: { worker: true, url: '/rebuild.js', name: 'model' }, inputs: [], outputs: [{ name: 'value', type: 'number' }]
    } })
    await app._initPromise
    app.cancelCurrentRun()
    hold = true
    const run = app.run()
    await started
    app.cancelCurrentRun()
    const cancelled = await run
    hold = false
    const recovered = await app.run()
    const result = { cancelled, aborted: signal.aborted, recovered, value: app.data.outputs[0].value }
    app.destroy()
    delete window.rebuildFetch
    return result
  })
  expect(result).toEqual({ cancelled: false, aborted: true, recovered: true, value: 42 })
})

test('cancelled main-thread context cannot emit output or progress during a newer run', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      model: { worker: false, code: 'function model (data, ctx) { return new Promise(resolve => { window.pendingModels[data.caller] = { ctx, resolve } }) }' },
      inputs: [], outputs: [{ name: 'value', type: 'code' }]
    } })
    await app._initPromise
    window.pendingModels = {}
    const first = app.run('first')
    while (!window.pendingModels.first) await new Promise(resolve => setTimeout(resolve, 0))
    app.cancelCurrentRun()
    await first
    const second = app.run('second')
    while (!window.pendingModels.second) await new Promise(resolve => setTimeout(resolve, 0))
    const old = window.pendingModels.first
    const current = window.pendingModels.second
    current.ctx.progress(25)
    current.ctx.output({ value: 'current' })
    old.ctx.progress(99)
    await old.ctx.outputAsync({ value: 'stale' })
    const state = { oldCancelled: old.ctx.isCancelled(), currentCancelled: current.ctx.isCancelled(),
      progress: document.getElementById(app.progressId).style.width, value: app.data.outputs[0].value }
    old.resolve({ value: 'old' })
    current.resolve({ value: 'done' })
    const succeeded = await second
    app.destroy()
    return { state, succeeded }
  })
  expect(result).toEqual({ state: { oldCancelled: true, currentCancelled: false, progress: '25%', value: 'current' }, succeeded: true })
})

test('main-thread invocation contexts retain browser fields and instance method ownership', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      inputs: [], model: { worker: false, code: `function model (data, ctx) {
        ctx.marker = 3
        ctx.addMarker(4)
        return { value: ctx.marker, container: ctx.container, hasUtils: typeof ctx.utils.delay === 'function' }
      }` }, outputs: [{ name: 'value', type: 'number' }, { name: 'container', type: 'code' }, { name: 'hasUtils', type: 'object' }]
    } })
    app.addMarker = function (value) { this.marker += value }
    await app._initPromise
    const succeeded = await app.run()
    const result = { succeeded, marker: app.marker, outputs: app.data.outputs.map(output => output.value) }
    app.destroy()
    return result
  })
  expect(result).toEqual({ succeeded: true, marker: 7, outputs: [7, '#app', true] })
})

test('cancelled main-thread stages cannot advance after a new run starts', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    window.downstream = []
    let ready
    const started = new Promise(resolve => { ready = resolve })
    window.firstReady = ready
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      model: [
        { worker: false, code: 'async function wait (data) { if (data.caller === "first") { await new Promise(resolve => { window.releaseFirst = resolve; window.firstReady() }) } return data }' },
        { worker: false, code: 'function next (data) { window.downstream.push(data.caller); return data }' }
      ], inputs: []
    } })
    await app._initPromise
    const first = app.run('first')
    await started
    app.cancelCurrentRun()
    const cancelled = await first
    const second = await app.run('second')
    window.releaseFirst()
    // Drain the old promise chain without a timing-dependent sleep.
    await new Promise(resolve => setTimeout(resolve, 0))
    const result = { cancelled, second, calls: window.downstream }
    app.destroy()
    return result
  })
  expect(result).toEqual({ cancelled: false, second: true, calls: ['second'] })
})

test('Stop before the first pipeline microtask prevents model execution', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    window.microtaskCalls = 0
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      inputs: [], model: { worker: false, code: 'function model () { window.microtaskCalls++; return {} }' }
    } })
    await app._initPromise
    const first = app.run()
    app.cancelCurrentRun()
    const cancelled = await first
    const callsAfterStop = window.microtaskCalls
    const recovered = await app.run()
    const callsAfterRun = window.microtaskCalls
    app.destroy()
    return { cancelled, callsAfterStop, recovered, callsAfterRun }
  })
  expect(result).toEqual({ cancelled: false, callsAfterStop: 0, recovered: true, callsAfterRun: 1 })
})

test('completed worker handlers ignore late raw callbacks', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const app = new JSEE({ container: '#app', verbose: false, schema: {
      inputs: [], outputs: [{ name: 'value', type: 'number' }],
      model: { worker: true, code: `function compute () {
        self.addEventListener('message', event => {
          if (event.data.probe) {
            postMessage({ _status: 'progress', _progress: 77 })
            postMessage({ _partial: true, value: 99 })
            postMessage({ probeDone: true })
          }
        })
        return { value: 42 }
      }` }
    } })
    try {
      await app._initPromise
      await app.run()
      const progress = []
      app.progress = value => progress.push(value)
      const worker = app._workers[0]
      await new Promise(resolve => {
        worker.addEventListener('message', event => {
          if (event.data.probeDone) resolve()
        })
        worker.postMessage({ _jsee: 'cancel', probe: true })
      })
      return { progress, value: app.data.outputs[0].value }
    } finally { app.destroy() }
  })
  expect(result).toEqual({ progress: [], value: 42 })
})

test.describe('API streaming and cancellation', () => {
  let server
  let base
  let closed
  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') { res.end(); return }
      res.on('close', () => { if (req.url === '/hold') closed++ })
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (req.url === '/stop') {
        res.end('data: {"result":7,"stop":true}\n\ndata: [DONE]\n\n')
        return
      }
      if (req.url === '/chat') {
        res.end('data: {"chat":"one"}\n\ndata: {"chat":"two"}\n\ndata: [DONE]\n\n')
        return
      }
      res.write('data: {"result":1}\n\n')
      if (req.url === '/hold') return
      if (req.url === '/failure') {
        res.end('event: error\ndata: {"error":"generator failed"}\n\ndata: [DONE]\n\n')
        return
      }
      res.write('data: {"result":2,"_status":"business"}\n\ndata: [DONE]\n\n')
      // Completion must not depend on the server closing its keep-alive stream.
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  test.beforeEach(() => { closed = 0 })
  test.afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  for (const worker of [false, true]) {
    test(`presentation preserves streamed pipeline data and chat completion, worker=${worker}`, async ({ page }) => {
      await page.goto('/load/')
      const result = await page.evaluate(async ({ base, worker }) => {
        document.body.innerHTML = '<div id="app"></div>'
        const app = new JSEE({ container: '#app', verbose: false, schema: {
          model: [
            { type: 'post', url: base + '/stop', worker, stream: true },
            { worker: false, code: 'function unreachable () { throw new Error("advanced after stop") }' }
          ], inputs: [], outputs: [{ name: 'result', type: 'number' }]
        } })
        await app._initPromise
        const stopped = await app.run()
        app.destroy()
        document.body.innerHTML = '<div id="app"></div>'
        const chat = new JSEE({ container: '#app', verbose: false, schema: {
          model: { type: 'post', url: base + '/chat', worker, stream: true },
          inputs: [{ name: 'message', default: 'hello' }], outputs: [{ name: 'chat', type: 'chat' }]
        } })
        await chat._initPromise
        const succeeded = await chat.run()
        const messages = chat.data.outputs[0]._messages.map(({ role, content }) => ({ role, content }))
        const cleared = chat.data.inputs[0].value
        chat.destroy()
        return { stopped, succeeded, messages, cleared }
      }, { base, worker })
      expect(result).toEqual({ stopped: true, succeeded: true, cleared: '', messages: [
        { role: 'user', content: 'hello' }, { role: 'assistant', content: 'one' }, { role: 'assistant', content: 'two' }
      ] })
    })

    test(`streams partials and rejects terminal errors, worker=${worker}`, async ({ page }) => {
      await page.goto('/load/')
      const results = await page.evaluate(async ({ base, worker }) => {
        const results = []
        for (const endpoint of ['/success', '/failure']) {
          document.body.innerHTML = '<div id="app"></div>'
          const app = new JSEE({ container: '#app', verbose: false, schema: {
            model: { type: 'post', url: base + endpoint, stream: true, worker, timeout: 500 },
            inputs: [], outputs: [{ name: 'result', type: 'number' }]
          } })
          await app._initPromise
          const chunks = []
          const output = app.output.bind(app)
          app.output = (value, partial) => { chunks.push(structuredClone(value)); output(value, partial) }
          const succeeded = await app.run()
          results.push({ succeeded, chunks, value: app.data.outputs[0].value })
          app.destroy()
        }
        return results
      }, { base, worker })
      expect(results[0].succeeded).toBe(true)
      expect(results[0].chunks.slice(0, 2)).toEqual([{ result: 1 }, { result: 2, _status: 'business' }])
      expect(results[0].value).toBe(2)
      expect(results[1]).toEqual({ succeeded: false, chunks: [{ result: 1 }], value: 1 })
    })

    test(`Stop closes the active request and later Run succeeds, worker=${worker}`, async ({ page }) => {
      await page.goto('/load/')
      await page.evaluate(async ({ base, worker }) => {
        document.body.innerHTML = '<div id="app"></div>'
        window.streamingApp = new JSEE({ container: '#app', verbose: false, schema: {
          model: { type: 'post', url: base + '/hold', stream: true, worker },
          inputs: [], outputs: [{ name: 'result', type: 'number' }]
        } })
        await window.streamingApp._initPromise
        window.streamRun = window.streamingApp.run()
      }, { base, worker })
      await page.waitForFunction(() => window.streamingApp.data.outputs[0].value === 1)
      expect(await page.evaluate(async () => {
        window.streamingApp.cancelCurrentRun()
        return await window.streamRun
      })).toBe(false)
      await expect.poll(() => closed).toBe(1)
      expect(await page.evaluate(async base => {
        const app = window.streamingApp
        app.schema.model.url = base + '/success'
        await app.initModel()
        await app.initPipeline()
        const succeeded = await app.run()
        app.destroy()
        return succeeded
      }, base)).toBe(true)
    })
  }
})

test.describe('pinned real applications', () => {
  async function loadApp (page, name) {
    await page.goto('/load/')
    await page.evaluate(async name => {
      document.body.innerHTML = '<div id="app"></div>'
      const base = '/test/fixtures/real-apps/' + name + '/'
      const schema = await (await fetch(base + 'schema.json')).json()
      const models = Array.isArray(schema.model) ? schema.model : [schema.model]
      models.forEach(model => {
        if (model.url && !model.url.startsWith('http')) model.url = base + model.url
      })
      window.fixtureApp = new JSEE({ container: '#app', verbose: false, schema })
      await window.fixtureApp._initPromise
    }, name)
    await page.waitForFunction(() => window.fixtureApp && !window.fixtureApp.running)
  }

  test('hash preserves deterministic file computation through a worker', async ({ page }) => {
    await loadApp(page, 'hash')
    const values = await page.evaluate(async () => {
      const app = window.fixtureApp
      const values = []
      for (const method of ['sha1', 'sha256', 'sha512']) {
        app.data.inputs.find(input => input.name === 'file').value = 'abc'
        app.data.inputs.find(input => input.name === 'method').value = method
        if (!await app.run()) throw new Error('hash run failed')
        values.push(app.data.outputs[0].value)
      }
      app.destroy()
      return values
    })
    expect(values).toEqual(['sha1', 'sha256', 'sha512'].map(method => crypto.createHash(method).update('abc').digest('hex')))
  })

  test('CLI fetch flag produces a hash app that runs with network requests blocked', async ({ page }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-offline-hash-'))
    const output = path.join(directory, 'index.html')
    const requests = []
    try {
      await gen(['--inputs', path.join(fixtures, 'hash/schema.json'), '-o', output, '-f', '--runtime', 'inline'])
      await page.route(/^https?:\/\//, route => {
        requests.push(route.request().url())
        return route.abort()
      })
      await page.goto(pathToFileURL(output).href)
      await page.setInputFiles('input[type="file"]', { name: 'data.txt', mimeType: 'text/plain', buffer: Buffer.from('abc') })
      await page.getByRole('button', { name: /^Run/ }).click()
      const digest = crypto.createHash('sha256').update('abc').digest('hex')
      await expect(page.locator('#outputs')).toContainText(digest)
      expect(requests).toEqual([])
    } finally {
      if (!page.isClosed()) await page.goto('about:blank').catch(() => {})
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  test('ethgen emits a fresh address and private key on repeated worker runs', async ({ page }) => {
    await loadApp(page, 'ethgen')
    const values = await page.evaluate(async () => {
      const app = window.fixtureApp
      const values = []
      for (let i = 0; i < 2; i++) {
        if (!await app.run()) throw new Error('ethgen run failed')
        values.push(app.data.outputs.map(output => output.value))
      }
      app.destroy()
      return values
    })
    for (const [address, key] of values) {
      expect(/^0x[\da-fA-F]{40}$/.test(address)).toBe(true)
      expect(/^0x[\da-f]{64}$/.test(key)).toBe(true)
    }
    expect(values[0][0] === values[1][0]).toBe(false)
  })

  test('keygen produces an interoperable RSA key pair', async ({ page }) => {
    await loadApp(page, 'keygen')
    const verified = await page.evaluate(async () => {
      const app = window.fixtureApp
      app.data.inputs.find(input => input.name === 'length').value = 1024
      app.data.inputs.find(input => input.name === 'hash').value = 'SHA-256'
      if (!await app.run()) throw new Error('keygen run failed')
      const decode = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), char => char.charCodeAt(0))
      const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      const publicKey = await crypto.subtle.importKey('spki', decode(app.data.outputs[0].value), algorithm, false, ['verify'])
      const privateKey = await crypto.subtle.importKey('pkcs8', decode(app.data.outputs[1].value), algorithm, false, ['sign'])
      const data = new TextEncoder().encode('jsee fixture')
      const signature = await crypto.subtle.sign(algorithm, privateKey, data)
      app.destroy()
      return crypto.subtle.verify(algorithm, publicKey, signature, data)
    })
    expect(verified).toBe(true)
  })

  test('prime-spiral redraws its custom canvas from declared parameters', async ({ page }) => {
    await loadApp(page, 'ulam')
    const result = await page.evaluate(async () => {
      const app = window.fixtureApp
      app.data.inputs.find(input => input.name === 'n').value = 100
      const first = await app.run()
      const canvas = document.querySelector('#outputs canvas')
      const pixels = () => Array.from(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data).filter((value, index) => index % 4 === 3 && value > 0).length
      const before = pixels()
      app.data.inputs.find(input => input.name === 'scale').value = 1
      const second = await app.run()
      const after = pixels()
      app.destroy()
      return { first, second, before, after }
    })
    expect(result.first && result.second).toBe(true)
    expect(result.before).toBeGreaterThan(0)
    expect(result.after).toBeGreaterThan(result.before)
  })
})

for (const runtime of ['node', 'python']) {
  test(`${runtime} authenticated UI and browser CORS use the host policy`, async ({ browser }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-auth-browser-'))
    const token = 'browser-test-token'
    const model = runtime === 'node' ? 'model.js' : 'model.py'
    fs.writeFileSync(path.join(directory, model), runtime === 'node' ? 'module.exports = ({x, document, table, photo}) => ({answer:x * 2, metadata:{document,table,bytes:photo ? Array.from(new Uint8Array(photo)) : []}, preview:photo ? {content:photo,mime:"image/png"} : ""})' : 'def compute(x, document=None, table=None, photo=None):\n    return {"answer": x * 2, "metadata":{"document":document,"table":table,"bytes":list(photo) if photo else []}, "preview":{"content":photo,"mime":"image/png"} if photo else ""}\n')
    const filename = path.join(directory, 'schema.json')
    fs.writeFileSync(filename, JSON.stringify({ model: { name: 'compute', url: model, autorun: false }, inputs: [{ name: 'x', type: 'int', default: 3 }, { name: 'document', type: 'object', default: {} }, { name: 'table', type: 'table', default: [] }, { name: 'photo', type: 'image', required: false }], outputs: [{ name: 'answer', type: 'number' }, { name: 'metadata', type: 'object' }, { name: 'preview', type: 'image' }] }))
    const clientOrigin = http.createServer((req, res) => res.end('<!doctype html><title>Client</title>'))
    await new Promise(resolve => clientOrigin.listen(0, '127.0.0.1', resolve))
    const allowed = 'http://127.0.0.1:' + clientOrigin.address().port
    let server, child, context
    try {
      let base
      if (runtime === 'node') {
        server = await gen(['serve', filename, '--port', '0', '--auth-token', token, '--cors-origin', allowed])
        if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
        base = 'http://127.0.0.1:' + server.address().port
      } else {
        const { spawn } = require('child_process')
        const source = 'import importlib,sys,signal\nr=importlib.import_module("jsee.jsee")\noriginal=r.ThreadingHTTPServer\ndef factory(*a,**k):\n    server=original(*a,**k)\n    print("PORT="+str(server.server_port),flush=True)\n    return server\nr.ThreadingHTTPServer=factory\ndef stop(*a):\n    raise KeyboardInterrupt\nsignal.signal(signal.SIGTERM,stop)\nr.serve(sys.argv[1],port=0,canonical=True,auth_token=sys.argv[2],cors_origins=[sys.argv[3]])\n'
        child = spawn('python', ['-u', '-c', source, filename, token, allowed], { env: { ...process.env, PYTHONPATH: path.resolve(__dirname, '../py'), TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] })
        base = await new Promise((resolve, reject) => {
          let log = ''
          child.stdout.on('data', data => { log += data; const match = /PORT=(\d+)/.exec(log); if (match) resolve('http://127.0.0.1:' + match[1]) })
          child.stderr.on('data', data => { log += data })
          child.once('exit', () => reject(new Error(log)))
          child.once('error', reject)
        })
      }
      // Browser credentials authenticate navigation, runtime scripts and same-origin calls.
      context = await browser.newContext({ httpCredentials: { username: 'jsee', password: token, origin: base } })
      const page = await context.newPage()
      const messages = []
      const uploads = []
      page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/__jsee/artifacts')) uploads.push(request.url()) })
      page.on('console', message => messages.push(message.text()))
      page.on('pageerror', error => messages.push(String(error)))
      expect((await page.goto(base)).status()).toBe(200)
      await page.evaluate(() => window.env._initPromise)
      const started = await page.evaluate(() => window.env.run())
      expect(started, messages.join('\n')).toBe(true)
      await expect.poll(() => page.evaluate(() => window.env.data.outputs[0].value)).toBe(6)

      await page.getByLabel('document', { exact: true }).fill('{"items":[0,false,null]}')
      await page.getByRole('button', { name: 'Edit JSON', exact: true }).click()
      await page.getByLabel('table', { exact: true }).fill('[{"value":false},{"value":null}]')
      await page.getByLabel('photo', { exact: true }).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0, 255, 128]) })
      expect(await page.evaluate(() => window.env.run())).toBe(true)
      const media = await page.evaluate(async () => ({ metadata: window.env.data.outputs[1].value, bytes: Array.from(new Uint8Array(await (await fetch(window.env.data.outputs[2].value)).arrayBuffer())) }))
      expect(media.metadata).toEqual({ document: { items: [0, false, null] }, table: [{ value: false }, { value: null }], bytes: [0, 255, 128] })
      expect(media.bytes).toEqual([0, 255, 128])
      await page.locator('#x').fill('4')
      expect(await page.evaluate(() => window.env.run())).toBe(true)
      expect(uploads).toHaveLength(1)

      expect(await page.content()).not.toContain(token)
      await page.goto(allowed)
      const result = await page.evaluate(async ({ base, token }) => {
        const response = await fetch(base + '/run', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{"x":4}' })
        return { status: response.status, run: await response.json() }
      }, { base, token })
      expect(result.status).toBe(200)
      expect(result.run.outputs.answer).toBe(8)
      const error = await page.evaluate(async ({ base, token }) => {
        try { await fetch(base + '/compute', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'X-Not-Allowed': 'yes' }, body: '{}' }); return null } catch (error) { return error.name }
      }, { base, token })
      expect(error).toBe('TypeError')
    } finally {
      if (context) await context.close()
      if (server) await new Promise(resolve => server.close(resolve))
      if (child && child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited }
      await new Promise(resolve => clientOrigin.close(resolve))
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('worker initialization has a bounded deadline', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="deadline"></div>'
    const app = new JSEE({ container: '#deadline', schema: {
      model: { type: 'async-init', worker: true, initTimeout: 100, autorun: false, code: 'async function model() { await new Promise(() => {}) }' }
    } })
    const outcome = await Promise.race([app._initPromise.then(() => 'settled', () => 'rejected'), new Promise(resolve => setTimeout(() => resolve('hung'), 1500))])
    const workers = app._workers.length
    app.destroy()
    return { outcome, workers }
  })
  expect(result.outcome).not.toBe('hung')
  expect(result.workers).toBe(0)
})

test('dynamic classic worker retains imports, classes and globals', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const Original = window.Worker
    const types = []
    window.Worker = class extends Original { constructor(url, options) { types.push(options && options.type); super(url, options) } }
    document.body.innerHTML = '<div id="module-worker"></div>'
    const app = new JSEE({ container: '#module-worker', schema: {
      model: { name: 'Model', type: 'class', method: 'run', worker: true, autorun: false,
        imports: ['/test/fixtures/worker-compat.js'],
        code: 'class Model { run(data) { return { answer: helper(data.x) * self.factor, moduleWorker: (()=>{try{importScripts();return false}catch(e){return true}})() } } }' },
      inputs: [{ name: 'x', type: 'int', default: 2 }], outputs: [{ name: 'answer', type: 'number' }, { name: 'moduleWorker', type: 'bool' }]
    } })
    await app._initPromise
    const ok = await app.run()
    const values = app.data.outputs.map(o => o.value)
    app.destroy(); window.Worker = Original
    return { ok, values, types }
  })
  expect(result).toEqual({ ok: true, values: [9, false], types: ['classic'] })
})

test('classic imports preserve each script strictness and model globals', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="script-scope"></div>'
    const app = new JSEE({ container: '#script-scope', schema: {
      model: { worker: true, autorun: false, imports: ['/test/fixtures/worker-strict.js'],
        code: 'function model() { return { answer: this === self && self.strictImportLoaded } }' },
      outputs: [{ name: 'answer', type: 'bool' }]
    } })
    await app._initPromise
    const ok = await app.run()
    const answer = app.data.outputs[0].value
    app.destroy()
    return { ok, answer }
  })
  expect(result).toEqual({ ok: true, answer: true })
})

test('embedding handle owns inputs, results, cancellation and teleported regions', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="host"></div><aside id="controls"></aside><main id="results"></main>'
    const events = []
    const app = new JSEE({ container: '#host', verbose: false,
      regions: { inputs: '#controls', outputs: '#results' },
      schema: { persist: false, model: { worker: false, type: 'async-function', code: async data => {
        await new Promise(resolve => setTimeout(resolve, 50))
        if (data.x < 0) throw new Error('negative')
        return { answer: data.x * 2 }
      } }, inputs: [{ name: 'x', type: 'int', default: 2 }], outputs: [{ name: 'answer', type: 'number' }] }
    })
    window.embedding = app
    await app.ready
    app.on('inputs', values => events.push(values.x))
    await app.setInputs({ x: 4 })
    const values = app.getInputs()
    values.x = 99
    const answer = await app.invoke()
    let failure
    try { await app.invoke({ x: -1 }) } catch (error) { failure = error.message }
    const pending = app.invoke({ x: 8 })
    await new Promise(resolve => setTimeout(resolve, 10))
    app.stop()
    let cancelled
    try { await pending } catch (error) { cancelled = error.name }
    return { answer, current: app.getInputs().x, failure, cancelled, events,
      controls: !!document.querySelector('#controls input'), output: !!document.querySelector('#results #outputs') }
  })
  expect(result).toMatchObject({ answer: { answer: 8 }, current: 8, failure: 'negative', cancelled: 'AbortError', controls: true, output: true })
  expect(result.events).toContain(4)
  await page.evaluate(() => window.embedding.destroy())
  await expect(page.locator('#controls input')).toHaveCount(0)
  await expect(page.locator('#results #outputs')).toHaveCount(0)
})

test('embedding patches are atomic, grouped, isolated and reject overlapping invocations', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>'
    const schema = { persist: false,
      model: { worker: false, type: 'async-function', code: async data => {
        await new Promise(resolve => setTimeout(resolve, 25))
        return { answer: data.settings.x }
      } },
      inputs: [{ name: 'settings', type: 'group', elements: [{ name: 'x', type: 'int', default: 2 }] }],
      outputs: [{ name: 'answer', type: 'number' }] }
    const a = new JSEE({ container: '#a', schema, verbose: false })
    const b = new JSEE({ container: '#b', schema, verbose: false })
    await Promise.all([a.ready, b.ready])
    let invalid
    try { await a.setInputs({ settings: { x: 9, missing: 1 } }) } catch (error) { invalid = error.message }
    const before = a.getInputs()
    const first = a.invoke({ settings: { x: 7 } })
    let overlap
    try { await a.invoke({ settings: { x: 99 } }) } catch (error) { overlap = error.message }
    const answer = await first
    const other = b.getInputs()
    let notifications = 0
    const off = a.on('inputs', () => notifications++)
    off()
    await a.setInputs({ settings: { x: 8 } })
    a.destroy(); b.destroy()
    let destroyed
    try { await a.invoke() } catch (error) { destroyed = error.message }
    return { before, answer, other, invalid, overlap, notifications, destroyed }
  })
  expect(result).toEqual({ before: { settings: { x: 2 } }, answer: { answer: 7 }, other: { settings: { x: 2 } },
    invalid: 'Unknown input: missing', overlap: 'A run is already in progress', notifications: 0, destroyed: 'JSEE instance has been destroyed' })
})

test('an optional binary file can be empty while another input runs', async ({ page }) => {
  await page.goto('/load/')
  const errors = []
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="optional-file"></div>'
    window.optionalFile = new JSEE({ container: '#optional-file', verbose: false, schema: {
      persist: false, model: { worker: false, code: data => ({ answer: data.bundle === null }) },
      inputs: [{ name: 'bundle', type: 'file', raw: true, default: null, nullable: true }],
      outputs: [{ name: 'answer', type: 'object' }]
    } })
    await window.optionalFile.ready
  })
  await expect(page.locator('#optional-file input[type=file]')).toHaveCount(1)
  expect(await page.evaluate(() => window.optionalFile.invoke())).toEqual({ answer: true })
  expect(errors).toEqual([])
  await page.evaluate(() => window.optionalFile.output({ bundle: null }))
  expect(await page.evaluate(() => window.optionalFile.getInputs())).toEqual({ bundle: null })
  await page.evaluate(() => window.optionalFile.destroy())
})

test('worker input-option updates survive internal caller metadata', async ({ page }) => {
  await page.goto('/load/')
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="options"></div>'
    window.optionsApp = new JSEE({ container: '#options', verbose: false, schema: {
      persist: false, model: { worker: true, code: 'function model () { return { target: { options: ["", "label"], value: "" } } }' },
      inputs: [{ name: 'target', type: 'select', options: [''] }], outputs: [{ name: 'result', type: 'string' }]
    } })
    await window.optionsApp.ready
    await window.optionsApp.invoke()
  })
  await expect(page.locator('#options select option')).toHaveText(['', 'label'])
  await page.evaluate(() => window.optionsApp.invoke({ target: 'label' }))
  await page.evaluate(() => window.optionsApp.destroy())
})

test('Run waits for model initialization and destroy observers cannot reenter disposal', async ({ page }) => {
  await page.goto('/load/')
  await page.evaluate(() => {
    document.body.innerHTML = '<div id="early"></div>'
    window.early = new JSEE({ container: '#early', verbose: false, schema: {
      persist: false, model: { worker: false, type: 'async-init', code: async () => {
        await new Promise(resolve => { window.releaseEarly = resolve })
        return () => ({ answer: 42 })
      } }, inputs: [], outputs: [{ name: 'answer', type: 'number' }]
    } })
  })
  await expect.poll(() => page.evaluate(() => typeof window.releaseEarly)).toBe('function')
  const settled = await page.evaluate(async () => {
    window.earlySettled = false
    window.earlyRun = window.early.run().then(value => { window.earlySettled = true; return value })
    await new Promise(resolve => setTimeout(resolve, 30))
    return window.earlySettled
  })
  expect(settled).toBe(false)
  expect(await page.evaluate(async () => { window.releaseEarly(); return window.earlyRun })).toBe(true)
  await expect(page.locator('#early #outputs')).toContainText('42')
  expect(await page.evaluate(() => {
    let calls = 0
    window.early.on('destroy', () => { if (++calls === 1) window.early.destroy() })
    window.early.destroy()
    return calls
  })).toBe(1)
})

test('Stop cancels invoke before input patching reaches the pipeline', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="invoke-stop"></div>'
    window.invokeStopCalls = 0
    const app = new JSEE({ container: '#invoke-stop', verbose: false, schema: {
      persist: false, inputs: [{ name: 'x', type: 'int', default: 1 }], outputs: [{ name: 'answer', type: 'number' }],
      model: { worker: false, code: data => { window.invokeStopCalls++; return { answer: data.x } } }
    } })
    await app.ready
    const pending = app.invoke({ x: 2 })
    app.stop()
    let error
    try { await pending } catch (caught) { error = caught.name }
    const calls = window.invokeStopCalls
    const next = await app.invoke({ x: 3 })
    app.destroy()
    return { error, calls, next }
  })
  expect(result).toEqual({ error: 'AbortError', calls: 0, next: { answer: 3 } })
})

test('embedded controls and toasts are independently owned by each host', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="quiet"></div><div id="normal"></div>')
    const schema = { persist: false, inputs: [{ name: 'x', type: 'int', default: 1 }], outputs: [{ name: 'answer', type: 'int' }],
      model: { worker: false, code: data => { if (data.x < 0) throw new Error('host-visible failure'); return { answer: data.x + 1 } } } }
    const quiet = new JSEE({ container: '#quiet', schema, controls: false, toasts: false, verbose: false })
    await quiet.ready
    quiet.notify('quiet host marker')
    await new Promise(resolve => requestAnimationFrame(resolve))
    const messages = document.body.textContent
    let error = ''
    try { await quiet.invoke({ x: -1 }) } catch (e) { error = e.message }
    const normal = new JSEE({ container: '#normal', schema, verbose: false })
    await normal.ready
    normal.notify('normal host marker')
    window.embeddedQuiet = quiet
    window.embeddedNormal = normal
    return { messages, error, outputs: await quiet.invoke({ x: 4 }) }
  })
  expect(result.messages).not.toContain('quiet host marker')
  expect(result.error).toContain('host-visible failure')
  expect(result.outputs.answer).toBe(5)
  await expect(page.locator('#quiet .jsee-card-footer')).toHaveCount(0)
  await expect(page.locator('#normal .jsee-run-btn')).toBeVisible()
  await expect(page.locator('.notyf')).toContainText('normal host marker')
  await page.evaluate(() => { window.embeddedQuiet.destroy(); window.embeddedNormal.destroy() })
})

test('one composed JSEE runs scoped module chains and branches, reuses ancestors and restores results', async ({ page }) => {
  await page.goto('/load/')
  const schema = require('./fixtures/composition.json')
  const result = await page.evaluate(async schema => {
    const container = document.createElement('div'); document.body.append(container)
    const app = window.composite = new JSEE({ container, schema, toasts: false })
    await app.ready
    const first = await app.invoke({ source: { count: 4 }, left: { scale: 3 } }, { target: 'left' })
    const sourceRevision = app.getPipelineState().stages.source.revision
    const second = await app.invoke(undefined, { target: 'right' })
    const state = app.getPipelineState()
    await app.setInputs({ left: { scale: 4 } })
    const stale = app.getPipelineState().stages.left.status
    return { first, second, sourceRevision, nextRevision: state.stages.source.revision, stale,
      roots: container.querySelectorAll('.jsee-app').length }
  }, schema)
  expect(result.first['left.value']).toBe(30)
  expect(result.second['right.value']).toBe(4)
  expect(result.sourceRevision).toBe(result.nextRevision)
  expect(result.stale).toBe('stale')
  expect(result.roots).toBe(1)
})

test('module inspection scopes dynamic input updates and partial outputs to the selected module', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const container = document.createElement('div'); document.body.append(container)
    const module = {
      inputs: [{ name: 'target', type: 'select', options: [''], default: '' }, { name: 'inspect', type: 'checkbox', default: false, display: false }],
      model: { type: 'async-function', name: 'model', worker: true,
        code: `async function model(input) { if (input.inspect) { postMessage({_partial:true, report:'inspected'}); return {target:{options:['','x','y'],value:''}} } return {report:input.target} }` },
      outputs: [{ name: 'report', type: 'string' }]
    }
    const app = new JSEE({ container, toasts: false, schema: { persist: false,
      inputs: ['a','b'].map(id => ({ type: 'group', name: id, elements: module.inputs.map(field => ({...field, _id:id+'--'+field.name})) })),
      outputs: ['a','b'].map(id => ({ type: 'group', elements: module.outputs.map(field => ({ ...field, name:id+'.'+field.name })) })),
      model: ['a','b'].map(id => ({ ...module.model, id, scope:id })) } })
    await app.ready
    await app.invoke(undefined, { target: 'a', transient: true, overrides: { inspect: true, target: '' } })
    const options = app.data.inputs.map(group => group.elements[0].options)
    await app.setInputs({ a: { target: 'y' } })
    const output = await app.invoke(undefined, { target: 'a' })
    return { options, output, hiddenControls: container.querySelectorAll('input[type=checkbox]').length, ids: [...container.querySelectorAll('select')].map(element => element.id) }
  })
  expect(result.hiddenControls).toBe(0)
  expect(new Set(result.ids).size).toBe(result.ids.length)
  expect(result.options).toEqual([['', 'x', 'y'], ['']])
  expect(result.output['a.report']).toBe('y')
})

test('composed schema exports as one offline JSEE application without the composer', async ({ page }) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-composite-'))
  try {
    await page.goto('/load/')
    const schema = require('./fixtures/composition.json')
    const html = await page.evaluate(async schema => {
      const container = document.createElement('div'); document.body.append(container)
      const app = new JSEE({ container, schema, toasts: false })
      await app.ready
      await app.invoke({ source: { count: 4 }, left: { scale: 3 } })
      return (await app.exportHTML({ runtime: '/dist/jsee.core.js' })).text()
    }, schema)
    const file = path.join(directory, 'index.html'); fs.writeFileSync(file, html)
    const requests = []
    await page.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort() })
    await page.goto(pathToFileURL(file).href)
    const result = await page.evaluate(async () => { await window.env.ready; return window.env.invoke() })
    expect(result['left.value']).toBe(30)
    expect(result['right.value']).toBe(4)
    expect(requests).toEqual([])
    expect(await page.locator('.jsee-app').count()).toBe(1)
  } finally { await page.goto('about:blank'); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('function outputs dispose the previous render and their mounted resources', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const container = document.createElement('div'); document.body.append(container)
    let disposed = 0
    const app = new JSEE({ container, toasts: false, schema: { inputs: [], outputs: [{ name: 'report', type: 'function' }],
      model: { type: 'function', worker: false, code: () => ({ report: element => { element.textContent = 'report'; return () => { disposed++ } } }) } } })
    await app.ready; await app.invoke(); await new Promise(requestAnimationFrame)
    await app.invoke(); await new Promise(requestAnimationFrame)
    const rerendered = disposed
    app.destroy()
    return { rerendered, disposed }
  })
  expect(result).toEqual({ rerendered: 1, disposed: 2 })
})

test('selected input groups share a host inspector without reruns or remounts', async ({ page }) => {
  await page.goto('/load/')
  const schema = require('./fixtures/composition.json')
  const result = await page.evaluate(async schema => {
    const container = document.createElement('div'), inspector = document.createElement('div')
    document.body.append(container, inspector)
    const app = new JSEE({ container, schema, controls: false, toasts: false, regions: { inputGroups: inspector } })
    await app.ready
    app.selectInputGroup('source')
    await app.invoke(undefined, { target: 'left' })
    const before = app.getPipelineState()
    app.selectInputGroup('left')
    await new Promise(resolve => setTimeout(resolve, 0))
    const visible = [...inspector.querySelectorAll('.jsee-input-col')].filter(element => getComputedStyle(element).display !== 'none').length
    const after = app.getPipelineState()
    await app.invoke()
    const full = app.getPipelineState()
    await app.invoke()
    const reused = app.getPipelineState()
    app.destroy()
    return { visible, before, after, full, reused, remaining: inspector.childElementCount }
  }, schema)
  expect(result.visible).toBe(1)
  expect(result.after).toEqual(result.before)
  expect(result.reused).toEqual(result.full)
  expect(result.remaining).toBe(0)
})

test('nested parameter groups receive scoped inspection updates and selection changes only presentation', async ({ page }) => {
  await page.goto('/load/')
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="nested"></div>'
    const field = name => ({ name, type: 'group', label: name, style: 'section', collapsed: true,
      elements: [{ name: 'column', type: 'select', options: [''], default: '' }] })
    window.nestedApp = new JSEE({ container: '#nested', schema: { persist: false,
      inputs: [{ name: 'segment', type: 'group', style: 'blocks', elements: [field('rename'), field('diff')] }],
      model: [{ id: 'transform', scope: 'segment', worker: false,
        code: 'function model() { return {diff:{column:{options:["","price"],value:"price"}}} }' }], outputs: [] } })
    await window.nestedApp.ready
    await window.nestedApp.invoke(undefined, { target: 'transform', transient: true })
  })
  expect(await page.evaluate(() => window.nestedApp.getInputs().segment.diff.column)).toBe('price')
  await page.evaluate(() => window.nestedApp.selectInputGroup('diff'))
  await expect(page.locator('[data-jsee-input-group="diff"] select')).toBeVisible()
  await expect(page.locator('[data-jsee-input-group="rename"] select')).not.toBeVisible()
  expect(await page.evaluate(() => window.nestedApp.getStages().transform.revision)).toBe(0)
})

test('host control state is atomic, scoped and does not execute or change values', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="host-state"></div>'
    const app = new JSEE({ container: '#host-state', verbose: false, toasts: false, schema: {
      persist: false, autorun: false, reactive: true,
      model: { worker: false, code: data => data },
      inputs: [{ name: 'settings', type: 'group', elements: [
        { name: 'choice.with.dot', type: 'select', options: ['a', 'b'], default: 'a' },
        { name: 'text', type: 'string', default: 'kept' }
      ] }], outputs: []
    } })
    await app.ready
    let runs = 0, changes = 0
    app.on('start', () => runs++)
    app.on('inputs', () => changes++)
    const path = ['settings', 'choice.with.dot']
    await app.setInputState(path, { disabled: true, options: ['b'] })
    let invalid, unknown
    try { await app.setInputState(path, { disabled: false, value: 'b' }) } catch (error) { invalid = error.message }
    try { await app.setInputState(['missing'], { disabled: true }) } catch (error) { unknown = error.message }
    await app.setInputState(['settings', 'text'], { readonly: true })
    await new Promise(resolve => setTimeout(resolve, 400))
    const root = document.querySelector('#host-state')
    const snapshot = { runs, changes, values: app.getInputs(), disabled: root.querySelector('select').disabled,
      readonly: root.querySelector('input').readOnly, hasErrors: app.app.validateInputs(), invalid, unknown }
    await app.setInputState(path, { options: ['a', 'b'], disabled: false, display: false })
    snapshot.hidden = root.querySelector('select') === null
    await app.setInputState(path, { display: true })
    snapshot.visible = !!root.querySelector('select')
    await app.setInputs({ settings: { text: 'changed' } })
    await new Promise(resolve => setTimeout(resolve, 400))
    snapshot.valueRuns = runs
    app.destroy()
    return snapshot
  })
  expect(result).toMatchObject({ runs: 0, changes: 0, disabled: true, readonly: true, hasErrors: true,
    values: { settings: { 'choice.with.dot': 'a', text: 'kept' } }, hidden: true, visible: true, valueRuns: 1 })
  expect(result.invalid).toContain('value')
  expect(result.unknown).toContain('missing')
})

for (const worker of [false, true]) {
  test(`host progress identifies runs and ignores retired contexts (worker=${worker})`, async ({ page }) => {
    await page.goto('/load/')
    const result = await page.evaluate(async worker => {
      document.body.innerHTML = '<div id="host-progress"></div>'
      const app = new JSEE({ container: '#host-progress', verbose: false, toasts: false, progress: false, schema: {
        persist: false, model: { worker, code: `async function model (data, ctx) {
          if (self.oldProgressContext) self.oldProgressContext.progress(99)
          self.oldProgressContext = ctx
          if (typeof document === 'undefined') postMessage({ _status: 'progress', requestId: 'retired', _progress: 91 })
          ctx.progress(null)
          ctx.progress(25, { loaded: 1, total: 4, phase: 'load' })
          setTimeout(() => ctx.progress(88), 25)
          return { n: data.n }
        }` }, inputs: [{ name: 'n', type: 'int', default: 1 }], outputs: [{ name: 'n', type: 'number' }]
      } })
      await app.ready
      const events = [], off = app.on('progress', event => events.push(event))
      await app.invoke()
      await app.invoke({ n: 2 })
      await new Promise(resolve => setTimeout(resolve, 60))
      off()
      const count = events.length
      await app.invoke({ n: 3 })
      const result = { events, unsubscribed: count === events.length, bar: !!document.getElementById(app.progressId) }
      app.destroy()
      return result
    }, worker)
    expect(result.bar).toBe(false)
    expect(result.unsubscribed).toBe(true)
    expect(result.events.map(event => event.value)).not.toContain(99)
    expect(result.events.map(event => event.value)).not.toContain(88)
    expect(result.events.map(event => event.value)).not.toContain(91)
    const reported = result.events.filter(event => event.value === 25)
    expect(reported).toHaveLength(2)
    expect(reported[0]).toMatchObject({ mode: 'determinate', value: 25, loaded: 1, total: 4, phase: 'load', stageId: null })
    expect(typeof reported[0].runId).toBe('string')
    expect(reported[1].runId).not.toBe(reported[0].runId)
  })
}

test('host overlay is positioned without moving controls or blocking Stop', async ({ page }) => {
  await page.goto('/load/')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const result = await page.evaluate(async () => {
      document.body.innerHTML = '<div id="a"></div><div id="b"></div><div id="region-a"></div><div id="region-b"></div>'
      const apps = []
      for (const id of ['a', 'b']) {
        const app = new JSEE({ container: '#' + id, regions: { inputs: '#region-' + id }, verbose: false, schema: {
          persist: false, model: { worker: false, code: data => data }, inputs: [{ name: 'x', type: 'int', default: 1 }], outputs: []
        } })
        await app.ready
        apps.push(app)
      }
      const values = apps.map(app => {
        const overlay = app.overlay.element, parent = overlay.parentNode
        parent.style.display = 'grid'; parent.style.gap = '18px'
        const button = document.createElement('button');button.textContent = 'Host stop'; parent.appendChild(button)
        app.overlay.hide(); const before = button.getBoundingClientRect().top
        app.overlay.show()
        const style = getComputedStyle(overlay)
        return { id: overlay.id, movement: button.getBoundingClientRect().top - before, position: style.position, pointerEvents: style.pointerEvents }
      })
      apps.forEach(app => app.destroy())
      return values
    })
    expect(result[0].id).not.toBe(result[1].id)
    for (const value of result) {
      expect(Math.abs(value.movement)).toBeLessThanOrEqual(0.5)
      expect(value.position).toBe('absolute')
      expect(value.pointerEvents).toBe('none')
    }
  }
})

test('host control updates preserve named-stage caches and progress scope', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, inputs: [{ name: 'one', type: 'group', elements: [{ name: 'choice', type: 'select', options: ['a'], default: 'a' }] }],
      model: [{ id: 'one', scope: 'one', worker: true, code: 'function model (data, ctx) { ctx.progress(50); return { answer: data.choice } }' }],
      outputs: [{ name: 'one.answer', type: 'string' }]
    } })
    await app.ready
    const events = [];app.on('progress', event => events.push(event))
    await app.invoke()
    const before = app.getPipelineState().stages.one
    await app.setInputState(['one', 'choice'], { readonly: true, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] })
    const after = app.getPipelineState().stages.one
    const values = { before: { status: before.status, revision: before.revision }, after: { status: after.status, revision: after.revision },
      selected: app.getInputs(), labels: [...root.querySelectorAll('option')].map(el => el.textContent), disabled: root.querySelector('select').disabled,
      stage: events.find(event => event.value === 50).stageId }
    let invalid
    try { await app.setInputState(['one', 'choice'], { readonly: false, options: [undefined] }) } catch (error) { invalid = error.message }
    values.atomic = root.querySelector('select').disabled
    values.invalid = !!invalid
    app.destroy()
    return values
  })
  expect(result.after).toEqual(result.before)
  expect(result).toMatchObject({ selected: { one: { choice: 'a' } }, labels: ['Alpha', 'Beta'], disabled: true, stage: 'one', atomic: true, invalid: true })
})

test('host progress listener can destroy the instance without recreating presentation', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false,
      schema: { inputs: [{ name: 'x', type: 'int', default: 1 }], outputs: [] } })
    await app.ready
    app.on('progress', () => app.destroy())
    app.progress(50)
    return { bar: !!document.getElementById(app.progressId), overlay: !!document.getElementById(app.overlayId) }
  })
  expect(result).toEqual({ bar: false, overlay: false })
})

for (const worker of [false, true]) {
  test(`cooperative Stop waits for cleanup and retains model state (worker=${worker})`, async ({ page }) => {
    await page.goto('http://localhost:8484/load/')
    const result = await page.evaluate(async worker => {
      document.body.innerHTML = '<div id="cooperative"></div>'
      const app = new JSEE({ container: '#cooperative', verbose: false, toasts: false, schema: {
        persist: false, autorun: false,
        model: { type: 'async-init', worker, code: `async function model() {
          const identity = Math.random(); let cleanups = 0
          return async (data, ctx) => {
            if (data.wait) {
              ctx.progress(1)
              await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }))
              await new Promise(resolve => setTimeout(resolve, 40))
              cleanups++; ctx.progress(99)
            }
            return { identity, cleanups }
          }
        }` }, inputs: [{ name: 'wait', type: 'checkbox', default: false }], outputs: []
      } })
      await app.ready
      const before = await app.invoke(), progress = []
      let started
      const active = new Promise(resolve => { started = resolve })
      app.on('progress', event => { progress.push(event.value); if (event.value === 1) started() })
      const pending = app.invoke({ wait: true }).then(() => 'unexpected success', error => error.name)
      await active
      const stopping = app.stop({ mode: 'cooperative', graceMs: 1000 })
      const overlap = await app.invoke({ wait: false }).then(() => 'unexpected success', error => error.message)
      const stopped = await stopping, outcome = await pending
      const after = await app.invoke({ wait: false })
      app.destroy()
      return { before, after, stopped, outcome, overlap, progress }
    }, worker)
    expect(result.stopped).toEqual({ retained: true })
    expect(result.outcome).toBe('AbortError')
    expect(result.overlap).toContain('already in progress')
    expect(result.after).toEqual({ identity: result.before.identity, cleanups: 1, wait: false, caller: 'invoke' })
    expect(result.progress).not.toContain(99)
  })
}

test('cooperative Stop escalates for a blocking worker and recovers', async ({ page }) => {
  await page.goto('http://localhost:8484/load/')
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="blocking"></div>'
    const app = new JSEE({ container: '#blocking', verbose: false, toasts: false, schema: {
      persist: false, autorun: false,
      model: { worker: true, code: 'function model(data, ctx) { if (data.block) { ctx.progress(1); while (true) {} } return { ok: true } }' },
      inputs: [{ name: 'block', type: 'checkbox', default: false }], outputs: []
    } })
    await app.ready
    let started
    const active = new Promise(resolve => { started = resolve })
    app.on('progress', event => { if (event.value === 1) started() })
    const pending = app.invoke({ block: true }).catch(error => error.name)
    await active
    const stopped = await app.stop({ mode: 'cooperative', graceMs: 40 })
    const outcome = await pending, after = await app.invoke({ block: false })
    app.destroy()
    return { stopped, outcome, after }
  })
  expect(result.stopped).toEqual({ retained: false })
  expect(result.outcome).toBe('AbortError')
  expect(result.after.ok).toBe(true)
})

test('cooperative Stop retains batched training state and prevents downstream execution', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false,
      inputs: [{ name: 'source', type: 'group', elements: [] }, { name: 'training', type: 'group', elements: [{ name: 'steps', type: 'int', default: 0 }] }],
      model: [
        { id: 'source', scope: 'source', worker: true, code: 'function model() { return { target: 2 } }' },
        { id: 'training', scope: 'training', type: 'async-init', worker: true,
          bindings: { target: { stage: 'source', path: ['target'] } },
          code: `async function model() {
            let weight = 0, batches = 0; const identity = Math.random()
            return async (data, ctx) => {
              for (let i = 0; i < data.steps && !ctx.isCancelled(); i++) {
                weight -= .1 * (weight - data.target); batches++
                ctx.progress(10)
                await new Promise(resolve => setTimeout(resolve, 5))
              }
              return { weight, batches, identity }
            }
          }` },
        { id: 'report', type: 'async-init', worker: true, bindings: { weight: { stage: 'training', path: ['weight'] } },
          code: 'async function model() { let calls = 0; return () => ({ calls: ++calls }) }' }
      ], outputs: ['training.weight', 'training.batches', 'training.identity', 'report.calls'].map(name => ({ name, type: 'number' }))
    } })
    await app.ready
    const before = await app.invoke()
    let started
    const active = new Promise(resolve => { started = resolve })
    app.on('progress', event => { if (event.stageId === 'training' && event.value === 10) started() })
    const pending = app.invoke({ training: { steps: 200 } }).catch(error => error.name)
    await active
    const stopped = await app.stop({ mode: 'cooperative', graceMs: 1000 })
    const outcome = await pending, state = app.getPipelineState()
    const after = await app.invoke({ training: { steps: 1 } })
    app.destroy()
    return { before, stopped, outcome, state, after }
  })
  expect(result.stopped).toEqual({ retained: true })
  expect(result.outcome).toBe('AbortError')
  expect(result.state.stages.source.revision).toBe(1)
  expect(result.state.stages.training.status).toBe('cancelled')
  expect(result.state.stages.report.revision).toBe(1)
  expect(result.after['training.identity']).toBe(result.before['training.identity'])
  expect(result.after['training.batches']).toBeGreaterThan(1)
  expect(result.after['training.batches']).toBeLessThan(201)
  expect(result.after['report.calls']).toBe(2)
})

test('cooperative main-thread cleanup cannot be preempted by the worker grace timeout', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false, inputs: [], outputs: [],
      model: { worker: false, type: 'async-function', code: 'async function model(data, ctx) { ctx.progress(1); await new Promise(resolve => setTimeout(resolve, 80)); self.cleaned = true; return {} }' }
    } })
    await app.ready
    let started
    const active = new Promise(resolve => { started = resolve })
    app.on('progress', event => { if (event.value === 1) started() })
    const pending = app.invoke().catch(error => error.name)
    await active
    const stopped = await app.stop({ mode: 'cooperative', graceMs: 5 }), cleaned = self.cleaned
    const outcome = await pending
    app.destroy()
    return { stopped, cleaned, outcome }
  })
  expect(result).toEqual({ stopped: { retained: true }, cleaned: true, outcome: 'AbortError' })
})

test('cooperative Stop also stops an interval between invocations', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    self.intervalCalls = 0
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false, interval: 100, inputs: [], outputs: [],
      model: { worker: false, code: 'function model() { return { calls: ++self.intervalCalls } }' }
    } })
    await app.ready
    const loop = app.run()
    while (app.running || self.intervalCalls === 0) await new Promise(resolve => setTimeout(resolve, 1))
    const stopped = await app.stop({ mode: 'cooperative' })
    await loop
    await new Promise(resolve => setTimeout(resolve, 130))
    const calls = self.intervalCalls
    app.destroy()
    return { stopped, calls }
  })
  expect(result).toEqual({ stopped: { retained: true }, calls: 1 })
})

for (const action of ['force', 'destroy']) {
  test(`pending cooperative Stop can be escalated by ${action}`, async ({ page }) => {
    await page.goto('/load/')
    const result = await page.evaluate(async action => {
      const root = document.createElement('div');document.body.append(root)
      const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
        persist: false, autorun: false, inputs: [], outputs: [], model: { worker: true, type: 'async-function',
          code: 'async function model(data, ctx) { ctx.progress(1); await new Promise(resolve => setTimeout(resolve, 10000)); return {} }' }
      } })
      await app.ready
      let started
      const active = new Promise(resolve => { started = resolve })
      app.on('progress', event => { if (event.value === 1) started() })
      const pending = app.invoke().catch(error => error.name)
      await active
      const stopping = app.stop({ mode: 'cooperative', graceMs: 5000 })
      if (action === 'destroy') app.destroy()
      else await app.stop()
      const stopped = await stopping, outcome = await pending
      app.destroy()
      return { stopped, outcome }
    }, action)
    expect(result).toEqual({ stopped: { retained: false }, outcome: 'AbortError' })
  })
}

test('cooperative Stop requires readiness before claiming retention', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false, inputs: [], outputs: [],
      model: { worker: false, type: 'async-init', code: 'async function model() { await new Promise(resolve => setTimeout(resolve, 40)); return () => ({ ok: true }) }' }
    } })
    const early = await app.stop({ mode: 'cooperative' }).then(() => 'accepted', error => error.message)
    await app.ready
    const ready = await app.stop({ mode: 'cooperative' })
    app.destroy()
    return { early, ready }
  })
  expect(result.early).toContain('Await instance.ready')
  expect(result.ready).toEqual({ retained: true })
})

test('cooperative Stop suppresses a terminal worker progress reset already in transit', async ({ page }) => {
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false, inputs: [], outputs: [],
      model: { worker: true, code: 'function model(data, ctx) { ctx.progress(10); return { ok: true } }' }
    } })
    await app.ready
    const progress = [];let stopping
    app.on('progress', event => {
      progress.push(event.value)
      if (event.value === 10) stopping = app.stop({ mode: 'cooperative' })
    })
    const outcome = await app.invoke().catch(error => error.name)
    await stopping
    app.destroy()
    return { progress, outcome }
  })
  expect(result).toEqual({ progress: [10], outcome: 'AbortError' })
})
