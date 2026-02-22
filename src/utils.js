const { DEFAULT_CHUNK_SIZE, STREAM_HIGH_WATER } = require('./constants')

// https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
function isObject (item) {
  return (typeof item === 'object' && !Array.isArray(item) && item !== null)
}

function shouldPreserveWorkerValue (value) {
  if (!value || typeof value !== 'object') {
    return true
  }
  if ((typeof File !== 'undefined') && (value instanceof File)) {
    return true
  }
  if ((typeof Blob !== 'undefined') && (value instanceof Blob)) {
    return true
  }
  if ((typeof ArrayBuffer !== 'undefined') && (value instanceof ArrayBuffer)) {
    return true
  }
  if ((typeof ArrayBuffer !== 'undefined') && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
    return true
  }
  if ((typeof Date !== 'undefined') && (value instanceof Date)) {
    return true
  }
  if ((typeof RegExp !== 'undefined') && (value instanceof RegExp)) {
    return true
  }
  if ((typeof URL !== 'undefined') && (value instanceof URL)) {
    return true
  }
  if ((typeof Map !== 'undefined') && (value instanceof Map)) {
    return true
  }
  if ((typeof Set !== 'undefined') && (value instanceof Set)) {
    return true
  }
  return false
}

function containsBinaryPayload (value, seen=new WeakSet()) {
  if (!value || (typeof value !== 'object')) {
    return false
  }
  if ((typeof File !== 'undefined') && (value instanceof File)) {
    return true
  }
  if ((typeof Blob !== 'undefined') && (value instanceof Blob)) {
    return true
  }
  if ((typeof ArrayBuffer !== 'undefined') && (value instanceof ArrayBuffer)) {
    return true
  }
  if ((typeof ArrayBuffer !== 'undefined') && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
    return true
  }

  if (seen.has(value)) {
    return false
  }
  seen.add(value)

  if (Array.isArray(value)) {
    return value.some(item => containsBinaryPayload(item, seen))
  }

  if ((typeof Map !== 'undefined') && (value instanceof Map)) {
    for (const [key, item] of value.entries()) {
      if (containsBinaryPayload(key, seen) || containsBinaryPayload(item, seen)) {
        return true
      }
    }
    return false
  }

  if ((typeof Set !== 'undefined') && (value instanceof Set)) {
    for (const item of value.values()) {
      if (containsBinaryPayload(item, seen)) {
        return true
      }
    }
    return false
  }

  for (const key of Object.keys(value)) {
    if (containsBinaryPayload(value[key], seen)) {
      return true
    }
  }
  return false
}

const VALID_INPUT_TYPES = [
  'int',
  'float',
  'number',
  'string',
  'color',
  'text',
  'categorical',
  'select',
  'bool',
  'checkbox',
  'file',
  'group',
  'action',
  'button',
  'slider',
  'radio',
  'toggle',
  'date',
  'multi-select',
  'range'
]

const VALID_MODEL_TYPES = [
  'function',
  'class',
  'async-init',
  'async-function',
  'get',
  'post',
  'py',
  'tf'
]

