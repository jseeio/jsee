const { getValueSchema, matchesFileAccept, tableOutputJsonSchema, assertSchemaVersion, jseeInputsToJsonSchema, collectInputValues } = require('./schema')
const { DEFAULT_CHUNK_SIZE, STREAM_HIGH_WATER } = require('./constants')

// https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
function isObject (item) {
  return (typeof item === 'object' && !Array.isArray(item) && item !== null)
}

function isArrayBuffer (value) {
  // Views can expose buffers created in another realm (iframes or Node VM contexts).
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]'
}

function isBinaryLike (value) {
  if (!value || typeof value !== 'object') return false
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(value)) return true
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) return true
  return false
}

function isRecordObject (item) {
  // Built-in values (ImageData, Date, Map, binary data) are atomic pipeline values.
  return isObject(item) && Object.prototype.toString.call(item) === '[object Object]'
}

function normalizeFileOutputValue (output, value) {
  const source = output || {}
  const fallback = {
    value,
    filename: source.filename || source.name,
    mime: source.mime || source.contentType
  }

  if (!isRecordObject(value)) return fallback

  let content = value
  if (Object.prototype.hasOwnProperty.call(value, 'content')) content = value.content
  else if (Object.prototype.hasOwnProperty.call(value, 'value')) content = value.value
  else if (Object.prototype.hasOwnProperty.call(value, 'data')) content = value.data
  else if (Object.prototype.hasOwnProperty.call(value, 'url')) content = value.url

  return {
    value: content,
    filename: value.filename || value.name || fallback.filename,
    mime: value.mime || value.contentType || fallback.mime
  }
}

function bufferStartsWith (buffer, bytes, offset=0) {
  if (!buffer || buffer.length < offset + bytes.length) return false
  for (let i = 0; i < bytes.length; i++) {
    if (buffer[offset + i] !== bytes[i]) return false
  }
  return true
}

function sniffBinaryMime (value) {
  const buffer = Buffer.from(value)
  if (bufferStartsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png'
  }
  if (bufferStartsWith(buffer, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }
  if (bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || bufferStartsWith(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) {
    return 'image/gif'
  }
  if (bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46])
    && bufferStartsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  if (bufferStartsWith(buffer, [0x25, 0x50, 0x44, 0x46])) {
    return 'application/pdf'
  }
  if (bufferStartsWith(buffer, [0x52, 0x49, 0x46, 0x46])
    && bufferStartsWith(buffer, [0x57, 0x41, 0x56, 0x45], 8)) {
    return 'audio/wav'
  }
  return 'application/octet-stream'
}

function binaryDataUrl (value) {
  const buffer = Buffer.from(value)
  const mime = sniffBinaryMime(buffer)
  return `data:${mime};base64,${buffer.toString('base64')}`
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
  if ((typeof ImageData !== 'undefined') && (value instanceof ImageData)) {
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
  if ((typeof ImageData !== 'undefined') && (value instanceof ImageData)) {
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

const descriptor = require('../schema.json')
const VALID_INPUT_TYPES = descriptor.definitions.inputType.enum
const VALID_MODEL_TYPES = descriptor.definitions.modelType.enum

const SECURITY_FLAGS = [
  'allowEval',
  'allowNetwork',
  'allowRawHtml',
  'allowNotifications',
  'allowFileViewer'
]

const DEFAULT_SECURITY_OPTIONS = {
  mode: 'trusted',
  trusted: true,
  allowEval: true,
  allowNetwork: true,
  allowRawHtml: true,
  allowNotifications: true,
  allowFileViewer: true
}

const SECURE_SECURITY_OPTIONS = {
  mode: 'secure',
  trusted: false,
  allowEval: false,
  allowNetwork: false,
  allowRawHtml: false,
  allowNotifications: false,
  allowFileViewer: false
}

const DEFAULT_PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs'

const SAFE_HTML_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'svg',
  'g',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'title',
  'desc'
])

const DROP_HTML_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'foreignobject'
])

const SAFE_GLOBAL_ATTRS = new Set([
  'aria-label',
  'aria-hidden',
  'class',
  'height',
  'id',
  'role',
  'title',
  'width'
])

const SAFE_HTML_ATTRS = new Set([
  'align',
  'alt',
  'colspan',
  'href',
  'rel',
  'rowspan',
  'src',
  'target'
])

const SAFE_SVG_ATTRS = new Set([
  'clip-path',
  'cx',
  'cy',
  'd',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'font-size',
  'gradientunits',
  'marker-end',
  'marker-mid',
  'marker-start',
  'offset',
  'opacity',
  'points',
  'r',
  'rx',
  'ry',
  'stroke',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'transform',
  'viewbox',
  'x',
  'x1',
  'x2',
  'xmlns',
  'y',
  'y1',
  'y2'
])

const URL_ATTRS = new Set(['href', 'src', 'poster', 'xlink:href'])

