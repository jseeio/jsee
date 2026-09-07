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
