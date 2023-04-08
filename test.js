require('expect-puppeteer')

page.setDefaultTimeout(10000)

// Tests require a server to be running on port 8080
// If you have php installed: php -S localhost:8080
// Python: python -m http.server 8080
// Node: npm install -g http-server && http-server -p 8080

const port = 8080
const urlSchema = (name) => `http://localhost:${port}/load/?s=/test/${name}.schema.json`
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`
const urlQuery = (schema) => `http://localhost:${port}/load/?s=${JSON.stringify(schema)}`

describe('Initial test', () => {
  beforeAll(async () => {
    await page.goto(urlSchema('sum'))
  })
  test('Title', async () => {
    await expect(page).toMatchTextContent('title')
  })
  test('Description', async () => {
    await expect(page).toMatchTextContent('description')
  })
  test('Run button is active', async () => {
    await expect(page).toClick('button', { text: 'Run' })
  })
  test('Default result is right', async () => {
    await expect(page).toMatchTextContent('142')
  })
  test('Changing inputs', async () => {
    await expect(page).toFill('#a', '200')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('242')
    // await jestPuppeteer.debug()
  })
})


describe('Initial test (worker)', () => {
  beforeAll(async () => {
    await page.goto(urlSchema('sumw'))
  })
  test('Result is right', async () => {
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
})

describe('Minimal examples', () => {
  const schema = {
    'model': {
      'code': 'function (a, b) { return a / b }', // TODO: check '+'
    }
  }
  test('Code only (text) (main window)', async () => {
    schema.model.worker = false
    await page.goto(urlQuery(schema))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('25')
  })
  test('Code instead of schema (function)', async () => {
    await page.goto(urlHTML('minimal1'))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('400')
  })
  test('Code instead of model (function)', async () => {
    await page.goto(urlHTML('minimal2'))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('400')
  })
  test('Code instead of schema (anonymous function)', async () => {
    await page.goto(urlHTML('minimal3'))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('400')
  })
})

describe('Load code directly', () => {
  test('Window', async () => {
    await page.goto(urlHTML('code'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
  test('Window (string with eval)', async () => {
    await page.goto(urlHTML('string'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
  test('Worker', async () => {
    await page.goto(urlHTML('codew'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
  test('Worker (string)', async () => {
    await page.goto(urlHTML('stringw'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
})

describe('Classes', () => {
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

  test('Window', async () => {
    schema.model.worker = false
    await page.goto(urlQuery(schema))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('200')
  })

  test('Worker', async () => {
    schema.model.worker = true
    await page.goto(urlQuery(schema))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('200')
  })
})

describe('Some edge cases', () => {
  test('Result is zero', async () => {
    const schema = {
      'model': {
        'code': 'function mul (a, b) { return a * b }',
      }
    }
    schema.model.worker = false
    await page.goto(urlQuery(schema))
    await expect(page).toFill('#a', '0')
    await expect(page).toFill('#b', '0')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('Copy')
  })
})


