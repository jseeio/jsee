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
})