function sanitizeName (inputName) {
  return inputName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

function outputLookupNames (output) {
  const names = output.name ? [output.name, sanitizeName(output.name)] : []
  if (output.alias) names.push(...(Array.isArray(output.alias) ? output.alias : [output.alias]))
  return names.filter(Boolean)
}

function collectOutputNames (outputs, names=new Set()) {
  if (!Array.isArray(outputs)) return names
  for (const output of outputs) {
    if (!output) continue
    if (output.type === 'group' && Array.isArray(output.elements)) collectOutputNames(output.elements, names)
    else outputLookupNames(output).forEach(name => names.add(name))
  }
  return names
}

function cleanOutputMetadata (result, outputs) {
  if (!isRecordObject(result)) return result
  const clean = { ...result }
  const declared = collectOutputNames(outputs)
  // Legacy control fields stay hidden unless a descriptor explicitly presents them.
  for (const key of ['caller', 'stop', '_status', '_log', '_progress']) {
    if (!declared.has(key)) delete clean[key]
  }
  return clean
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

function getIntervalDelay (interval) {
  const delay = Number(interval)
  if (!Number.isFinite(delay) || delay <= 0) return 0
  return delay
}

function shouldContinueInterval (interval, runningOrCancelled, cancelled) {
  const isCancelled = typeof cancelled === 'boolean'
    ? cancelled
    : runningOrCancelled === true
  return getIntervalDelay(interval) > 0 && !isCancelled
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
  if (!isRecordObject(inputs)) {
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

async function getModelFuncJS (model, target, app, inputNames, getContext=() => app) {
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
        // Declared arguments are positional; object insertion order and runtime metadata are not.
        const values = Array.isArray(inputNames) ? inputNames.map(name => a[0][name]) : Object.values(a[0])
        return modelFunc(...values)
      } else {
        return modelFunc(...a)
      }
    }
  } else {
    return (...a) => {
      if (isObject(a[0]) && a.length === 1) {
        // In case when we have only one input object
        // Pass log and callback to the model function
        return modelFunc(a[0], getContext())
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

function resolveUrlLike (url) {
  if (typeof url !== 'string') return url
  try {
    return (new URL(url)).href
  } catch (e) {
    const base = typeof window !== 'undefined' && window.location
      ? window.location.href
      : 'https://cdn.jsdelivr.net/npm/'
    return (new URL(url, base)).href
  }
}

function inferPyodideIndexURL (url) {
  if (typeof url !== 'string' || !url) return undefined
  const clean = url.split('#')[0].split('?')[0]
  if (!/\/pyodide\.m?js$/i.test(clean)) return undefined
  return clean.slice(0, clean.lastIndexOf('/') + 1)
}

function normalizePyodideOptions (model={}, options={}) {
  const internal = isObject(model._pyodide) ? model._pyodide : null
  const config = internal || model.pyodide
  let rawUrl = DEFAULT_PYODIDE_URL
  let indexURL
  let code
  let packages
  let assets
  let embeddedAssets
  let stdLibURL
  let lockFileURL
  let packageBaseUrl
  let packageCacheDir
  let createPyodideModule

  if (typeof config === 'string') {
    rawUrl = config
  } else if (isObject(config)) {
    rawUrl = config.rawUrl || config.url || rawUrl
    indexURL = config.indexURL
    code = config.code
    assets = config.assets
    embeddedAssets = config.embeddedAssets
    stdLibURL = config.stdLibURL
    lockFileURL = config.lockFileURL
    packageBaseUrl = config.packageBaseUrl
    packageCacheDir = config.packageCacheDir
    createPyodideModule = config.createPyodideModule
    packages = Array.isArray(config.packages)
      ? config.packages.filter(pkg => typeof pkg === 'string' && pkg)
      : undefined
  }

  // Workers inherit the host's resolved URL; their blob URL cannot resolve app-relative paths.
  const sourceUrl = internal && internal.url ? internal.url : rawUrl
  const url = options.resolveUrl ? resolveUrlLike(sourceUrl) : sourceUrl
  const resolvedIndexURL = typeof indexURL === 'string'
    ? (options.resolveUrl ? resolveUrlLike(indexURL) : indexURL)
    : inferPyodideIndexURL(url)

  return {
    rawUrl,
    url,
    indexURL: resolvedIndexURL,
    code,
    assets,
    embeddedAssets,
    stdLibURL,
    lockFileURL,
    packageBaseUrl,
    packageCacheDir,
    createPyodideModule,
    packages
  }
}

async function loadPyodideRuntime (options, root) {
  if (/\.mjs(?:[?#]|$)/.test(options.url)) {
    const url = options.code ? URL.createObjectURL(new Blob([options.code], { type: 'text/javascript' })) : options.url
    try { return (await import(/* webpackIgnore: true */ url)).loadPyodide }
    finally { if (options.code) URL.revokeObjectURL(url) }
  }
  // The worker factory routes legacy .js Python loaders to the classic build.
  if (!root.loadPyodide) {
    if (root.document) await importScripts(options.code ? { url: options.url, code: options.code } : options.url)
    else {
      const url = options.code ? URL.createObjectURL(new Blob([options.code], { type: 'text/javascript' })) : options.url
      try { root.importScripts(url) } finally { if (options.code) URL.revokeObjectURL(url) }
    }
  }
  return root.loadPyodide
}

function getPyodideLoadOptions (pyodideOptions) {
  if (!pyodideOptions) {
    return undefined
  }
  const options = {}
  if (typeof pyodideOptions.indexURL === 'string' && pyodideOptions.indexURL) {
    options.indexURL = pyodideOptions.indexURL
  }
  if (Array.isArray(pyodideOptions.packages) && pyodideOptions.packages.length) {
    options.packages = pyodideOptions.packages
  }
  ;['stdLibURL', 'lockFileURL', 'packageBaseUrl', 'packageCacheDir', 'createPyodideModule'].forEach(key => {
    if (typeof pyodideOptions[key] !== 'undefined') {
      options[key] = pyodideOptions[key]
    }
  })
  return Object.keys(options).length ? options : undefined
}

function loadFromDOM (url) {
  const scriptElement = document.querySelector(`script[data-src="${url}"]`)
  if (scriptElement) {
    if (scriptElement.getAttribute('data-encoding') === 'base64') {
      const encoded = scriptElement.textContent.trim()
      if (typeof TextDecoder !== 'undefined' && typeof atob !== 'undefined') {
        const binary = atob(encoded)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return new TextDecoder().decode(bytes)
      }
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(encoded, 'base64').toString('utf8')
      }
    }
    return scriptElement.textContent
  } else {
    return null
  }
}

function loadPyodideEmbeddedAssets (pyodideOptions) {
  const options = pyodideOptions || {}
  if (options.embeddedAssets) return options.embeddedAssets

  const assets = options.assets
  if (!assets || assets.type !== 'embedded' || !assets.manifest) return null
  const manifestText = loadFromDOM(assets.manifest)
  if (!manifestText) {
    throw new Error(`Embedded Pyodide asset manifest not found: ${assets.manifest}`)
  }
  return JSON.parse(manifestText)
}

function decodeBase64Bytes (value) {
  const text = String(value || '')
  if (typeof atob !== 'undefined') {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(text, 'base64'))
  }
  throw new Error('Base64 decoding is not available')
}

function bytesToText (bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes)
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8')
  let text = ''
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i])
  return text
}

function getEmbeddedFetchState (targetGlobal) {
  const root = targetGlobal || globalThis
  if (!root.__jseeEmbeddedPyodideAssets) {
    Object.defineProperty(root, '__jseeEmbeddedPyodideAssets', {
      value: {
        installed: false,
        originalFetch: null,
        manifests: new Map()
      },
      enumerable: false,
      configurable: false,
      writable: false
    })
  }
  return root.__jseeEmbeddedPyodideAssets
}

function getFetchInputUrl (input) {
  if (typeof input === 'string') return input
  if (input && typeof input.url === 'string') return input.url
  return String(input)
}

function getEmbeddedAssetForUrl (state, url) {
  for (const manifest of state.manifests.values()) {
    if (!url.startsWith(manifest.baseURL)) continue
    const relPath = decodeURIComponent(url.slice(manifest.baseURL.length).replace(/^\/+/, ''))
    return {
      manifest,
      asset: manifest.assets.get(relPath) || null
    }
  }
  return null
}

function cloneAssetBytes (bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

function installEmbeddedPyodideFetch (targetGlobal) {
  const root = targetGlobal || globalThis
  const state = getEmbeddedFetchState(root)
  if (state.installed) return state

  const originalFetch = typeof root.fetch === 'function'
    ? root.fetch.bind(root)
    : (typeof fetch === 'function' ? fetch.bind(globalThis) : null)
  const ResponseCtor = root.Response || (typeof Response !== 'undefined' ? Response : null)
  if (!ResponseCtor) {
    throw new Error('Response is not available for embedded Pyodide assets')
  }

  state.originalFetch = originalFetch
  root.fetch = function (input, init) {
    const url = getFetchInputUrl(input)
    const match = getEmbeddedAssetForUrl(state, url)
    if (match) {
      if (!match.asset) {
        return Promise.resolve(new ResponseCtor('', { status: 404, statusText: 'Not Found' }))
      }
      return Promise.resolve(new ResponseCtor(cloneAssetBytes(match.asset.bytes), {
        status: 200,
        headers: {
          'Content-Type': match.asset.mime || 'application/octet-stream'
        }
      }))
    }
    if (!originalFetch) {
      return Promise.reject(new Error(`No fetch implementation available for ${url}`))
    }
    return originalFetch(input, init)
  }
  state.installed = true
  return state
}

function registerEmbeddedPyodideAssets (manifest, targetGlobal) {
  if (!manifest || manifest.version !== 1 || !manifest.baseURL || !isObject(manifest.assets)) {
    throw new Error('Invalid embedded Pyodide asset manifest')
  }
  const root = targetGlobal || globalThis
  const state = installEmbeddedPyodideFetch(root)
  const assets = new Map()
  Object.keys(manifest.assets).forEach(relPath => {
    const entry = manifest.assets[relPath]
    if (!entry || typeof entry.base64 !== 'string') return
    assets.set(relPath, {
      bytes: decodeBase64Bytes(entry.base64),
      mime: entry.mime || 'application/octet-stream'
    })
  })
  const baseURL = manifest.baseURL.endsWith('/') ? manifest.baseURL : manifest.baseURL + '/'
  const registered = { baseURL, assets }
  state.manifests.set(baseURL, registered)
  return registered
}

function createEmbeddedAssetObjectUrl (asset, targetGlobal) {
  const root = targetGlobal || globalThis
  const BlobCtor = root.Blob || (typeof Blob !== 'undefined' ? Blob : null)
  const URLApi = root.URL || (typeof URL !== 'undefined' ? URL : null)
  if (!BlobCtor || !URLApi || typeof URLApi.createObjectURL !== 'function') {
    throw new Error('Blob URLs are not available for embedded Pyodide assets')
  }
  return URLApi.createObjectURL(new BlobCtor([cloneAssetBytes(asset.bytes)], {
    type: asset.mime || 'application/octet-stream'
  }))
}

async function importEmbeddedAsmJs (asset, targetGlobal) {
  const root = targetGlobal || globalThis
  if (typeof root._createPyodideModule === 'function') return

  if (typeof root.importScripts === 'function') {
    const url = createEmbeddedAssetObjectUrl(asset, root)
    root.importScripts(url)
    return
  }

  const doc = root.document || (typeof document !== 'undefined' ? document : null)
  if (doc && doc.createElement && doc.head) {
    const script = doc.createElement('script')
    script.type = 'text/javascript'
    script.textContent = bytesToText(asset.bytes)
    doc.head.appendChild(script)
    return
  }

  throw new Error('Cannot execute embedded pyodide.asm.js in this environment')
}

async function importEmbeddedAsmModule (asset, targetGlobal) {
  const url = createEmbeddedAssetObjectUrl(asset, targetGlobal)
  try {
    const mod = await import(/* webpackIgnore: true */ url)
    return mod && (mod.default || mod.createPyodideModule)
  } finally { (targetGlobal || globalThis).URL.revokeObjectURL(url) }
}

async function preparePyodideRuntimeOptions (pyodideOptions, targetGlobal) {
  const options = Object.assign({}, pyodideOptions || {})
  if (!options.embeddedAssets) return options

  const registered = registerEmbeddedPyodideAssets(options.embeddedAssets, targetGlobal)
  options.indexURL = registered.baseURL
  options.stdLibURL = registered.baseURL + 'python_stdlib.zip'
  options.lockFileURL = registered.baseURL + 'pyodide-lock.json'
  options.packageBaseUrl = registered.baseURL
  options.packageCacheDir = registered.baseURL

  const asmJs = registered.assets.get('pyodide.asm.js')
  if (asmJs) {
    await importEmbeddedAsmJs(asmJs, targetGlobal)
  }

  const asmModule = registered.assets.get('pyodide.asm.mjs')
  if (asmModule) {
    const createPyodideModule = await importEmbeddedAsmModule(asmModule, targetGlobal)
    if (createPyodideModule) {
      options.createPyodideModule = createPyodideModule
    }
  }

  return options
}

function importScriptAsync (imp, async=true) {
  return new Promise((resolve, reject) => {
    try {
      if (typeof imp === 'string') {
        imp = { url: imp }
      }
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
        document.addEventListener(imp.url, () => {
          resolve({ status: true })
        })
        document.body.appendChild(scriptElement)
        document.body.appendChild(eventElement)
      } else {
        // Create script element from import.url
        scriptElement.async = async
        scriptElement.src = imp.url
        scriptElement.addEventListener('load', () => {
          resolve({ status: true })
        })
        scriptElement.addEventListener('error', (ev) => {
          reject({
            status: false,
            message: `Failed to import ${imp.url}`
          })
        })
        document.body.appendChild(scriptElement)
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
    await importScriptAsync(imp)
  }
}

function getModuleModelTarget (mod, model={}) {
  const exportName = model.export || model.name
  let target = exportName ? mod[exportName] : (mod.default || mod.model)
  if (typeof target === 'undefined' && exportName) {
    target = mod.default || mod.model
  }
  if (typeof target === 'undefined') {
    throw new Error(`Module model export not found: ${exportName || 'default/model'}`)
  }
  return target
}

function parseSSELine (line) {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (payload === '[DONE]') return null
  try {
    return JSON.parse(payload)
  } catch (e) {
    return payload
  }
}

async function readSSE (response, onChunk) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data = []
  let event = ''
  let lastResult = null
  let complete = false
  let eof = false
  const dispatch = () => {
    if (!data.length) { event = ''; return }
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') { complete = true; return }
    let value
    try { value = JSON.parse(payload) } catch (_) { value = payload }
    if (event === 'error') {
      throw new Error(value && (value.error || value.message) || String(value || 'Stream failed'))
    }
    event = ''
    lastResult = value
    if (onChunk) onChunk(value)
  }
  const line = text => {
    if (!text) { dispatch(); return }
    const colon = text.indexOf(':')
    const field = colon < 0 ? text : text.slice(0, colon)
    let value = colon < 0 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }
  const consume = final => {
    let start = 0
    for (let i = 0; i < buffer.length && !complete; i++) {
      if (buffer[i] !== '\n' && buffer[i] !== '\r') continue
      // A CRLF may straddle chunks; consume the pair as one line ending.
      if (buffer[i] === '\r' && i + 1 === buffer.length && !final) break
      line(buffer.slice(start, i))
      if (buffer[i] === '\r' && buffer[i + 1] === '\n') i++
      start = i + 1
    }
    buffer = buffer.slice(start)
  }
  try {
    while (!complete) {
      const { done, value } = await reader.read()
      if (done) {
        eof = true
        buffer += decoder.decode()
        consume(true)
        // Preserve JSEE's legacy acceptance of a final frame without a blank line.
        if (!complete) {
          if (buffer) line(buffer)
          dispatch()
        }
        break
      }
      buffer += decoder.decode(value, { stream: true })
      consume(false)
    }
    return lastResult
  } finally {
    try {
      if (!eof) await reader.cancel()
    } finally { reader.releaseLock() }
  }
}

function getModelFuncAPI (model, log=console.log, onChunk, security, outputs) {
  if (model.type !== 'get' && model.type !== 'post') return undefined
  // Blob/File contents are immutable; reuse registrations only within this host binding.
  const uploadedFiles = new WeakMap()
  return (data, options={}) => {
    assertApiNetworkAllowed(model, security)
    const url = model.type === 'get' ? model.url + '?' + new URLSearchParams(data).toString() : model.url
    assertNetworkAllowed(url, security, 'API model URL')
    const canonicalUrl = model._jseeCanonical ? new URL(url, typeof location !== 'undefined' ? location.href : undefined).href : url
    return (async () => {
      if (model._jseeCanonical) {
        const uploadUrl = new URL('__jsee/artifacts', new URL('./', canonicalUrl)).href
        const encode = async value => {
          if (typeof Blob !== 'undefined' && value instanceof Blob || isBinaryLike(value)) {
            const immutable = typeof Blob !== 'undefined' && value instanceof Blob
            const known = immutable && uploadedFiles.get(value)
            if (known && known.url === uploadUrl) return known.promise
            const promise = (async () => {
              const target = uploadUrl + '?name=' + encodeURIComponent(value.name || 'file')
              assertNetworkAllowed(target, security, 'Artifact upload')
              const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': value.type || 'application/octet-stream' }, body: value, signal: options.signal })
              const uploaded = await response.json()
              if (!response.ok) throw new Error(uploaded.error && uploaded.error.message || 'Artifact upload failed')
              return { artifact: uploaded.artifact }
            })()
            if (immutable) uploadedFiles.set(value, { url: uploadUrl, promise })
            try { return await promise } catch (error) {
              if (immutable && uploadedFiles.get(value).promise === promise) uploadedFiles.delete(value)
              throw error
            }
          }
          if (Array.isArray(value)) return Promise.all(value.map(encode))
          if (isRecordObject(value)) return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encode(item)])))
          return value
        }
        data = await encode(data)
      }
      log('Sending', model.type.toUpperCase(), 'request to', url)
      const init = model.type === 'post' ? {
        method: 'POST',
        headers: { 'Accept': model.stream ? 'text/event-stream' : 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      } : {}
      if (model.type === 'get' && model.stream) init.headers = { 'Accept': 'text/event-stream' }
      if (options.signal) init.signal = options.signal
      const request = Object.keys(init).length ? fetch(url, init) : fetch(url)
      return request.then(async response => {
        if (response.ok === false) {
          const body = await response.text()
          let message = body
          try { const value = JSON.parse(body); message = value.error || value.message || body } catch (_) { /* text error */ }
          const error = new Error(`HTTP ${response.status}: ${message || response.statusText || 'Request failed'}`)
          error.status = response.status
          throw error
        }
        const contentType = response.headers && response.headers.get('content-type') || ''
        if (contentType.includes('text/event-stream') && response.body) return readSSE(response, options.onChunk || onChunk)
        const result = await response.json()
        if (!model._jseeCanonical) return result
        if (result.status !== 'succeeded') throw new Error(result.error && result.error.message || 'Invocation failed')
        const kinds = Object.fromEntries(flattenJseeOutputs(outputs).map(output => [output.name, output.type]))
        for (const artifact of result.artifacts || []) {
          const target = new URL(artifact.uri, canonicalUrl).href
          assertNetworkAllowed(target, security, 'Artifact output')
          if (kinds[artifact.output] === 'file') {
            const file = await fetch(target, { signal: options.signal })
            if (!file.ok) throw new Error('Artifact download failed')
            result.outputs[artifact.output] = { content: await file.blob(), filename: artifact.name, mime: artifact.mime }
          } else result.outputs[artifact.output] = target
        }
        return result.outputs
      })
    })()
  }
}

const TYPED_ARRAY_CONSTRUCTORS = {
  float32: Float32Array,
  float64: Float64Array,
  int8: Int8Array,
  int16: Int16Array,
  int32: Int32Array,
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
}

function toTypedArray (value, dtype) {
  if (!dtype || !TYPED_ARRAY_CONSTRUCTORS[dtype]) return value
  const Ctor = TYPED_ARRAY_CONSTRUCTORS[dtype]
  if (value instanceof Ctor) return value
  if (isArrayBuffer(value)) return new Ctor(value)
  if (ArrayBuffer.isView(value)) {
    // Typed arrays carry numeric values; DataView carries an explicitly bounded byte range.
    return typeof value.BYTES_PER_ELEMENT === 'number'
      ? new Ctor(value)
      : new Ctor(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  }
  if (Array.isArray(value)) return new Ctor(value)
  return value
}

function fromTypedArray (value) {
  if (ArrayBuffer.isView(value)) return Array.from(value)
  return value
}

function collectTransferables (value, seen) {
  if (!value || typeof value !== 'object') return []
  if (!seen) seen = new WeakSet()
  if (seen.has(value)) return []
  seen.add(value)
  const buffers = []
  if (isArrayBuffer(value)) {
    buffers.push(value)
  } else if (ArrayBuffer.isView(value)) {
    buffers.push(...collectTransferables(value.buffer, seen))
  } else if (Array.isArray(value)) {
    value.forEach(item => buffers.push(...collectTransferables(item, seen)))
  } else {
    Object.keys(value).forEach(key => {
      buffers.push(...collectTransferables(value[key], seen))
    })
  }
  return buffers
}

async function prepareBrowserFiles (fields, values, remote=false) {
  const result = { ...values }
  for (const field of fields || []) {
    const value = result[field.name]
    if (field.type === 'group') {
      if (!field.name) Object.assign(result, await prepareBrowserFiles(field.elements, result, remote))
      else if (value) Object.defineProperty(result, field.name, { value: await prepareBrowserFiles(field.elements, value, remote), enumerable: true, writable: true, configurable: true })
    } else if (['file', 'image', 'audio', 'video'].includes(field.type)) {
      if (value && value.artifact && !remote) throw new Error(field.name + ': artifact references require their canonical host')
      if (field.type !== 'file' && typeof Blob !== 'undefined' && value instanceof Blob) {
        if (!matchesFileAccept(field.type + '/*', value.name, value.type) || !matchesFileAccept(field.accept, value.name, value.type)) throw new Error(field.name + ': media does not match accept')
        if (!remote) Object.defineProperty(result, field.name, { value: await value.arrayBuffer(), enumerable: true, writable: true, configurable: true })
      }
    }
  }
  return result
}

function wrapTypedArrayInputs (inputs, inputConfigs) {
  if (!isObject(inputs) || !Array.isArray(inputConfigs)) return inputs
  const wrapped = Object.assign({}, inputs)
  inputConfigs.forEach(cfg => {
    if (cfg.arrayBuffer && !['image', 'audio', 'video'].includes(cfg.type) && cfg.name && typeof wrapped[cfg.name] !== 'undefined') {
      wrapped[cfg.name] = toTypedArray(wrapped[cfg.name], cfg.dtype || 'float64')
    }
  })
  return wrapped
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
      // JS infers .name from property assignment for ALL function forms:
      // { code: (a) => a } and { code: function(a) {} } both get .name === "code".
      // Only trust .name when the name actually appears in the source text.
      const src = code.toString().trimStart()
      const keyword = src.startsWith('async function')
        ? 'async function'
        : src.startsWith('function')
          ? 'function'
          : null
      if (keyword) {
        const afterKeyword = src.slice(keyword.length).trimStart()
        if (afterKeyword.startsWith(code.name)) return code.name
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

function findMatchingParen (source, openIndex) {
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = openIndex; i < source.length; i++) {
    const char = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function findTopLevelArrow (source) {
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  let quote = null
  let escaped = false
  for (let i = 0; i < source.length - 1; i++) {
    const char = source[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') parenDepth += 1
    else if (char === ')') parenDepth -= 1
    else if (char === '{') braceDepth += 1
    else if (char === '}') braceDepth -= 1
    else if (char === '[') bracketDepth += 1
    else if (char === ']') bracketDepth -= 1
    else if (char === '=' && source[i + 1] === '>' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return i
    }
  }
  return -1
}

function splitTopLevelParams (paramsSource) {
  const params = []
  let start = 0
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  let quote = null
  let escaped = false
  for (let i = 0; i < paramsSource.length; i++) {
    const char = paramsSource[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') parenDepth += 1
    else if (char === ')') parenDepth -= 1
    else if (char === '{') braceDepth += 1
    else if (char === '}') braceDepth -= 1
    else if (char === '[') bracketDepth += 1
    else if (char === ']') bracketDepth -= 1
    else if (char === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      params.push(paramsSource.slice(start, i).trim())
      start = i + 1
    }
  }
  const last = paramsSource.slice(start).trim()
  if (last) params.push(last)
  return params.filter(Boolean)
}

function splitParamDefault (paramSource) {
  let parenDepth = 0
  let braceDepth = 0
  let bracketDepth = 0
  let quote = null
  let escaped = false
  for (let i = 0; i < paramSource.length; i++) {
    const char = paramSource[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') parenDepth += 1
    else if (char === ')') parenDepth -= 1
    else if (char === '{') braceDepth += 1
    else if (char === '}') braceDepth -= 1
    else if (char === '[') bracketDepth += 1
    else if (char === ']') bracketDepth -= 1
    else if (char === '=' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      return {
        nameSource: paramSource.slice(0, i).trim(),
        defaultSource: paramSource.slice(i + 1).trim()
      }
    }
  }
  return {
    nameSource: paramSource.trim(),
    defaultSource: null
  }
}

function extractFunctionParamSource (code) {
  const source = typeof code === 'function' ? code.toString() : String(code || '')
  const arrowIndex = findTopLevelArrow(source)
  if (arrowIndex >= 0) {
    let left = source.slice(0, arrowIndex).trim()
    if (left.startsWith('async ')) left = left.slice(6).trim()
    if (left.startsWith('(')) {
      const close = findMatchingParen(left, 0)
      return close >= 0 ? left.slice(1, close) : ''
    }
    return left
  }

  const functionIndex = source.search(/\bfunction\b/)
  const open = source.indexOf('(', functionIndex >= 0 ? functionIndex : 0)
  if (open < 0) return ''
  const close = findMatchingParen(source, open)
  return close >= 0 ? source.slice(open + 1, close) : ''
}

function parseJsdocParamTypes (code) {
  const source = typeof code === 'function' ? code.toString() : String(code || '')
  const types = {}
  const re = /@param\s+(?:\{([^}]+)\}\s*)?(\[[^\]]+\]|[^\s-]+)/g
  let match
  while ((match = re.exec(source))) {
    const type = match[1]
    let name = match[2] || ''
    if (name.startsWith('[') && name.endsWith(']')) {
      name = name.slice(1, -1).split('=')[0]
    }
    name = name.replace(/^\.\.\./, '').split('.')[0]
    if (name && type) types[name] = type.trim()
  }
  return types
}

function inputTypeHintFromDefault (defaultSource) {
  if (typeof defaultSource !== 'string') return null
  const value = defaultSource.trim()
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) return 'number'
  if (value === 'true' || value === 'false') return 'checkbox'
  if (/^(['"`])[\s\S]*\1$/.test(value)) return 'string'
  return null
}

function inputTypeHintFromJsdoc (type) {
  if (!type) return null
  const value = String(type).toLowerCase()
  if (/(^|[|<,\s])(number|integer|int|float)([|>,\s]|$)/.test(value)) return 'number'
  if (/(^|[|<,\s])(boolean|bool)([|>,\s]|$)/.test(value)) return 'checkbox'
  if (/(^|[|<,\s])string([|>,\s]|$)/.test(value)) return 'string'
  return null
}

function parseFunctionInputParams (code) {
  const paramsSource = extractFunctionParamSource(code)
  if (!paramsSource) return []
  return splitTopLevelParams(paramsSource).map(paramSource => {
    const split = splitParamDefault(paramSource)
    const nameSource = split.nameSource.replace(/^\.\.\./, '').trim()
    if (nameSource.startsWith('{') || nameSource.startsWith('[')) {
      return {
        raw: paramSource,
        destructured: true
      }
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(nameSource)) {
      return {
        raw: paramSource,
        invalid: true
      }
    }
    return {
      raw: paramSource,
      name: nameSource,
      defaultSource: split.defaultSource
    }
  })
}

function inferInputsFromModel (model, options={}) {
  if (!model || typeof model.code === 'undefined') {
    return {
      inputs: [],
      warnings: []
    }
  }

  const params = parseFunctionInputParams(model.code)
  const jsdocTypes = parseJsdocParamTypes(model.code)
  const inputs = []
  const warnings = []
  const inferTypes = options && options.inferTypes === true

  params.forEach(param => {
    if (param.destructured) {
      warnings.push(`Cannot infer input from destructured parameter "${param.raw}". Add schema.inputs explicitly.`)
      return
    }
    if (param.invalid || !param.name) {
      warnings.push(`Cannot infer input from parameter "${param.raw}". Add schema.inputs explicitly.`)
      return
    }

    const jsdocType = jsdocTypes[param.name]
    const jsdocHint = inputTypeHintFromJsdoc(jsdocType)
    const defaultHint = inputTypeHintFromDefault(param.defaultSource)
    const inferredType = inferTypes
      ? (defaultHint || jsdocHint || 'string')
      : 'string'

    inputs.push({
      name: param.name,
      type: inferredType
    })

    if (inferTypes && inferredType !== 'string') {
      const source = defaultHint
        ? 'default value'
        : `JSDoc ${jsdocType}`
      warnings.push(`Inferred input "${param.name}" as ${inferredType} from ${source}. Declare schema.inputs explicitly to override.`)
    } else if (jsdocHint && jsdocHint !== 'string') {
      warnings.push(`Inferred input "${param.name}" as string, but JSDoc declares ${jsdocType}. Add schema.inputs or set inferInputTypes: true for ${jsdocHint} behavior.`)
    } else if (defaultHint && defaultHint !== 'string') {
      warnings.push(`Inferred input "${param.name}" as string, but its default value suggests ${defaultHint}. Add schema.inputs or set inferInputTypes: true for ${defaultHint} behavior.`)
    } else {
      warnings.push(`Inferred input "${param.name}" as string. Add schema.inputs for numeric behavior.`)
    }
  })

  return { inputs, warnings }
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

  if (model.type === 'tf') {
    report.errors.push(`${path}.type 'tf' is not supported. Load TensorFlow.js with imports and use a normal JavaScript function/class model instead.`)
  } else if ((typeof model.type !== 'undefined') && !VALID_MODEL_TYPES.includes(model.type)) {
    report.warnings.push(`${path}.type '${model.type}' is not recognized`)
  }

  if ((typeof model.worker !== 'undefined') && (typeof model.worker !== 'boolean')) {
    report.warnings.push(`${path}.worker should be a boolean`)
  }

  if (model.initTimeout !== undefined && (typeof model.initTimeout !== 'number' || !Number.isFinite(model.initTimeout) || model.initTimeout <= 0)) report.errors.push(`${path}.initTimeout should be a positive finite number`)
  if (model.workerUrl !== undefined && (typeof model.workerUrl !== 'string' || !model.workerUrl)) report.errors.push(`${path}.workerUrl should be a nonempty string`)

  if (typeof model.timeout !== 'undefined') {
    const timeoutValid = (typeof model.timeout === 'number') && !Number.isNaN(model.timeout) && (model.timeout > 0)
    if (!timeoutValid) {
      report.warnings.push(`${path}.timeout should be a positive number`)
    }
  }

  if (typeof model.entry !== 'undefined') {
    if (typeof model.entry !== 'string') {
      report.warnings.push(`${path}.entry should be a Python function name string`)
    } else if (!isPythonIdentifier(model.entry.trim())) {
      report.warnings.push(`${path}.entry should be a valid Python function name`)
    } else if (model.type !== 'py') {
      report.warnings.push(`${path}.entry is used only for py models`)
    }
  }

  if ((typeof model.export !== 'undefined') && (typeof model.export !== 'string')) {
    report.warnings.push(`${path}.export should be a string`)
  }

  if (typeof model.pyodide !== 'undefined') {
    if (model.type !== 'py') {
      report.warnings.push(`${path}.pyodide is used only for py models`)
    }
    if (typeof model.pyodide !== 'string' && !isObject(model.pyodide)) {
      report.warnings.push(`${path}.pyodide should be a URL string or an object`)
    }
    if (isObject(model.pyodide)) {
      if ((typeof model.pyodide.url !== 'undefined') && (typeof model.pyodide.url !== 'string')) {
        report.warnings.push(`${path}.pyodide.url should be a string`)
      }
      if ((typeof model.pyodide.indexURL !== 'undefined') && (typeof model.pyodide.indexURL !== 'string')) {
        report.warnings.push(`${path}.pyodide.indexURL should be a string`)
      }
      if ((typeof model.pyodide.packages !== 'undefined') && (!Array.isArray(model.pyodide.packages) || model.pyodide.packages.some(pkg => typeof pkg !== 'string'))) {
        report.warnings.push(`${path}.pyodide.packages should be an array of package name strings`)
      }
    }
  }
}

function normalizeSecurityOptions (security) {
  if (!isObject(security)) return Object.assign({}, DEFAULT_SECURITY_OPTIONS)

  const secureMode = (security.mode === 'secure') || (security.trusted === false)
  const normalized = Object.assign({}, secureMode ? SECURE_SECURITY_OPTIONS : DEFAULT_SECURITY_OPTIONS)

  if (security.mode === 'trusted' || security.mode === 'secure') {
    normalized.mode = security.mode
  }

  if (typeof security.trusted === 'boolean') {
    normalized.trusted = security.trusted
  }

  SECURITY_FLAGS.forEach(flag => {
    if (typeof security[flag] === 'boolean') {
      normalized[flag] = security[flag]
    }
  })

  if (normalized.trusted === false && security.mode !== 'trusted') {
    normalized.mode = 'secure'
  }
  if (normalized.mode === 'secure' && typeof security.trusted === 'undefined') {
    normalized.trusted = false
  }

  return normalized
}

const PYODIDE_BRIDGE_OWNED_GLOBALS = '__jseePyodideInputGlobals'

function getOwnedPyodideGlobals (targetGlobal) {
  if (!targetGlobal || (typeof targetGlobal !== 'object' && typeof targetGlobal !== 'function')) return null

  try {
    if (!Object.prototype.hasOwnProperty.call(targetGlobal, PYODIDE_BRIDGE_OWNED_GLOBALS)) {
      Object.defineProperty(targetGlobal, PYODIDE_BRIDGE_OWNED_GLOBALS, {
        value: new Set(),
        enumerable: false,
        configurable: false,
        writable: false
      })
    }
    return targetGlobal[PYODIDE_BRIDGE_OWNED_GLOBALS]
  } catch (e) {
    return null
  }
}

function setPyodideGlobal (pyodide, name, value) {
  if (!pyodide || !pyodide.globals || typeof pyodide.globals.set !== 'function') {
    throw new Error('Pyodide globals API is unavailable')
  }
  const pyValue = typeof pyodide.toPy === 'function' ? pyodide.toPy(value) : value
  pyodide.globals.set(name, pyValue)
  return pyValue
}

function makePyodideContext (data, extraContext) {
  const ctx = Object.assign({}, isObject(extraContext) ? extraContext : {})
  if (isObject(data) && Object.prototype.hasOwnProperty.call(data, 'caller')) {
    ctx.caller = data.caller
  }
  if (isObject(data) && Array.isArray(data.history)) {
    ctx.history = data.history
  }
  return ctx
}

function bindPyodideInputs (pyodide, data, targetGlobal, options={}) {
  const inputData = isObject(data) ? data : {}
  const warnings = []
  const collisions = []
  const legacyGlobals = []
  const warn = (message) => {
    warnings.push(message)
    if (typeof options.warn === 'function') options.warn(message)
  }

  const ctx = makePyodideContext(inputData, options.ctx)
  const pyInputs = setPyodideGlobal(pyodide, 'inputs', inputData)
  const pyCtx = setPyodideGlobal(pyodide, 'ctx', ctx)

  const ownedGlobals = getOwnedPyodideGlobals(targetGlobal)
  if (targetGlobal && (typeof targetGlobal === 'object' || typeof targetGlobal === 'function')) {
    Object.keys(inputData).forEach(key => {
      const owned = ownedGlobals && ownedGlobals.has(key)
      if ((key in targetGlobal) && !owned) {
        collisions.push(key)
        warn(`Pyodide input "${key}" was not exposed as a JS global because that name already exists; use inputs["${key}"] from Python instead.`)
        return
      }
      try {
        targetGlobal[key] = inputData[key]
        legacyGlobals.push(key)
        if (ownedGlobals) ownedGlobals.add(key)
      } catch (e) {
        collisions.push(key)
        warn(`Pyodide input "${key}" could not be exposed as a JS global; use inputs["${key}"] from Python instead.`)
      }
    })
  }

  return {
    inputs: pyInputs,
    ctx: pyCtx,
    warnings,
    collisions,
    legacyGlobals
  }
}

function isPythonIdentifier (value) {
  return (typeof value === 'string') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
}

function getPyodideEntryName (model) {
  if (!model || typeof model.entry === 'undefined' || model.entry === null || model.entry === '') {
    return null
  }
  if (typeof model.entry !== 'string') {
    throw new Error('model.entry should be a Python function name string')
  }
  const entry = model.entry.trim()
  if (!isPythonIdentifier(entry)) {
    throw new Error('model.entry should be a valid Python function name')
  }
  return entry
}

function buildPyodideEntryCallCode (entry) {
  const entryLiteral = JSON.stringify(entry)
  return `
import inspect as __jsee_inspect
__jsee_entry_name = ${entryLiteral}
__jsee_fn = globals().get(__jsee_entry_name)
if __jsee_fn is None or not callable(__jsee_fn):
    raise NameError(f"Pyodide entry function {__jsee_entry_name!r} is not defined")
__jsee_sig = __jsee_inspect.signature(__jsee_fn)
__jsee_kwargs = {}
for __jsee_name, __jsee_param in __jsee_sig.parameters.items():
    if __jsee_param.kind == __jsee_inspect.Parameter.VAR_POSITIONAL:
        continue
    if __jsee_name == "inputs":
        __jsee_kwargs[__jsee_name] = inputs
    elif __jsee_name == "ctx":
        __jsee_kwargs[__jsee_name] = ctx
    elif __jsee_param.kind == __jsee_inspect.Parameter.VAR_KEYWORD:
        for __jsee_key, __jsee_value in inputs.items():
            if __jsee_key not in __jsee_kwargs:
                __jsee_kwargs[__jsee_key] = __jsee_value
    elif __jsee_name in inputs:
        __jsee_kwargs[__jsee_name] = inputs[__jsee_name]
__jsee_result = __jsee_fn(**__jsee_kwargs)
if __jsee_inspect.isawaitable(__jsee_result):
    __jsee_result = await __jsee_result
__jsee_result
`.trim()
}

function pyodideResultToJs (value) {
  if (!value || typeof value.toJs !== 'function') {
    return value
  }

  let converted
  try {
    converted = value.toJs({ dict_converter: Object.fromEntries })
  } catch (error) {
    converted = value.toJs()
  } finally {
    if (typeof value.destroy === 'function') {
      value.destroy()
    }
  }
  return converted
}

function decodeHtmlEntitiesBasic (value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);?/gi, (match, code) => {
      const point = parseInt(code, 16)
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match
    })
    .replace(/&#([0-9]+);?/g, (match, code) => {
      const point = parseInt(code, 10)
      return Number.isFinite(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : match
    })
    .replace(/&(colon|tab|newline|Tab|NewLine);?/g, (match, name) => {
      const lower = name.toLowerCase()
      if (lower === 'colon') return ':'
      if (lower === 'tab') return '\t'
      if (lower === 'newline') return '\n'
      return match
    })
}

function getFallbackAttrValue (rawValue) {
  const value = String(rawValue == null ? '' : rawValue)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function sanitizeHtmlFallback (value, security) {
  const normalized = normalizeSecurityOptions(security)
  return String(value == null ? '' : value)
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|option|foreignobject)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|option|foreignobject)[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(style|srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|poster|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, attrName, rawValue) => {
      const decoded = decodeHtmlEntitiesBasic(getFallbackAttrValue(rawValue))
      return isSafeHtmlUrl(decoded, attrName.toLowerCase(), normalized) ? match : ''
    })
    .replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

function isSafeHtmlUrl (value, attrName, security) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return true

  const compact = raw.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
  if (!compact) return true
  if (compact.startsWith('#')) return true
  if (compact.startsWith('mailto:') || compact.startsWith('tel:')) return true
  if (compact.startsWith('javascript:') || compact.startsWith('vbscript:') || compact.startsWith('data:text/html')) return false

  if (compact.startsWith('data:')) {
    const safeInlineMedia = /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(compact)
      || /^data:audio\/(mpeg|mp3|wav|ogg|webm);base64,/.test(compact)
      || /^data:video\/(mp4|webm|ogg);base64,/.test(compact)
    return safeInlineMedia && security.allowFileViewer !== false
  }

  if (/^https?:\/\//.test(compact) || compact.startsWith('//')) {
    return security.allowNetwork !== false
  }

  if (/^[a-z][a-z0-9+.-]*:/.test(compact)) {
    return false
  }

  return security.allowNetwork !== false || attrName === 'href'
}

function isSafeHtmlAttribute (tagName, attr, security) {
  const name = attr.name.toLowerCase()
  if (!name || name.startsWith('on')) return false
  if (name === 'style' || name === 'srcdoc' || name === 'formaction') return false
  if (URL_ATTRS.has(name) && !isSafeHtmlUrl(attr.value, name, security)) return false
  return SAFE_GLOBAL_ATTRS.has(name)
    || SAFE_HTML_ATTRS.has(name)
    || SAFE_SVG_ATTRS.has(name)
}

function unwrapHtmlElement (element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
}

function sanitizeHtmlNode (node, security) {
  const children = Array.from(node.childNodes || [])
  children.forEach(child => {
    if (child.nodeType === 8) {
      child.remove()
      return
    }

    if (child.nodeType !== 1) return

    const tagName = child.tagName.toLowerCase()
    if (DROP_HTML_TAGS.has(tagName)) {
      child.remove()
      return
    }

    if (!SAFE_HTML_TAGS.has(tagName)) {
      unwrapHtmlElement(child)
      sanitizeHtmlNode(node, security)
      return
    }

    Array.from(child.attributes || []).forEach(attr => {
      if (!isSafeHtmlAttribute(tagName, attr, security)) {
        child.removeAttribute(attr.name)
      }
    })

    if (tagName === 'a' && child.getAttribute('target') === '_blank') {
      child.setAttribute('rel', 'noopener noreferrer')
    }

    sanitizeHtmlNode(child, security)
  })
}

function sanitizeHtml (value, security) {
  const normalized = normalizeSecurityOptions(security)
  const text = String(value == null ? '' : value)
  if (normalized.allowRawHtml !== false
      && normalized.allowNetwork !== false
      && normalized.allowFileViewer !== false) return text

  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return sanitizeHtmlFallback(text, normalized)
  }

  const template = document.createElement('template')
  template.innerHTML = text
  sanitizeHtmlNode(template.content, normalized)
  return template.innerHTML
}

function isHttpUrl (value) {
  return (typeof value === 'string') && /^https?:\/\//i.test(value)
}

function isNetworkUrl (value) {
  return (typeof value === 'string') && /^(https?:)?\/\//i.test(value)
}

function invocationUnsupportedReason (schema) {
  const models = Array.isArray(schema.model) ? schema.model : [schema.model]
  const hasImports = value => Array.isArray(value) ? value.length > 0 : Boolean(value)
  if (!models.length) return 'Invocation requires a model'
  for (const model of models) {
    if (model?.render || model?.enabled === false) continue
    if (!model || !['function', 'async-function', 'class', 'async-init', undefined].includes(model.type) ||
        model.stream || hasImports((model.imports || []).filter ? (model.imports || []).filter(imp => typeof imp !== 'object' || (!imp.code && !imp.sha256)) : model.imports) || hasImports(schema.imports) ||
        (typeof model.code !== 'function' && typeof model.code !== 'string' && (!model.url || isNetworkUrl(model.url) && !model.sha256))) {
      return 'invokeSchema supports local JavaScript models without schema imports or streaming'
    }
  }
  return null
}

function assertNetworkAllowed (url, security, context='network URL') {
  const options = normalizeSecurityOptions(security)
  if (options.allowNetwork === false && isNetworkUrl(url)) {
    throw new Error(`security.allowNetwork is false; blocked ${context}: ${url}`)
  }
}

function assertApiNetworkAllowed (model, security) {
  const options = normalizeSecurityOptions(security)
  if (options.allowNetwork === false) {
    const type = model && model.type ? model.type : 'api'
    throw new Error(`security.allowNetwork is false; blocked ${type} model request`)
  }
}

function assertEvalAllowed (security, context='dynamic code execution') {
  const options = normalizeSecurityOptions(security)
  if (options.allowEval === false) {
    throw new Error(`security.allowEval is false; blocked ${context}`)
  }
}

function assertImportNetworkAllowed (imports, security, context='imports') {
  if (!Array.isArray(imports)) return
  imports.forEach((item, index) => {
    if (item && typeof item === 'object' && typeof item.code !== 'undefined') return
    const url = typeof item === 'string'
      ? item
      : item && (item._rawUrl || item.url || item.src || item.href)
    assertNetworkAllowed(url, security, `${context}[${index}]`)
  })
}

function assertPyodideNetworkAllowed (pyodideOptions, security, context='Pyodide runtime') {
  const options = pyodideOptions || {}
  if (!options.code) {
    assertNetworkAllowed(options.url, security, context)
  }
  if (options.indexURL) {
    assertNetworkAllowed(options.indexURL, security, `${context} indexURL`)
  }
}

function collectSchemaBlocks (value, path) {
  if (typeof value === 'undefined') return []
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      value: item,
      path: `${path}[${index}]`
    }))
  }
  return [{ value, path }]
}

