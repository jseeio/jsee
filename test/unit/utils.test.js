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
  containsBinaryPayload
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

describe('getUrl', () => {
  test('returns absolute URLs as-is', () => {
    expect(getUrl('https://example.com/lib.js')).toBe('https://example.com/lib.js')
  })
  test('prepends CDN base for bare package names', () => {
    expect(getUrl('lodash@4.17.21/lodash.min.js'))
      .toBe('https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js')
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
    global.fetch.mockResolvedValue({ json: () => Promise.resolve({ result: 99 }) })
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