function sanitizeName (inputName) {
  return inputName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

function isWorkerInitMessage (data, initialized=false) {
  if (initialized || !isObject(data)) {
    return false
  }
  return (typeof data.url !== 'undefined') || (typeof data.code !== 'undefined')
}

function getProgressState (value) {
  if (value === null) {
    return {
      mode: 'indeterminate',
      value: null
    }
  }

  const progressValue = Number(value)
  if (Number.isNaN(progressValue)) {
    return null
  }

  return {
    mode: 'determinate',
    value: Math.max(0, Math.min(100, progressValue))
  }
}

function shouldContinueInterval (interval, running, cancelled, caller) {
  return Boolean(interval) && running && !cancelled && caller === 'run'
}

function createAbortError (message='Operation aborted') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function isAbortRequested (signal, isCancelled) {
  return !!(
    (signal && signal.aborted)
    || (typeof isCancelled === 'function' && isCancelled())
  )
}

function isFileLikeSource (source) {
  return !!source
    && (typeof source === 'object')
    && (typeof source.slice === 'function')
    && (typeof source.size === 'number')
}

function getUrlFromSource (source) {
  if (typeof source === 'string') {
    return source
  }
  if (source && source.kind === 'url' && (typeof source.url === 'string')) {
    return source.url
  }
  return null
}

function isChunkedReaderSource (source) {
  return !!source
    && (typeof source === 'object')
    && (typeof source[Symbol.asyncIterator] === 'function')
    && (typeof source.text === 'function')
    && (typeof source.bytes === 'function')
    && (typeof source.lines === 'function')
}

function getNameFromUrl (sourceUrl) {
  if ((typeof sourceUrl !== 'string') || (sourceUrl.length === 0)) {
    return undefined
  }

  try {
    const baseUrl = (typeof location !== 'undefined' && location.href)
      ? location.href
      : 'http://localhost/'
    const parsed = new URL(sourceUrl, baseUrl)
    const fileName = parsed.pathname.split('/').pop()
    return fileName || undefined
  } catch (error) {
    const noQuery = sourceUrl.split('?')[0].split('#')[0]
    const fileName = noQuery.split('/').pop()
    return fileName || undefined
  }
}

function getStreamMetadata (source, sourceUrl) {
  const metadata = {}

  if (source && (typeof source === 'object')) {
    if (typeof source.name === 'string') {
      metadata.name = source.name
    }
    if ((typeof source.size === 'number') && !Number.isNaN(source.size)) {
      metadata.size = source.size
    }
    if (typeof source.type === 'string') {
      metadata.type = source.type
    }
  }

  if (!metadata.name) {
    const inferredName = getNameFromUrl(sourceUrl)
    if (typeof inferredName === 'string') {
      metadata.name = inferredName
    }
  }

  return metadata
}

// Async channel with backpressure for streaming chunks
function createChunkChannel () {
  const queue = []
  let waitingConsumer = null  // resolve fn when consumer awaits data
  let waitingProducer = null  // resolve fn when producer awaits drain
  let done = false
  let error = null
  const HIGH_WATER = STREAM_HIGH_WATER

  return {
    async push (chunk) {
      if (done || error) return
      queue.push(chunk)
      if (waitingConsumer) {
        const resolve = waitingConsumer
        waitingConsumer = null
        resolve()
      }
      if (queue.length >= HIGH_WATER) {
        await new Promise(resolve => { waitingProducer = resolve })
      }
    },
    close () {
      done = true
      if (waitingConsumer) {
        const resolve = waitingConsumer
        waitingConsumer = null
        resolve()
      }
    },
    fail (err) {
      error = err
      done = true
      if (waitingConsumer) {
        const resolve = waitingConsumer
        waitingConsumer = null
        resolve()
      }
    },
    [Symbol.asyncIterator] () {
      return {
        async next () {
          while (queue.length === 0 && !done) {
            await new Promise(resolve => { waitingConsumer = resolve })
          }
          if (queue.length > 0) {
            const value = queue.shift()
            if (waitingProducer && queue.length < HIGH_WATER) {
              const resolve = waitingProducer
              waitingProducer = null
              resolve()
            }
            return { value, done: false }
          }
          if (error) {
            throw error
          }
          return { value: undefined, done: true }
        }
      }
    }
  }
}

// Lightweight async-iterable reader for chunked data (File or fetch)
class ChunkedReader {
  constructor (channel, metadata={}) {
    this._channel = channel
    if (typeof metadata.name === 'string') {
      this.name = metadata.name
    }
    if ((typeof metadata.size === 'number') && !Number.isNaN(metadata.size)) {
      this.size = metadata.size
    }
    if (typeof metadata.type === 'string') {
      this.type = metadata.type
    }
  }

  [Symbol.asyncIterator] () {
    return this._channel[Symbol.asyncIterator]()
  }

  async text () {
    const decoder = new TextDecoder('utf-8')
    let result = ''
    for await (const chunk of this) {
      result += decoder.decode(chunk, { stream: true })
    }
    result += decoder.decode()
    return result
  }

  async bytes () {
    const parts = []
    let totalLength = 0
    for await (const chunk of this) {
      parts.push(chunk)
      totalLength += chunk.byteLength
    }
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.byteLength
    }
    return result
  }

  async * lines () {
    const decoder = new TextDecoder('utf-8')
    let remainder = ''
    for await (const chunk of this) {
      remainder += decoder.decode(chunk, { stream: true })
      const parts = remainder.split('\n')
      remainder = parts.pop()
      for (const line of parts) {
        yield line
      }
    }
    remainder += decoder.decode()
    if (remainder.length > 0) {
      yield remainder
    }
  }
}

