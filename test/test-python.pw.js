const { test, expect } = require('@playwright/test')

const port = 8484
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`

test.describe('Python', () => {
  test('Window', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto(urlHTML('python'))
    // Wait for pyodide to load
    await page.waitForTimeout(10000)
    await page.fill('#a', '4')
    await page.fill('#b', '2')
    await page.click('button:has-text("Run")')
    await page.waitForTimeout(5000)
    await expect(page.locator('body')).toContainText('3')
  })

  test('entry function runs module once in worker', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto(urlHTML('python-entry'))
    await page.waitForTimeout(10000)

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
