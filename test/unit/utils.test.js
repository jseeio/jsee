const {
  isObject,
  sanitizeName,
  loadFromDOM,
  getUrl,
  delay,
  debounce,
  getName,
  isWorkerInitMessage,
  getProgressState,
  getIntervalDelay,
  shouldContinueInterval,
  getModelFuncJS,
  getModelFuncAPI,
  getModuleModelTarget,
  inferInputsFromModel,
  normalizeSecurityOptions,
  normalizePyodideOptions,
  getPyodideLoadOptions,
  bindPyodideInputs,
  getPyodideEntryName,
  buildPyodideEntryCallCode,
  pyodideResultToJs,
  isNetworkUrl,
  assertNetworkAllowed,
  assertImportNetworkAllowed,
  assertEvalAllowed,
  sanitizeHtml,
  validateSchema,
  toWorkerSerializable,
  wrapStreamInputs,
  containsBinaryPayload,
  isCssImport,
  isRelativeImport,
  getUrlParam,
  coerceParam,
  serializeResult,
  parseMultipart,
  parseSSELine,
  toTypedArray,
  fromTypedArray,
  wrapTypedArrayInputs,
  collectTransferables,
  columnsToRows,
  createValidateFn,
  runValidation,
  fileExtToOutputType,
  inferOutputType,
  generateOpenAPISpec
} = require('../../src/utils')

describe('isObject', () => {
  test('returns true for plain objects', () => {
    expect(isObject({})).toBe(true)
    expect(isObject({ a: 1 })).toBe(true)
  })
  test('returns false for arrays', () => {
    expect(isObject([])).toBe(false)
    expect(isObject([1, 2])).toBe(false)
  })
  test('returns false for null', () => {
    expect(isObject(null)).toBe(false)
  })
  test('returns false for primitives', () => {
    expect(isObject(42)).toBe(false)
    expect(isObject('string')).toBe(false)
    expect(isObject(true)).toBe(false)
    expect(isObject(undefined)).toBe(false)
  })
})

describe('sanitizeName', () => {
  test('lowercases and replaces non-alphanumeric', () => {
    expect(sanitizeName('Hello World')).toBe('hello_world')
  })
  test('keeps underscores and digits', () => {
    expect(sanitizeName('input_1')).toBe('input_1')
  })
  test('replaces special characters', () => {
    expect(sanitizeName('My Input!')).toBe('my_input_')
  })
  test('handles already clean names', () => {
    expect(sanitizeName('foo')).toBe('foo')
  })
})

describe('getModuleModelTarget', () => {
  test('selects named exports and falls back to default/model', () => {
    const named = () => 'named'
    const fallback = () => 'fallback'

    expect(getModuleModelTarget({ predict: named }, { export: 'predict' })).toBe(named)
    expect(getModuleModelTarget({ default: fallback }, { export: 'missing' })).toBe(fallback)
    expect(getModuleModelTarget({ model: fallback }, {})).toBe(fallback)
    expect(() => getModuleModelTarget({}, { export: 'missing' })).toThrow('Module model export not found')
  })
})

describe('isCssImport', () => {
  test('.css extension returns true', () => {
    expect(isCssImport('styles/main.css')).toBe(true)
    expect(isCssImport('https://cdn.example.com/lib.css')).toBe(true)
  })
  test('.css with query string returns true', () => {
    expect(isCssImport('styles/main.css?v=2')).toBe(true)
  })
  test('.css with hash returns true', () => {
    expect(isCssImport('styles/main.css#id')).toBe(true)
  })
  test('.js extension returns false', () => {
    expect(isCssImport('lib/app.js')).toBe(false)
  })
  test('bare package name returns false', () => {
    expect(isCssImport('lodash')).toBe(false)
  })
  test('non-string returns false', () => {
    expect(isCssImport(null)).toBe(false)
    expect(isCssImport(undefined)).toBe(false)
    expect(isCssImport(42)).toBe(false)
  })
})

describe('isRelativeImport', () => {
  test('./ prefix is relative', () => {
    expect(isRelativeImport('./lib.js')).toBe(true)
  })
  test('../ prefix is relative', () => {
    expect(isRelativeImport('../utils.js')).toBe(true)
  })
  test('/ prefix is relative', () => {
    expect(isRelativeImport('/dist/app.js')).toBe(true)
  })
  test('path with dir separator and .js extension is relative', () => {
    expect(isRelativeImport('dist/core.js')).toBe(true)
  })
  test('path with dir separator and .css extension is relative', () => {
    expect(isRelativeImport('styles/main.css')).toBe(true)
  })
  test('bare package name is not relative', () => {
    expect(isRelativeImport('lodash')).toBe(false)
  })
  test('package name ending in .js without slash is not relative', () => {
    expect(isRelativeImport('chart.js')).toBe(false)
  })
  test('scoped package is not relative', () => {
    expect(isRelativeImport('@org/pkg')).toBe(false)
  })
  test('versioned package is not relative', () => {
    expect(isRelativeImport('lodash@4.17.21/lodash.min.js')).toBe(false)
  })
  test('absolute URL is not relative', () => {
    expect(isRelativeImport('https://example.com/lib.js')).toBe(false)
  })
  test('non-string returns false', () => {
    expect(isRelativeImport(null)).toBe(false)
    expect(isRelativeImport(undefined)).toBe(false)
  })
})

describe('getUrl', () => {
  test('returns absolute URLs as-is', () => {
    expect(getUrl('https://example.com/lib.js')).toBe('https://example.com/lib.js')
  })
  test('prepends CDN base for bare package names', () => {
    expect(getUrl('lodash@4.17.21/lodash.min.js'))
      .toBe('https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js')
  })
  test('resolves relative paths with ./ using window.location when available', () => {
    global.window = { location: { href: 'https://example.com/app/' } }
    const result = getUrl('./lib/helper.js')
    expect(result).toBe('https://example.com/app/lib/helper.js')
    delete global.window
  })
  test('resolves paths with dir separator and extension using window.location', () => {
    global.window = { location: { href: 'https://example.com/app/' } }
    const result = getUrl('dist/profile-core.js')
    expect(result).toBe('https://example.com/app/dist/profile-core.js')
    delete global.window
  })
  test('falls back to CDN for relative paths when window is unavailable', () => {
    const result = getUrl('./lib/helper.js')
    expect(result).toContain('cdn.jsdelivr.net')
  })
  test('bare names without extension still resolve to CDN', () => {
    expect(getUrl('lodash')).toBe('https://cdn.jsdelivr.net/npm/lodash')
  })
})

describe('loadFromDOM', () => {
  afterEach(() => {
    delete global.document
  })

  test('decodes base64 hidden assets', () => {
    const code = `function demo () {
  return '</script>'
}
`
    const encoded = Buffer.from(code, 'utf8').toString('base64')
    global.document = {
      querySelector: jest.fn(() => ({
        textContent: encoded,
        getAttribute: (name) => name === 'data-encoding' ? 'base64' : null
      }))
    }

    expect(loadFromDOM('model.js')).toBe(code)
    expect(global.document.querySelector).toHaveBeenCalledWith('script[data-src="model.js"]')
  })
})

describe('delay', () => {
  test('resolves after specified ms', async () => {
    const start = Date.now()
    await delay(50)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(40) // allow small timing variance
  })
  test('defaults to 1ms if no argument', async () => {
    await expect(delay()).resolves.toBeUndefined()
  })
})

describe('toWorkerSerializable', () => {
  test('clones plain objects and arrays recursively', () => {
    const original = {
      file: { kind: 'url', url: 'http://localhost:8080/test.csv' },
      nested: [{ a: 1 }, { b: 2 }]
    }
    const result = toWorkerSerializable(original)
    expect(result).toEqual(original)
    expect(result).not.toBe(original)
    expect(result.file).not.toBe(original.file)
    expect(result.nested).not.toBe(original.nested)
    expect(result.nested[0]).not.toBe(original.nested[0])
  })

  test('preserves native clone-safe objects by reference', () => {
    const date = new Date('2024-01-01T00:00:00.000Z')
    const original = { date }
    const result = toWorkerSerializable(original)
    expect(result.date).toBe(date)
  })

  test('de-proxies custom object-like values into plain data', () => {
    class CustomType {
      constructor (v) {
        this.value = v
      }
    }
    const custom = new CustomType(42)
    const original = { custom }
    const result = toWorkerSerializable(original)
    expect(result.custom).toEqual({ value: 42 })
    expect(result.custom).not.toBe(custom)
  })
})