function createChunkedReader (producer, metadata={}) {
  const channel = createChunkChannel()
  const reader = new ChunkedReader(channel, metadata)

  Promise.resolve()
    .then(() => producer(
      chunk => channel.push(chunk),
      () => channel.close(),
      err => channel.fail(err),
      reader
    ))
    .catch(err => channel.fail(err))

  return reader
}

function createFileStream (source, options={}) {
  const onProgress = options.onProgress
  const signal = options.signal
  const isCancelled = options.isCancelled
  const chunkSize = (typeof options.chunkSize === 'number') && options.chunkSize > 0
    ? Math.floor(options.chunkSize)
    : DEFAULT_CHUNK_SIZE

  const readerMetadata = getStreamMetadata(source, null)

  return createChunkedReader(async (pushChunk, closeStream, failStream) => {
    const totalBytes = source.size
    let loadedBytes = 0

    const reportProgress = async (value) => {
      if (typeof onProgress === 'function') {
        await onProgress(value)
      }
    }

    try {
      await reportProgress(totalBytes > 0 ? 0 : null)
      while (loadedBytes < totalBytes) {
        if (isAbortRequested(signal, isCancelled)) {
          throw createAbortError('createFileStream: aborted')
        }
        const nextOffset = Math.min(loadedBytes + chunkSize, totalBytes)
        const blob = source.slice(loadedBytes, nextOffset)
        const value = new Uint8Array(await blob.arrayBuffer())
        loadedBytes = nextOffset
        if (value.byteLength > 0) {
          await pushChunk(value)
        }
        const progressValue = totalBytes > 0
          ? Math.round((loadedBytes / totalBytes) * 100)
          : null
        await reportProgress(progressValue)
      }
      await reportProgress(totalBytes > 0 ? 100 : null)
      closeStream()
    } catch (error) {
      failStream(error)
    }
  }, readerMetadata)
}

function createFetchStream (source, options={}) {
  const sourceUrl = getUrlFromSource(source)
  if (!sourceUrl) {
    throw new Error('createFetchStream: unsupported source type')
  }
  const onProgress = options.onProgress
  const signal = options.signal
  const isCancelled = options.isCancelled
  const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null)
  if (!fetchImpl) {
    throw new Error('createFetchStream: fetch is not available')
  }

  const readerMetadata = getStreamMetadata(source, sourceUrl)

  return createChunkedReader(async (pushChunk, closeStream, failStream, streamReader) => {
    const reportProgress = async (value) => {
      if (typeof onProgress === 'function') {
        await onProgress(value)
      }
    }

    const abortController = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null
    const fetchSignal = abortController ? abortController.signal : signal
    if (signal && abortController) {
      if (signal.aborted) {
        abortController.abort()
      } else {
        signal.addEventListener('abort', () => abortController.abort(), { once: true })
      }
    }

    let bodyReader
    try {
      if (isAbortRequested(signal, isCancelled)) {
        throw createAbortError('createFetchStream: aborted before fetch')
      }
      const response = await fetchImpl(sourceUrl, fetchSignal ? { signal: fetchSignal } : {})
      if (!response.ok) {
        throw new Error(`createFetchStream: failed to fetch ${sourceUrl} (${response.status})`)
      }
      if (!response.body) {
        throw new Error(`createFetchStream: empty response body for ${sourceUrl}`)
      }

      const totalBytesHeader = response.headers.get('content-length')
      const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null
      const hasKnownLength = !!totalBytes && !Number.isNaN(totalBytes) && totalBytes > 0
      if ((typeof streamReader.size !== 'number') && hasKnownLength) {
        streamReader.size = totalBytes
      }
      const contentTypeHeader = response.headers.get('content-type')
      if ((!streamReader.type) && contentTypeHeader) {
        streamReader.type = contentTypeHeader.split(';')[0].trim()
      }
      let loadedBytes = 0
      bodyReader = response.body.getReader()

      await reportProgress(hasKnownLength ? 0 : null)
      while (true) {
        if (isAbortRequested(signal, isCancelled)) {
          if (abortController) {
            abortController.abort()
          }
          throw createAbortError('createFetchStream: aborted during read')
        }
        const { done, value } = await bodyReader.read()
        if (done) {
          break
        }
        loadedBytes += value.byteLength
        if (value.byteLength > 0) {
          await pushChunk(value)
        }
        const progressValue = hasKnownLength
          ? Math.round((loadedBytes / totalBytes) * 100)
          : null
        await reportProgress(progressValue)
      }
      await reportProgress(hasKnownLength ? 100 : null)
      closeStream()
    } catch (error) {
      failStream(error)
    } finally {
      if (bodyReader) {
        bodyReader.releaseLock()
      }
    }
  }, readerMetadata)
}