function collectImportUrls (imports, path) {
  if (!Array.isArray(imports)) return []
  return imports.map((item, index) => {
    if (typeof item === 'string') {
      return {
        url: item,
        path: `${path}[${index}]`
      }
    }
    if (isObject(item)) {
      return {
        url: item.url || item.src || item.href,
        path: `${path}[${index}]`
      }
    }
    return {
      url: undefined,
      path: `${path}[${index}]`
    }
  })
}

function collectNestedInputs (inputs, path) {
  if (!Array.isArray(inputs)) return []
  const collected = []
  inputs.forEach((input, index) => {
    const inputPath = `${path}[${index}]`
    collected.push({ value: input, path: inputPath })
    if (isObject(input) && input.type === 'group') {
      collected.push(...collectNestedInputs(input.elements, `${inputPath}.elements`))
    }
  })
  return collected
}

function collectNestedOutputs (outputs, path) {
  if (!Array.isArray(outputs)) return []
  const collected = []
  outputs.forEach((output, index) => {
    const outputPath = `${path}[${index}]`
    collected.push({ value: output, path: outputPath })
    if (isObject(output) && output.type === 'group') {
      collected.push(...collectNestedOutputs(output.elements, `${outputPath}.elements`))
    }
  })
  return collected
}

function validateSecuritySchema (schema, report) {
  if (typeof schema.security === 'undefined') return

  if (!isObject(schema.security)) {
    report.warnings.push('security should be an object')
    return
  }

  const security = schema.security
  if ((typeof security.mode !== 'undefined') && !['trusted', 'secure'].includes(security.mode)) {
    report.warnings.push("security.mode should be 'trusted' or 'secure'")
  }

  if ((typeof security.trusted !== 'undefined') && (typeof security.trusted !== 'boolean')) {
    report.warnings.push('security.trusted should be a boolean')
  }

  SECURITY_FLAGS.forEach(flag => {
    if ((typeof security[flag] !== 'undefined') && (typeof security[flag] !== 'boolean')) {
      report.warnings.push(`security.${flag} should be a boolean`)
    }
  })

  const options = normalizeSecurityOptions(security)
  const advisoryMode = options.mode === 'secure' || options.trusted === false
  if (advisoryMode) {
    report.warnings.push('security.mode enables opt-in runtime enforcement for allowEval, allowNetwork, allowRawHtml, allowNotifications, and allowFileViewer; incompatible schema features are reported as warnings')
  }

  const executableBlocks = [
    ...collectSchemaBlocks(schema.model, 'model'),
    ...collectSchemaBlocks(schema.view, 'view'),
    ...collectSchemaBlocks(schema.render, 'render')
  ]

  if (options.allowEval === false) {
    executableBlocks.forEach(block => {
      if (typeof block.value === 'function') {
        report.warnings.push(`security.allowEval is false but ${block.path} is an inline function`)
      } else if (isObject(block.value) && typeof block.value.code !== 'undefined') {
        report.warnings.push(`security.allowEval is false but ${block.path}.code uses inline code`)
      }
    })
  }

  if (options.allowNetwork === false) {
    collectImportUrls(schema.imports, 'imports').forEach(item => {
      if (isHttpUrl(item.url)) {
        report.warnings.push(`security.allowNetwork is false but ${item.path} uses network URL ${item.url}`)
      }
    })

    executableBlocks.forEach(block => {
      if (!isObject(block.value)) return
      if (isHttpUrl(block.value.url)) {
        report.warnings.push(`security.allowNetwork is false but ${block.path}.url uses network URL ${block.value.url}`)
      }
      if (block.value.type === 'get' || block.value.type === 'post') {
        report.warnings.push(`security.allowNetwork is false but ${block.path}.type '${block.value.type}' performs HTTP requests`)
      }
      collectImportUrls(block.value.imports, `${block.path}.imports`).forEach(item => {
        if (isHttpUrl(item.url)) {
          report.warnings.push(`security.allowNetwork is false but ${item.path} uses network URL ${item.url}`)
        }
      })
      if (block.value.type === 'py') {
        const pyodideOptions = normalizePyodideOptions(block.value)
        if (isHttpUrl(pyodideOptions.url)) {
          report.warnings.push(`security.allowNetwork is false but ${block.path}.pyodide.url uses network URL ${pyodideOptions.url}`)
        }
        if (isHttpUrl(pyodideOptions.indexURL)) {
          report.warnings.push(`security.allowNetwork is false but ${block.path}.pyodide.indexURL uses network URL ${pyodideOptions.indexURL}`)
        }
      }
    })
  }

  const outputs = collectNestedOutputs(schema.outputs, 'outputs')
  if (options.allowRawHtml === false) {
    outputs.forEach(output => {
      if (isObject(output.value) && ['html', 'svg', 'markdown', 'chat'].includes(output.value.type)) {
        report.warnings.push(`security.allowRawHtml is false but ${output.path}.type '${output.value.type}' may render unsanitized content`)
      }
    })
  }

  if (options.allowNotifications === false && schema.notify === true) {
    report.warnings.push('security.allowNotifications is false but notify is enabled')
  }

  if (options.allowFileViewer === false) {
    collectNestedInputs(schema.inputs, 'inputs').forEach(input => {
      if (isObject(input.value) && ['file', 'folder'].includes(input.value.type)) {
        report.warnings.push(`security.allowFileViewer is false but ${input.path}.type '${input.value.type}' reads local files`)
      }
    })

    outputs.forEach(output => {
      if (isObject(output.value) && ['file', 'pdf', 'gallery', 'viewer', 'image', 'audio', 'video'].includes(output.value.type)) {
        report.warnings.push(`security.allowFileViewer is false but ${output.path}.type '${output.value.type}' can display file/media content`)
      }
    })
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

  try {
    assertSchemaVersion(schema)
  } catch (error) {
    report.errors.push(error.message)
  }

  const hasModel = typeof schema.model !== 'undefined'
  const hasView = (typeof schema.view !== 'undefined') || (typeof schema.render !== 'undefined')

  const hasInputs = Array.isArray(schema.inputs) && schema.inputs.length > 0
  if (!hasModel && !hasView && !hasInputs) {
    report.errors.push('Schema should define `model` (or `view`/`render`) or `inputs`')
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

  const checkNames = (inputs, names=new Set()) => {
    if (!Array.isArray(inputs)) return
    inputs.forEach(input => {
      if (!isObject(input)) return
      if (input.type === 'group' && !input.name) {
        checkNames(input.elements, names)
        return
      }
      if (typeof input.name === 'string' && input.type !== 'button' && input.type !== 'action') {
        if (names.has(input.name)) report.errors.push(`Duplicate input name: ${input.name}`)
        names.add(input.name)
      }
      if (input.type === 'group') checkNames(input.elements)
    })
  }
  checkNames(schema.inputs)

  if (schema.outputs !== undefined && !Array.isArray(schema.outputs)) {
    report.errors.push('`outputs` should be an array')
  }

  if ((typeof schema.inferInputTypes !== 'undefined') && (typeof schema.inferInputTypes !== 'boolean')) {
    report.warnings.push('inferInputTypes should be a boolean')
  }

  if (hasModel) {
    const models = Array.isArray(schema.model)
      ? schema.model
      : [schema.model]
    models.forEach((model, index) => {
      validateModelSchema(model, `model[${index}]`, report)
    })
  }

  const checkShapes = fields => {
    for (const field of fields || []) {
      try { getValueSchema(field) } catch (error) { report.errors.push(error.message) }
      if (Array.isArray(field.elements)) checkShapes(field.elements)
    }
  }
  if (Array.isArray(schema.inputs)) checkShapes(schema.inputs)
  if (Array.isArray(schema.outputs)) checkShapes(schema.outputs)
  validateSecuritySchema(schema, report)

  return report
}

// Convert a URL parameter string to the appropriate type
function coerceParam (value, type, name) {
  if (type === 'number' || type === 'int' || type === 'float' || type === 'slider') return Number(value)
  if (type === 'boolean' || type === 'bool' || type === 'checkbox' || type === 'toggle') return value === 'true'
  if (type === 'range') {
    try { return JSON.parse(value) }
    catch (e) { console.error(`Failed to parse range for input ${name}:`, e) }
  }
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

function flattenJseeOutputs (outputs, flat=[]) {
  if (!Array.isArray(outputs)) return flat
  outputs.forEach(output => {
    if (!output || typeof output !== 'object') return
    if (output.type === 'group') {
      flattenJseeOutputs(output.elements, flat)
      return
    }
    if (output.name) flat.push(output)
  })
  return flat
}

function fileLikeOutputJsonSchema () {
  return {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          name: { type: 'string' },
          mime: { type: 'string' },
          contentType: { type: 'string' },
          content: {},
          value: {},
          data: {},
          url: { type: 'string' }
        },
        additionalProperties: true
      }
    ]
  }
}

