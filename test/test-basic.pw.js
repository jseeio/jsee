const { test, expect } = require('@playwright/test')
const path = require('path')

const port = 8484
const urlSchema = (name) => `http://localhost:${port}/load/?s=/test/${name}.schema.json`
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`
const urlQueryEscaped = (schema) => `http://localhost:${port}/load/?s=${encodeURIComponent(JSON.stringify(schema))}`
const uploadFixture = path.resolve(__dirname, 'fixtures', 'upload-sample.csv')

function moduleCspPolicy (workerSrc) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `worker-src ${workerSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

async function installModuleCspRoutes (page) {
  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>JSEE CSP test</title></head>
  <body>
    <div id="app"></div>
    <script src="/dist/jsee.core.js"></script>
    <script src="/__jsee-csp/app.js"></script>
  </body>
</html>`
  const appScript = `
(async function () {
  const params = new URLSearchParams(window.location.search)
  const worker = params.get('mode') === 'worker'
  const schema = {
    security: { mode: 'secure' },
    model: {
      type: 'module',
      worker,
      timeout: 1000,
      url: '/test/fixtures/module-worker-model.mjs',
      export: 'predict'
    },
    inputs: [{ name: 'x', type: 'int', default: 6 }],
    outputs: [
      { name: 'result', type: 'number' },
      { name: 'workerScope', type: 'code' }
    ]
  }
  try {
    const app = new JSEE({ container: '#app', schema, verbose: false })
    await app._initPromise
    await app.run()
    await new Promise(resolve => setTimeout(resolve, 100))
    window.__jseeCspResult = {
      ok: true,
      text: document.querySelector('#app').textContent
    }
  } catch (error) {
    window.__jseeCspResult = {
      ok: false,
      error: error && error.message ? error.message : String(error),
      text: document.querySelector('#app').textContent
    }
  }
})()
`

  await page.route(`http://localhost:${port}/__jsee-csp/page.html**`, route => {
    const url = new URL(route.request().url())
    const policy = url.searchParams.get('policy') || 'none'
    const workerSrc = policy === 'blob' ? 'blob:' : policy === 'self' ? "'self'" : "'none'"
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: {
        'Content-Security-Policy': moduleCspPolicy(workerSrc)
      },
      body: html
    })
  })
  await page.route(`http://localhost:${port}/__jsee-csp/app.js`, route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: appScript
    })
  })
}

async function runModuleCspCase (page, mode, policy) {
  await page.goto(`http://localhost:${port}/__jsee-csp/page.html?mode=${mode}&policy=${policy}`)
  await page.waitForFunction(() => window.__jseeCspResult, null, { timeout: 3000 })
  return page.evaluate(() => window.__jseeCspResult)
}

test.describe('Initial test', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(urlSchema('sum'))
  })
  test('Title', async ({ page }) => {
    await expect(page.locator('body')).toContainText('title')
  })
  test('Description', async ({ page }) => {
    await expect(page.locator('body')).toContainText('description')
  })
  test('Run button is active', async ({ page }) => {
    await page.click('button:has-text("Run")')
  })
  test('Default result is right', async ({ page }) => {
    await expect(page.locator('body')).toContainText('142')
  })
  test('Changing inputs', async ({ page }) => {
    await page.fill('#a', '200')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('242')
  })
})

test.describe('Initial test (worker)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(urlSchema('sumw'))
  })
  test('Result is right', async ({ page }) => {
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
})

