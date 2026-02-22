const {
  isObject,
  sanitizeName,
  getUrl,
  delay,
  debounce,
  getName,
  isWorkerInitMessage,
  getProgressState,
  shouldContinueInterval,
  getModelFuncJS,
  getModelFuncAPI,
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
  runValidation
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

describe('shouldContinueInterval', () => {
  test('returns true only for active non-cancelled run caller', () => {
    expect(shouldContinueInterval(1000, true, false, 'run')).toBe(true)
  })

  test('returns false when run is cancelled', () => {
    expect(shouldContinueInterval(1000, true, true, 'run')).toBe(false)
  })

  test('returns false for non-run callers', () => {
    expect(shouldContinueInterval(1000, true, false, 'reactive')).toBe(false)
    expect(shouldContinueInterval(1000, true, false, 'autorun')).toBe(false)
  })

  test('returns false when interval is missing or run is inactive', () => {
    expect(shouldContinueInterval(0, true, false, 'run')).toBe(false)
    expect(shouldContinueInterval(null, true, false, 'run')).toBe(false)
    expect(shouldContinueInterval(1000, false, false, 'run')).toBe(false)
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
})

describe('validateSchema', () => {
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

  test('returns error when schema has no model and no view/render', () => {
    const report = validateSchema({
      inputs: [{ name: 'x', type: 'int' }]
    })
    expect(report.errors.length).toBeGreaterThan(0)
    expect(report.errors.join(' ')).toContain('model')
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
    expect(coerceParam('false', 'boolean', 'x')).toBe(false)
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
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      const result = serializeResult(buf)
      expect(result.result).toMatch(/^data:image\/png;base64,/)
    })

    test('converts Uint8Array to base64 image', () => {
      const arr = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      const result = serializeResult(arr)
      expect(result.result).toMatch(/^data:image\/png;base64,/)
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