function jseeOutputToJsonSchema (output) {
  const shape = getValueSchema(output)
  if (shape !== undefined) return shape
  const type = output && output.type
  switch (type) {
    case 'int':
      return { type: 'integer' }
    case 'float':
    case 'number':
      return { type: 'number' }
    case 'bool':
      return { type: 'boolean' }
    case 'gauge':
      return {
        oneOf: [
          { type: 'number' },
          { type: 'object', additionalProperties: true }
        ]
      }
    case 'table':
      return tableOutputJsonSchema()
    case 'file':
    case 'image':
    case 'audio':
    case 'video':
    case 'pdf':
    case 'viewer':
      return fileLikeOutputJsonSchema()
    case 'text':
    case 'string':
    case 'markdown':
    case 'html':
    case 'svg':
    case 'code':
    case 'highlight':
      return { type: 'string' }
    case 'alert':
    case 'chat':
      return {
        oneOf: [
          { type: 'string' },
          { type: 'object', additionalProperties: true },
          { type: 'array', items: { type: 'object', additionalProperties: true } }
        ]
      }
    case 'chart':
    case 'map':
    case '3d':
    case 'gallery':
      return {
        oneOf: [
          { type: 'object', additionalProperties: true },
          { type: 'array', items: {} }
        ]
      }
    // The JSON viewer accepts any JSON value, including scalars and null.
    case 'object':
    case 'blank':
    case 'function':
      return {}
    default:
      return {}
  }
}