function wrapStreamInputs (inputs, streamConfig={}, options={}) {
  if (!isObject(inputs)) {
    return inputs
  }

  const wrapped = Object.assign({}, inputs)
  Object.keys(streamConfig).forEach((inputName) => {
    const config = streamConfig[inputName]
    if (!config || config.stream !== true) {
      return
    }
    if (typeof wrapped[inputName] === 'undefined' || wrapped[inputName] === null) {
      return
    }

    const source = wrapped[inputName]
    if (isChunkedReaderSource(source)) {
      return
    }
    if (isFileLikeSource(source)) {
      wrapped[inputName] = createFileStream(source, options)
      return
    }

    const sourceUrl = getUrlFromSource(source)
    if (sourceUrl) {
      wrapped[inputName] = createFetchStream(source, options)
    }
  })
  return wrapped
}

async function getModelFuncJS (model, target, app) {
  let modelFunc
  switch (model.type) {
    case 'class':
      app.log('Init class')
      const modelClass = new target()
      modelFunc = (...a) => {
        return modelClass[model.method || 'predict'](...a)
      }
      break
    case 'async-init':
      app.log('Function with async init')
      modelFunc = await target()
      break
    default:
      app.log('Init function')
      modelFunc = target
  }

  // Wrap modelFunc to take into account container
  // Possible cases:
  if (model.container === 'args') {
    return (...a) => {
      if (Array.isArray(a[0]) && a[0].length && a.length === 1) {
        return modelFunc(...a[0])
      } else if (isObject(a[0]) && a.length === 1) {
        return modelFunc(...Object.values(a[0]))
      } else {
        return modelFunc(...a)
      }
    }
  } else {
    return (...a) => {
      if (isObject(a[0]) && a.length === 1) {
        // In case when we have only one input object
        // Pass log and callback to the model function
        return modelFunc(a[0], app)
      } else {
        return modelFunc(...a)
      }
    }
  }
}

function isCssImport (url) {
  if (typeof url !== 'string') return false
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  return clean.endsWith('.css')
}

