const { test, expect } = require('@playwright/test')
const { prepareAssets } = require('./prepare-assets')

test.beforeAll(async () => {
  test.setTimeout(900000)
  await prepareAssets('python')
})
test.afterEach(async ({ page }) => { await page.evaluate(() => window.app && window.app.destroy()) })

const port = 8484
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`

test.describe('Python', () => {
  test('NumPy worker preserves the browser location global', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto(urlHTML('python'))
    await page.evaluate(() => window.app._initPromise)
    await page.fill('#a', '4')
    await page.fill('#b', '2')
    await page.click('button:has-text("Run")')
    await expect.poll(() => page.evaluate(() => window.app.data.outputs[0].value)).toBe(3)
  })

  test('entry function runs module once in worker', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto(urlHTML('python-entry'))
    await page.evaluate(() => window.app._initPromise)

    await page.click('button:has-text("Run")')
    await expect(page.locator('#result')).toContainText('7', { timeout: 30000 })
    await expect(page.locator('#module_loads')).toContainText('1')
    await expect(page.locator('#run_caller')).toContainText('run')

    await page.fill('#a', '6')
    await page.click('button:has-text("Run")')
    await expect(page.locator('#result')).toContainText('11', { timeout: 30000 })
    await expect(page.locator('#module_loads')).toContainText('1')
    await expect(page.locator('#run_caller')).toContainText('run')
  })
})