function jseeOutputsToJsonSchema (outputs) {
  const flatOutputs = flattenJseeOutputs(outputs)
  if (!flatOutputs.length) {
    return { type: 'object', additionalProperties: true }
  }
  // Output names are data, including __proto__.
  const properties = Object.fromEntries(flatOutputs.map(output => [output.name, jseeOutputToJsonSchema(output)]))
  return {
    type: 'object',
    properties,
    additionalProperties: true
  }
}

function jseeInputsToMultipartJsonSchema (inputs) {
  const schema = jseeInputsToJsonSchema(inputs)
  for (const inp of (inputs || [])) {
    if (!inp || !inp.name) continue
    if (inp.type === 'file') {
      schema.properties[inp.name] = { type: 'string', format: 'binary' }
    }
  }
  return schema
}

function hasFileInput (inputs) {
  return (inputs || []).some(input => {
    if (!input || typeof input !== 'object') return false
    if (input.type === 'group') return hasFileInput(input.elements)
    return input.type === 'file'
  })
}

function openApiRequestExamples (examples) {
  if (!Array.isArray(examples) || examples.length === 0) return null
  const result = {}
  examples.forEach((example, index) => {
    const value = isObject(example) && isObject(example.inputs)
      ? example.inputs
      : example
    result[`example${index + 1}`] = { value }
  })
  return result
}