describe('containsBinaryPayload', () => {
  test('returns true for nested binary payloads', () => {
    const payload = {
      file: {
        blob: new Uint8Array([1, 2, 3])
      }
    }
    expect(containsBinaryPayload(payload)).toBe(true)
  })

  test('returns false for plain JSON-like payloads', () => {
    const payload = {
      file: { kind: 'url', url: 'http://localhost:8080/test.csv' },
      rows: [{ a: 1 }, { b: 2 }]
    }
    expect(containsBinaryPayload(payload)).toBe(false)
  })
})

describe('wrapStreamInputs', () => {
  test('wraps file-like source into async iterable chunked reader', async () => {
    const content = new TextEncoder().encode('name,age\n1,2\n')
    const fakeFile = {
      size: content.byteLength,
      slice (start, end) {
        const chunk = content.slice(start, end)
        return {
          async arrayBuffer () {
            return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
          }
        }
      }
    }
    const wrapped = wrapStreamInputs(
      { file: fakeFile },
      { file: { stream: true } }
    )
    expect(wrapped.file).not.toBe(fakeFile)
    expect(typeof wrapped.file[Symbol.asyncIterator]).toBe('function')
    expect(typeof wrapped.file.text).toBe('function')
    expect(typeof wrapped.file.bytes).toBe('function')
    expect(typeof wrapped.file.lines).toBe('function')

    const text = await wrapped.file.text()
    expect(text).toBe('name,age\n1,2\n')
  })

  test('copies file metadata to chunked reader', () => {
    const fakeFile = {
      name: 'input.csv',
      size: 4,
      type: 'text/csv',
      slice () {
        return {
          async arrayBuffer () {
            return new Uint8Array([1, 2, 3, 4]).buffer
          }
        }
      }
    }
    const wrapped = wrapStreamInputs(
      { file: fakeFile },
      { file: { stream: true } }
    )
    expect(wrapped.file.name).toBe('input.csv')
    expect(wrapped.file.size).toBe(4)
    expect(wrapped.file.type).toBe('text/csv')
  })

  test('wraps URL handle into async iterable chunked reader', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      body: {
        getReader () {
          let readCount = 0
          return {
            async read () {
              readCount += 1
              if (readCount === 1) {
                return { done: false, value: new TextEncoder().encode('name,age\n') }
              }
              return { done: true, value: undefined }
            },
            releaseLock () {}
          }
        }
      }
    })

    const wrapped = wrapStreamInputs(
      { file: { kind: 'url', url: 'http://localhost:8080/test.csv' } },
      { file: { stream: true } },
      { fetch: fetchMock }
    )
    expect(typeof wrapped.file[Symbol.asyncIterator]).toBe('function')

    const text = await wrapped.file.text()
    expect(text).toBe('name,age\n')
    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8080/test.csv')
  })

  test('copies URL metadata to chunked reader', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name) => {
          if (name === 'content-length') return '9'
          if (name === 'content-type') return 'text/csv; charset=utf-8'
          return null
        }
      },
      body: {
        getReader () {
          let readCount = 0
          return {
            async read () {
              readCount += 1
              if (readCount === 1) {
                return { done: false, value: new TextEncoder().encode('a,b\n1,2\n') }
              }
              return { done: true, value: undefined }
            },
            releaseLock () {}
          }
        }
      }
    })

    const wrapped = wrapStreamInputs(
      {
        file: {
          kind: 'url',
          url: 'http://localhost:8080/files/upload-sample.csv'
        }
      },
      { file: { stream: true } },
      { fetch: fetchMock }
    )
    expect(wrapped.file.name).toBe('upload-sample.csv')

    const text = await wrapped.file.text()
    expect(text).toBe('a,b\n1,2\n')
    expect(wrapped.file.size).toBe(9)
    expect(wrapped.file.type).toBe('text/csv')
  })

  test('does not re-wrap chunked readers on downstream stages', () => {
    const content = new TextEncoder().encode('hello')
    const fakeFile = {
      size: content.byteLength,
      slice (start, end) {
        const chunk = content.slice(start, end)
        return {
          async arrayBuffer () {
            return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
          }
        }
      }
    }
    const onceWrapped = wrapStreamInputs(
      { file: fakeFile },
      { file: { stream: true } }
    )
    const twiceWrapped = wrapStreamInputs(
      onceWrapped,
      { file: { stream: true } }
    )
    expect(twiceWrapped.file).toBe(onceWrapped.file)
  })

  test('lines() yields individual lines from chunked input', async () => {
    const content = new TextEncoder().encode('line1\nline2\nline3')
    const fakeFile = {
      size: content.byteLength,
      slice (start, end) {
        const chunk = content.slice(start, end)
        return {
          async arrayBuffer () {
            return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
          }
        }
      }
    }
    const wrapped = wrapStreamInputs(
      { file: fakeFile },
      { file: { stream: true } }
    )

    const lines = []
    for await (const line of wrapped.file.lines()) {
      lines.push(line)
    }
    expect(lines).toEqual(['line1', 'line2', 'line3'])
  })

  test('bytes() returns concatenated Uint8Array', async () => {
    const content = new TextEncoder().encode('hello')
    const fakeFile = {
      size: content.byteLength,
      slice (start, end) {
        const chunk = content.slice(start, end)
        return {
          async arrayBuffer () {
            return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
          }
        }
      }
    }
    const wrapped = wrapStreamInputs(
      { file: fakeFile },
      { file: { stream: true } }
    )

    const bytes = await wrapped.file.bytes()
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })
})

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('delays execution', () => {
    const fn = jest.fn()
    const debounced = debounce(fn, 100)
    debounced()
    expect(fn).not.toHaveBeenCalled()
    jest.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('resets timer on rapid calls', () => {
    const fn = jest.fn()
    const debounced = debounce(fn, 100)
    debounced()
    jest.advanceTimersByTime(50)
    debounced()
    jest.advanceTimersByTime(50)
    expect(fn).not.toHaveBeenCalled()
    jest.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('passes arguments through', () => {
    const fn = jest.fn()
    const debounced = debounce(fn, 100)
    debounced('a', 'b')
    jest.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledWith('a', 'b')
  })
})

describe('getName', () => {
  test('regular named function string', () => {
    expect(getName('function sum (a, b) { return a + b }')).toBe('sum')
  })
  test('async function string', () => {
    expect(getName('async function fetchData () { }')).toBe('fetchData')
  })
  test('anonymous function string', () => {
    expect(getName('function (a, b) { return a + b }')).toBeUndefined()
  })
  test('arrow function returns undefined', () => {
    expect(getName('(a, b) => a + b')).toBeUndefined()
  })
  test('actual function reference', () => {
    function myFunc () {}
    expect(getName(myFunc)).toBe('myFunc')
  })
  test('arrow function reference returns undefined (not inferred property name)', () => {
    const obj = { code: (a, b) => a + b }
    expect(getName(obj.code)).toBeUndefined()
  })
  test('anonymous function assigned to variable returns undefined', () => {
    const fn = function () {}
    // .name is inferred as "fn" but toString() is "function () {}" — no name in source
    expect(getName(fn)).toBeUndefined()
  })
  test('anonymous function on object property returns undefined', () => {
    const obj = { code: function (data, ctx) { return data } }
    // .name is inferred as "code" but toString() is "function (data, ctx) { ... }"
    expect(getName(obj.code)).toBeUndefined()
  })
  test('async function reference', () => {
    async function fetchData () {}
    expect(getName(fetchData)).toBe('fetchData')
  })
  test('async arrow function returns undefined', () => {
    const obj = { code: async (a) => a }
    expect(getName(obj.code)).toBeUndefined()
  })
  test('non-string non-function returns undefined', () => {
    expect(getName(42)).toBeUndefined()
    expect(getName(null)).toBeUndefined()
    expect(getName(undefined)).toBeUndefined()
  })
})

describe('inferInputsFromModel', () => {
  test('keeps inferred default parameters as strings and warns about numeric defaults', () => {
    function add (a = 1, b = 2) {
      return a + b
    }
    const result = inferInputsFromModel({ code: add })

    expect(result.inputs).toEqual([
      { name: 'a', type: 'string' },
      { name: 'b', type: 'string' }
    ])
    expect(result.warnings.join('\n')).toContain('input "a" as string')
    expect(result.warnings.join('\n')).toContain('default value suggests number')
  })

  test('infers numeric defaults only when inferTypes is enabled', () => {
    function add (a = 1, b = 2, label = 'total') {
      return a + b + label
    }
    const result = inferInputsFromModel({ code: add }, { inferTypes: true })

    expect(result.inputs).toEqual([
      { name: 'a', type: 'number' },
      { name: 'b', type: 'number' },
      { name: 'label', type: 'string' }
    ])
    expect(result.warnings.join('\n')).toContain('input "a" as number')
  })

  test('reads JSDoc type hints for diagnostics without changing inferred types', () => {
    const result = inferInputsFromModel({
      code: `/**
 * @param {number} n Count
 * @param {string} label Label
 */
function model (n, label) {
  return n
}`
    })

    expect(result.inputs).toEqual([
      { name: 'n', type: 'string' },
      { name: 'label', type: 'string' }
    ])
    expect(result.warnings.join('\n')).toContain('JSDoc declares number')
    expect(result.warnings.join('\n')).toContain('input "label" as string')
  })

  test('infers JSDoc numeric and boolean hints only when inferTypes is enabled', () => {
    const result = inferInputsFromModel({
      code: `/**
 * @param {number} count Count
 * @param {boolean} enabled Enabled
 * @param {string} label Label
 */
function model (count, enabled, label) {
  return count
}`
    }, { inferTypes: true })

    expect(result.inputs).toEqual([
      { name: 'count', type: 'number' },
      { name: 'enabled', type: 'checkbox' },
      { name: 'label', type: 'string' }
    ])
  })

  test('handles single-parameter arrow functions', () => {
    const result = inferInputsFromModel({ code: 'value => value * 2' })
    expect(result.inputs).toEqual([
      { name: 'value', type: 'string' }
    ])
  })

  test('warns and skips destructured parameters', () => {
    const result = inferInputsFromModel({ code: '({ value }) => value' })
    expect(result.inputs).toEqual([])
    expect(result.warnings.join('\n')).toContain('destructured parameter')
  })
})

describe('bindPyodideInputs', () => {
  function fakePyodide () {
    const values = new Map()
    return {
      values,
      toPy: value => ({ py: value }),
      globals: {
        set: (name, value) => values.set(name, value)
      }
    }
  }

  test('installs Python inputs and ctx globals', () => {
    const pyodide = fakePyodide()
    const target = {}

    bindPyodideInputs(pyodide, { x: 2, caller: 'run' }, target)

    expect(pyodide.values.get('inputs')).toEqual({
      py: { x: 2, caller: 'run' }
    })
    expect(pyodide.values.get('ctx')).toEqual({
      py: { caller: 'run' }
    })
  })

  test('preserves non-colliding legacy JS globals', () => {
    const pyodide = fakePyodide()
    const target = {}

    const first = bindPyodideInputs(pyodide, { x: 2 }, target)
    const second = bindPyodideInputs(pyodide, { x: 5 }, target)

    expect(target.x).toBe(5)
    expect(first.legacyGlobals).toContain('x')
    expect(second.legacyGlobals).toContain('x')
  })

  test('does not overwrite existing JS globals', () => {
    const pyodide = fakePyodide()
    const target = {
      location: { href: 'https://example.test/' }
    }
    const warnings = []

    const result = bindPyodideInputs(pyodide, {
      location: 'input-location',
      value: 7
    }, target, {
      warn: message => warnings.push(message)
    })

    expect(target.location).toEqual({ href: 'https://example.test/' })
    expect(target.value).toBe(7)
    expect(result.collisions).toContain('location')
    expect(result.legacyGlobals).toContain('value')
    expect(warnings.join('\n')).toContain('inputs["location"]')
  })
})

describe('Pyodide entry helpers', () => {
  test('normalizes default and custom Pyodide runtime options', () => {
    expect(normalizePyodideOptions({}).url).toBe('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js')

    expect(normalizePyodideOptions({
      pyodide: 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js'
    })).toEqual({
      rawUrl: 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js',
      url: 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js',
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/',
      code: undefined,
      packages: undefined
    })

    expect(normalizePyodideOptions({
      pyodide: {
        url: 'pyodide/pyodide.js',
        indexURL: 'pyodide/',
        packages: ['numpy', '']
      }
    })).toEqual({
      rawUrl: 'pyodide/pyodide.js',
      url: 'pyodide/pyodide.js',
      indexURL: 'pyodide/',
      code: undefined,
      packages: ['numpy']
    })
  })

  test('returns Pyodide load options only when indexURL is known', () => {
    expect(getPyodideLoadOptions({ indexURL: 'pyodide/' })).toEqual({ indexURL: 'pyodide/' })
    expect(getPyodideLoadOptions({ packages: ['numpy'] })).toEqual({ packages: ['numpy'] })
    expect(getPyodideLoadOptions({ indexURL: 'pyodide/', packages: ['numpy'] })).toEqual({ indexURL: 'pyodide/', packages: ['numpy'] })
    expect(getPyodideLoadOptions({})).toBe(undefined)
  })

  test('normalizes valid entry function names', () => {
    expect(getPyodideEntryName({ entry: ' calculate ' })).toBe('calculate')
    expect(getPyodideEntryName({})).toBe(null)
  })

  test('rejects invalid entry function names', () => {
    expect(() => getPyodideEntryName({ entry: 'not-valid()' })).toThrow('valid Python function name')
    expect(() => getPyodideEntryName({ entry: 3 })).toThrow('function name string')
  })

  test('builds a wrapper that passes inputs and ctx', () => {
    const code = buildPyodideEntryCallCode('calculate')

    expect(code).toContain('__jsee_entry_name = "calculate"')
    expect(code).toContain('__jsee_kwargs[__jsee_name] = inputs')
    expect(code).toContain('__jsee_kwargs[__jsee_name] = ctx')
    expect(code).toContain('__jsee_result = await __jsee_result')
  })

  test('converts and destroys Pyodide proxy results', () => {
    const proxy = {
      destroyed: false,
      toJs: jest.fn(() => ({ result: 7 })),
      destroy () {
        this.destroyed = true
      }
    }

    expect(pyodideResultToJs(proxy)).toEqual({ result: 7 })
    expect(proxy.toJs).toHaveBeenCalledWith({ dict_converter: Object.fromEntries })
    expect(proxy.destroyed).toBe(true)
  })
})

describe('secure-mode network guards', () => {
  test('detects http and protocol-relative network URLs', () => {
    expect(isNetworkUrl('https://example.com/model.js')).toBe(true)
    expect(isNetworkUrl('http://example.com/model.js')).toBe(true)
    expect(isNetworkUrl('//cdn.example.com/model.js')).toBe(true)
    expect(isNetworkUrl('/local/model.js')).toBe(false)
    expect(isNetworkUrl('data:text/plain,ok')).toBe(false)
  })

  test('blocks network URLs only when allowNetwork is false', () => {
    expect(() => assertNetworkAllowed('https://example.com/model.js', { allowNetwork: false }, 'model URL'))
      .toThrow('security.allowNetwork is false')
    expect(() => assertNetworkAllowed('/local/model.js', { allowNetwork: false }, 'model URL'))
      .not.toThrow()
    expect(() => assertNetworkAllowed('https://example.com/model.js', { allowNetwork: true }, 'model URL'))
      .not.toThrow()
  })

  test('checks import policy against raw schema URLs before resolved loader URLs', () => {
    expect(() => assertImportNetworkAllowed([
      { _rawUrl: '/local/import.js', url: 'http://localhost/local/import.js' }
    ], { allowNetwork: false }, 'model.imports')).not.toThrow()
    expect(() => assertImportNetworkAllowed([
      { _rawUrl: 'https://example.com/import.js', url: 'https://example.com/import.js' }
    ], { allowNetwork: false }, 'model.imports')).toThrow('security.allowNetwork is false')
  })
})

describe('isWorkerInitMessage', () => {
  test('returns true for first model payload with code', () => {
    expect(isWorkerInitMessage({ code: 'function run () {}' }, false)).toBe(true)
  })

  test('returns true for first model payload with url', () => {
    expect(isWorkerInitMessage({ url: '/apps/test/model.js' }, false)).toBe(true)
  })

  test('returns false after worker was initialized', () => {
    expect(isWorkerInitMessage({ url: '/apps/test/input.csv' }, true)).toBe(false)
  })

  test('returns false for non-model execution payloads', () => {
    expect(isWorkerInitMessage({ input: 1, caller: 'run' }, false)).toBe(false)
  })
})

describe('getProgressState', () => {
  test('returns indeterminate mode for null', () => {
    expect(getProgressState(null)).toEqual({ mode: 'indeterminate', value: null })
  })

  test('returns determinate mode for numeric values', () => {
    expect(getProgressState(42)).toEqual({ mode: 'determinate', value: 42 })
    expect(getProgressState('25')).toEqual({ mode: 'determinate', value: 25 })
  })

  test('clamps determinate values to [0, 100]', () => {
    expect(getProgressState(-5)).toEqual({ mode: 'determinate', value: 0 })
    expect(getProgressState(120)).toEqual({ mode: 'determinate', value: 100 })
  })

  test('returns null for non-numeric non-null values', () => {
    expect(getProgressState('unknown')).toBeNull()
    expect(getProgressState(undefined)).toBeNull()
  })
})

describe('interval helpers', () => {
  test('normalizes positive interval delays', () => {
    expect(getIntervalDelay(1000)).toBe(1000)
    expect(getIntervalDelay('250')).toBe(250)
  })

  test('returns 0 for disabled or invalid interval delays', () => {
    expect(getIntervalDelay(0)).toBe(0)
    expect(getIntervalDelay(null)).toBe(0)
    expect(getIntervalDelay('')).toBe(0)
    expect(getIntervalDelay('abc')).toBe(0)
  })

  test('continues only for configured non-cancelled intervals', () => {
    expect(shouldContinueInterval(1000, false)).toBe(true)
    expect(shouldContinueInterval(1000, true)).toBe(false)
  })

  test('preserves the previous helper argument shape without caller gating', () => {
    expect(shouldContinueInterval(1000, true, false, 'run')).toBe(true)
    expect(shouldContinueInterval(1000, true, false, 'autorun')).toBe(true)
    expect(shouldContinueInterval(1000, true, true, 'run')).toBe(false)
  })
})

describe('getModelFuncJS', () => {
  const mockApp = { log: jest.fn() }

  test('wraps function with object container (default)', async () => {
    const target = (inputs) => inputs.a + inputs.b
    const wrapped = await getModelFuncJS({ type: 'function' }, target, mockApp)
    expect(wrapped({ a: 1, b: 2 })).toBe(3)
  })

  test('wraps function with args container', async () => {
    const target = (a, b) => a + b
    const wrapped = await getModelFuncJS(
      { type: 'function', container: 'args' },
      target,
      mockApp
    )
    // Object values spread as args
    expect(wrapped({ a: 10, b: 20 })).toBe(30)
  })

  test('passes app context for object container', async () => {
    const ctxApp = {
      log: jest.fn(),
      isCancelled: jest.fn(() => true)
    }
    const target = (inputs, ctx) => ({ value: inputs.a, cancelled: ctx.isCancelled() })
    const wrapped = await getModelFuncJS({ type: 'function' }, target, ctxApp)
    expect(wrapped({ a: 7 })).toEqual({ value: 7, cancelled: true })
    expect(ctxApp.isCancelled).toHaveBeenCalledTimes(1)
  })

  test('wraps class type', async () => {
    class Calculator {
      predict (inputs) { return inputs.x * 2 }
    }
    const wrapped = await getModelFuncJS({ type: 'class' }, Calculator, mockApp)
    expect(wrapped({ x: 5 })).toBe(10)
  })

  test('class type with custom method', async () => {
    class Calculator {
      double (a, b) { return (a + b) * 2 }
    }
    const wrapped = await getModelFuncJS(
      { type: 'class', method: 'double', container: 'args' },
      Calculator,
      mockApp
    )
    expect(wrapped({ a: 3, b: 4 })).toBe(14)
  })
})

describe('getModelFuncAPI', () => {
  const mockLog = jest.fn()

  beforeEach(() => {
    global.fetch = jest.fn()
  })
  afterEach(() => {
    delete global.fetch
  })

  test('creates GET function', async () => {
    global.fetch.mockResolvedValue({ json: () => Promise.resolve({ result: 42 }) })
    const fn = getModelFuncAPI({ type: 'get', url: 'https://api.example.com/run' }, mockLog)
    const result = await fn({ a: 1, b: 2 })
    expect(result).toEqual({ result: 42 })
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/run?a=1&b=2')
  })

  test('creates POST function', async () => {
    global.fetch.mockResolvedValue({
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ result: 99 })
    })
    const fn = getModelFuncAPI({ type: 'post', url: 'https://api.example.com/run' }, mockLog)
    const result = await fn({ x: 10 })
    expect(result).toEqual({ result: 99 })
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/run', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 10 })
    })
  })

  test('blocks API requests when allowNetwork is false', async () => {
    const fn = getModelFuncAPI({ type: 'post', url: 'https://api.example.com/run' }, mockLog, undefined, {
      allowNetwork: false
    })

    expect(() => fn({ x: 10 })).toThrow('security.allowNetwork is false')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('security runtime guards', () => {
  test('blocks dynamic code execution when allowEval is false', () => {
    expect(() => assertEvalAllowed({ allowEval: false }, 'inline model code'))
      .toThrow('security.allowEval is false; blocked inline model code')
  })

  test('allows dynamic code execution by default', () => {
    expect(() => assertEvalAllowed(undefined, 'inline model code')).not.toThrow()
  })
})

describe('validateSchema', () => {
  test('normalizes secure-mode defaults and explicit overrides', () => {
    expect(normalizeSecurityOptions({ mode: 'secure' })).toEqual({
      mode: 'secure',
      trusted: false,
      allowEval: false,
      allowNetwork: false,
      allowRawHtml: false,
      allowNotifications: false,
      allowFileViewer: false
    })

    expect(normalizeSecurityOptions({
      mode: 'secure',
      allowNetwork: true
    })).toEqual({
      mode: 'secure',
      trusted: false,
      allowEval: false,
      allowNetwork: true,
      allowRawHtml: false,
      allowNotifications: false,
      allowFileViewer: false
    })

    expect(normalizeSecurityOptions({ trusted: false }).mode).toBe('secure')
  })

  test('returns empty report for valid minimal schema', () => {
    const report = validateSchema({
      model: {
        code: 'function sum (a, b) { return a + b }'
      },
      inputs: [
        { name: 'a', type: 'int' },
        { name: 'b', type: 'int' }
      ]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  test('returns error when schema has no model, no view/render, and no inputs', () => {
    const report = validateSchema({})
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.errors.join(' ')).toContain('model')
  })

  test('accepts schema with inputs but no model (identity mode)', () => {
    const report = validateSchema({
      inputs: [{ name: 'x', type: 'int' }]
    })
    expect(report.errors.length).toBe(0)
  })

  test('returns warning when schema uses view/render without model', () => {
    const report = validateSchema({
      render: {
        type: 'function',
        code: 'function render () {}'
      }
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.length).toBeGreaterThan(0)
  })

  test('returns error for non-array inputs', () => {
    const report = validateSchema({
      model: { code: 'function run () {}' },
      inputs: { name: 'a', type: 'int' }
    })
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.errors.join(' ')).toContain('inputs')
  })

  test('returns warnings for unsupported input/model options', () => {
    const report = validateSchema({
      model: { type: 'unsupported-model', timeout: -1 },
      inputs: [{ name: 123, type: 'unsupported-input', alias: [1, 2, 3] }]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.length).toBeGreaterThan(0)
    expect(report.warnings.join(' ')).toContain('not recognized')
  })

  test('rejects removed TensorFlow model type', () => {
    const report = validateSchema({
      model: { type: 'tf', url: 'model.json' },
      inputs: []
    })
    expect(report.errors.join(' ')).toContain("model[0].type 'tf' is not supported")
    expect(report.errors.join(' ')).toContain('Load TensorFlow.js with imports')
  })

  test('warns for malformed Pyodide entry function names', () => {
    const report = validateSchema({
      model: { type: 'py', entry: 'bad-name()', code: 'def model(): pass' },
      inputs: []
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join(' ')).toContain('model[0].entry should be a valid Python function name')
  })

  test('warns for malformed Pyodide runtime options', () => {
    const report = validateSchema({
      model: { type: 'py', pyodide: { url: 7, indexURL: false }, code: 'def model(): pass' },
      inputs: []
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join(' ')).toContain('model[0].pyodide.url should be a string')
    expect(report.warnings.join(' ')).toContain('model[0].pyodide.indexURL should be a string')
  })

  test('warns when secure-mode advisory flags conflict with schema features', () => {
    const report = validateSchema({
      security: { mode: 'secure' },
      notify: true,
      imports: ['https://cdn.example.com/lib.js'],
      model: {
        type: 'post',
        url: 'https://api.example.com/run',
        code: 'function run () {}'
      },
      inputs: [
        { name: 'upload', type: 'file' }
      ],
      outputs: [
        { name: 'page', type: 'html' },
        { name: 'doc', type: 'pdf' }
      ]
    })
    const warnings = report.warnings.join('\n')

    expect(report.errors).toEqual([])
    expect(warnings).toContain('security.mode enables opt-in runtime enforcement')
    expect(warnings).toContain('security.allowEval is false')
    expect(warnings).toContain('security.allowNetwork is false')
    expect(warnings).toContain('security.allowRawHtml is false')
    expect(warnings).toContain('security.allowNotifications is false')
    expect(warnings).toContain('security.allowFileViewer is false')
  })

  test('accepts module models and warns for invalid export selector', () => {
    const valid = validateSchema({
      model: { type: 'module', url: './model.mjs', export: 'predict' }
    })
    expect(valid.errors).toEqual([])
    expect(valid.warnings).toEqual([])

    const invalid = validateSchema({
      model: { type: 'module', url: './model.mjs', export: 3 }
    })
    expect(invalid.errors).toEqual([])
    expect(invalid.warnings.join(' ')).toContain('model[0].export should be a string')
  })

  test('warns for malformed security options without failing schema validation', () => {
    const report = validateSchema({
      security: {
        mode: 'locked',
        trusted: 'no',
        allowEval: 'no'
      },
      model: { code: 'function run () {}' }
    })
    const warnings = report.warnings.join('\n')

    expect(report.errors).toEqual([])
    expect(warnings).toContain("security.mode should be 'trusted' or 'secure'")
    expect(warnings).toContain('security.trusted should be a boolean')
    expect(warnings).toContain('security.allowEval should be a boolean')
  })

  test('warns when inferInputTypes is not boolean', () => {
    const report = validateSchema({
      inferInputTypes: 'yes',
      model: { code: 'function run (value = 1) { return value }' }
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join('\n')).toContain('inferInputTypes should be a boolean')
  })

  test('sanitizes raw HTML when secure mode disables raw HTML', () => {
    const dirty = '<p onclick="window.bad = 1"><strong>ok</strong></p><script>window.bad = 1</script><a href="javascript:window.bad = 1">bad</a><iframe src="https://example.com"></iframe>'
    const clean = sanitizeHtml(dirty, { mode: 'secure' })

    expect(clean).toContain('<strong>ok</strong>')
    expect(clean).toContain('bad</a>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('javascript:')
    expect(clean).not.toContain('<iframe')
  })

  test('sanitizes obfuscated URLs in the fallback sanitizer', () => {
    const dirty = [
      '<a href="java\nscript:window.bad = 1">newline</a>',
      '<a href="jav&#x61;script:window.bad = 1">entity</a>',
      '<img src="data:text/html,<script>window.bad = 1</script>">'
    ].join('')
    const clean = sanitizeHtml(dirty, { mode: 'secure' })
    const compact = clean.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()

    expect(clean).toContain('newline</a>')
    expect(clean).toContain('entity</a>')
    expect(compact).not.toContain('javascript:')
    expect(compact).not.toContain('data:text/html')
    expect(clean).not.toContain('<script')
  })

  test('leaves raw HTML unchanged in trusted mode', () => {
    const dirty = '<p onclick="window.bad = 1"><strong>ok</strong></p>'
    expect(sanitizeHtml(dirty, { mode: 'trusted' })).toBe(dirty)
  })

  test('accepts file input raw flag when it is boolean', () => {
    const report = validateSchema({
      model: { code: 'function run () {}' },
      inputs: [{ name: 'file', type: 'file', raw: true }]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  test('warns when file input raw flag is not boolean', () => {
    const report = validateSchema({
      model: { code: 'function run () {}' },
      inputs: [{ name: 'file', type: 'file', raw: 'yes' }]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join(' ')).toContain('raw should be a boolean')
  })

  test('accepts file input stream flag when it is boolean', () => {
    const report = validateSchema({
      model: { code: 'function run () {}' },
      inputs: [{ name: 'file', type: 'file', stream: true }]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
  })

  test('warns when file input stream flag is not boolean', () => {
    const report = validateSchema({
      model: { code: 'function run () {}' },
      inputs: [{ name: 'file', type: 'file', stream: 'yes' }]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join(' ')).toContain('stream should be a boolean')
  })

  test('warns when stream flag is used on non-file input', () => {
    const report = validateSchema({
      model: { code: 'function run () {}' },
      inputs: [{ name: 'text', type: 'string', stream: true }]
    })
    expect(report.errors).toEqual([])
    expect(report.warnings.join(' ')).toContain('stream is supported only for file inputs')
  })
})

describe('generateOpenAPISpec', () => {
  test('generates declared output, multipart, SSE, errors, and examples schemas', () => {
    const spec = generateOpenAPISpec({
      title: 'Analysis API',
      model: { name: 'analyze', type: 'post', stream: true },
      inputs: [
        { name: 'x', type: 'int' },
        { name: 'upload', type: 'file' }
      ],
      outputs: [
        { name: 'summary', type: 'markdown' },
        { name: 'score', type: 'number' },
        { name: 'rows', type: 'table' },
        {
          name: 'assets',
          type: 'group',
          elements: [
            { name: 'report', type: 'pdf' }
          ]
        }
      ],
      examples: [{ x: 3 }]
    })

    const operation = spec.paths['/analyze'].post
    const requestContent = operation.requestBody.content
    const responseContent = operation.responses['200'].content
    const responseSchema = responseContent['application/json'].schema

    expect(requestContent['application/json'].examples.example1.value).toEqual({ x: 3 })
    expect(requestContent['multipart/form-data'].schema.properties.upload).toEqual({
      type: 'string',
      format: 'binary'
    })
    expect(responseSchema.properties.summary).toEqual({ type: 'string' })
    expect(responseSchema.properties.score).toEqual({ type: 'number' })
    expect(responseSchema.properties.rows.oneOf).toBeDefined()
    expect(responseSchema.properties.report.oneOf).toBeDefined()
    expect(responseContent['text/event-stream']).toBeDefined()
    expect(operation.responses['400'].content['application/json'].schema.properties.error).toEqual({ type: 'string' })
    expect(operation.responses['500'].content['application/json'].schema.required).toContain('error')
  })
})

describe('getUrlParam', () => {
  function makeParams (obj) {
    return new URLSearchParams(obj)
  }

  test('matches by input name', () => {
    const params = makeParams({ myInput: '42' })
    expect(getUrlParam(params, { name: 'myInput' })).toBe('42')
  })

  test('matches by sanitized name', () => {
    const params = makeParams({ my_input: '42' })
    expect(getUrlParam(params, { name: 'my input' })).toBe('42')
  })

  test('matches by string alias', () => {
    const params = makeParams({ f: 'data.csv' })
    expect(getUrlParam(params, { name: 'file', alias: 'f' })).toBe('data.csv')
  })

  test('matches by array alias', () => {
    const params = makeParams({ src: 'data.csv' })
    expect(getUrlParam(params, { name: 'file', alias: ['f', 'src'] })).toBe('data.csv')
  })

  test('returns null when no match', () => {
    const params = makeParams({ other: '1' })
    expect(getUrlParam(params, { name: 'file' })).toBeNull()
  })

  test('returns null when no alias match', () => {
    const params = makeParams({ other: '1' })
    expect(getUrlParam(params, { name: 'file', alias: ['f', 'data'] })).toBeNull()
  })

  test('prefers name over alias', () => {
    const params = makeParams({ file: 'direct', f: 'alias' })
    expect(getUrlParam(params, { name: 'file', alias: 'f' })).toBe('direct')
  })

  test('returns null when input has no name', () => {
    const params = makeParams({ x: '1' })
    expect(getUrlParam(params, { type: 'group' })).toBeNull()
  })
})

describe('coerceParam', () => {
  test('coerces to number', () => {
    expect(coerceParam('42', 'number', 'x')).toBe(42)
    expect(coerceParam('3.14', 'number', 'x')).toBeCloseTo(3.14)
  })

  test('coerces to boolean', () => {
    expect(coerceParam('true', 'boolean', 'x')).toBe(true)
    expect(coerceParam('true', 'bool', 'x')).toBe(true)
    expect(coerceParam('false', 'boolean', 'x')).toBe(false)
    expect(coerceParam('false', 'bool', 'x')).toBe(false)
    expect(coerceParam('yes', 'boolean', 'x')).toBe(false)
  })

  test('coerces to JSON', () => {
    expect(coerceParam('{"a":1}', 'json', 'x')).toEqual({ a: 1 })
    expect(coerceParam('[1,2,3]', 'json', 'x')).toEqual([1, 2, 3])
  })

  test('returns original string for invalid JSON', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    expect(coerceParam('not json', 'json', 'x')).toBe('not json')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  test('returns string as-is for unknown types', () => {
    expect(coerceParam('hello', 'string', 'x')).toBe('hello')
    expect(coerceParam('hello', 'text', 'x')).toBe('hello')
  })
})

describe('error scenarios', () => {
  describe('validateSchema edge cases', () => {
    test('handles empty schema', () => {
      const report = validateSchema({})
      expect(report.errors.length).toBeGreaterThan(0)
    })

    test('handles null/undefined inputs gracefully', () => {
      const report = validateSchema({
        model: { code: 'function run () {}' },
        inputs: null
      })
      // null inputs should not crash
      expect(report).toBeDefined()
    })

    test('warns on multiple issues at once', () => {
      const report = validateSchema({
        model: { type: 'bad-type', timeout: -100 },
        inputs: [
          { name: 123, type: 'invalid-type', alias: [1], raw: 'yes', stream: 'yes' }
        ]
      })
      expect(report.warnings.length).toBeGreaterThan(3)
    })
  })

  describe('getName edge cases', () => {
    test('handles empty string', () => {
      expect(getName('')).toBeUndefined()
    })

    test('handles whitespace-only string', () => {
      expect(getName('   ')).toBeUndefined()
    })

    test('handles object input', () => {
      expect(getName({})).toBeUndefined()
    })
  })

  describe('sanitizeName edge cases', () => {
    test('handles empty string', () => {
      expect(sanitizeName('')).toBe('')
    })

    test('handles string with only special chars', () => {
      const result = sanitizeName('!@#$%')
      expect(typeof result).toBe('string')
    })

    test('handles numbers as input', () => {
      expect(sanitizeName('123abc')).toBe('123abc')
    })
  })

  describe('getModelFuncJS error handling', () => {
    const mockApp = { log: jest.fn() }

    test('class without predict method throws', async () => {
      class NoPredict {}
      await expect(async () => {
        const wrapped = await getModelFuncJS({ type: 'class' }, NoPredict, mockApp)
        wrapped({ x: 1 })
      }).rejects.toThrow()
    })
  })

  describe('toWorkerSerializable edge cases', () => {
    test('handles empty object', () => {
      const result = toWorkerSerializable({})
      expect(result).toEqual({})
    })

    test('handles nested objects without binary', () => {
      const input = { a: 1, b: { c: 'hello' } }
      const result = toWorkerSerializable(input)
      expect(result).toEqual(input)
    })

    test('handles null values', () => {
      const input = { a: null, b: undefined }
      const result = toWorkerSerializable(input)
      expect(result.a).toBeNull()
    })
  })

  describe('containsBinaryPayload edge cases', () => {
    test('returns false for empty object', () => {
      expect(containsBinaryPayload({})).toBe(false)
    })

    test('returns false for string values', () => {
      expect(containsBinaryPayload({ a: 'hello', b: '123' })).toBe(false)
    })

    test('returns false for null/undefined', () => {
      expect(containsBinaryPayload(null)).toBe(false)
      expect(containsBinaryPayload(undefined)).toBe(false)
    })
  })

  describe('serializeResult', () => {
    test('wraps primitives in result key', () => {
      expect(serializeResult(42)).toEqual({ result: 42 })
      expect(serializeResult('hello')).toEqual({ result: 'hello' })
      expect(serializeResult(true)).toEqual({ result: true })
    })

    test('returns plain objects as-is', () => {
      expect(serializeResult({ sum: 7 })).toEqual({ sum: 7 })
    })

    test('returns arrays as-is', () => {
      expect(serializeResult([1, 2, 3])).toEqual([1, 2, 3])
    })

    test('converts Buffer to base64 image', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const result = serializeResult(buf)
      expect(result.result).toMatch(/^data:image\/png;base64,/)
    })

    test('converts Uint8Array to base64 image', () => {
      const arr = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const result = serializeResult(arr)
      expect(result.result).toMatch(/^data:image\/png;base64,/)
    })

    test('sniffs common binary MIME types', () => {
      expect(serializeResult(Buffer.from('%PDF-1.4\n')).result).toMatch(/^data:application\/pdf;base64,/)
      expect(serializeResult(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).result).toMatch(/^data:image\/jpeg;base64,/)
      expect(serializeResult(Buffer.from('GIF89a')).result).toMatch(/^data:image\/gif;base64,/)
      expect(serializeResult(Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ')).result).toMatch(/^data:image\/webp;base64,/)
      expect(serializeResult(Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ')).result).toMatch(/^data:audio\/wav;base64,/)
      expect(serializeResult(Buffer.from([1, 2, 3])).result).toMatch(/^data:application\/octet-stream;base64,/)
    })

    test('handles null and undefined', () => {
      expect(serializeResult(null)).toEqual({ result: null })
      expect(serializeResult(undefined)).toEqual({ result: null })
    })
  })

  describe('parseMultipart', () => {
    function buildMultipart (boundary, fields) {
      const parts = []
      for (const [name, value, filename] of fields) {
        let headers = `Content-Disposition: form-data; name="${name}"`
        if (filename) headers += `; filename="${filename}"`
        parts.push(`--${boundary}\r\n${headers}\r\n\r\n${value}`)
      }
      parts.push(`--${boundary}--\r\n`)
      return Buffer.from(parts.join('\r\n') + '\r\n')
    }

    test('parses text fields', () => {
      const boundary = 'abc123'
      const body = buildMultipart(boundary, [
        ['name', 'Alice'],
        ['age', '30']
      ])
      const result = parseMultipart('multipart/form-data; boundary=' + boundary, body)
      expect(result.name).toBe('Alice')
      expect(result.age).toBe(30) // parsed as JSON number
    })

    test('parses file fields as Buffer', () => {
      const boundary = 'xyz789'
      const body = buildMultipart(boundary, [
        ['file', 'binary data here', 'test.png']
      ])
      const result = parseMultipart('multipart/form-data; boundary=' + boundary, body)
      expect(Buffer.isBuffer(result.file)).toBe(true)
    })

    test('handles mixed fields and files', () => {
      const boundary = 'mixed'
      const body = buildMultipart(boundary, [
        ['label', 'test'],
        ['count', '5'],
        ['data', 'file content', 'data.csv']
      ])
      const result = parseMultipart('multipart/form-data; boundary=' + boundary, body)
      expect(result.label).toBe('test')
      expect(result.count).toBe(5)
      expect(Buffer.isBuffer(result.data)).toBe(true)
    })

    test('returns empty object for invalid content type', () => {
      expect(parseMultipart('text/plain', Buffer.from(''))).toEqual({})
    })
  })
})

describe('parseSSELine', () => {
  test('parses JSON data line', () => {
    expect(parseSSELine('data: {"result": 42}')).toEqual({ result: 42 })
  })

  test('parses data line with extra whitespace', () => {
    expect(parseSSELine('data:  {"a":1} ')).toEqual({ a: 1 })
  })

  test('returns null for [DONE] sentinel', () => {
    expect(parseSSELine('data: [DONE]')).toBeNull()
  })

  test('returns plain string for non-JSON data', () => {
    expect(parseSSELine('data: hello world')).toBe('hello world')
  })

  test('returns null for non-data lines', () => {
    expect(parseSSELine('event: update')).toBeNull()
    expect(parseSSELine(': comment')).toBeNull()
    expect(parseSSELine('')).toBeNull()
  })
})

describe('toTypedArray', () => {
  test('converts JS array to Float64Array', () => {
    const result = toTypedArray([1, 2, 3], 'float64')
    expect(result).toBeInstanceOf(Float64Array)
    expect(Array.from(result)).toEqual([1, 2, 3])
  })

  test('converts JS array to Float32Array', () => {
    const result = toTypedArray([1.5, 2.5], 'float32')
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(2)
  })

  test('converts JS array to Uint8Array', () => {
    const result = toTypedArray([0, 128, 255], 'uint8')
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result)).toEqual([0, 128, 255])
  })

  test('returns same typed array if already correct type', () => {
    const arr = new Float64Array([1, 2])
    expect(toTypedArray(arr, 'float64')).toBe(arr)
  })

  test('returns value unchanged for unknown dtype', () => {
    expect(toTypedArray([1, 2], 'unknown')).toEqual([1, 2])
  })

  test('returns value unchanged when no dtype', () => {
    expect(toTypedArray([1, 2], null)).toEqual([1, 2])
  })
})

describe('fromTypedArray', () => {
  test('converts typed array to plain array', () => {
    expect(fromTypedArray(new Float64Array([1, 2, 3]))).toEqual([1, 2, 3])
  })

  test('returns non-typed-array as-is', () => {
    expect(fromTypedArray([1, 2])).toEqual([1, 2])
    expect(fromTypedArray('hello')).toBe('hello')
  })
})

describe('wrapTypedArrayInputs', () => {
  test('converts declared arrayBuffer inputs', () => {
    const inputs = { data: [1, 2, 3], name: 'test' }
    const configs = [
      { name: 'data', arrayBuffer: true, dtype: 'float32' },
      { name: 'name', type: 'string' }
    ]
    const wrapped = wrapTypedArrayInputs(inputs, configs)
    expect(wrapped.data).toBeInstanceOf(Float32Array)
    expect(wrapped.name).toBe('test')
  })

  test('skips inputs without arrayBuffer flag', () => {
    const inputs = { data: [1, 2] }
    const configs = [{ name: 'data', type: 'string' }]
    const wrapped = wrapTypedArrayInputs(inputs, configs)
    expect(Array.isArray(wrapped.data)).toBe(true)
  })

  test('defaults dtype to float64', () => {
    const inputs = { data: [1, 2] }
    const configs = [{ name: 'data', arrayBuffer: true }]
    const wrapped = wrapTypedArrayInputs(inputs, configs)
    expect(wrapped.data).toBeInstanceOf(Float64Array)
  })

  test('returns inputs unchanged if configs is not array', () => {
    expect(wrapTypedArrayInputs({ a: 1 }, null)).toEqual({ a: 1 })
  })
})

describe('collectTransferables', () => {
  test('collects ArrayBuffer from typed array', () => {
    const arr = new Float32Array([1, 2, 3])
    const result = collectTransferables({ data: arr })
    expect(result.length).toBe(1)
    expect(result[0]).toBe(arr.buffer)
  })

  test('collects nested ArrayBuffers', () => {
    const a = new Uint8Array([1])
    const b = new Float64Array([2])
    const result = collectTransferables({ a, nested: { b } })
    expect(result.length).toBe(2)
  })

  test('returns empty array for plain objects', () => {
    expect(collectTransferables({ a: 1, b: 'hello' })).toEqual([])
  })

  test('handles null and primitives', () => {
    expect(collectTransferables(null)).toEqual([])
    expect(collectTransferables(42)).toEqual([])
    expect(collectTransferables('str')).toEqual([])
  })
})

describe('createValidateFn', () => {
  // Simple filtrex-like compiler for testing
  const mockCompile = (expr, opts) => {
    return (ctx) => {
      const { value } = ctx
      const { extraFunctions } = opts || {}
      // Support simple expressions for testing
      if (expr === 'value >= 0 and value <= 150') return value >= 0 && value <= 150
      if (expr === 'value > 0') return value > 0
      if (expr === 'len(value) > 0') return extraFunctions.len(value) > 0
      return true
    }
  }
  const filtrexOptions = { extraFunctions: { len: s => (s && s.length) || 0 } }

  test('returns null for input without validate or required', () => {
    const fn = createValidateFn({ name: 'x', type: 'string' }, mockCompile, filtrexOptions)
    expect(fn).toBeNull()
  })

  test('validates with filtrex expression — valid value', () => {
    const fn = createValidateFn(
      { name: 'age', type: 'int', validate: 'value >= 0 and value <= 150' },
      mockCompile, filtrexOptions
    )
    expect(fn(25)).toBeNull()
  })

  test('validates with filtrex expression — invalid value', () => {
    const fn = createValidateFn(
      { name: 'age', type: 'int', validate: 'value >= 0 and value <= 150' },
      mockCompile, filtrexOptions
    )
    expect(fn(200)).toBe('Invalid value')
  })

  test('uses custom error message', () => {
    const fn = createValidateFn(
      { name: 'age', type: 'int', validate: 'value > 0', error: 'Must be positive' },
      mockCompile, filtrexOptions
    )
    expect(fn(0)).toBe('Must be positive')
    expect(fn(5)).toBeNull()
  })

  test('required rejects empty string', () => {
    const fn = createValidateFn(
      { name: 'name', type: 'string', required: true },
      mockCompile, filtrexOptions
    )
    expect(fn('')).toBe('Required')
    expect(fn('hello')).toBeNull()
  })

  test('required rejects null and undefined', () => {
    const fn = createValidateFn(
      { name: 'x', type: 'string', required: true },
      mockCompile, filtrexOptions
    )
    expect(fn(null)).toBe('Required')
    expect(fn(undefined)).toBe('Required')
  })

  test('required rejects empty array', () => {
    const fn = createValidateFn(
      { name: 'tags', type: 'multi-select', required: true },
      mockCompile, filtrexOptions
    )
    expect(fn([])).toBe('Required')
    expect(fn(['a'])).toBeNull()
  })

  test('required with custom error message', () => {
    const fn = createValidateFn(
      { name: 'x', type: 'string', required: true, error: 'Please fill this in' },
      mockCompile, filtrexOptions
    )
    expect(fn('')).toBe('Please fill this in')
  })

  test('validate expression error returns error message', () => {
    const throwingCompile = () => () => { throw new Error('bad') }
    const fn = createValidateFn(
      { name: 'x', type: 'string', validate: 'bad expr' },
      throwingCompile, filtrexOptions
    )
    expect(fn('anything')).toBe('Invalid value')
  })
})

describe('runValidation', () => {
  test('sets _error on invalid inputs', () => {
    const inputs = [
      { name: 'a', value: '', _error: null },
      { name: 'b', value: 5, _error: null }
    ]
    const fns = [
      (v) => v === '' ? 'Required' : null,
      null
    ]
    const hasErrors = runValidation(inputs, fns)
    expect(hasErrors).toBe(true)
    expect(inputs[0]._error).toBe('Required')
    expect(inputs[1]._error).toBeNull()
  })

  test('clears _error on valid inputs', () => {
    const inputs = [
      { name: 'a', value: 'hello', _error: 'Required' }
    ]
    const fns = [(v) => v === '' ? 'Required' : null]
    const hasErrors = runValidation(inputs, fns)
    expect(hasErrors).toBe(false)
    expect(inputs[0]._error).toBeNull()
  })

  test('returns false when no validation functions', () => {
    const inputs = [
      { name: 'a', value: '', _error: null }
    ]
    const hasErrors = runValidation(inputs, [null])
    expect(hasErrors).toBe(false)
  })

  test('handles empty inputs', () => {
    expect(runValidation([], [])).toBe(false)
  })
})

describe('columnsToRows', () => {
  test('converts column-oriented data to row-oriented', () => {
    const result = columnsToRows({ x: [1, 2, 3], y: [4, 5, 6] })
    expect(result).toEqual([
      { x: 1, y: 4 },
      { x: 2, y: 5 },
      { x: 3, y: 6 }
    ])
  })

  test('returns empty array for empty object', () => {
    expect(columnsToRows({})).toEqual([])
  })

  test('returns input unchanged if not an object', () => {
    expect(columnsToRows([1, 2])).toEqual([1, 2])
    expect(columnsToRows('hello')).toBe('hello')
    expect(columnsToRows(null)).toBe(null)
    expect(columnsToRows(42)).toBe(42)
  })

  test('returns input unchanged if values are not arrays', () => {
    expect(columnsToRows({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 })
  })

  test('returns input unchanged if arrays have different lengths', () => {
    const data = { x: [1, 2], y: [3] }
    expect(columnsToRows(data)).toEqual(data)
  })

  test('handles single-column data', () => {
    expect(columnsToRows({ x: [1, 2, 3] })).toEqual([
      { x: 1 },
      { x: 2 },
      { x: 3 }
    ])
  })

  test('handles single-row data', () => {
    expect(columnsToRows({ x: [10], y: [20] })).toEqual([
      { x: 10, y: 20 }
    ])
  })
})

describe('fileExtToOutputType', () => {
  test('maps image extensions', () => {
    expect(fileExtToOutputType('photo.png')).toBe('image')
    expect(fileExtToOutputType('pic.jpg')).toBe('image')
    expect(fileExtToOutputType('icon.svg')).toBe('image')
  })
  test('maps pdf extension', () => {
    expect(fileExtToOutputType('report.pdf')).toBe('pdf')
  })
  test('maps audio extensions', () => {
    expect(fileExtToOutputType('song.mp3')).toBe('audio')
    expect(fileExtToOutputType('clip.wav')).toBe('audio')
  })
  test('maps video extensions', () => {
    expect(fileExtToOutputType('movie.mp4')).toBe('video')
  })
  test('maps table extensions', () => {
    expect(fileExtToOutputType('data.csv')).toBe('table')
    expect(fileExtToOutputType('data.tsv')).toBe('table')
  })
  test('maps markdown extension', () => {
    expect(fileExtToOutputType('readme.md')).toBe('markdown')
  })
  test('maps html extension', () => {
    expect(fileExtToOutputType('page.html')).toBe('html')
  })
  test('maps json extension', () => {
    expect(fileExtToOutputType('data.json')).toBe('object')
  })
  test('returns code for unknown extensions', () => {
    expect(fileExtToOutputType('file.xyz')).toBe('code')
    expect(fileExtToOutputType('script.py')).toBe('code')
  })
  test('returns code for non-string input', () => {
    expect(fileExtToOutputType(null)).toBe('code')
    expect(fileExtToOutputType(42)).toBe('code')
  })
  test('returns code for no extension', () => {
    expect(fileExtToOutputType('Makefile')).toBe('code')
  })
  test('handles query strings in filenames', () => {
    expect(fileExtToOutputType('photo.png?v=1')).toBe('image')
  })
})

describe('inferOutputType', () => {
  test('detects image data URLs', () => {
    expect(inferOutputType('img', 'data:image/png;base64,abc')).toBe('image')
  })
  test('detects audio data URLs', () => {
    expect(inferOutputType('snd', 'data:audio/mp3;base64,abc')).toBe('audio')
  })
  test('detects video data URLs', () => {
    expect(inferOutputType('vid', 'data:video/mp4;base64,abc')).toBe('video')
  })
  test('detects pdf data URLs', () => {
    expect(inferOutputType('doc', 'data:application/pdf;base64,abc')).toBe('pdf')
  })
  test('detects image URLs by extension', () => {
    expect(inferOutputType('img', '/path/photo.png')).toBe('image')
    expect(inferOutputType('img', 'https://example.com/pic.jpg')).toBe('image')
  })
  test('detects audio URLs by extension', () => {
    expect(inferOutputType('snd', '/files/song.mp3')).toBe('audio')
  })
  test('detects video URLs by extension', () => {
    expect(inferOutputType('vid', '/files/movie.mp4')).toBe('video')
  })
  test('detects pdf URLs by extension', () => {
    expect(inferOutputType('doc', '/files/report.pdf')).toBe('pdf')
  })
  test('detects markdown URLs by extension', () => {
    expect(inferOutputType('doc', '/files/readme.md')).toBe('markdown')
  })
  test('detects long multiline strings as code', () => {
    const code = 'function foo() {\n' + '  return 1\n'.repeat(30) + '}'
    expect(inferOutputType('src', code)).toBe('code')
  })
  test('returns string for short strings', () => {
    expect(inferOutputType('msg', 'hello world')).toBe('string')
  })
  test('detects array of objects as table', () => {
    expect(inferOutputType('data', [{a: 1}, {a: 2}])).toBe('table')
  })
  test('detects array of image URLs as gallery', () => {
    expect(inferOutputType('imgs', ['a.png', 'b.jpg'])).toBe('gallery')
  })
  test('detects plain array as object', () => {
    expect(inferOutputType('arr', [1, 2, 3])).toBe('object')
  })
  test('detects objects as object', () => {
    expect(inferOutputType('obj', {a: 1})).toBe('object')
  })
  test('detects numbers as string', () => {
    expect(inferOutputType('num', 42)).toBe('string')
  })
  test('detects booleans as string', () => {
    expect(inferOutputType('flag', true)).toBe('string')
  })
  test('handles null', () => {
    expect(inferOutputType('n', null)).toBe('string')
  })
  test('handles URLs with query strings', () => {
    expect(inferOutputType('img', '/photo.png?v=2')).toBe('image')
  })
})
