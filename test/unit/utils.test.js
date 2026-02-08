const {
  isObject,
  sanitizeName,
  getUrl,
  delay,
  debounce,
  getModelFuncJS,
  getModelFuncAPI
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