// Distinguish relative file paths (dist/core.js, ./lib.js) from bare package
// names (lodash, chart.js, @org/pkg). Bare names resolve to CDN; relative paths
// must resolve against the page URL so blob workers can load them.
function isRelativeImport (url) {
  if (typeof url !== 'string') return false
  if (url.startsWith('./') || url.startsWith('../') || url.startsWith('/')) return true
  if (/^https?:\/\//i.test(url)) return false
  if (url.includes('@')) return false // scoped or versioned packages (e.g. lodash@4/...)
  // Bare names like "chart.js" have no slash; paths like "dist/core.js" do
  if (url.includes('/') && /\.(js|css|mjs|wasm)(\?|#|$)/i.test(url)) return true
  return false
}

function getUrl (url) {
  let newUrl
  try {
    newUrl = (new URL(url)).href
  } catch (e) {
    if (isRelativeImport(url)) {
      // Resolve against page URL so the absolute URL works inside blob workers
      // (blob workers have opaque origins and can't resolve relative paths)
      const base = typeof window !== 'undefined' && window.location
        ? window.location.href
        : 'https://cdn.jsdelivr.net/npm/'
      newUrl = (new URL(url, base)).href
    } else {
      newUrl = (new URL(url, 'https://cdn.jsdelivr.net/npm/')).href
    }
  }
  return newUrl
}

function loadFromDOM (url) {
  const scriptElement = document.querySelector(`script[data-src="${url}"]`)
  if (scriptElement) {
    return scriptElement.textContent
  } else {
    return null
  }
}

function importScriptAsync (imp, async=true) {
  return new Promise((resolve, reject) => {
    try {
      // CSS imports: inject <link> or <style> instead of <script>
      if (isCssImport(imp.url)) {
        if (imp.code) {
          const style = document.createElement('style')
          style.textContent = imp.code
          document.head.appendChild(style)
          resolve({ status: true })
        } else {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = imp.url
          link.addEventListener('load', () => resolve({ status: true }))
          link.addEventListener('error', () => reject({
            status: false,
            message: `Failed to load CSS ${imp.url}`
          }))
          document.head.appendChild(link)
        }
        return
      }
      const scriptElement = document.createElement('script')
      scriptElement.type = 'text/javascript'
      if (imp.code) {
        // Create script element from import.code
        scriptElement.textContent = imp.code
        // Create event element to notify about script load
        const eventElement = document.createElement('script')
        eventElement.type = 'text/javascript'
        eventElement.textContent = `document.dispatchEvent(new CustomEvent('${imp.url}', {detail: {url: '${imp.url}'}}));`
        document.addEventListener(imp.url, (ev) => {
          console.log('Script loaded from cache:', ev.detail.url)
          resolve({ status: true })
        })
        document.body.appendChild(scriptElement)
        document.body.appendChild(eventElement)
      } else {
        // Create script element from import.url
        scriptElement.async = async
        scriptElement.src = imp.url
        scriptElement.addEventListener('load', (ev) => {
          console.log('Script loaded:', imp.url)
          resolve({ status: true })
        })
        scriptElement.addEventListener('error', (ev) => {
          reject({
            status: false,
            message: `Failed to import ${imp.url}`
          })
        })
        document.body.appendChild(scriptElement);
      }
    } catch (error) {
      reject(error)
    }
  })
}

async function importScripts (...imports) {
  // Load scripts in parallel
  // return Promise.all(imports.map(importScriptAsync))
  // Load scripts in sequence. Possible ordering issues.
  for (const imp of imports) {
    await importScriptAsync(imp);
  }
}

function getModelFuncAPI (model, log=console.log) {
  switch (model.type) {
    case 'get':
      return (data) => {
        const query = new URLSearchParams(data).toString()
        const finalURL = model.url +'?' + query
        log('Sending GET request to:', finalURL)
        const resPromise = fetch(finalURL)
          .then(response => response.json())
        return resPromise
      }
    case 'post':
      return (data) => {
        log('Sending POST request to', model.url)
        const resPromise = fetch(model.url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        }).then(response => response.json())
        return resPromise
      }
  }
}

async function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms || 1))
}

function toWorkerSerializable (value) {
  if (shouldPreserveWorkerValue(value)) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => toWorkerSerializable(item))
  }

  if (!isObject(value)) {
    return value
  }

  const copy = {}
  Object.keys(value).forEach(key => {
    copy[key] = toWorkerSerializable(value[key])
  })
  return copy
}

// Simple debounce to prevent rapid-fire calls (e.g. autorun on every keystroke)
function debounce (fn, ms) {
  let timer
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), ms)
  }
}

// Extract function name from code (string or function reference).
// Handles 'function name', 'async function name'. Arrow/anonymous return undefined.
function getName (code) {
  switch (typeof code) {
    case 'function':
      if (!code.name) return undefined
      // Arrow functions get an inferred .name from property assignment
      // (e.g. { code: (a) => a } → code.name === "code") which is misleading.
      // Only trust .name when toString() confirms a real named declaration.
      const src = code.toString().trimStart()
      if (src.startsWith('function') || src.startsWith('async function')) {
        return code.name
      }
      return undefined
    case 'string':
      const words = code.split(' ')
      const functionIndex = words.findIndex((word) => word === 'function')
      if (functionIndex === -1) return undefined
      const name = words[functionIndex + 1]
      if (!name || name.includes('(')) return undefined
      return name
    default:
      return undefined
  }
}

