require('expect-puppeteer')

page.setDefaultTimeout(30000)

// Tests require a server to be running on port 8080
// If you have php installed: php -S localhost:8080
// Python: python -m http.server 8080
// Node: npm install -g http-server && http-server -p 8080

const port = 8080
const urlSchema = (name) => `http://localhost:${port}/load/?s=/test/${name}.schema.json`
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`
const urlQuery = (schema) => `http://localhost:${port}/load/?s=${JSON.stringify(schema)}`

describe('Python', () => {
  test('Window', async () => {
    await page.goto(urlHTML('python'))
    // Wait for pyodide to load
    await (new Promise(resolve => setTimeout(resolve, 10000)))
    await expect(page).toFill('#a', '4')
    await expect(page).toFill('#b', '2')
    await expect(page).toClick('button', { text: 'Run' })
    await (new Promise(resolve => setTimeout(resolve, 5000)))
    await expect(page).toMatchTextContent('3')
  })
})