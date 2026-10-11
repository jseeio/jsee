const { test, expect } = require('@playwright/test')

async function mount(page, options={}) {
  await page.goto('/load/')
  await page.evaluate(async options => {
    document.body.innerHTML = '<div id="app"></div>'
    window.app = new JSEE({ container: '#app', verbose: false, toasts: false, schema: {
      persist: false, autorun: false, design: { theme: 'mono' },
      model: { worker: true, code: 'function(data) { return { predictions: data.rows } }' },
      inputs: [{ name: 'rows', type: 'object', default: [{ label: 'low', score: 0.2 }, { label: 'high', score: 0.8 }], display: false }],
      outputs: [{ name: 'predictions', type: 'scores', ...options }]
    } })
    await window.app.ready
    await window.app.invoke()
  }, options)
}

test('scores rank without normalizing, retain rows and inherit live theme', async ({ page }) => {
  await mount(page, { format: 'percent', precision: 1 })
  const meters = page.getByRole('meter')
  await expect(meters).toHaveCount(2)
  await expect(meters.first()).toHaveAttribute('aria-label', 'high')
  await expect(meters.first()).toHaveAttribute('aria-valuenow', '0.8')
  await expect(page.locator('#predictions')).toContainText('80%')
  await page.evaluate(() => { window.lowRow = document.querySelector('[aria-label="low"]') })
  await page.evaluate(() => window.app.invoke({ rows: [{ label: 'low', score: 0.9 }, { label: 'high', score: 0.8 }] }))
  expect(await page.evaluate(() => window.lowRow === document.querySelector('[aria-label="low"]'))).toBe(true)
  await expect(meters.first()).toHaveAttribute('aria-label', 'low')
  await expect(meters.first()).toHaveAttribute('aria-valuenow', '0.9')
  await page.evaluate(() => window.app.setDesign({ colorScheme: 'dark' }))
  await expect(page.locator('.jsee-scores')).toHaveCSS('color', 'rgb(236, 236, 236)')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.app.invoke({ rows: [{ label: 'A'.repeat(200), score: 0.7 }] }))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.app.destroy())
  await expect(meters).toHaveCount(0)
})

test('scores share a declared range, clip only bars and safely render labels', async ({ page }) => {
  await mount(page, { min: -1, max: 1, precision: 2, prefix: '~', suffix: ' units' })
  const result = await page.evaluate(() => window.app.invoke({ rows: [
    { label: '<img src=x onerror=alert(1)>', score: -2 }, { label: 'same', score: 3 }, { label: 'same', score: 0 }
  ] }))
  expect(result.predictions[0].score).toBe(-2)
  await expect(page.getByRole('meter')).toHaveCount(3)
  await expect(page.locator('#predictions img')).toHaveCount(0)
  await expect(page.locator('#predictions')).toContainText('~3 units')
  await expect(page.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '1')
  await expect(page.getByRole('meter').first()).toHaveAttribute('aria-valuetext', /outside display range/)
  await page.evaluate(() => window.app.invoke({ rows: [] }))
  await expect(page.getByRole('meter')).toHaveCount(0)
  await expect(page.locator('#predictions')).toContainText('No scores')
})

test('scores reject malformed values visibly and recover on the next result', async ({ page }) => {
  await mount(page)
  await page.evaluate(() => window.app.invoke({ rows: [{ label: 'bad', score: '0.5' }] }))
  await expect(page.getByRole('alert')).toContainText('score')
  await expect(page.getByRole('meter')).toHaveCount(0)
  await page.evaluate(() => window.app.invoke({ rows: [{ label: 'valid', score: 0.5 }] }))
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('meter')).toHaveAttribute('aria-label', 'valid')
})

test('scores built-in survives standalone offline export', async ({ page }) => {
  const fs = require('fs'), path = require('path'), os = require('os')
  const { pathToFileURL } = require('url')
  const gen = require('../src/cli')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-scores-'))
  try {
    const output = path.join(directory, 'index.html')
    await gen(['--inputs', path.resolve(__dirname, '../examples/scores/schema.json'), '-o', output, '-f', '--runtime', 'inline'])
    const requests = []
    await page.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort() })
    await page.goto(pathToFileURL(output).href)
    await expect(page.getByRole('meter', { name: 'Alpha' })).toHaveAttribute('aria-valuenow', '0.72')
    await expect(page.locator('#scores')).toContainText('72%')
    expect(requests).toEqual([])
  } finally {
    await page.goto('about:blank')
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
