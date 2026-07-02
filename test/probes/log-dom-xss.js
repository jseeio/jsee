const fs = require('fs')
const http = require('http')
const path = require('path')
const { chromium } = require('@playwright/test')

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

function contentType (filePath) {
  if (filePath.endsWith('.html')) return 'text/html'
  if (filePath.endsWith('.js')) return 'application/javascript'
  if (filePath.endsWith('.css')) return 'text/css'
  return 'application/octet-stream'
}

function startServer (root, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    let filePath = path.join(root, decodeURIComponent(url.pathname))
    if (url.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html')
    const relative = path.relative(root, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) })
    res.end(fs.readFileSync(filePath))
  })
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function main () {
  const root = path.resolve(__dirname, '..', '..')
  const runtimePath = path.join(root, 'dist', 'jsee.core.js')
  assert(fs.existsSync(runtimePath), 'dist/jsee.core.js is missing; run npm run build-dev first')

  const port = 8625
  const server = await startServer(root, port)
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const baseUrl = `http://127.0.0.1:${port}`

  try {
    await page.goto(`${baseUrl}/load/`)
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

    assert(result.executed === false, 'log HTML executed an event handler')
    assert(result.imageCount === 0, 'log HTML was parsed into DOM nodes')
    assert(result.text.includes('<img src="x"'), 'log text did not preserve the original message')
    console.log('probe-log-dom-xss: ok')
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
