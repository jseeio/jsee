require('expect-puppeteer')

page.setDefaultTimeout(1000)

const port = 8080
const urlSchema = (name) => `http://localhost:${port}/load/?s=/test/${name}.schema.json`
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`
const urlQuery = (schema) => `http://localhost:${port}/load/?s=${JSON.stringify(schema)}`

describe('Initial test', () => {
  beforeAll(async () => {
    await page.goto(urlSchema('sum'))
  })
  test('Title', async () => {
    await expect(page).toMatch('title')
  })
  test('Description', async () => {
    await expect(page).toMatch('description')
  })
  test('Run button is active', async () => {
    await expect(page).toClick('button', { text: 'Run' })
  })
  test('Default result is right', async () => {
    await expect(page).toMatch('142')
  })
  test('Changing inputs', async () => {
    await expect(page).toFill('#a', '200')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('242')
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
    await expect(page).toMatch('15')
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
    await expect(page).toMatch('25')
  })
  test('Code instead of schema (function)', async () => {
    await page.goto(urlHTML('minimal1'))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('400')
  })
  test('Code instead of model (function)', async () => {
    await page.goto(urlHTML('minimal2'))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('400')
  })
  test('Code instead of schema (anonymous function)', async () => {
    await page.goto(urlHTML('minimal3'))
    await expect(page).toFill('#a', '100')
    await expect(page).toFill('#b', '4')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('400')
  })
})

describe('Load code directly', () => {
  test('Window', async () => {
    await page.goto(urlHTML('code'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('15')
  })
  test('Window (string with eval)', async () => {
    await page.goto(urlHTML('string'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('15')
  })
  test('Worker', async () => {
    await page.goto(urlHTML('codew'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('15')
  })
  test('Worker (string)', async () => {
    await page.goto(urlHTML('stringw'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('15')
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
    await expect(page).toMatch('200')
  })

  test('Worker', async () => {
    schema.model.worker = true
    await page.goto(urlQuery(schema))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatch('200')
  })
})