function openApiErrorResponse (description) {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          },
          required: ['error'],
          additionalProperties: true
        }
      }
    }
  }
}

function generateOpenAPISpec (schema) {
  const models = Array.isArray(schema.model) ? schema.model : (schema.model ? [schema.model] : [])
  const paths = {}
  const inputSchema = jseeInputsToJsonSchema(schema.inputs)
  const outputSchema = jseeOutputsToJsonSchema(schema.outputs)
  const examples = openApiRequestExamples(schema.examples)

  for (const m of models) {
    const jsonContent = { schema: inputSchema }
    if (examples) jsonContent.examples = examples
    const requestContent = {
      'application/json': jsonContent
    }
    if (hasFileInput(schema.inputs)) {
      requestContent['multipart/form-data'] = {
        schema: jseeInputsToMultipartJsonSchema(schema.inputs)
      }
    }
    const responseContent = {
      'application/json': { schema: outputSchema }
    }
    if (m.stream) {
      responseContent['text/event-stream'] = {
        schema: { type: 'string' },
        description: 'Server-Sent Events stream with data frames and a [DONE] sentinel'
      }
    }
    paths['/' + m.name] = {
      post: {
        summary: 'Run ' + m.name,
        operationId: m.name,
        requestBody: {
          required: true,
          content: requestContent
        },
        responses: {
          '200': {
            description: 'Model output',
            content: responseContent
          },
          '400': openApiErrorResponse('Invalid request'),
          '404': openApiErrorResponse('Unknown model'),
          '500': openApiErrorResponse('Model execution error')
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
  // Buffer or Uint8Array -> MIME-sniffed data URL
  if (Buffer.isBuffer(result) || result instanceof Uint8Array) {
    return { result: binaryDataUrl(result) }
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

// Convert column-oriented data {x: [1,2], y: [3,4]} to row-oriented [{x:1, y:3}, {x:2, y:4}]
function columnsToRows (data) {
  if (!isObject(data)) return data
  const keys = Object.keys(data)
  if (keys.length === 0) return []
  const firstArray = data[keys[0]]
  if (!Array.isArray(firstArray)) return data
  // Ensure all values are arrays of the same length
  const len = firstArray.length
  if (!keys.every(k => Array.isArray(data[k]) && data[k].length === len)) return data
  const rows = []
  for (let i = 0; i < len; i++) {
    const row = {}
    keys.forEach(k => { row[k] = data[k][i] })
    rows.push(row)
  }
  return rows
}

function createValidateFn (input, filtrexCompile, filtrexOptions) {
  let validate = null
  if (input.validate) {
    const expr = input.validate.replace(/\'/g, '"')
    const f = filtrexCompile(expr, filtrexOptions)
    const msg = input.error || 'Invalid value'
    validate = function (value) {
      try {
        return f({ value }) ? null : msg
      } catch (e) {
        return msg
      }
    }
  }
  if (input.required) {
    const msg = input.error || 'Required'
    return function (value) {
      // Structured inputs use JSON Schema presence semantics; empty collections are values.
      if (value === undefined) return msg
      if (!['object', 'table'].includes(input.type)) {
        if (value === null || value === '') return msg
        if (Array.isArray(value) && value.length === 0) return msg
      }
      return validate ? validate(value) : null
    }
  }
  return validate
}

function runValidation (inputs, validateFunctions) {
  let hasErrors = false
  inputs.forEach((input, index) => {
    if (input._parseError) { input._error = input._parseError; hasErrors = true; return }
    if (index < validateFunctions.length && validateFunctions[index]) {
      const value = input.type === 'group' ? collectInputValues(input.elements) : input.value
      input._error = validateFunctions[index](value)
      if (input._error) hasErrors = true
    }
  })
  return hasErrors
}

const EXT_TO_OUTPUT = {
  '.pdf': 'pdf',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image',
  '.gif': 'image', '.svg': 'image', '.webp': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.csv': 'table', '.tsv': 'table',
  '.md': 'markdown',
  '.html': 'html', '.htm': 'html',
  '.json': 'object',
}

function fileExtToOutputType (filename) {
  if (typeof filename !== 'string') return 'code'
  const dotIdx = filename.lastIndexOf('.')
  if (dotIdx < 0) return 'code'
  const ext = filename.slice(dotIdx).toLowerCase().replace(/[?#].*$/, '')
  return EXT_TO_OUTPUT[ext] || 'code'
}

function inferOutputType (key, value) {
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object' && value[0] !== null) return 'table'
    if (value.length > 0 && typeof value[0] === 'string' && /\.(png|jpe?g|gif|svg|webp)([?#].*)?$/i.test(value[0])) return 'gallery'
    return 'object'
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return 'image'
    if (value.startsWith('data:audio/')) return 'audio'
    if (value.startsWith('data:video/')) return 'video'
    if (value.startsWith('data:application/pdf')) return 'pdf'
    if (/\.(png|jpe?g|gif|svg|webp)([?#].*)?$/i.test(value)) return 'image'
    if (/\.(mp3|wav|ogg|flac)([?#].*)?$/i.test(value)) return 'audio'
    if (/\.(mp4|webm|mov)([?#].*)?$/i.test(value)) return 'video'
    if (/\.pdf([?#].*)?$/i.test(value)) return 'pdf'
    if (/\.md([?#].*)?$/i.test(value)) return 'markdown'
    if (value.includes('\n') && value.length > 200) return 'code'
    return 'string'
  }
  if (typeof value === 'number' || typeof value === 'boolean') return 'string'
  if (typeof value === 'object' && value !== null) return 'object'
  return 'string'
}

module.exports = {
  isObject,
  isBinaryLike,
  isRecordObject,
  normalizeFileOutputValue,
  loadFromDOM,
  getModelFuncJS,
  getModelFuncAPI,
  getModuleModelTarget,
  importScripts,
  getUrl,
  normalizePyodideOptions,
  loadPyodideRuntime,
  getPyodideLoadOptions,
  loadPyodideEmbeddedAssets,
  preparePyodideRuntimeOptions,
  assertPyodideNetworkAllowed,
  delay,
  debounce,
  sanitizeName,
  outputLookupNames,
  collectOutputNames,
  cleanOutputMetadata,
  isWorkerInitMessage,
  getProgressState,
  getIntervalDelay,
  shouldContinueInterval,
  createFileStream,
  createFetchStream,
  wrapStreamInputs,
  getName,
  inferInputsFromModel,
  normalizeSecurityOptions,
  bindPyodideInputs,
  getPyodideEntryName,
  buildPyodideEntryCallCode,
  pyodideResultToJs,
  isNetworkUrl,
  invocationUnsupportedReason,
  assertNetworkAllowed,
  assertApiNetworkAllowed,
  assertEvalAllowed,
  assertImportNetworkAllowed,
  sanitizeHtml,
  assertSchemaVersion,
  validateSchema,
  toWorkerSerializable,
  containsBinaryPayload,
  isCssImport,
  isRelativeImport,
  getUrlParam,
  coerceParam,
  jseeInputsToJsonSchema,
  jseeOutputsToJsonSchema,
  flattenJseeOutputs,
  generateOpenAPISpec,
  serializeResult,
  parseMultipart,
  parseSSELine,
  toTypedArray,
  fromTypedArray,
  prepareBrowserFiles,
  wrapTypedArrayInputs,
  collectTransferables,
  columnsToRows,
  createValidateFn,
  runValidation,
  fileExtToOutputType,
  inferOutputType
}