test.describe('Run cancellation', () => {
  test('Stop cancels a main-thread async run and renders one stop button', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        autorun: false,
        code: `async function (data) {
          await new Promise(resolve => setTimeout(resolve, 2000))
          return { status: 'DONE' }
        }`
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')

    const stopButtons = page.locator('button:has-text("Stop")')
    await expect(stopButtons).toHaveCount(1)
    await stopButtons.click()

    await expect(page.locator('button:has-text("Run")')).toBeVisible()
    await expect(stopButtons).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('DONE')
  })

  test('Stop tears down worker run and next Run rebuilds pipeline', async ({ page }) => {
    const schema = {
      model: {
        worker: true,
        timeout: 2000,
        code: `async function slow (inputs) {
          await new Promise(resolve => setTimeout(resolve, inputs.wait))
          return { status: 'DONE' }
        }`
      },
      inputs: [
        { name: 'wait', type: 'int', default: 1000 }
      ],
      outputs: [
        { name: 'status', type: 'code' }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await page.waitForTimeout(100)
    await page.click('button:has-text("Stop")')
    await expect(page.locator('button:has-text("Run")')).toBeVisible()
    await page.fill('#wait', '1')
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-output-card').filter({ hasText: 'DONE' })).toBeVisible()
  })
})

test.describe('Multiple app instances', () => {
  test('input persistence is namespaced per app and includes grouped inputs', async ({ page }) => {
    await page.goto(`http://localhost:${port}/load/`)
    await page.evaluate(() => {
      localStorage.clear()
      document.body.innerHTML = '<div id="one"></div><div id="two"></div>'
      const makeSchema = (id, fallback) => ({
        id,
        persist: true,
        model: {
          worker: false,
          code: 'function passthrough (inputs) { return inputs }'
        },
        inputs: [
          { name: 'value', type: 'string', default: fallback },
          {
            name: 'settings',
            type: 'group',
            elements: [
              { name: 'choice', type: 'select', options: ['one', 'two'], default: 'one' }
            ]
          },
          { name: 'locked', type: 'string', default: 'fixed', disabled: true }
        ],
        outputs: []
      })
      window.apps = [
        new JSEE({ container: '#one', schema: makeSchema('persist-one', 'A') }),
        new JSEE({ container: '#two', schema: makeSchema('persist-two', 'B') })
      ]
    })

    await expect(page.locator('#one #value')).toHaveValue('A')
    await expect(page.locator('#two #value')).toHaveValue('B')
    await page.fill('#one #value', 'stored-a')
    await page.fill('#two #value', 'stored-b')
    await page.selectOption('#one #choice', 'two')
    await page.waitForTimeout(500)

    await page.evaluate(() => {
      window.apps.forEach(app => app.destroy())
      document.body.innerHTML = '<div id="one"></div><div id="two"></div>'
      const makeSchema = (id, fallback) => ({
        id,
        persist: true,
        model: {
          worker: false,
          code: 'function passthrough (inputs) { return inputs }'
        },
        inputs: [
          { name: 'value', type: 'string', default: fallback },
          {
            name: 'settings',
            type: 'group',
            elements: [
              { name: 'choice', type: 'select', options: ['one', 'two'], default: 'one' }
            ]
          },
          { name: 'locked', type: 'string', default: 'changed', disabled: true }
        ],
        outputs: []
      })
      window.apps = [
        new JSEE({ container: '#one', schema: makeSchema('persist-one', 'fresh-a') }),
        new JSEE({ container: '#two', schema: makeSchema('persist-two', 'fresh-b') })
      ]
    })

    await expect(page.locator('#one #value')).toHaveValue('stored-a')
    await expect(page.locator('#two #value')).toHaveValue('stored-b')
    await expect(page.locator('#one #choice')).toHaveValue('two')
    await expect(page.locator('#one #locked')).toHaveValue('changed')
  })

  test('progress and overlay nodes are scoped per instance', async ({ page }) => {
    await page.goto(`http://localhost:${port}/load/`)
    await page.evaluate(() => {
      localStorage.clear()
      document.body.innerHTML = '<div id="alpha"></div><div id="beta"></div>'
      const schema = {
        persist: false,
        model: {
          worker: false,
          code: 'function demo () { return { done: true } }'
        },
        inputs: [],
        outputs: [{ name: 'done', type: 'code' }]
      }
      window.alphaApp = new JSEE({ id: 'alpha', container: '#alpha', schema: JSON.parse(JSON.stringify(schema)) })
      window.betaApp = new JSEE({ id: 'beta', container: '#beta', schema: JSON.parse(JSON.stringify(schema)) })
    })
    await page.waitForFunction(() => window.alphaApp && window.alphaApp.overlay && window.betaApp && window.betaApp.overlay)
    await page.evaluate(() => {
      window.alphaApp.progress(25)
      window.betaApp.progress(75)
    })

    await expect(page.locator('#jsee-alpha-overlay')).toHaveCount(1)
    await expect(page.locator('#jsee-beta-overlay')).toHaveCount(1)
    await expect(page.locator('#jsee-alpha-progress')).toHaveCount(1)
    await expect(page.locator('#jsee-beta-progress')).toHaveCount(1)
    await expect(page.locator('#jsee-alpha-progress')).toHaveAttribute('style', /width: 25%/)
    await expect(page.locator('#jsee-beta-progress')).toHaveAttribute('style', /width: 75%/)

    await page.evaluate(() => window.alphaApp.destroy())
    await expect(page.locator('#jsee-alpha-progress')).toHaveCount(0)
    await expect(page.locator('#jsee-alpha-overlay')).toHaveCount(0)
    await expect(page.locator('#jsee-beta-progress')).toHaveCount(1)
    await expect(page.locator('#jsee-beta-overlay')).toHaveCount(1)
  })
})

test.describe('Minimal examples', () => {
  const schema = {
    'model': {
      'code': 'function (a, b) { return a / b }',
    }
  }
  test('Code only (text) (main window)', async ({ page }) => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await page.fill('#a', '100')
    await page.fill('#b', '4')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('25')
  })
  test('Code instead of schema (function)', async ({ page }) => {
    await page.goto(urlHTML('minimal1'))
    await page.fill('#a', '100')
    await page.fill('#b', '4')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('400')
  })
  test('Code instead of model (function)', async ({ page }) => {
    await page.goto(urlHTML('minimal2'))
    await page.fill('#a', '100')
    await page.fill('#b', '4')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('400')
  })
  test('Code instead of schema (anonymous function)', async ({ page }) => {
    await page.goto(urlHTML('minimal3'))
    await page.fill('#a', '100')
    await page.fill('#b', '4')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('400')
  })
})