function validateInputSchema (input, path, report) {
  if (!isObject(input)) {
    report.errors.push(`${path} should be an object`)
    return
  }

  if ((typeof input.name !== 'undefined') && (typeof input.name !== 'string')) {
    report.warnings.push(`${path}.name should be a string`)
  }

  if ((typeof input.type !== 'undefined') && !VALID_INPUT_TYPES.includes(input.type)) {
    report.warnings.push(`${path}.type '${input.type}' is not recognized`)
  }

  if ((typeof input.raw !== 'undefined') && (typeof input.raw !== 'boolean')) {
    report.warnings.push(`${path}.raw should be a boolean`)
  }

  if ((typeof input.stream !== 'undefined') && (typeof input.stream !== 'boolean')) {
    report.warnings.push(`${path}.stream should be a boolean`)
  }
  if ((input.stream === true) && (input.type !== 'file')) {
    report.warnings.push(`${path}.stream is supported only for file inputs`)
  }

  if (input.type === 'group') {
    if (!Array.isArray(input.elements)) {
      report.warnings.push(`${path}.elements should be an array for group inputs`)
    } else {
      input.elements.forEach((element, index) => {
        validateInputSchema(element, `${path}.elements[${index}]`, report)
      })
    }
  }

  if (typeof input.alias !== 'undefined') {
    const validAlias = (
      typeof input.alias === 'string'
      || (Array.isArray(input.alias) && input.alias.every(alias => typeof alias === 'string'))
    )
    if (!validAlias) {
      report.warnings.push(`${path}.alias should be a string or an array of strings`)
    }
  }
}

function validateModelSchema (model, path, report) {
  if (typeof model === 'function') {
    return
  }

  if (!isObject(model)) {
    report.errors.push(`${path} should be an object or function`)
    return
  }

  if ((typeof model.type !== 'undefined') && !VALID_MODEL_TYPES.includes(model.type)) {
    report.warnings.push(`${path}.type '${model.type}' is not recognized`)
  }

  if ((typeof model.worker !== 'undefined') && (typeof model.worker !== 'boolean')) {
    report.warnings.push(`${path}.worker should be a boolean`)
  }

  if (typeof model.timeout !== 'undefined') {
    const timeoutValid = (typeof model.timeout === 'number') && !Number.isNaN(model.timeout) && (model.timeout > 0)
    if (!timeoutValid) {
      report.warnings.push(`${path}.timeout should be a positive number`)
    }
  }
}

function validateSchema (schema) {
  const report = {
    errors: [],
    warnings: []
  }

  if (!isObject(schema)) {
    report.errors.push('Schema should be an object')
    return report
  }

  const hasModel = typeof schema.model !== 'undefined'
  const hasView = (typeof schema.view !== 'undefined') || (typeof schema.render !== 'undefined')

  if (!hasModel && !hasView) {
    report.errors.push('Schema should define `model` (or `view`/`render`)')
  } else if (!hasModel && hasView) {
    report.warnings.push('Schema has no `model`, using `view`/`render` only')
  }

  if (typeof schema.inputs !== 'undefined') {
    if (!Array.isArray(schema.inputs)) {
      report.errors.push('`inputs` should be an array')
    } else {
      schema.inputs.forEach((input, index) => {
        validateInputSchema(input, `inputs[${index}]`, report)
      })
    }
  }

  if (hasModel) {
    const models = Array.isArray(schema.model)
      ? schema.model
      : [schema.model]
    models.forEach((model, index) => {
      validateModelSchema(model, `model[${index}]`, report)
    })
  }

  return report
}

// Convert a URL parameter string to the appropriate type
function coerceParam (value, type, name) {
  if (type === 'number') return Number(value)
  if (type === 'boolean') return value === 'true'
  if (type === 'json') {
    try { return JSON.parse(value) }
    catch (e) { console.error(`Failed to parse JSON for input ${name}:`, e) }
  }
  return value
}

// Extract URL parameter value for an input, checking name, sanitized name, and aliases
function getUrlParam (urlParams, input) {
  if (!input.name) return null
  if (urlParams.has(input.name)) return urlParams.get(input.name)
  if (urlParams.has(sanitizeName(input.name))) return urlParams.get(sanitizeName(input.name))
  if (!input.alias) return null
  const aliases = Array.isArray(input.alias) ? input.alias : [input.alias]
  for (const alias of aliases) {
    if (urlParams.has(alias)) return urlParams.get(alias)
  }
  return null
}

