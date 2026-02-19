require('expect-puppeteer')
const path = require('path')

page.setDefaultTimeout(10000)

// Server on port 8484 is auto-started by jest-puppeteer (see jest-puppeteer.config.js)

const port = 8484
const urlSchema = (name) => `http://localhost:${port}/load/?s=/test/${name}.schema.json`
const urlHTML = (name) => `http://localhost:${port}/test/${name}.html`
const urlQuery = (schema) => `http://localhost:${port}/load/?s=${JSON.stringify(schema)}`
const urlQueryEscaped = (schema) => `http://localhost:${port}/load/?s=${encodeURIComponent(JSON.stringify(schema))}`
const uploadFixture = path.resolve(__dirname, 'fixtures', 'upload-sample.csv')

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
      'code': 'function (a, b) { return a / b }',
    }
  }
  test('Code only (text) (main window)', async () => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
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

describe('Arrow function as model.code', () => {
  test('Main thread', async () => {
    await page.goto(urlHTML('arrow-main'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
  test('Worker', async () => {
    await page.goto(urlHTML('arrow-worker'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })
})

describe('Runtime build (jsee.runtime.js)', () => {
  test('Arrow function in worker', async () => {
    await page.goto(urlHTML('runtime-arrow'))
    await expect(page).toFill('#a', '8')
    await expect(page).toFill('#b', '7')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
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

  test('Window infers function type for URL-loaded JS when type is omitted', async () => {
    const schema = {
      model: {
        name: 'sum',
        container: 'args',
        url: '/test/example-sum.js',
        worker: false
      },
      inputs: [
        { name: 'a', type: 'int', default: 8 },
        { name: 'b', type: 'int', default: 7 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('15')
  })

  test('Worker infers function type for URL-loaded JS when type is omitted', async () => {
    const schema = {
      model: {
        name: 'sum',
        container: 'args',
        url: '/test/example-sum.js',
        worker: true
      },
      inputs: [
        { name: 'a', type: 'int', default: 8 },
        { name: 'b', type: 'int', default: 7 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
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
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('200')
  })

  test('Worker', async () => {
    schema.model.worker = true
    await page.goto(urlQueryEscaped(schema))
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
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toFill('#a', '0')
    await expect(page).toFill('#b', '0')
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('Copy')
  })
})

describe('Imports', () => {
  const schema = {
    'model': {
      'name': 'kebab',
      'type': 'function',
      'container': 'args',
      'code': `
      function kebab (str) {
        return _.kebabCase(str)
      }
      `
    },
    'imports': `http://localhost:${port}/test/fixtures/lodash-like.js`,
    'inputs': [
      { 'name': 'str', 'type': 'string', 'default': 'FooBar' },
    ]
  }
  test('Window', async () => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('foo-bar')
  })
  test('Worker', async () => {
    schema.model.worker = true
    await page.goto(urlQueryEscaped(schema))
    const runUntilReady = async (attempts=3) => {
      if (attempts <= 0) {
        return false
      }
      await expect(page).toClick('button', { text: 'Run' })
      try {
        await page.waitForFunction(() => document.body.innerText.includes('foo-bar'), { timeout: 5000 })
        return true
      } catch (error) {
        return runUntilReady(attempts - 1)
      }
    }
    const ready = await runUntilReady()
    expect(ready).toBe(true)
    await expect(page).toMatchTextContent('foo-bar')
    // await (new Promise(resolve => setTimeout(resolve, 1000)))
  })
})

describe('Buttons, button titles and caller', () => {
  const schema = {
    'model': {
      'name': 'callerRepeater',
      'type': 'function',
      'code': `function callerRepeater (inputs) {
        return inputs.caller
      }`
    },
    'inputs': [
      { 'name': 'test_button', 'type': 'button', 'title': 'Test Button' },
    ]
  }
  test('Window', async () => {
    schema.model.worker = false
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toMatchTextContent('Test Button')
    await expect(page).toClick('button', { text: 'Test Button' })
    await expect(page).toMatchTextContent('test_button')
  })
  test('Worker', async () => {
    schema.model.worker = true
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'Test Button' })
    await expect(page).toMatchTextContent('test_button')
  })
})

describe('Pipeline', () => {
  test('Multiple models', async () => {
    let a = 3
    let b = 4
    await page.goto(urlHTML('pipeline'))
    await expect(page).toFill('#a', a.toString())
    await expect(page).toFill('#b', b.toString())
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent((Math.pow((a + b), 2) + 1).toString())
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent((Math.pow((a + b), 2) + 2).toString())
  })
})

describe('File uploads', () => {
  test('default file input reads uploaded text', async () => {
    const schema = {
      model: {
        worker: false,
        code: `function filePreview (inputs) {
          return {
            preview: inputs.file.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    const fileInput = await page.$('#vfp-filePicker')
    await fileInput.uploadFile(uploadFixture)
    await page.waitForFunction(() => document.body.innerText.includes('Selected 1 file(s)'))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('name,age')
  })

  test('raw file input passes File object (not text content)', async () => {
    const schema = {
      model: {
        worker: false,
        code: `function fileRawMeta (inputs) {
          const isFileObject = !!inputs.file
            && (typeof inputs.file === 'object')
            && (typeof inputs.file.name === 'string')
            && (typeof inputs.file.text === 'function')
          return {
            is_file_object: isFileObject,
            is_string: typeof inputs.file === 'string',
            file_name: inputs.file && inputs.file.name ? inputs.file.name : '',
            content_prefix: typeof inputs.file === 'string' ? inputs.file.slice(0, 10) : 'NONE'
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    const fileInput = await page.$('#vfp-filePicker')
    await fileInput.uploadFile(uploadFixture)
    await page.waitForFunction(() => document.body.innerText.includes('Selected 1 file(s)'))
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('is_file_object')
    await expect(page).toMatchTextContent('true')
    await expect(page).toMatchTextContent('file_name')
    await expect(page).toMatchTextContent('upload-sample.csv')
    await expect(page).toMatchTextContent('content_prefix')
    await expect(page).toMatchTextContent('NONE')
  })

  test('raw url input passes URL handle (not fetched text content)', async () => {
    const schema = {
      model: {
        worker: false,
        code: `function fileRawUrlMeta (inputs) {
          const isUrlHandle = !!inputs.file
            && (typeof inputs.file === 'object')
            && (inputs.file.kind === 'url')
            && (typeof inputs.file.url === 'string')
          return {
            is_url_handle: isUrlHandle,
            is_string: typeof inputs.file === 'string',
            url_value: isUrlHandle ? inputs.file.url : '',
            content_prefix: typeof inputs.file === 'string' ? inputs.file.slice(0, 10) : 'NONE'
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true }
      ]
    }
    const rawUrl = 'http://127.0.0.1:9999/nope.csv'
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'From URL' })
    await page.waitForSelector('input.vfp-urlInput[type="text"]')
    await page.click('input.vfp-urlInput[type="text"]', { clickCount: 3 })
    await page.type('input.vfp-urlInput[type="text"]', rawUrl)
    await page.evaluate(() => {
      const loadButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load')
      if (!loadButton) throw new Error('Load button not found')
      loadButton.click()
    })
    await expect(page).toClick('button', { text: 'Run' })
    await page.waitForFunction((expectedUrl) => {
      return document.querySelector('#outputs').innerText.includes(expectedUrl)
    }, {}, rawUrl)
    await expect(page).toMatchTextContent('is_url_handle')
    await expect(page).toMatchTextContent('true')
    await expect(page).toMatchTextContent('url_value')
    await expect(page).toMatchTextContent(rawUrl)
    await expect(page).toMatchTextContent('content_prefix')
    await expect(page).toMatchTextContent('NONE')
  })

  test('file query param auto-loads URL without clicking Load', async () => {
    const schema = {
      model: {
        worker: false,
        code: `function filePreviewFromQuery (inputs) {
          return {
            preview: inputs.file.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file' }
      ]
    }
    const fileUrl = `http://localhost:${port}/test/fixtures/upload-sample.csv`
    await page.goto(`${urlQueryEscaped(schema)}&file=${encodeURIComponent(fileUrl)}`)
    await page.waitForFunction(() => document.body.innerText.includes('Loaded from URL:'), { timeout: 5000 })
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('preview')
    await expect(page).toMatchTextContent('name,age')
  })
})

describe('Streamed file inputs', () => {
  test('main thread receives uploaded file as async iterable stream', async () => {
    const schema = {
      model: {
        worker: false,
        code: `async function streamMainFile (inputs) {
          const reader = inputs.file
          const isIterable = !!reader
            && typeof reader[Symbol.asyncIterator] === 'function'
            && typeof reader.text === 'function'
            && typeof reader.bytes === 'function'
            && typeof reader.lines === 'function'
          if (!isIterable) {
            return { is_iterable: false, header: 'NONE' }
          }
          const text = await reader.text()
          return {
            is_iterable: true,
            header: text.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    const fileInput = await page.$('#vfp-filePicker')
    await fileInput.uploadFile(uploadFixture)
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('is_iterable')
    await expect(page).toMatchTextContent('true')
    await expect(page).toMatchTextContent('header')
    await expect(page).toMatchTextContent('name,age')
  })

  test('stream metadata is preserved for downstream pipeline models', async () => {
    const schema = {
      model: [
        {
          worker: false,
          code: `function streamStageOne (inputs) {
            return {
              stage1_name: inputs.file && inputs.file.name ? inputs.file.name : 'NONE'
            }
          }`
        },
        {
          worker: false,
          code: `function streamStageTwo (inputs) {
            return {
              stage2_name: inputs.file && inputs.file.name ? inputs.file.name : 'NONE',
              stage2_size: inputs.file && typeof inputs.file.size === 'number' ? inputs.file.size : -1
            }
          }`
        }
      ],
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    const fileInput = await page.$('#vfp-filePicker')
    await fileInput.uploadFile(uploadFixture)
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('stage1_name')
    await expect(page).toMatchTextContent('stage2_name')
    await expect(page).toMatchTextContent('upload-sample.csv')
    await expect(page).toMatchTextContent('stage2_size')
  })

  test('main thread receives URL source as async iterable stream', async () => {
    const schema = {
      model: {
        worker: false,
        code: `async function streamMainUrl (inputs) {
          const reader = inputs.file
          const text = await reader.text()
          return {
            is_iterable: typeof reader[Symbol.asyncIterator] === 'function',
            header: text.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    const sampleUrl = `http://localhost:${port}/test/fixtures/upload-sample.csv`
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'From URL' })
    await page.waitForSelector('input.vfp-urlInput[type="text"]')
    await page.click('input.vfp-urlInput[type="text"]', { clickCount: 3 })
    await page.type('input.vfp-urlInput[type="text"]', sampleUrl)
    await page.evaluate(() => {
      const loadButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load')
      if (!loadButton) throw new Error('Load button not found')
      loadButton.click()
    })
    await expect(page).toClick('button', { text: 'Run' })
    await page.waitForFunction(() => {
      const outputs = document.querySelector('#outputs')
      return outputs && outputs.innerText.includes('header')
    }, { timeout: 5000 })
    await expect(page).toMatchTextContent('is_iterable')
    await expect(page).toMatchTextContent('true')
    await expect(page).toMatchTextContent('header')
    await expect(page).toMatchTextContent('name,age')
  })

  test('worker receives uploaded file as async iterable stream', async () => {
    const schema = {
      model: {
        worker: true,
        code: `async function streamWorkerFile (inputs) {
          const reader = inputs.file
          const lines = []
          for await (const line of reader.lines()) {
            lines.push(line)
          }
          return {
            is_iterable: typeof reader.text === 'function',
            header: lines[0] || 'NONE'
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.waitForSelector('#vfp-filePicker')
    const fileInput = await page.$('#vfp-filePicker')
    await fileInput.uploadFile(uploadFixture)
    await expect(page).toClick('button', { text: 'Run' })
    await expect(page).toMatchTextContent('is_iterable')
    await expect(page).toMatchTextContent('true')
    await expect(page).toMatchTextContent('header')
    await expect(page).toMatchTextContent('name,age')
  })

  test('worker receives URL source as async iterable stream', async () => {
    const schema = {
      model: {
        worker: true,
        code: `async function streamWorkerUrl (inputs) {
          const reader = inputs.file
          const decoder = new TextDecoder()
          let text = ''
          for await (const chunk of reader) {
            text += decoder.decode(chunk, { stream: true })
          }
          text += decoder.decode()
          return {
            is_iterable: typeof reader.bytes === 'function',
            header: text.split('\\n')[0]
          }
        }`
      },
      inputs: [
        { name: 'file', type: 'file', raw: true, stream: true }
      ]
    }
    const sampleUrl = `http://localhost:${port}/test/fixtures/upload-sample.csv`
    await page.goto(urlQueryEscaped(schema))
    await expect(page).toClick('button', { text: 'From URL' })
    await page.waitForSelector('input.vfp-urlInput[type="text"]')
    await page.click('input.vfp-urlInput[type="text"]', { clickCount: 3 })
    await page.type('input.vfp-urlInput[type="text"]', sampleUrl)
    await page.evaluate(() => {
      const loadButton = Array.from(document.querySelectorAll('button'))
        .find(btn => btn.textContent.trim() === 'Load')
      if (!loadButton) throw new Error('Load button not found')
      loadButton.click()
    })
    await expect(page).toClick('button', { text: 'Run' })
    await page.waitForFunction(() => {
      const outputs = document.querySelector('#outputs')
      return outputs && outputs.innerText.includes('header')
    }, { timeout: 5000 })
    await expect(page).toMatchTextContent('is_iterable')
    await expect(page).toMatchTextContent('true')
    await expect(page).toMatchTextContent('header')
    await expect(page).toMatchTextContent('name,age')
  })
})
