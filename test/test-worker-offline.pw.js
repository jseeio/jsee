const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const gen = require('../src/cli')
const { prepareAssets, assetRoot } = require('./prepare-assets')

test.beforeAll(async () => { test.setTimeout(900000); await prepareAssets('python') })

for (const worker of [false, true]) {
  test(`CLI Pyodide single-file runs offline and downloads again, worker=${worker}`, async ({ page, context }) => {
    test.setTimeout(180000)
    const directory = fs.mkdtempSync(path.resolve(__dirname, '../tmp/worker-offline-'))
    try {
      const runtime = path.relative(directory, path.join(assetRoot, 'pyodide-314.0.7'))
      const schema = { persist: false, model: { name: 'model', type: 'py', entry: 'model', worker, autorun: false,
        imports: ['numpy', 'pandas'], pyodide: { url: path.join(runtime, 'pyodide.mjs'), indexURL: runtime + '/' },
        code: 'import numpy as np\nimport pandas as pd\nimport hashlib, sqlite3, lzma, ssl\ndef model(a):\n    assert hashlib.sha256(b"x").hexdigest().startswith("2d7116")\n    try:\n        ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT).wrap_bio(ssl.MemoryBIO(), ssl.MemoryBIO(), server_hostname="example.com")\n        raise AssertionError("TLS unexpectedly supported")\n    except NotImplementedError:\n        pass\n    return {"answer": float(pd.Series([a, 4]).mean()), "sum": int(np.array([a,4]).sum())}' },
      inputs: [{ name: 'a', type: 'int', default: 2 }], outputs: [{ name: 'answer', type: 'number' }, { name: 'sum', type: 'int' }] }
      const source = path.join(directory, 'schema.json')
      const output = path.join(directory, 'app.html')
      fs.writeFileSync(source, JSON.stringify(schema))
      fs.writeFileSync(output, await gen(['--inputs', source, '--outputs', output, '--bundle=pyodide-single'], true))
      const requests = []
      await context.route(/^https?:/, route => { requests.push(route.request().url()); return route.abort() })
      await context.setOffline(true)
      await page.goto(pathToFileURL(output).href)
      await page.evaluate(() => window.env._initPromise)
      expect(await page.evaluate(() => window.env.run())).toBe(true)
      expect(await page.evaluate(() => window.env.data.outputs.map(o => o.value))).toEqual([3, 6])
      const download = page.waitForEvent('download')
      await page.evaluate(() => window.env.download('again'))
      const downloaded = path.join(directory, 'again.html')
      await (await download).saveAs(downloaded)
      await page.goto(pathToFileURL(downloaded).href)
      await page.evaluate(() => window.env._initPromise)
      expect(await page.evaluate(() => window.env.run())).toBe(true)
      expect(await page.evaluate(() => window.env.data.outputs.map(o => o.value))).toEqual([3, 6])
      expect(requests).toEqual([])
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
}

test('external classic worker bytes survive CLI bundling and browser download at file origins', async ({ page, context }) => {
  const directory = fs.mkdtempSync(path.resolve(__dirname, '../tmp/worker-offline-js-'))
  try {
    const schema = { persist: false, model: { worker: true, workerUrl: './worker.js', autorun: false,
      code: 'function model() { return { answer: 9 } }' }, outputs: [{ name: 'answer', type: 'int' }] }
    fs.copyFileSync(path.resolve(__dirname, '../dist/jsee.worker.js'), path.join(directory, 'worker.js'))
    const source = path.join(directory, 'schema.json')
    const output = path.join(directory, 'app.html')
    fs.writeFileSync(source, JSON.stringify(schema))
    fs.writeFileSync(output, await gen(['--inputs', source, '--outputs', output, '--fetch'], true))
    fs.unlinkSync(path.join(directory, 'worker.js'))
    await context.setOffline(true)
    await page.goto(pathToFileURL(output).href)
    await page.evaluate(() => window.env._initPromise)
    expect(await page.evaluate(() => window.env.run())).toBe(true)
    const download = page.waitForEvent('download')
    await page.evaluate(() => window.env.download('again'))
    const downloaded = path.join(directory, 'again.html')
    await (await download).saveAs(downloaded)
    await page.goto(pathToFileURL(downloaded).href)
    await page.evaluate(() => window.env._initPromise)
    expect(await page.evaluate(() => window.env.run())).toBe(true)
    expect(await page.evaluate(() => window.env.data.outputs[0].value)).toBe(9)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

for (const worker of [false, true]) {
  test(`adjacent Pyodide assets execute without external network, worker=${worker}`, async ({ page, context }) => {
    test.setTimeout(120000)
    const directory = fs.mkdtempSync(path.resolve(__dirname, '../tmp/worker-adjacent-'))
    try {
      const runtime = path.relative(directory, path.join(assetRoot, 'pyodide-314.0.7'))
      const source = path.join(directory, 'schema.json')
      const output = path.join(directory, 'app.html')
      fs.writeFileSync(source, JSON.stringify({ model: { type: 'py', worker, autorun: false, entry: 'model',
        imports: ['numpy'], pyodide: { url: runtime + '/pyodide.mjs', indexURL: runtime + '/' },
        code: 'import numpy as np\ndef model(): return int(np.arange(4).sum())' },
      outputs: [{ name: 'answer', type: 'int' }] }))
      fs.writeFileSync(output, await gen(['--inputs', source, '--outputs', output, '--bundle=pyodide'], true))
      const remote = []
      await context.route(/^https?:/, route => {
        if (new URL(route.request().url()).hostname === 'localhost') return route.continue()
        remote.push(route.request().url()); return route.abort()
      })
      await page.goto('/' + path.relative(path.resolve(__dirname, '..'), output))
      await page.evaluate(() => window.env._initPromise)
      expect(await page.evaluate(() => window.env.run())).toBe(true)
      expect(await page.evaluate(() => window.env.data.outputs[0].value)).toBe(6)
      expect(remote).toEqual([])
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
}