function jseeInputsToJsonSchema (inputs) {
  const properties = {}
  const required = []
  for (const inp of (inputs || [])) {
    const prop = {}
    if (inp.description) prop.description = inp.description
    switch (inp.type) {
      case 'int':
        prop.type = 'integer'
        break
      case 'float': case 'number':
        prop.type = 'number'
        break
      case 'bool': case 'checkbox': case 'toggle':
        prop.type = 'boolean'
        break
      case 'select': case 'categorical': case 'radio':
        prop.type = 'string'
        if (inp.options) prop.enum = inp.options
        break
      case 'slider':
        prop.type = 'number'
        if (inp.min !== undefined) prop.minimum = inp.min
        if (inp.max !== undefined) prop.maximum = inp.max
        if (inp.step !== undefined) prop.multipleOf = inp.step
        break
      case 'range':
        prop.type = 'array'
        prop.items = { type: 'number' }
        prop.minItems = 2
        prop.maxItems = 2
        break
      case 'multi-select':
        prop.type = 'array'
        prop.items = { type: 'string' }
        if (inp.options) prop.items.enum = inp.options
        break
      default:
        prop.type = 'string'
    }
    if (inp.default !== undefined) prop.default = inp.default
    properties[inp.name] = prop
    if (inp.default === undefined) required.push(inp.name)
  }
  return { type: 'object', properties, required }
}

function generateOpenAPISpec (schema) {
  const models = Array.isArray(schema.model) ? schema.model : (schema.model ? [schema.model] : [])
  const paths = {}
  const inputSchema = jseeInputsToJsonSchema(schema.inputs)

  for (const m of models) {
    paths['/' + m.name] = {
      post: {
        summary: 'Run ' + m.name,
        operationId: m.name,
        requestBody: {
          required: true,
          content: { 'application/json': { schema: inputSchema } }
        },
        responses: {
          '200': {
            description: 'Model output',
            content: { 'application/json': { schema: { type: 'object' } } }
          }
        }
      }
    }
  }

  const title = schema.title
    || (schema.page && schema.page.title)
    || (models[0] && models[0].name)
    || 'JSEE API'

  return {
    openapi: '3.1.0',
    info: { title, version: '1.0.0' },
    paths
  }
}

function serializeResult (result) {
  if (result === null || result === undefined) return { result: null }
  // Buffer or Uint8Array → base64 image
  if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
    const b64 = Buffer.from(result).toString('base64')
    return { result: 'data:image/png;base64,' + b64 }
  }
  // Plain object or array — return as-is
  if (typeof result === 'object') return result
  // Primitives
  return { result }
}

function parseMultipart (contentType, body) {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/)
  if (!match) return {}
  const boundary = '--' + (match[1] || match[2])
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const data = {}
  let start = buf.indexOf(boundary) + boundary.length
  while (start < buf.length) {
    // Skip \r\n after boundary
    if (buf[start] === 0x0d) start += 2
    else if (buf[start] === 0x0a) start += 1
    // Check for closing boundary (--)
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break
    // Find end of headers (\r\n\r\n)
    const headerEnd = buf.indexOf('\r\n\r\n', start)
    if (headerEnd === -1) break
    const headers = buf.slice(start, headerEnd).toString('utf-8')
    const bodyStart = headerEnd + 4
    // Find next boundary
    const nextBoundary = buf.indexOf(boundary, bodyStart)
    if (nextBoundary === -1) break
    // Body ends 2 bytes before boundary (\r\n)
    const bodyEnd = nextBoundary - 2
    const nameMatch = headers.match(/name="([^"]+)"/)
    if (nameMatch) {
      const name = nameMatch[1]
      const filenameMatch = headers.match(/filename="([^"]*)"/)
      if (filenameMatch) {
        // File field — keep as Buffer
        data[name] = buf.slice(bodyStart, bodyEnd)
      } else {
        // Text field — try to parse as JSON for numbers/booleans
        const val = buf.slice(bodyStart, bodyEnd).toString('utf-8')
        try { data[name] = JSON.parse(val) } catch (e) { data[name] = val }
      }
    }
    start = nextBoundary + boundary.length
  }
  return data
}

module.exports = {
  isObject,
  loadFromDOM,
  getModelFuncJS,
  getModelFuncAPI,
  importScripts,
  getUrl,
  delay,
  debounce,
  sanitizeName,
  isWorkerInitMessage,
  getProgressState,
  shouldContinueInterval,
  createFileStream,
  createFetchStream,
  wrapStreamInputs,
  getName,
  validateSchema,
  toWorkerSerializable,
  containsBinaryPayload,
  isCssImport,
  isRelativeImport,
  getUrlParam,
  coerceParam,
  jseeInputsToJsonSchema,
  generateOpenAPISpec,
  serializeResult,
  parseMultipart
}
