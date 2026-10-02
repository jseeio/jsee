const { test, expect } = require('@playwright/test')
const { prepareAssets } = require('./prepare-assets')
const cases = require('./fixtures/python-apps.json')

test.beforeAll(async () => {
  test.setTimeout(900000)
  await prepareAssets('python')
})

for (const worker of [false, true]) {
  for (const app of ['pytest', 'pysummary']) {
    test(`${app} pinned Python computation, worker=${worker}`, async ({ page, context }) => {
      test.setTimeout(120000)
      const remote = []
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue()
        remote.push(url.href)
        return route.abort()
      })
      await page.goto('/load/')
      const appPath = app === 'pytest' ? '/test/fixtures/real-apps/pytest/' : '/examples/python-summary/'
      await page.evaluate(async ({ appPath, worker }) => {
        document.body.innerHTML = '<div id="app"></div>'
        const schema = await (await window.fetch(appPath + 'schema.json')).json()
        schema.model.url = appPath + schema.model.url
        schema.model.worker = worker
        schema.model.autorun = false
        schema.model.pyodide = {
          url: '/tmp/test-assets/pyodide-0.24.1/pyodide.js',
          indexURL: '/tmp/test-assets/pyodide-0.24.1/'
        }
        window.app = new JSEE({ container: '#app', schema, verbose: false })
        await window.app._initPromise
        const pipeline = window.app.pipeline
        window.app.pipeline = async data => {
          try { return await pipeline(data) } catch (error) {
            window.modelError = String(error)
            throw error
          }
        }
      }, { appPath, worker })
      try {
        if (app === 'pytest') {
          await page.fill('#a', '4')
          await page.fill('#b', '2')
        }
        for (const fixture of app === 'pytest' ? [null] : cases) {
          if (fixture) {
            await page.locator('input[type=file]').setInputFiles({
              name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from(fixture.csv)
            })
            await expect.poll(() => page.evaluate(() => window.app.data.inputs[0].value)).toBe(fixture.csv)
          }
          const result = await page.evaluate(async () => {
            const succeeded = await window.app.run()
            return { succeeded, value: window.app.data.outputs[0].value, error: window.modelError || null }
          })
          expect(result).toMatchObject({ succeeded: true, error: null })
          if (fixture && fixture.summary.amount && fixture.summary.amount.std === null) {
            expect(Number.isNaN(result.value.amount.std)).toBe(true)
          }
          // Compare the JSON contract; browser arithmetic retains NaN for undefined statistics.
          expect(JSON.parse(JSON.stringify(result.value))).toEqual(fixture ? fixture.summary : 6)
        }
        expect(remote).toEqual([])
      } finally { await page.evaluate(() => window.app.destroy()) }
    })
  }
}

for (const worker of [false, true]) {
  test(`typed media reaches Python as an exact byte buffer, worker=${worker}`, async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('/load/')
    await page.evaluate(async worker => {
      document.body.innerHTML = '<div id="media-python"></div>'
      window.app = new JSEE({ container: '#media-python', verbose: false, schema: {
        persist: false,
        model: { name: 'model', entry: 'model', type: 'py', worker, autorun: false,
          pyodide: { url: '/tmp/test-assets/pyodide-0.24.1/pyodide.js', indexURL: '/tmp/test-assets/pyodide-0.24.1/' },
          code: 'def model(photo):\n    return {"values": list(bytes(photo))}' },
        inputs: [{ name: 'photo', type: 'image' }], outputs: [{ name: 'values', type: 'object' }]
      } })
      await window.app._initPromise
    }, worker)
    await page.getByLabel('photo', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from([0, 255, 128]) })
    expect(await page.evaluate(() => window.app.run())).toBe(true)
    expect(await page.evaluate(() => window.app.data.outputs[0].value)).toEqual([0, 255, 128])
  })
}