test.describe('Arrow function as model.code', () => {
  test('Main thread', async ({ page }) => {
    await page.goto(urlHTML('arrow-main'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
  test('Worker', async ({ page }) => {
    await page.goto(urlHTML('arrow-worker'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
})

test.describe('Core build (jsee.core.js)', () => {
  test('Arrow function in worker', async ({ page }) => {
    await page.goto(urlHTML('runtime-arrow'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
})

test.describe('Load code directly', () => {
  test('Window', async ({ page }) => {
    await page.goto(urlHTML('code'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
  test('Window (string with eval)', async ({ page }) => {
    await page.goto(urlHTML('string'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
  test('Worker', async ({ page }) => {
    await page.goto(urlHTML('codew'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })
  test('Worker (string)', async ({ page }) => {
    await page.goto(urlHTML('stringw'))
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })

  test('auto-inferred default parameters keep stable input names and warn', async ({ page }) => {
    const logs = []
    page.on('console', msg => logs.push(msg.text()))
    const schema = {
      model: {
        worker: false,
        code: `function add (a = 1, b = 2) {
          return a + b
        }`
      }
    }

    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('#a')).toBeVisible()
    await expect(page.locator('#b')).toBeVisible()
    await expect(page.locator('[id="="]')).toHaveCount(0)
    await expect(page.locator('[id="1"]')).toHaveCount(0)
    await expect(page.locator('[id="2"]')).toHaveCount(0)
    expect(logs.some(line => line.includes('[Schema inference warning]') && line.includes('default value suggests number'))).toBe(true)
  })

  test('auto-inferred numeric default parameters are opt-in', async ({ page }) => {
    const schema = {
      inferInputTypes: true,
      model: {
        worker: false,
        code: `function add (a = 1, b = 2) {
          return a + b
        }`
      }
    }

    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('#a')).toHaveAttribute('type', 'number')
    await expect(page.locator('#b')).toHaveAttribute('type', 'number')
    await page.fill('#a', '8')
    await page.fill('#b', '7')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
    await expect(page.locator('body')).not.toContainText('87')
  })

  test('Window infers function type for URL-loaded JS when type is omitted', async ({ page }) => {
    const schema = {
      model: {
        name: 'sum',
        container: 'args',
        url: '/test/example-sum.js',
        worker: false
      },
      inputs: [
        { name: 'a', type: 'int', default: 8 },
        { name: 'b', type: 'int', default: 7 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })

  test('Worker infers function type for URL-loaded JS when type is omitted', async ({ page }) => {
    const schema = {
      model: {
        name: 'sum',
        container: 'args',
        url: '/test/example-sum.js',
        worker: true
      },
      inputs: [
        { name: 'a', type: 'int', default: 8 },
        { name: 'b', type: 'int', default: 7 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('15')
  })

  test('Secure worker URL init resolves relative URLs and ignores execution timeout', async ({ page }) => {
    await page.route(`http://localhost:${port}/__jsee-slow-worker-init.js`, async route => {
      await new Promise(resolve => setTimeout(resolve, 350))
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `function slowWorkerInit (inputs) {
          return { result: inputs.x + 1 }
        }`
      })
    })

    const schema = {
      security: { mode: 'secure' },
      model: {
        name: 'slowWorkerInit',
        worker: true,
        timeout: 100,
        url: '/__jsee-slow-worker-init.js'
      },
      inputs: [
        { name: 'x', type: 'int', default: 4 }
      ],
      outputs: [
        { name: 'result', type: 'number' }
      ]
    }

    await page.goto(`http://localhost:${port}/load/`)
    const result = await page.evaluate(async (schema) => {
      document.body.innerHTML = '<div id="app"></div>'
      const app = new JSEE({ container: '#app', schema, verbose: false })
      let initError = ''
      try {
        await app._initPromise
        await app.run()
      } catch (error) {
        initError = error && error.message ? error.message : String(error)
      }
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        initError,
        bodyText: document.querySelector('#app').textContent
      }
    }, schema)

    expect(result.initError).toBe('')
    expect(result.bodyText).toContain('5')
  })

  test('Worker runs module models without eval in secure mode', async ({ page }) => {
    const schema = {
      security: { mode: 'secure' },
      model: {
        type: 'module',
        worker: true,
        timeout: 1000,
        url: '/test/fixtures/module-worker-model.mjs',
        export: 'predict'
      },
      inputs: [
        { name: 'x', type: 'int', default: 6 }
      ],
      outputs: [
        { name: 'result', type: 'number' },
        { name: 'workerScope', type: 'code' }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('24')
    await expect(page.locator('body')).toContainText('true')
  })

  test('Module models run under documented CSP policies', async ({ page }) => {
    await installModuleCspRoutes(page)

    const mainResult = await runModuleCspCase(page, 'main', 'none')
    expect(mainResult.ok).toBe(true)
    expect(mainResult.text).toContain('24')
    expect(mainResult.text).toContain('false')

    const workerResult = await runModuleCspCase(page, 'worker', 'blob')
    expect(workerResult.ok).toBe(true)
    expect(workerResult.text).toContain('24')
    expect(workerResult.text).toContain('true')

    const blockedWorkerResult = await runModuleCspCase(page, 'worker', 'self')
    expect(blockedWorkerResult.ok).toBe(false)
  })
})

test.describe('Classes', () => {
  const schema = {
    'model': {
      'name': 'Doubler',
      'method': 'double',
      'type': 'class',
      'container': 'args',
      'url': '/test/example-class.js',
    },
    'inputs': [
      { 'name': 'b', 'type': 'int', 'default': 100 }
    ]
  }

  test('Window', async ({ page }) => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('200')
  })

  test('Worker', async ({ page }) => {
    schema.model.worker = true
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('200')
  })
})

test.describe('Some edge cases', () => {
  test('DOM log sink treats messages as text', async ({ page }) => {
    await page.goto(`http://localhost:${port}/load/`)
    const result = await page.evaluate(async () => {
      document.body.innerHTML = '<pre id="log"></pre><div id="app"></div>'
      const app = new JSEE({
        container: '#app',
        schema: {
          model: {
            worker: false,
            code: 'function passthrough () { return { result: 1 } }'
          },
          outputs: [{ name: 'result', type: 'number' }]
        }
      })
      await app._initPromise
      app.log('<img src="x" onerror="window.__jseeLogXss = 1">')
      await new Promise(resolve => setTimeout(resolve, 100))
      return {
        executed: window.__jseeLogXss === 1,
        imageCount: document.querySelectorAll('#log img').length,
        text: document.querySelector('#log').textContent
      }
    })

    expect(result.executed).toBe(false)
    expect(result.imageCount).toBe(0)
    expect(result.text).toContain('<img src="x"')
  })

  test('Result is zero', async ({ page }) => {
    const schema = {
      'model': {
        'code': 'function mul (a, b) { return a * b }',
      }
    }
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await page.fill('#a', '0')
    await page.fill('#b', '0')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('Copy')
  })

  test('Declared falsy outputs render', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function falsyOutputs () {
          return { count: 0, flag: false, empty: '' }
        }`
      },
      inputs: [],
      outputs: [
        { name: 'count', type: 'number' },
        { name: 'flag', type: 'code' },
        { name: 'empty', type: 'code' }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-number-value')).toContainText('0')
    await expect(page.locator('#flag pre')).toContainText('false')
    await expect(page.locator('.jsee-output-card').filter({ hasText: 'empty' })).toBeVisible()
  })

  test('Declared output wins when output name matches input name', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function sameNameOutput () {
          return { value: 'OUT' }
        }`
      },
      inputs: [
        { name: 'value', type: 'string', default: 'IN' }
      ],
      outputs: [
        { name: 'value', type: 'code' }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-output-card').filter({ hasText: 'OUT' })).toBeVisible()
  })

  test('Worker timeout is cleared after successful run', async ({ page }) => {
    const schema = {
      model: {
        worker: true,
        timeout: 100,
        code: `let runs = 0
        function quick () {
          runs += 1
          return { status: 'run-' + runs }
        }`
      },
      inputs: [],
      outputs: [
        { name: 'status', type: 'code' }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-output-card').filter({ hasText: 'run-1' })).toBeVisible()
    await page.waitForTimeout(250)
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-output-card').filter({ hasText: 'run-2' })).toBeVisible()
  })
})

test.describe('Imports', () => {
  const schema = {
    'model': {
      'name': 'kebab',
      'type': 'function',
      'container': 'args',
      'code': `
      function kebab (str) {
        return _.kebabCase(str)
      }
      `
    },
    'imports': `http://localhost:${port}/test/fixtures/lodash-like.js`,
    'inputs': [
      { 'name': 'str', 'type': 'string', 'default': 'FooBar' },
    ]
  }
  test('Window', async ({ page }) => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('foo-bar')
  })
  test('Worker', async ({ page }) => {
    schema.model.worker = true
    await page.goto(urlQueryEscaped(schema))
    // Worker may need retries for import loading
    const runUntilReady = async (attempts = 3) => {
      if (attempts <= 0) return false
      await page.click('button:has-text("Run")')
      try {
        await page.waitForFunction(() => document.body.innerText.includes('foo-bar'), { timeout: 5000 })
        return true
      } catch {
        return runUntilReady(attempts - 1)
      }
    }
    const ready = await runUntilReady()
    expect(ready).toBe(true)
    await expect(page.locator('body')).toContainText('foo-bar')
  })

  test('Secure mode checks relative imports before URL resolution', async ({ page }) => {
    await page.route(`http://localhost:${port}/__jsee-local-import-lib.js`, route => {
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'self.localImportValue = function () { return 41 }'
      })
    })

    const schema = {
      security: { mode: 'secure', allowEval: true },
      model: {
        imports: ['/__jsee-local-import-lib.js'],
        code: `function imported () {
          return {
            result: self.localImportValue() + 1,
            scope: typeof document === 'undefined' ? 'worker' : 'main'
          }
        }`
      },
      outputs: [
        { name: 'result', type: 'number' },
        { name: 'scope', type: 'code' }
      ]
    }

    await page.goto(`http://localhost:${port}/load/`)
    for (const worker of [false, true]) {
      const result = await page.evaluate(async ({ schema, worker }) => {
        document.body.innerHTML = '<div id="app"></div>'
        const runSchema = JSON.parse(JSON.stringify(schema))
        runSchema.model.worker = worker
        const app = new JSEE({ container: '#app', schema: runSchema, verbose: false })
        let initError = ''
        try {
          await app._initPromise
          await app.run()
        } catch (error) {
          initError = error && error.message ? error.message : String(error)
        }
        await new Promise(resolve => setTimeout(resolve, 100))
        return {
          initError,
          bodyText: document.querySelector('#app').textContent
        }
      }, { schema, worker })

      expect(result.initError).toBe('')
      expect(result.bodyText).toContain('42')
      if (worker) {
        expect(result.bodyText).toContain('worker')
      } else {
        expect(result.bodyText).toContain('main')
      }
    }
  })
})

test.describe('Buttons, button titles and caller', () => {
  const schema = {
    'model': {
      'name': 'callerRepeater',
      'type': 'function',
      'code': `function callerRepeater (inputs) {
        return inputs.caller
      }`
    },
    'inputs': [
      { 'name': 'test_button', 'type': 'button', 'title': 'Test Button' },
    ]
  }
  test('Window', async ({ page }) => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('body')).toContainText('Test Button')
    await page.click('button:has-text("Test Button")')
    await expect(page.locator('body')).toContainText('test_button')
  })
  test('Worker', async ({ page }) => {
    schema.model.worker = true
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Test Button")')
    await expect(page.locator('body')).toContainText('test_button')
  })
  test('Nested group button reaches root runner', async ({ page }) => {
    const nestedSchema = {
      model: {
        worker: false,
        code: `function nestedAction (inputs) {
          return inputs.caller
        }`
      },
      inputs: [
        {
          type: 'group',
          name: 'Controls',
          elements: [
            { name: 'Nested Action', type: 'button', title: 'Nested Action' }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(nestedSchema))
    await page.click('button:has-text("Nested Action")')
    await expect(page.locator('body')).toContainText('nested_action')
  })
})

test.describe('Interval execution', () => {
  test('autorun interval repeats without manual Run and stops cleanly', async ({ page }) => {
    const schema = {
      autorun: true,
      interval: 50,
      model: {
        worker: false,
        name: 'intervalProbe',
        code: `function intervalProbe (inputs) {
          window.__jseeIntervalCalls = (window.__jseeIntervalCalls || 0) + 1
          window.__jseeIntervalCallers = window.__jseeIntervalCallers || []
          window.__jseeIntervalCallers.push(inputs.caller)
          return { result: inputs.caller + ':' + window.__jseeIntervalCalls }
        }`
      },
      inputs: [],
      outputs: [{ name: 'result', type: 'code' }]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.waitForFunction(() => {
      return (window.__jseeIntervalCalls || 0) >= 2
        && (window.__jseeIntervalCallers || []).includes('interval')
    }, null, { timeout: 2000 })

    const callers = await page.evaluate(() => window.__jseeIntervalCallers.slice())
    expect(callers[0]).toBe('autorun')
    expect(callers).toContain('interval')

    await page.click('button:has-text("Stop")')
    const stoppedAt = await page.evaluate(() => window.__jseeIntervalCalls)
    await page.waitForTimeout(180)
    await expect.poll(async () => page.evaluate(() => window.__jseeIntervalCalls)).toBe(stoppedAt)
  })
})

test.describe('Pipeline', () => {
  test('Multiple models', async ({ page }) => {
    let a = 3
    let b = 4
    await page.goto(urlHTML('pipeline'))
    await page.fill('#a', a.toString())
    await page.fill('#b', b.toString())
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText((Math.pow((a + b), 2) + 1).toString())
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText((Math.pow((a + b), 2) + 2).toString())
  })
})

test.describe('File uploads', () => {
  test('default file input reads uploaded text', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function filePreview (inputs) {
          return {
            preview: inputs.file.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    await page.setInputFiles('#vfp-filePicker', uploadFixture)
    await page.waitForFunction(() => document.body.innerText.includes('Selected 1 file(s)'))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('name,age')
  })

  test('raw file input passes File object (not text content)', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function fileRawMeta (inputs) {
          const isFileObject = !!inputs.file
            && (typeof inputs.file === 'object')
            && (typeof inputs.file.name === 'string')
            && (typeof inputs.file.text === 'function')
          return {
            is_file_object: isFileObject,
            is_string: typeof inputs.file === 'string',
            file_name: inputs.file && inputs.file.name ? inputs.file.name : '',
            content_prefix: typeof inputs.file === 'string' ? inputs.file.slice(0, 10) : 'NONE'
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    await page.setInputFiles('#vfp-filePicker', uploadFixture)
    await page.waitForFunction(() => document.body.innerText.includes('Selected 1 file(s)'))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('is_file_object')
    await expect(page.locator('body')).toContainText('true')
    await expect(page.locator('body')).toContainText('file_name')
    await expect(page.locator('body')).toContainText('upload-sample.csv')
    await expect(page.locator('body')).toContainText('content_prefix')
    await expect(page.locator('body')).toContainText('NONE')
  })

  test('raw url input passes URL handle (not fetched text content)', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function fileRawUrlMeta (inputs) {
          const isUrlHandle = !!inputs.file
            && (typeof inputs.file === 'object')
            && (inputs.file.kind === 'url')
            && (typeof inputs.file.url === 'string')
          return {
            is_url_handle: isUrlHandle,
            is_string: typeof inputs.file === 'string',
            url_value: isUrlHandle ? inputs.file.url : '',
            content_prefix: typeof inputs.file === 'string' ? inputs.file.slice(0, 10) : 'NONE'
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true }
      ]
    }
    const rawUrl = 'http://127.0.0.1:9999/nope.csv'
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("From URL")')
    await page.waitForSelector('input.vfp-urlInput[type="text"]')
    await page.click('input.vfp-urlInput[type="text"]', { clickCount: 3 })
    await page.type('input.vfp-urlInput[type="text"]', rawUrl)
    await page.evaluate(() => {
      const loadButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load')
      if (!loadButton) throw new Error('Load button not found')
      loadButton.click()
    })
    await page.click('button:has-text("Run")')
    await page.waitForFunction((expectedUrl) => {
      return document.querySelector('#outputs').innerText.includes(expectedUrl)
    }, rawUrl)
    await expect(page.locator('body')).toContainText('is_url_handle')
    await expect(page.locator('body')).toContainText('true')
    await expect(page.locator('body')).toContainText('url_value')
    await expect(page.locator('body')).toContainText(rawUrl)
    await expect(page.locator('body')).toContainText('content_prefix')
    await expect(page.locator('body')).toContainText('NONE')
  })

  test('file query param auto-loads URL without clicking Load', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function filePreviewFromQuery (inputs) {
          return {
            preview: inputs.file.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file' }
      ]
    }
    const fileUrl = `http://localhost:${port}/test/fixtures/upload-sample.csv`
    await page.goto(`${urlQueryEscaped(schema)}&file=${encodeURIComponent(fileUrl)}`)
    await page.waitForFunction(() => document.body.innerText.includes('Loaded from URL:'), { timeout: 5000 })
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('preview')
    await expect(page.locator('body')).toContainText('name,age')
  })
})

test.describe('Streamed file inputs', () => {
  test('main thread receives uploaded file as async iterable stream', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `async function streamMainFile (inputs) {
          const reader = inputs.file
          const isIterable = !!reader
            && typeof reader[Symbol.asyncIterator] === 'function'
            && typeof reader.text === 'function'
            && typeof reader.bytes === 'function'
            && typeof reader.lines === 'function'
          if (!isIterable) {
            return { is_iterable: false, header: 'NONE' }
          }
          const text = await reader.text()
          return {
            is_iterable: true,
            header: text.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    await page.setInputFiles('#vfp-filePicker', uploadFixture)
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('is_iterable')
    await expect(page.locator('body')).toContainText('true')
    await expect(page.locator('body')).toContainText('header')
    await expect(page.locator('body')).toContainText('name,age')
  })

  test('stream metadata is preserved for downstream pipeline models', async ({ page }) => {
    const schema = {
      model: [
        {
          worker: false,
          code: `function streamStageOne (inputs) {
            return {
              stage1_name: inputs.file && inputs.file.name ? inputs.file.name : 'NONE'
            }
          }`
        },
        {
          worker: false,
          code: `function streamStageTwo (inputs) {
            return {
              stage2_name: inputs.file && inputs.file.name ? inputs.file.name : 'NONE',
              stage2_size: inputs.file && typeof inputs.file.size === 'number' ? inputs.file.size : -1
            }
          }`
        }
      ],
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    await page.setInputFiles('#vfp-filePicker', uploadFixture)
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('stage1_name')
    await expect(page.locator('body')).toContainText('stage2_name')
    await expect(page.locator('body')).toContainText('upload-sample.csv')
    await expect(page.locator('body')).toContainText('stage2_size')
  })

  test('main thread receives URL source as async iterable stream', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `async function streamMainUrl (inputs) {
          const reader = inputs.file
          const text = await reader.text()
          return {
            is_iterable: typeof reader[Symbol.asyncIterator] === 'function',
            header: text.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    const sampleUrl = `http://localhost:${port}/test/fixtures/upload-sample.csv`
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("From URL")')
    await page.waitForSelector('input.vfp-urlInput[type="text"]')
    await page.click('input.vfp-urlInput[type="text"]', { clickCount: 3 })
    await page.type('input.vfp-urlInput[type="text"]', sampleUrl)
    await page.evaluate(() => {
      const loadButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load')
      if (!loadButton) throw new Error('Load button not found')
      loadButton.click()
    })
    await page.click('button:has-text("Run")')
    await page.waitForFunction(() => {
      const outputs = document.querySelector('#outputs')
      return outputs && outputs.innerText.includes('header')
    }, { timeout: 5000 })
    await expect(page.locator('body')).toContainText('is_iterable')
    await expect(page.locator('body')).toContainText('true')
    await expect(page.locator('body')).toContainText('header')
    await expect(page.locator('body')).toContainText('name,age')
  })

  test('worker receives uploaded file as async iterable stream', async ({ page }) => {
    const schema = {
      model: {
        worker: true,
        code: `async function streamWorkerFile (inputs) {
          const reader = inputs.file
          const lines = []
          for await (const line of reader.lines()) {
            lines.push(line)
          }
          return {
            is_iterable: typeof reader.text === 'function',
            header: lines[0] || 'NONE'
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    await page.setInputFiles('#vfp-filePicker', uploadFixture)
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('is_iterable')
    await expect(page.locator('body')).toContainText('true')
    await expect(page.locator('body')).toContainText('header')
    await expect(page.locator('body')).toContainText('name,age')
  })

  test('worker receives URL source as async iterable stream', async ({ page }) => {
    const schema = {
      model: {
        worker: true,
        code: `async function streamWorkerUrl (inputs) {
          const reader = inputs.file
          const decoder = new TextDecoder()
          let text = ''
          for await (const chunk of reader) {
            text += decoder.decode(chunk, { stream: true })
          }
          text += decoder.decode()
          return {
            is_iterable: typeof reader.bytes === 'function',
            header: text.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    const sampleUrl = `http://localhost:${port}/test/fixtures/upload-sample.csv`
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("From URL")')
    await page.waitForSelector('input.vfp-urlInput[type="text"]')
    await page.click('input.vfp-urlInput[type="text"]', { clickCount: 3 })
    await page.type('input.vfp-urlInput[type="text"]', sampleUrl)
    await page.evaluate(() => {
      const loadButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load')
      if (!loadButton) throw new Error('Load button not found')
      loadButton.click()
    })
    await page.click('button:has-text("Run")')
    await page.waitForFunction(() => {
      const outputs = document.querySelector('#outputs')
      return outputs && outputs.innerText.includes('header')
    }, { timeout: 5000 })
    await expect(page.locator('body')).toContainText('is_iterable')
    await expect(page.locator('body')).toContainText('true')
    await expect(page.locator('body')).toContainText('header')
    await expect(page.locator('body')).toContainText('name,age')
  })
})

test.describe('Backward-compatible jsee.runtime.js', () => {
  test('loads and works but shows deprecation warning', async ({ page }) => {
    const warnings = []
    page.on('console', msg => {
      if (msg.type() === 'warning') warnings.push(msg.text())
    })
    await page.goto(urlHTML('runtime-compat'))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('142')
    expect(warnings.some(w => w.includes('jsee.runtime.js is deprecated'))).toBe(true)
  })
})
