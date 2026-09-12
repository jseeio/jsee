const { collectInputValues, getInputDefaultValue, prepareInputs, cloneSchema } = require('./schema')
const { runPipeline } = require('./pipeline')
const { outputLookupNames, cleanOutputMetadata, invocationUnsupportedReason } = require('./utils')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const Module = require('module')

const minimist = require('minimist')

const { getModelFuncJS, sanitizeName, isRecordObject, normalizeFileOutputValue, generateOpenAPISpec, serializeResult, parseMultipart, fileExtToOutputType, normalizePyodideOptions, isNetworkUrl, assertSchemaVersion } = require('./utils.js')

const API_BODY_LIMIT = '50mb'

let jsdoc2md
function getJsdocToMarkdown () {
  if (!jsdoc2md) jsdoc2md = require('jsdoc-to-markdown')
  return jsdoc2md
}

let markdownConverter
function getMarkdownConverter () {
  if (markdownConverter) return markdownConverter

  const MarkdownIt = require('markdown-it')
  markdownConverter = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false
  })
  return markdownConverter
}

// left padding of multiple lines
function pad (str, len, start=0) {
  return str.split('\n').map((s, i) => i >= start ? ' '.repeat(len) + s : s).join('\n')
}

function toArray (value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr (value) {
  return escapeHtml(value)
}

function safeJsonForScript (value) {
  const json = typeof value === 'undefined' ? 'null' : JSON.stringify(value)
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function escapeScriptContent (value) {
  return String(value == null ? '' : value).replace(/<\/script/gi, '<\\/script')
}

function encodeAssetForHtml (value) {
  return Buffer.from(String(value == null ? '' : value), 'utf8').toString('base64')
}

function hiddenAssetScript (src, value) {
  return `<script type="application/json" style="display: none;" data-src="${escapeAttr(src)}" data-encoding="base64">${encodeAssetForHtml(value)}</script>`
}

function sanitizeUrl (value) {
  if (!value) return ''
  const text = String(value).trim()
  try {
    const parsed = new URL(text)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:') {
      return parsed.href
    }
    return ''
  } catch (error) {
    if (/^(\/|\.\/|\.\.\/|#)/.test(text)) return text
    return ''
  }
}

function sanitizeGoogleAnalyticsId (value) {
  const text = String(value == null ? '' : value).trim()
  return /^[A-Za-z0-9_-]+$/.test(text) ? text : ''
}

function joinUrl (base, rel) {
  return new URL(rel, base.endsWith('/') ? base : base + '/').href
}

function ensureTrailingSlash (value) {
  return value.endsWith('/') ? value : `${value}/`
}

function getDisplayHost (host) {
  return (!host || host === '0.0.0.0' || host === '::' || host === '127.0.0.1')
    ? 'localhost'
    : host
}

function makeHttpError (message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function hasDeniedPathSegment (relativePath) {
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .some(part => part.startsWith('.') || part === 'node_modules')
}

function resolveInside (root, requested) {
  if (!requested || typeof requested !== 'string') {
    throw makeHttpError('path required', 400)
  }
  const realRoot = fs.realpathSync(root)
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(realRoot, requested)
  let realCandidate
  try {
    realCandidate = fs.realpathSync(candidate)
  } catch (error) {
    throw makeHttpError('path not found', 404)
  }
  const relative = path.relative(realRoot, realCandidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw makeHttpError('path outside app root', 403)
  }
  if (hasDeniedPathSegment(relative)) {
    throw makeHttpError('path denied', 403)
  }
  return realCandidate
}

function resolveInsideAny (roots, requested) {
  let lastError = null
  for (const root of roots) {
    try {
      return resolveInside(root, requested)
    } catch (error) {
      lastError = error
      if (error.status && error.status !== 403) {
        continue
      }
    }
  }
  throw lastError || makeHttpError('path not found', 404)
}

function sendEndpointError (res, error, fallbackStatus=500) {
  const status = error && error.status ? error.status : fallbackStatus
  res.status(status).json({ error: error.message || 'request failed' })
}

function containedStatic (root) {
  const serve = require('express').static(root, { dotfiles: 'deny' })
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    try {
      const requested = decodeURIComponent(req.path).replace(/^\/+/, '') || '.'
      const resolved = resolveInside(root, requested)
      // express.static also serves directory indexes; validate that final target as well.
      if (fs.statSync(resolved).isDirectory()) resolveInside(root, path.join(resolved, 'index.html'))
      serve(req, res, next)
    } catch (error) {
      if (error.status === 404) return next()
      sendEndpointError(res, error, error instanceof URIError ? 400 : 500)
    }
  }
}

function isAsyncIterable (value) {
  return !!value
    && typeof value !== 'string'
    && typeof value.next === 'function'
    && typeof value[Symbol.asyncIterator] === 'function'
}

function isIterable (value) {
  if (!value || typeof value === 'string') return false
  if (Array.isArray(value)) return false
  if (Buffer.isBuffer(value)) return false
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return false
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) return false
  return typeof value.next === 'function' && typeof value[Symbol.iterator] === 'function'
}

function isStreamResult (value) {
  return isAsyncIterable(value) || isIterable(value)
}

function writeSseFrame (res, payload, eventName) {
  const prefix = eventName ? `event: ${eventName}\n` : ''
  const frame = `${prefix}data: ${payload}\n\n`
  return new Promise((resolve, reject) => {
    if (res.destroyed || res.writableEnded) return reject(new Error('Stream disconnected'))
    if (res.write(frame)) return resolve()
    const cleanup = () => {
      res.removeListener('drain', drained)
      res.removeListener('close', closed)
      res.removeListener('error', failed)
    }
    const drained = () => { cleanup(); resolve() }
    const failed = error => { cleanup(); reject(error) }
    const closed = () => failed(new Error('Stream disconnected'))
    // A response can close instead of draining. Never leave the producer awaiting it.
    res.once('drain', drained)
    res.once('close', closed)
    res.once('error', failed)
    if (res.destroyed || res.writableEnded) closed()
  })
}

async function writeSseStream (res, result) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  try {
    try {
      for await (const chunk of result) {
        await writeSseFrame(res, JSON.stringify(serializeResult(chunk)))
      }
    } catch (error) {
      if (res.destroyed || res.writableEnded) return
      await writeSseFrame(res, JSON.stringify({ error: error.message || 'stream failed' }), 'error')
    }
    await writeSseFrame(res, '[DONE]')
    res.end()
  } catch (error) {
    if (!res.destroyed && !res.writableEnded) throw error
  }
}

// Auto-detect CLI argument type: file path, number, JSON array/object, or string
function detectArgValue (value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return value
  // File on disk
  if (fs.existsSync(value) && fs.statSync(value).isFile()) return value
  // Number
  if (value !== '' && !isNaN(value)) return Number(value)
  // JSON array or object
  if (value.startsWith('[') || value.startsWith('{')) {
    try { return JSON.parse(value) } catch (e) { /* not JSON */ }
  }
  return value
}

function readDirListing (resolved, relative) {
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      path: path.posix.join(relative, e.name),
      size: fs.statSync(path.join(resolved, e.name)).size,
      type: fileExtToOutputType(e.name),
      selected: true
    }))
}

function isPackageSpecifier (value) {
  if (typeof value !== 'string') return false
  if (!value || value.startsWith('.') || value.startsWith('/') || value.startsWith('file:')) return false
  if (isHttpUrl(value)) return false
  if (value.includes('\\')) return false
  if (value.startsWith('@')) {
    return /^@[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)
  }
  return /^[A-Za-z0-9._-]+$/.test(value)
}

function looksLikeMissingPackageInput (value, cwd) {
  if (!isPackageSpecifier(value)) return false
  if (value.includes('.json') || value.includes('.js')) return false
  return !fs.existsSync(path.resolve(cwd, value))
}

function getPackageInputInstallHint (specifier) {
  return `npx -p @jseeio/jsee -p ${specifier} jsee ${specifier} --serve`
}

function resolvePackageJsonPath (specifier, cwd) {
  const resolver = Module.createRequire(path.join(cwd, '__jsee_resolve__.js'))
  const searchPaths = resolver.resolve.paths(specifier) || []

  for (const base of searchPaths) {
    const candidate = path.join(base, specifier, 'package.json')
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }

  try {
    return require.resolve(`${specifier}/package.json`, { paths: [cwd] })
  } catch (error) {
    return null
  }
}

function readJseePackageInput (specifier, packageJsonPath) {
  const packageRoot = path.dirname(packageJsonPath)
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const appConfig = packageJson.jsee
  let schemaRel
  let descriptionRel

  if (typeof appConfig === 'string') {
    schemaRel = appConfig
  } else if (appConfig && typeof appConfig === 'object') {
    schemaRel = appConfig.schema || appConfig.input || appConfig.inputs
    descriptionRel = appConfig.description
  }

  if (!schemaRel) {
    throw new Error(`${specifier} does not declare a JSEE app. Add "jsee": "schema.json" to its package.json.`)
  }

  const schemaPath = path.resolve(packageRoot, schemaRel)
  if (!fs.existsSync(schemaPath) || !fs.statSync(schemaPath).isFile()) {
    throw new Error(`${specifier} declares JSEE schema ${schemaRel}, but the file was not found.`)
  }

  let descriptionPath = null
  if (descriptionRel) {
    descriptionPath = path.resolve(packageRoot, descriptionRel)
  } else {
    const readmePath = path.join(packageRoot, 'README.md')
    if (fs.existsSync(readmePath) && fs.statSync(readmePath).isFile()) descriptionPath = readmePath
  }

  return {
    packageName: packageJson.name || specifier,
    packageRoot,
    schemaPath,
    descriptionPath
  }
}

function resolveJseePackageInput (specifier, cwd) {
  if (!isPackageSpecifier(specifier)) return null

  const packageJsonPath = resolvePackageJsonPath(specifier, cwd)
  if (!packageJsonPath) return null

  return readJseePackageInput(specifier, packageJsonPath)
}

function findPackageRoot (startDir) {
  let dir = path.resolve(startDir)
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir)

  while (true) {
    const packageJsonPath = path.join(dir, 'package.json')
    if (fs.existsSync(packageJsonPath) && fs.statSync(packageJsonPath).isFile()) return dir

    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`No package.json found from ${startDir}`)
    dir = parent
  }
}

function hasArgOption (args, names) {
  return args.some(arg => names.some(name => arg === name || arg.startsWith(name + '=')))
}

async function runPackage (dirname, args=[]) {
  if (!Array.isArray(args)) throw new Error('runPackage args must be an array')

  const packageRoot = findPackageRoot(dirname)
  const packageInput = readJseePackageInput(packageRoot, path.join(packageRoot, 'package.json'))
  const pargv = []

  if (!hasArgOption(args, ['--inputs', '-i'])) {
    pargv.push('--inputs', packageInput.schemaPath)
  }
  if (!hasArgOption(args, ['--description', '-d']) && packageInput.descriptionPath) {
    pargv.push('--description', packageInput.descriptionPath)
  }
  pargv.push(...args)

  if (hasArgOption(args, ['--run'])) {
    return await gen(pargv)
  }

  const previousCwd = process.cwd()
  process.chdir(packageInput.packageRoot)
  try {
    return await gen(pargv)
  } finally {
    process.chdir(previousCwd)
  }
}

function generateIdentitySchema (target, cwd) {
  const resolved = path.isAbsolute(target) ? target : path.join(cwd, target)
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null

  if (stat && stat.isDirectory()) {
    const files = readDirListing(resolved, target)
    // Pre-select the first file
    files.forEach((f, i) => { f.selected = i === 0 })
    return {
      schema: {
        model: {
          name: 'identity',
          type: 'function',
          worker: false,
          autorun: true,
          code: `function identity(inputs) {
  var files = inputs.files || []
  var selected = files.filter(function (f) { return f.selected })
  var stats = { files: inputs.files ? inputs.files.length : 0, totalSize: (inputs.files || []).reduce(function (s, f) { return s + (f.size || 0) }, 0), types: {} }
  ;(inputs.files || []).forEach(function (f) { var t = f.type || 'unknown'; stats.types[t] = (stats.types[t] || 0) + 1 })
  return { stats: stats, viewer: selected.length > 0 ? '/__jsee/file?path=' + encodeURIComponent(selected[0].path) : null }
}`
        },
        inputs: [{
          name: 'files',
          type: 'folder',
          default: files,
          disabled: true,
          reactive: true,
          select: 'one'
        }],
        outputs: [
          { name: 'stats', type: 'object' },
          { name: 'viewer', type: 'viewer' }
        ],
        autorun: true
      },
      identity: true,
      serveDir: resolved
    }
  }

  if (stat && stat.isFile()) {
    const ext = path.extname(target).toLowerCase()
    if (ext === '.json' || ext === '.js') return null
    const outputType = fileExtToOutputType(target)
    return {
      schema: {
        inputs: [],
        outputs: [{ name: path.basename(target), type: outputType }],
        autorun: true
      },
      identity: true,
      serveFile: { path: target, resolved }
    }
  }

  return null
}

function collectFetchBundleBlocks (schema) {
  return []
    .concat(toArray(schema.model))
    .concat(toArray(schema.view))
    .concat(toArray(schema.render))
    .filter(Boolean)
}

function isHttpUrl (value) {
  return /^https?:\/\//i.test(value)
}

function toRuntimeUrl (value) {
  try {
    return (new URL(value)).href
  } catch (error) {
    return (new URL(value, 'https://cdn.jsdelivr.net/npm/')).href
  }
}

function getImportUrlValue (importValue) {
  if (typeof importValue === 'string') return importValue
  if (importValue && typeof importValue === 'object' && typeof importValue.url === 'string') {
    return importValue.url
  }
  return null
}

// Resolve an import path to a local file by checking candidate locations on disk.
// Returns the absolute file path if found, null otherwise.
// This replaces heuristic prefix detection (isLocalJsImport/isLocalCssImport) with
// a definitive filesystem check — no heuristic can reliably distinguish bare-relative
// local paths like "dist/core.js" from npm package subpaths like "chart.js/dist/chart.min.js".
function resolveLocalImportFile (importUrlValue, modelUrl, cwd) {
  if (!importUrlValue || typeof importUrlValue !== 'string') return null
  if (isHttpUrl(importUrlValue)) return null

  const modelDir = modelUrl && !isHttpUrl(modelUrl) ? path.dirname(modelUrl) : '.'
  const candidates = []

  if (importUrlValue.startsWith('./') || importUrlValue.startsWith('../')) {
    // Explicit relative: prefer model-relative (colocated helpers), fallback to cwd
    candidates.push(path.resolve(cwd, path.join(modelDir, importUrlValue)))
    candidates.push(path.resolve(cwd, importUrlValue))
  } else if (importUrlValue.startsWith('/')) {
    // Absolute from project root
    candidates.push(path.resolve(cwd, importUrlValue.slice(1)))
  } else {
    // Bare relative (dist/core.js): prefer cwd (schema-relative), fallback to model-relative
    candidates.push(path.resolve(cwd, importUrlValue))
    candidates.push(path.resolve(cwd, path.join(modelDir, importUrlValue)))
  }

  for (const fp of candidates) {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp
  }
  return null
}

function resolveFetchImport (importValue, modelUrl, cwd) {
  const importUrlValue = getImportUrlValue(importValue)
  if (!importUrlValue) return null
  const importIsObject = importValue && typeof importValue === 'object'

  const localFilePath = resolveLocalImportFile(importUrlValue, modelUrl, cwd)

  if (localFilePath) {
    // Keep the raw import string as the lookup key (importUrl) so that
    // data-src in the bundled HTML matches what the runtime's loadFromDOM
    // will look up before getUrl transforms the path.
    return {
      schemaImport: importUrlValue,
      schemaEntry: importIsObject ? { ...importValue, url: importUrlValue } : importUrlValue,
      importUrl: importUrlValue,
      localFilePath,
      remoteUrl: null
    }
  }

  // Remote: npm package or explicit HTTP URL
  const remoteUrl = isHttpUrl(importUrlValue)
    ? importUrlValue
    : `https://cdn.jsdelivr.net/npm/${importUrlValue}`
  return {
    schemaImport: importUrlValue,
    schemaEntry: importIsObject ? { ...importValue, url: importUrlValue } : importUrlValue,
    importUrl: toRuntimeUrl(importUrlValue),
    localFilePath: null,
    remoteUrl
  }
}

function resolveLocalDirectoryFromBase (baseDir, importUrlValue) {
  if (!importUrlValue || typeof importUrlValue !== 'string') return null
  if (isHttpUrl(importUrlValue)) return null

  const cleanUrl = importUrlValue.split('?')[0].split('#')[0]
  const candidate = cleanUrl.startsWith('/')
    ? path.resolve(baseDir, cleanUrl.slice(1))
    : path.resolve(baseDir, cleanUrl)
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate
  return null
}

function resolveLocalDirectoryForBundle (importUrlValue, modelUrl, cwd) {
  if (!importUrlValue || typeof importUrlValue !== 'string') return null
  if (isHttpUrl(importUrlValue)) return null

  const cleanUrl = importUrlValue.split('?')[0].split('#')[0]
  const modelDir = modelUrl && !isHttpUrl(modelUrl) ? path.dirname(modelUrl) : '.'
  const candidates = []

  if (cleanUrl.startsWith('./') || cleanUrl.startsWith('../')) {
    candidates.push(path.resolve(cwd, path.join(modelDir, cleanUrl)))
    candidates.push(path.resolve(cwd, cleanUrl))
  } else if (cleanUrl.startsWith('/')) {
    candidates.push(path.resolve(cwd, cleanUrl.slice(1)))
  } else {
    candidates.push(path.resolve(cwd, cleanUrl))
    candidates.push(path.resolve(cwd, path.join(modelDir, cleanUrl)))
  }

  for (const fp of candidates) {
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) return fp
  }
  return null
}

function getBundleOutputDirectories (outputs, cwd) {
  const htmlOutputs = toArray(outputs)
    .filter(output => typeof output === 'string' && output !== 'stdout' && output.includes('.html'))

  if (!htmlOutputs.length) return [cwd]

  return [...new Set(htmlOutputs.map(output => path.dirname(resolveOutputPath(cwd, output))))]
}

function resolveBundleMode (fetchValue) {
  if (!fetchValue) return 'none'
  if (fetchValue === true || fetchValue === 'true') return 'default'
  if (fetchValue === 'offline-strict' || fetchValue === 'strict') return 'offline-strict'
  if (fetchValue === 'hybrid') return 'hybrid'
  if (fetchValue === 'pyodide') return 'pyodide'
  if (fetchValue === 'pyodide-single' || fetchValue === 'pyodide-inline' || fetchValue === 'single-pyodide') return 'pyodide-single'
  return 'default'
}

function isOfflineStrictBundleMode (bundleMode) {
  return bundleMode === 'offline-strict'
}

function isPyodideBundleMode (bundleMode) {
  return bundleMode === 'pyodide'
}

function isPyodideSingleFileBundleMode (bundleMode) {
  return bundleMode === 'pyodide-single'
}

function normalizeBundleAssetDirName (value) {
  const text = String(value || '').trim().replace(/[^A-Za-z0-9._-]/g, '-')
  return text.replace(/^-+|-+$/g, '') || 'pyodide'
}

function getAssetDirBaseName (source) {
  if (fs.existsSync(source)) {
    return path.basename(source) || 'pyodide'
  }
  try {
    const parsed = new URL(source)
    const parts = parsed.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] || 'pyodide'
  } catch (error) {
    return path.basename(String(source || '')) || 'pyodide'
  }
}

function createPyodideAssetDirResolver () {
  const sourceToRel = new Map()
  const relToSource = new Map()

  return function getPyodideAssetDir (source) {
    const sourceKey = fs.existsSync(source)
      ? fs.realpathSync(source)
      : String(source)
    if (sourceToRel.has(sourceKey)) return sourceToRel.get(sourceKey)

    const baseName = normalizeBundleAssetDirName(getAssetDirBaseName(source))
    let relDir = `${baseName}/`
    if (relToSource.has(relDir) && relToSource.get(relDir) !== sourceKey) {
      const hash = crypto.createHash('sha256').update(sourceKey).digest('hex').slice(0, 8)
      relDir = `${baseName}-${hash}/`
    }

    sourceToRel.set(sourceKey, relDir)
    relToSource.set(relDir, sourceKey)
    return relDir
  }
}

function normalizeBundleRelativePath (value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Pyodide asset path should be a relative path')
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    throw new Error(`Pyodide asset path should be relative: ${value}`)
  }

  const clean = value.split('?')[0].split('#')[0]
  const normalized = path.posix.normalize(clean.replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.startsWith('/')) {
    throw new Error(`Unsafe Pyodide asset path: ${value}`)
  }
  return normalized
}

function writeBufferToOutputDirs (outputDirs, relPath, buffer) {
  const safeRelPath = normalizeBundleRelativePath(relPath)
  outputDirs.forEach(outputDir => {
    const target = path.join(outputDir, safeRelPath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, buffer)
  })
}

function copyDirectoryContents (sourceDir, destDir) {
  const realSource = fs.realpathSync(sourceDir)
  const resolvedDest = path.resolve(destDir)
  const destRelativeToSource = path.relative(realSource, resolvedDest)

  if (fs.existsSync(resolvedDest)) {
    const realDest = fs.realpathSync(resolvedDest)
    if (realDest === realSource) return
    const realDestRelativeToSource = path.relative(realSource, realDest)
    if (realDestRelativeToSource && !realDestRelativeToSource.startsWith('..') && !path.isAbsolute(realDestRelativeToSource)) {
      throw new Error(`Refusing to copy Pyodide assets into their own source directory: ${destDir}`)
    }
  } else if (destRelativeToSource && !destRelativeToSource.startsWith('..') && !path.isAbsolute(destRelativeToSource)) {
    throw new Error(`Refusing to copy Pyodide assets into their own source directory: ${destDir}`)
  }

  function copyEntry (src, dst) {
    const stat = fs.lstatSync(src)
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to copy symlinked Pyodide asset: ${src}`)
    }
    if (stat.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true })
      for (const entry of fs.readdirSync(src)) {
        copyEntry(path.join(src, entry), path.join(dst, entry))
      }
      return
    }
    if (!stat.isFile()) return

    const realFile = fs.realpathSync(src)
    const rel = path.relative(realSource, realFile)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to copy Pyodide asset outside source directory: ${src}`)
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }

  copyEntry(realSource, destDir)
}

async function readCachedRemoteBuffer (remoteUrl, options={}) {
  const cacheDir = path.join(os.homedir(), '.cache', 'jsee')
  fs.mkdirSync(cacheDir, { recursive: true })

  const hash = crypto.createHash('sha256').update(remoteUrl).digest('hex')
  const cacheFilePath = path.join(cacheDir, `${hash}.bin`)

  if (fs.existsSync(cacheFilePath)) {
    const stats = fs.statSync(cacheFilePath)
    const mtime = new Date(stats.mtime)
    const now = new Date()
    const ageInDays = (now - mtime) / (1000 * 60 * 60 * 24)

    if (ageInDays < 1) {
      return fs.readFileSync(cacheFilePath)
    }
  }

  const response = await fetch(remoteUrl)
  if (!response.ok) {
    if (options.optional && response.status === 404) return null
    throw new Error(`Failed to fetch ${remoteUrl}: ${response.statusText}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(cacheFilePath, bytes)
  return bytes
}

async function readRemoteText (remoteUrl, options={}) {
  const buffer = await readCachedRemoteBuffer(remoteUrl, options)
  return buffer ? buffer.toString('utf8') : null
}

function getRemoteRelativePath (baseUrl, assetUrl) {
  const base = ensureTrailingSlash(baseUrl)
  const full = new URL(assetUrl, base).href
  if (!full.startsWith(base)) {
    throw new Error(`Pyodide asset ${full} is outside indexURL ${base}`)
  }
  return normalizeBundleRelativePath(decodeURIComponent(full.slice(base.length)))
}

function getPyodideCoreAssetNames (loaderRelPath) {
  const names = [
    'pyodide.asm.wasm',
    'python_stdlib.zip',
    'pyodide-lock.json'
  ]
  if (loaderRelPath !== 'pyodide.asm.js') names.push('pyodide.asm.js')
  if (loaderRelPath !== 'pyodide.asm.mjs') names.push('pyodide.asm.mjs')
  return names
}

function isOptionalPyodideCoreAsset (assetName) {
  return assetName === 'pyodide.asm.js' || assetName === 'pyodide.asm.mjs'
}

function getPyodideRequestedPackages (model, pyodideOptions) {
  const packages = new Set()
  if (Array.isArray(pyodideOptions.packages)) {
    pyodideOptions.packages.forEach(name => {
      if (typeof name === 'string' && name.trim()) packages.add(name.trim())
    })
  }

  toArray(model.imports).forEach(imp => {
    const url = getImportUrlValue(imp)
    if (!url || typeof url !== 'string') return
    if (isHttpUrl(url) || url.startsWith('./') || url.startsWith('../') || url.startsWith('/')) return
    if (/\.(js|mjs|css)(\?|#|$)/i.test(url)) return
    packages.add(url)
  })
  return [...packages]
}

function collectPyodidePackageAssets (lockFile, packageNames) {
  if (!packageNames.length) return []
  const packages = lockFile && lockFile.packages
  if (!isRecordObject(packages)) {
    throw new Error('Pyodide lock file does not contain packages')
  }

  const files = []
  const seenPackages = new Set()
  const visit = name => {
    if (seenPackages.has(name)) return
    seenPackages.add(name)

    const pkg = packages[name]
    if (!pkg) {
      throw new Error(`Pyodide lock file does not contain package ${name}`)
    }
    if (pkg.file_name) files.push(normalizeBundleRelativePath(pkg.file_name))
    toArray(pkg.depends).forEach(dep => {
      if (typeof dep === 'string' && dep) visit(dep)
    })
  }

  packageNames.forEach(visit)
  return [...new Set(files)]
}

function getEmbeddedPyodideAssetMime (relPath) {
  const lower = relPath.toLowerCase()
  if (lower.endsWith('.wasm')) return 'application/wasm'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.whl')) return 'application/octet-stream'
  return 'application/octet-stream'
}

function addEmbeddedPyodideAsset (assets, relPath, bytes) {
  const safeRelPath = normalizeBundleRelativePath(relPath)
  assets.set(safeRelPath, {
    mime: getEmbeddedPyodideAssetMime(safeRelPath),
    base64: Buffer.from(bytes).toString('base64')
  })
}

function createEmbeddedPyodideManifest (assetId, assets) {
  const manifestAssets = {}
  Array.from(assets.keys()).sort().forEach(relPath => {
    manifestAssets[relPath] = assets.get(relPath)
  })
  return {
    version: 1,
    baseURL: `jsee-pyodide://${assetId}/`,
    assets: manifestAssets
  }
}

function readLocalPyodideAssetMap (sourceDir) {
  const realSource = fs.realpathSync(sourceDir)
  const assets = new Map()

  function readEntry (src) {
    const stat = fs.lstatSync(src)
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to embed symlinked Pyodide asset: ${src}`)
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(src)) {
        readEntry(path.join(src, entry))
      }
      return
    }
    if (!stat.isFile()) return

    const realFile = fs.realpathSync(src)
    const rel = path.relative(realSource, realFile)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to embed Pyodide asset outside source directory: ${src}`)
    }
    addEmbeddedPyodideAsset(assets, rel.split(path.sep).join('/'), fs.readFileSync(realFile))
  }

  readEntry(realSource)
  return assets
}

function getEmbeddedPyodideAssetId (source, getPyodideAssetDir) {
  return normalizeBundleAssetDirName(getPyodideAssetDir(source).replace(/\/+$/g, ''))
}

async function prepareRemotePyodideAssetsForBundle (model, options, outputDirs, getPyodideAssetDir) {
  const indexURL = ensureTrailingSlash(options.indexURL)
  const loaderUrl = new URL(options.rawUrl, indexURL).href
  const loaderRelPath = getRemoteRelativePath(indexURL, loaderUrl)
  const destIndexURL = getPyodideAssetDir(indexURL)
  const destLoaderURL = destIndexURL + loaderRelPath

  const loaderCode = await readRemoteText(loaderUrl)
  writeBufferToOutputDirs(outputDirs, destLoaderURL, Buffer.from(loaderCode, 'utf8'))

  const coreAssetNames = getPyodideCoreAssetNames(loaderRelPath)
  const lockUrl = new URL('pyodide-lock.json', indexURL).href
  let lockText = null

  for (const assetName of coreAssetNames) {
    const optional = isOptionalPyodideCoreAsset(assetName)
    const remoteUrl = new URL(assetName, indexURL).href
    const bytes = await readCachedRemoteBuffer(remoteUrl, { optional })
    if (!bytes) continue
    if (assetName === 'pyodide-lock.json') lockText = bytes.toString('utf8')
    writeBufferToOutputDirs(outputDirs, destIndexURL + assetName, bytes)
  }

  if (!lockText) {
    lockText = await readRemoteText(lockUrl)
  }
  const requestedPackages = getPyodideRequestedPackages(model, options)
  const lockFile = requestedPackages.length ? JSON.parse(lockText) : null
  const packageAssets = lockFile ? collectPyodidePackageAssets(lockFile, requestedPackages) : []
  for (const packageAsset of packageAssets) {
    const remoteUrl = new URL(packageAsset, indexURL).href
    const bytes = await readCachedRemoteBuffer(remoteUrl)
    writeBufferToOutputDirs(outputDirs, destIndexURL + packageAsset, bytes)
  }

  const nextConfig = isRecordObject(model.pyodide) ? { ...model.pyodide } : {}
  nextConfig.url = destLoaderURL
  nextConfig.indexURL = destIndexURL
  if (options.packages) nextConfig.packages = options.packages
  model.pyodide = nextConfig

  return {
    src: destLoaderURL,
    code: loaderCode,
    remote: true,
    indexURL: destIndexURL
  }
}

async function preparePyodideAssetsForBundle (model, cwd, outputDirs, getPyodideAssetDir) {
  if (!model || model.type !== 'py') return null
  if (typeof model.pyodide === 'undefined') {
    throw new Error('--bundle=pyodide requires explicit model.pyodide')
  }

  const options = normalizePyodideOptions(model)
  if (!options.indexURL) {
    throw new Error(`--bundle=pyodide requires Pyodide indexURL for model ${model.name || '(unnamed)'}`)
  }
  if (isNetworkUrl(options.indexURL)) {
    return await prepareRemotePyodideAssetsForBundle(model, options, outputDirs, getPyodideAssetDir)
  }

  const sourceDir = resolveLocalDirectoryForBundle(options.indexURL, model.url, cwd)
  if (!sourceDir) {
    throw new Error(`--bundle=pyodide could not find local Pyodide indexURL directory: ${options.indexURL}`)
  }

  const loaderPath = resolveLocalImportFile(options.rawUrl, model.url, cwd)
    || path.join(sourceDir, 'pyodide.js')
  if (!fs.existsSync(loaderPath) || !fs.statSync(loaderPath).isFile()) {
    throw new Error(`--bundle=pyodide could not find local Pyodide loader: ${options.rawUrl}`)
  }

  const realSourceDir = fs.realpathSync(sourceDir)
  const realLoaderPath = fs.realpathSync(loaderPath)
  const loaderRelative = path.relative(realSourceDir, realLoaderPath)
  if (loaderRelative.startsWith('..') || path.isAbsolute(loaderRelative)) {
    throw new Error('--bundle=pyodide requires the Pyodide loader to be inside the local indexURL directory')
  }

  const destIndexURL = getPyodideAssetDir(sourceDir)
  const destLoaderURL = destIndexURL + loaderRelative.split(path.sep).join('/')

  outputDirs.forEach(outputDir => {
    copyDirectoryContents(sourceDir, path.join(outputDir, destIndexURL))
  })

  const nextConfig = isRecordObject(model.pyodide) ? { ...model.pyodide } : {}
  nextConfig.url = destLoaderURL
  nextConfig.indexURL = destIndexURL
  model.pyodide = nextConfig

  return {
    src: destLoaderURL,
    code: fs.readFileSync(realLoaderPath, 'utf8'),
    remote: false,
    indexURL: destIndexURL
  }
}

async function readRemotePyodideAssetMap (model, options) {
  const indexURL = ensureTrailingSlash(options.indexURL)
  const loaderUrl = new URL(options.rawUrl, indexURL).href
  const loaderRelPath = getRemoteRelativePath(indexURL, loaderUrl)
  const loaderCode = await readRemoteText(loaderUrl)
  const assets = new Map()

  const coreAssetNames = getPyodideCoreAssetNames(loaderRelPath)
  let lockText = null

  for (const assetName of coreAssetNames) {
    const optional = isOptionalPyodideCoreAsset(assetName)
    const remoteUrl = new URL(assetName, indexURL).href
    const bytes = await readCachedRemoteBuffer(remoteUrl, { optional })
    if (!bytes) continue
    if (assetName === 'pyodide-lock.json') lockText = bytes.toString('utf8')
    addEmbeddedPyodideAsset(assets, assetName, bytes)
  }

  if (!lockText) {
    lockText = await readRemoteText(new URL('pyodide-lock.json', indexURL).href)
    addEmbeddedPyodideAsset(assets, 'pyodide-lock.json', Buffer.from(lockText, 'utf8'))
  }

  const requestedPackages = getPyodideRequestedPackages(model, options)
  const lockFile = requestedPackages.length ? JSON.parse(lockText) : null
  const packageAssets = lockFile ? collectPyodidePackageAssets(lockFile, requestedPackages) : []
  for (const packageAsset of packageAssets) {
    const remoteUrl = new URL(packageAsset, indexURL).href
    const bytes = await readCachedRemoteBuffer(remoteUrl)
    addEmbeddedPyodideAsset(assets, packageAsset, bytes)
  }

  return { loaderCode, assets, source: indexURL }
}

async function preparePyodideSingleFileBundle (model, cwd, getPyodideAssetDir) {
  if (!model || model.type !== 'py') return null
  if (typeof model.pyodide === 'undefined') {
    throw new Error('--bundle=pyodide-single requires explicit model.pyodide')
  }

  const options = normalizePyodideOptions(model)
  if (!options.indexURL) {
    throw new Error(`--bundle=pyodide-single requires Pyodide indexURL for model ${model.name || '(unnamed)'}`)
  }

  let loaderCode
  let assets
  let source

  if (isNetworkUrl(options.indexURL)) {
    const remote = await readRemotePyodideAssetMap(model, options)
    loaderCode = remote.loaderCode
    assets = remote.assets
    source = remote.source
  } else {
    const sourceDir = resolveLocalDirectoryForBundle(options.indexURL, model.url, cwd)
    if (!sourceDir) {
      throw new Error(`--bundle=pyodide-single could not find local Pyodide indexURL directory: ${options.indexURL}`)
    }

    const loaderPath = resolveLocalImportFile(options.rawUrl, model.url, cwd)
      || path.join(sourceDir, 'pyodide.js')
    if (!fs.existsSync(loaderPath) || !fs.statSync(loaderPath).isFile()) {
      throw new Error(`--bundle=pyodide-single could not find local Pyodide loader: ${options.rawUrl}`)
    }

    const realSourceDir = fs.realpathSync(sourceDir)
    const realLoaderPath = fs.realpathSync(loaderPath)
    const loaderRelative = path.relative(realSourceDir, realLoaderPath)
    if (loaderRelative.startsWith('..') || path.isAbsolute(loaderRelative)) {
      throw new Error('--bundle=pyodide-single requires the Pyodide loader to be inside the local indexURL directory')
    }

    loaderCode = fs.readFileSync(realLoaderPath, 'utf8')
    assets = readLocalPyodideAssetMap(sourceDir)
    source = sourceDir
  }

  const assetId = getEmbeddedPyodideAssetId(source, getPyodideAssetDir)
  const manifestSrc = `jsee:pyodide-assets:${assetId}`
  const manifest = createEmbeddedPyodideManifest(assetId, assets)

  const nextConfig = isRecordObject(model.pyodide) ? { ...model.pyodide } : {}
  nextConfig.url = options.rawUrl
  nextConfig.indexURL = manifest.baseURL
  nextConfig.assets = {
    type: 'embedded',
    manifest: manifestSrc
  }
  if (options.packages) nextConfig.packages = options.packages
  model.pyodide = nextConfig

  return {
    src: options.rawUrl,
    code: loaderCode,
    embedded: true,
    indexURL: manifest.baseURL,
    manifestSrc,
    manifest
  }
}

function assertOfflineStrictPyodide (model, cwd, outputDirs=[cwd]) {
  if (typeof model.pyodide === 'undefined') {
    throw new Error(`offline-strict bundle cannot include Pyodide model ${model.name || '(unnamed)'}: requires explicit model.pyodide with a bundled loader and local indexURL`)
  }

  const options = normalizePyodideOptions(model)
  if (!options.indexURL) {
    throw new Error(`offline-strict bundle cannot include Pyodide model ${model.name || '(unnamed)'}: model.pyodide.indexURL is required`)
  }
  if (isNetworkUrl(options.indexURL)) {
    throw new Error(`offline-strict bundle cannot include Pyodide model ${model.name || '(unnamed)'}: Pyodide indexURL remains remote (${options.indexURL})`)
  }
  const hasOutputRelativeIndexDir = outputDirs.some(outputDir =>
    resolveLocalDirectoryFromBase(outputDir, options.indexURL)
  )
  if (!hasOutputRelativeIndexDir) {
    throw new Error(`offline-strict bundle cannot include Pyodide model ${model.name || '(unnamed)'}: local Pyodide indexURL directory not found relative to the generated HTML (${options.indexURL})`)
  }
}

function assertOfflineStrictModel (model, cwd, outputDirs=[cwd]) {
  if (!model) return
  if (model.type === 'get' || model.type === 'post') {
    throw new Error(`offline-strict bundle cannot include ${model.type} model ${model.name || model.url || '(unnamed)'} because it requires an API request at runtime`)
  }
  if (model.url && isHttpUrl(model.url)) {
    throw new Error(`offline-strict bundle cannot include remote model URL ${model.url}`)
  }
  if (model.type === 'py') {
    assertOfflineStrictPyodide(model, cwd, outputDirs)
  }
}

function readCachedRemoteText (remoteUrl) {
  return (async () => {
    const cacheDir = path.join(os.homedir(), '.cache', 'jsee')
    fs.mkdirSync(cacheDir, { recursive: true })

    const hash = crypto.createHash('sha256').update(remoteUrl).digest('hex')
    const cacheFilePath = path.join(cacheDir, `${hash}.js`)

    if (fs.existsSync(cacheFilePath)) {
      const stats = fs.statSync(cacheFilePath)
      const mtime = new Date(stats.mtime)
      const now = new Date()
      const ageInDays = (now - mtime) / (1000 * 60 * 60 * 24)

      if (ageInDays < 1) {
        return fs.readFileSync(cacheFilePath, 'utf8')
      }
    }

    const response = await fetch(remoteUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${remoteUrl}: ${response.statusText}`)
    }
    const code = await response.text()
    fs.writeFileSync(cacheFilePath, code)
    return code
  })()
}

async function readPyodideRuntimeForBundle (model, cwd) {
  if (!model || model.type !== 'py' || typeof model.pyodide === 'undefined') {
    return null
  }
  const options = normalizePyodideOptions(model)
  const localFilePath = resolveLocalImportFile(options.rawUrl, model.url, cwd)
  if (localFilePath) {
    return {
      src: options.rawUrl,
      code: fs.readFileSync(localFilePath, 'utf8'),
      remote: false,
      indexURL: options.indexURL
    }
  }

  const remoteUrl = isNetworkUrl(options.rawUrl)
    ? options.rawUrl
    : toRuntimeUrl(options.rawUrl)
  const code = await readCachedRemoteText(remoteUrl, 'Pyodide runtime')
  return {
    src: options.rawUrl,
    code,
    remote: true,
    indexURL: options.indexURL
  }
}

function resolveRuntimeMode (runtime, fetchEnabled, outputs) {
  const requestedRuntime = runtime || 'auto'
  const availableModes = ['auto', 'local', 'cdn', 'inline']
  if (!availableModes.includes(requestedRuntime)) {
    return requestedRuntime // custom URL/path passthrough
  }
  if (requestedRuntime !== 'auto') {
    return requestedRuntime
  }
  if (fetchEnabled) {
    return 'inline'
  }
  return outputs ? 'cdn' : 'local'
}

function resolveOutputPath (cwd, outputPath) {
  if (path.isAbsolute(outputPath)) {
    return outputPath
  }
  return path.join(cwd, outputPath)
}

function writeOutputFile (cwd, outputPath, content) {
  const resolved = resolveOutputPath(cwd, outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, content)
}

// Run mode helpers
function getSchemaInputDefaults (schema) {
  return collectInputValues(schema.inputs, getInputDefaultValue)
}

function loadBrowserStyleModelFunction (src, model, modelPath) {
  const modelName = getModelExportName(model)
  const localRequire = modelPath
    ? Module.createRequire(modelPath)
    : require
  const moduleShim = { exports: {} }
  const dirname = modelPath ? path.dirname(modelPath) : process.cwd()
  const filename = modelPath || path.join(dirname, '__jsee_model__.js')

  const fn = new Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    `${src}
return typeof ${toJsIdentifier(modelName)} === 'function' ? ${toJsIdentifier(modelName)} : (module.exports && (module.exports.default || module.exports[${JSON.stringify(modelName)}] || module.exports))`
  )
  const target = fn(localRequire, moduleShim, moduleShim.exports, filename, dirname)
  if (typeof target === 'function') return target
  if (target && typeof target === 'object') {
    if (typeof target[modelName] === 'function') return target[modelName]
    if (typeof target.default === 'function') return target.default
  }
  return target
}

function resolveExportedTarget (target, model) {
  const modelName = getModelExportName(model)
  if (typeof target === 'function') return target
  if (target && typeof target === 'object') {
    if (typeof target[modelName] === 'function') return target[modelName]
    if (typeof target.default === 'function') return target.default
  }
  return target
}

async function loadCliModelFunction (model, schemaPath, cwd, log, inputs) {
  if (model.type === 'get' || model.type === 'post') {
    throw new Error(`--run cannot execute remote ${model.type.toUpperCase()} model ${model.name || model.url}. Use a local JavaScript model.`)
  }
  if (model.type === 'py') {
    throw new Error('--run currently supports local JavaScript models. Python model execution is available through the dev server/API path.')
  }

  let target
  let modelPath = null

  if (typeof model.code === 'function') {
    target = model.code
  } else if (typeof model.code === 'string' && model.code.trim()) {
    try {
      target = loadBrowserStyleModelFunction(model.code, model, null)
    } catch (error) {
      target = undefined
    }
    if (typeof target !== 'function') {
      try {
        target = new Function(`return (${model.code})`)()
      } catch (error) {
        // Keep the clearer error below.
      }
    }
  } else if (model.url && !isHttpUrl(model.url)) {
    modelPath = path.resolve(schemaPath ? path.dirname(schemaPath) : cwd, model.url)
    target = resolveExportedTarget(require(modelPath), model)
    if (typeof target !== 'function' && (!target || Object.keys(target).length === 0)) {
      const src = fs.readFileSync(modelPath, 'utf-8')
      target = loadBrowserStyleModelFunction(src, model, modelPath)
    }
  } else {
    throw new Error(`--run requires local model code or a local model url for ${model.name || 'model'}`)
  }

  target = resolveExportedTarget(target, model)
  if (typeof target !== 'function') {
    throw new Error(`Could not load a callable function for model ${model.name || model.url || 'model'}`)
  }

  return getModelFuncJS(model, target, {
    log,
    progress: () => {},
    isCancelled: () => false
  }, Array.isArray(inputs) ? Object.keys(collectInputValues(inputs, () => null)) : undefined)
}

async function runSchemaOnce (schema, data, schemaPath, cwd=process.cwd(), log=() => {}) {
  assertSchemaVersion(schema)
  const inputs = prepareInputs(schema.inputs, data)
  const models = Array.isArray(schema.model) ? schema.model : [schema.model]
  const stages = models.map(model => async values => {
    const modelFunc = await loadCliModelFunction(model, schemaPath, cwd, log, schema.inputs)
    return modelFunc(values)
  })
  return runPipeline(stages, inputs)
}

async function invokeSchema (schema, data, { schemaPath, cwd=process.cwd(), log=() => {}, _modelFunctions }={}) {
  const runId = crypto.randomUUID()
  let code = 'JSEE_SCHEMA_INVALID'
  try {
    if (!isRecordObject(schema)) throw new Error('Schema should be an object')
    assertSchemaVersion(schema)
    const models = Array.isArray(schema.model) ? schema.model : [schema.model]
    if (!models.length || models.some(model => !isRecordObject(model))) {
      throw new Error('Schema should define one or more model objects')
    }
    if (schema.inputs !== undefined && !Array.isArray(schema.inputs)) throw new Error('inputs should be an array')
    code = 'JSEE_INPUT_INVALID'
    // Validate before imports/initializers can have effects. Models own a copy of JSON input containers.
    const inputs = prepareInputs(schema.inputs, cloneSchema(data))
    code = 'JSEE_CAPABILITY_UNSUPPORTED'
    const unsupported = invocationUnsupportedReason(schema)
    if (unsupported) throw new Error(unsupported)
    code = 'JSEE_EXECUTION_FAILED'
    // Both entry points use the same loader and transitions; terminal calls cannot leave a stream open.
    const stages = models.map(model => async values => {
      const func = _modelFunctions ? _modelFunctions[model.name] : await loadCliModelFunction(model, schemaPath, cwd, log, schema.inputs)
      const result = await func(values)
      if (isStreamResult(result)) {
        if (typeof result.return === 'function') await result.return()
        code = 'JSEE_CAPABILITY_UNSUPPORTED'
        throw new Error('Streaming results require a streaming invocation interface')
      }
      return result
    })
    const result = await runPipeline(stages, inputs)
    return { runId, status: 'succeeded', result }
  } catch (error) {
    return { runId, status: 'failed', error: { code, message: error instanceof Error ? error.message : String(error) } }
  }
}

function flattenOutputs (outputs, flat=[]) {
  if (!Array.isArray(outputs)) return flat
  outputs.forEach(output => {
    if (output && output.type === 'group' && Array.isArray(output.elements)) {
      flattenOutputs(output.elements, flat)
    } else if (output) {
      flat.push(output)
    }
  })
  return flat
}

function getRunOutputValue (result, output) {
  if (!isRecordObject(result)) return result
  for (const name of outputLookupNames(output)) {
    if (name && Object.prototype.hasOwnProperty.call(result, name)) return result[name]
  }
  if (Object.prototype.hasOwnProperty.call(output, 'value')) return output.value
  return undefined
}

function getRunOutputEntries (schema, result) {
  const cleanResult = cleanOutputMetadata(result, schema.outputs)
  const outputs = flattenOutputs(schema.outputs || [])
  if (outputs.length) {
    return outputs.map((output, index) => {
      let value = getRunOutputValue(cleanResult, output)
      if (typeof value === 'undefined' && outputs.length === 1 && !isRecordObject(cleanResult)) value = cleanResult
      return {
        output,
        name: output.name || `output_${index + 1}`,
        value
      }
    }).filter(entry => typeof entry.value !== 'undefined')
  }

  if (isRecordObject(cleanResult)) {
    return Object.keys(cleanResult).map(key => ({
      output: { name: key, type: typeof cleanResult[key] },
      name: key,
      value: cleanResult[key]
    }))
  }

  return [{
    output: { name: 'result', type: typeof cleanResult },
    name: 'result',
    value: cleanResult
  }]
}

function getRunFileDescriptor (output, value) {
  if (output.type !== 'file') {
    return { value, filename: output.filename || output.name, mime: output.mime || output.contentType }
  }
  return normalizeFileOutputValue(output, value)
}

function extensionFromMime (mime) {
  if (!mime || typeof mime !== 'string') return null
  const clean = mime.split(';')[0].trim().toLowerCase()
  const map = {
    'text/csv': '.csv',
    'text/plain': '.txt',
    'text/markdown': '.md',
    'text/html': '.html',
    'application/json': '.json',
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/svg+xml': '.svg'
  }
  return map[clean] || null
}

function extensionForRunOutput (output, value, descriptor) {
  if (descriptor && descriptor.filename && path.extname(descriptor.filename)) return path.extname(descriptor.filename)
  if (descriptor && descriptor.mime) {
    const mimeExt = extensionFromMime(descriptor.mime)
    if (mimeExt) return mimeExt
  }

  switch ((output.type || '').toLowerCase()) {
    case 'file':
      return '.txt'
    case 'markdown':
      return '.md'
    case 'html':
      return '.html'
    case 'code':
    case 'text':
    case 'string':
    case 'chat':
      return '.txt'
    case 'image':
      return '.png'
    case 'pdf':
      return '.pdf'
    default:
      return '.json'
  }
}

function getRunOutputFilename (entry) {
  const descriptor = getRunFileDescriptor(entry.output, entry.value)
  const base = descriptor.filename
    ? path.basename(String(descriptor.filename))
    : sanitizeName(entry.name || 'output')
  if (path.extname(base)) return base
  return base + extensionForRunOutput(entry.output, descriptor.value, descriptor)
}

function formatRunOutputContent (entry, forStdout=false) {
  const descriptor = getRunFileDescriptor(entry.output, entry.value)
  const value = descriptor.value
  const type = (entry.output.type || '').toLowerCase()

  if (Buffer.isBuffer(value)) return { content: value, addNewline: false }
  if (value instanceof Uint8Array) return { content: Buffer.from(value), addNewline: false }

  if (type === 'file') {
    if (isRecordObject(value) || Array.isArray(value)) {
      return { content: JSON.stringify(value, null, 2), addNewline: true }
    }
    return { content: typeof value === 'undefined' || value === null ? '' : String(value), addNewline: false }
  }

  if (['text', 'string', 'code', 'markdown', 'html', 'chat'].includes(type)) {
    if (isRecordObject(value) || Array.isArray(value)) {
      return { content: JSON.stringify(value, null, 2), addNewline: true }
    }
    return { content: typeof value === 'undefined' || value === null ? '' : String(value), addNewline: true }
  }

  if (typeof value === 'string' && forStdout && !['table', 'object', 'array', 'json'].includes(type)) {
    return { content: value, addNewline: true }
  }

  return { content: JSON.stringify(value, null, 2), addNewline: true }
}

function writeRunContent (target, formatted) {
  let content = formatted.content
  if (typeof content === 'string' && formatted.addNewline && !content.endsWith('\n')) content += '\n'
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function writeRunStdout (formatted) {
  let content = formatted.content
  if (typeof content === 'string' && formatted.addNewline && !content.endsWith('\n')) content += '\n'
  process.stdout.write(content)
}

function getRunOutputsDirectory (outputs, cwd) {
  if (!outputs) return null
  const value = Array.isArray(outputs) ? outputs[0] : outputs
  if (value === true || typeof value !== 'string') {
    throw new Error('--outputs in --run mode expects a directory path')
  }
  return resolveOutputPath(cwd, value)
}

function getRunOutputTarget (entry, argv, inputNames, cwd) {
  const outputName = sanitizeName(entry.name)
  const explicitKey = `output-${outputName}`
  let value
  if (Object.prototype.hasOwnProperty.call(argv, explicitKey)) {
    value = argv[explicitKey]
  } else if (!inputNames.has(outputName) && Object.prototype.hasOwnProperty.call(argv, outputName)) {
    value = argv[outputName]
  }
  if (typeof value === 'undefined') return null
  if (value === true || typeof value !== 'string') {
    throw new Error(`Output target --${outputName} requires a file path`)
  }
  return resolveOutputPath(cwd, value)
}

function emitRunOutputs (schema, result, argv, outputs, cwd) {
  const entries = getRunOutputEntries(schema, result)
  const inputNames = new Set(Object.keys(collectInputValues(schema.inputs, () => null)).map(sanitizeName))
  const outputDir = getRunOutputsDirectory(outputs, cwd)
  const targets = new Map()

  entries.forEach(entry => {
    const target = getRunOutputTarget(entry, argv, inputNames, cwd)
    if (target) targets.set(entry.name, target)
  })

  if (outputDir) {
    fs.mkdirSync(outputDir, { recursive: true })
    entries.forEach(entry => {
      const target = targets.get(entry.name) || path.join(outputDir, getRunOutputFilename(entry))
      writeRunContent(target, formatRunOutputContent(entry))
    })
    return
  }

  if (targets.size) {
    entries.forEach(entry => {
      const target = targets.get(entry.name)
      if (target) writeRunContent(target, formatRunOutputContent(entry))
    })
    return
  }

  if (entries.length === 1) {
    writeRunStdout(formatRunOutputContent(entries[0], true))
    return
  }

  const resultObject = {}
  entries.forEach(entry => {
    resultObject[entry.name] = entry.value
  })
  writeRunStdout({ content: JSON.stringify(resultObject, null, 2), addNewline: true })
}

let optionalEsbuild
function getOptionalEsbuild () {
  if (optionalEsbuild) return optionalEsbuild
  try {
    optionalEsbuild = require('esbuild')
    return optionalEsbuild
  } catch (error) {
    throw new Error('Bundling model dependencies requires optional dependency esbuild. Run `npm install esbuild` or use schema imports/prebundled browser code.')
  }
}

function isJsIdentifier (value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
}

function toJsIdentifier (value, fallback='model') {
  const raw = value ? String(value) : fallback
  const clean = raw.replace(/[^A-Za-z0-9_$]/g, '_')
  if (!clean) return fallback
  return /^[A-Za-z_$]/.test(clean) ? clean : '_' + clean
}

function getModelExportName (model) {
  if (model.name) return model.name
  if (model.url) return path.basename(model.url).replace(/\.[^.]+$/, '')
  return 'model'
}

function hasCommonJsExport (code) {
  return /\bmodule\s*\.\s*exports\b|\bexports\s*\.\s*[A-Za-z_$]/.test(code)
}

function hasEsModuleExport (code) {
  return /^\s*export\s+(?:default|function|class|const|let|var|\{)/m.test(code)
}

function hasStaticImport (code) {
  return /^\s*import\s+(?!\()/m.test(code)
}

function hasRequireCall (code) {
  return /\brequire\s*\(/.test(code)
}

function shouldBundleModelCode (code) {
  return hasRequireCall(code) || hasStaticImport(code) || hasCommonJsExport(code) || hasEsModuleExport(code)
}

function buildBundledModelExposeCode (bundleGlobalName, modelName) {
  return `
;(function () {
  var mod = ${bundleGlobalName}
  var target = mod
  if (mod && (typeof mod === 'object')) {
    if (typeof mod[${JSON.stringify(modelName)}] !== 'undefined') {
      target = mod[${JSON.stringify(modelName)}]
    } else if (typeof mod.default !== 'undefined') {
      target = mod.default
    }
  }
  globalThis[${JSON.stringify(modelName)}] = target
})()
`
}


function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readPackageJsonForFile (filePath) {
  try {
    const packageRoot = findPackageRoot(filePath)
    const packageJsonPath = path.join(packageRoot, 'package.json')
    return {
      packageRoot,
      packageJson: JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    }
  } catch (error) {
    return null
  }
}

function createEmptyModulePlugin (specifiers) {
  const list = Array.from(new Set(specifiers.filter(Boolean)))
  if (!list.length) return null
  const filter = new RegExp(`^(?:${list.map(escapeRegExp).join('|')})$`)
  return {
    name: 'jsee-empty-browser-modules',
    setup (build) {
      build.onResolve({ filter }, args => ({ path: args.path, namespace: 'jsee-empty' }))
      build.onLoad({ filter: /.*/, namespace: 'jsee-empty' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
    }
  }
}

function getBrowserFieldEsbuildOptions (modelPath) {
  const packageInfo = readPackageJsonForFile(modelPath)
  if (!packageInfo) return {}

  const browser = packageInfo.packageJson.browser
  if (!browser || typeof browser !== 'object' || Array.isArray(browser)) {
    return { absWorkingDir: packageInfo.packageRoot }
  }

  const alias = {}
  const empty = []
  Object.entries(browser).forEach(([key, value]) => {
    if (!key || key.startsWith('.') || key.startsWith('/')) return
    if (value === false) empty.push(key)
    else if (typeof value === 'string' && value.length) alias[key] = value
  })

  const plugins = []
  const emptyPlugin = createEmptyModulePlugin(empty)
  if (emptyPlugin) plugins.push(emptyPlugin)

  const options = { absWorkingDir: packageInfo.packageRoot }
  if (Object.keys(alias).length) options.alias = alias
  if (plugins.length) options.plugins = plugins
  return options
}

async function bundleModelCode (model, modelPath, code, exportNames=[getModelExportName(model)]) {
  if (!shouldBundleModelCode(code)) return code

  const esbuild = getOptionalEsbuild()
  const modelName = getModelExportName(model)
  const bundleGlobalName = `__jsee_bundle_${toJsIdentifier(modelName)}`
  const needsExportShim = modelName &&
    !hasCommonJsExport(code) &&
    !hasEsModuleExport(code) &&
    (hasRequireCall(code) || hasStaticImport(code))

  if (needsExportShim && exportNames.some(name => !isJsIdentifier(name))) {
    throw new Error(`Bundling ${model.url || modelPath} requires a valid JavaScript model name or an explicit module export.`)
  }

  const options = Object.assign({
    // esbuild's service outlives calls and may retain a working directory that has been removed.
    absWorkingDir: path.dirname(modelPath),
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: bundleGlobalName,
    logLevel: 'silent'
  }, getBrowserFieldEsbuildOptions(modelPath))

  if (needsExportShim) {
    options.stdin = {
      contents: `${code}\nexport { ${exportNames.join(', ')} }\n`,
      resolveDir: path.dirname(modelPath),
      sourcefile: path.basename(modelPath),
      loader: 'js'
    }
  } else {
    options.entryPoints = [modelPath]
  }

  try {
    const result = await esbuild.build(options)
    return result.outputFiles[0].text + exportNames.map(name => buildBundledModelExposeCode(bundleGlobalName, name)).join('')
  } catch (error) {
    throw new Error(`Failed to bundle ${model.url || modelPath}: ${error.message}`)
  }
}

const FULL_BUNDLE_TYPES = ['chart', '3d', 'map']

function needsFullBundle (schema) {
  const outputs = schema.outputs || []
  const check = (list) => list.some(o => {
    if (FULL_BUNDLE_TYPES.includes(o.type)) return true
    if (o.type === 'group' && o.elements) return check(o.elements)
    return false
  })
  return check(outputs)
}

function getBundleFilename (schema) {
  return needsFullBundle(schema) ? 'jsee.full.js' : 'jsee.core.js'
}

async function loadRuntimeCode (version, schema) {
  const bundle = schema ? getBundleFilename(schema) : 'jsee.core.js'
  if (version === 'dev' || version === 'latest') {
    const filePath = path.join(__dirname, '..', 'dist', bundle)
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8')
    }
    return fs.readFileSync(path.join(__dirname, '..', 'dist', 'jsee.core.js'), 'utf8')
  }
  const response = await fetch(`https://cdn.jsdelivr.net/npm/@jseeio/jsee@${version}/dist/${bundle}`)
  return response.text()
}

function getDataFromArgv (schema, argv, loadFiles=true) {
  let data = {}
  if (schema.inputs) {
    schema.inputs.forEach(inp => {
      if (inp.type === 'group' && !inp.name) {
        Object.assign(data, getDataFromArgv({ inputs: inp.elements }, argv, loadFiles))
        return
      }
      if (!inp.name) return
      const inputName = sanitizeName(inp.name)
      if (inputName in argv) {
        switch (inp.type) {
          case 'file':
            if (!loadFiles) {
              // If we don't want to load files, just set the value to the file path
              data[inp.name] = argv[inputName]
              break
            } else if (fs.existsSync(argv[inputName])) {
              data[inp.name] = fs.readFileSync(argv[inputName], 'utf8')
            } else {
              console.error(`File not found: ${argv[inputName]}`)
              process.exit(1)
            }
            break
          case 'folder':
            if (!loadFiles) {
              data[inp.name] = argv[inputName]
              break
            }
            const dirPath = argv[inputName]
            const resolved = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath)
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
              data[inp.name] = readDirListing(resolved, dirPath)
            }
            break
          case 'int':
            data[inp.name] = parseInt(argv[inputName], 10)
            break
          case 'float':
            data[inp.name] = parseFloat(argv[inputName])
            break
          case 'string':
          default:
            data[inp.name] = argv[inputName]
        }
      }
    })
  }
  return data
}

function genSchema (jsdocData) {
  let schema = {
    model: [],
    inputs: [],
    outputs: [],
  }
  for (let d of jsdocData) {
    const model = {
      name: d.name ? d.name : d.meta.filename.split('.')[0],
      description: d.description ? d.description : '',
      type: d.kind,
      container: 'args',
      url: path.relative(process.cwd(), path.join(d.meta.path, d.meta.filename)),
      worker: false
    }
    if (d.requires) {
      model.imports = d.requires.map(r => r.replace('module:', ''))
    }
    if (d.params) {
      // Check if all params have the same name before '.'
      const names = new Set(d.params.map(p => p.name.split('.')[0]))
      if ((d.params.length > 1) && (names.size === 1)) {
        // Object
        model.container = 'object'
        d.params.slice(1).forEach(p => {
          const inp = {
            name: p.name.split('.')[1],
            type: p.type.names[0],
            description: p.description,
          }
          if (p.defaultvalue) {
            inp.default = p.defaultvalue
          }
          schema.inputs.push(inp)
        })
      } else {
        // Array
        model.container = 'args'
        d.params.forEach(p => {
          const inp = {
            name: p.name,
            type: p.type.names[0],
            description: p.description,
          }
          if (p.defaultvalue) {
            inp.default = p.defaultvalue
          }
          schema.inputs.push(inp)
        })
      }
    }
    if (d.returns) {
      d.returns.forEach(r => {
        r.name = r.name ? r.name : r.description.split('-')[0].trim()
        r.description = r.description.split('-').slice(1).join('-').trim()
      })
      const names = new Set(d.returns.map(r => r.name.split('.')[0]))
      if ((d.returns.length > 1) && (names.size === 1)) {
        // Object
        d.returns.slice(1).forEach(p => {
          const out = {
            name: p.name.split('.')[1],
            type: p.type.names[0],
            description: p.description,
          }
          schema.outputs.push(out)
        })
      } else {
        // Array
        d.returns.forEach(p => {
          const out = {
            name: p.name,
            type: p.type.names[0],
            description: p.description,
          }
          schema.outputs.push(out)
        })
      }
    }
    if (d.customTags) {
      d.customTags.forEach(t => {
        if (t.tag === 'worker') {
          model.worker = true
        }
      })
    }
    schema.model.push(model)
  }
  return schema
}

function genHtmlFromSchema (schema) {
  let htmlDescription = '<br><div class="schema-description">'

  // Process the model section
  if (schema.model && schema.model.length > 0) {
    schema.model.forEach(model => {
      htmlDescription += `<h3><strong>${escapeHtml(model.name)}</strong></h3>`
      if (model.description) {
        htmlDescription += `<p>${escapeHtml(model.description)}</p>`
      }
    })
  }

  // Process the inputs section
  if (schema.inputs && schema.inputs.length > 0) {
    htmlDescription += '<h4>Inputs</h4><ul>'
    schema.inputs.forEach(input => {
      htmlDescription += `<li><strong>${escapeHtml(input.name)}</strong> (${escapeHtml(input.type)})`
      if (input.description) {
        htmlDescription += ` - ${escapeHtml(input.description)}`
      }
      htmlDescription += '</li>'
    })
    htmlDescription += '</ul>'
  }

  // Process the outputs section
  if (schema.outputs && schema.outputs.length > 0) {
    htmlDescription += '<h4>Outputs</h4><ul>'
    schema.outputs.forEach(output => {
      htmlDescription += `<li><strong>${escapeHtml(output.name)}</strong> (${escapeHtml(output.type)})`
      if (output.description) {
        htmlDescription += ` - ${escapeHtml(output.description)}`
      }
      htmlDescription += '</li>'
    })
    htmlDescription += '</ul>'
  }
  htmlDescription += '</div>'
  return htmlDescription
}

function genMarkdownFromSchema (schema) {
  let markdownDescription = ''

  // Process the model section
  if (schema.model && schema.model.length > 0) {
    schema.model.forEach(model => {
      markdownDescription += `### **${model.name}**\n`
      if (model.description) {
        markdownDescription += `${model.description}\n\n`
      }
    })
  }

  // Process the inputs section
  if (schema.inputs && schema.inputs.length > 0) {
    markdownDescription += '#### Inputs\n'
    schema.inputs.forEach(input => {
      markdownDescription += `- **${input.name}** (${input.type})`
      if (input.description) {
        markdownDescription += ` - ${input.description}`
      }
      markdownDescription += '\n'
    })
  }

  // Process the outputs section
  if (schema.outputs && schema.outputs.length > 0) {
    markdownDescription += '#### Outputs\n'
    schema.outputs.forEach(output => {
      markdownDescription += `- **${output.name}** (${output.type})`
      if (output.description) {
        markdownDescription += ` - ${output.description}`
      }
      markdownDescription += '\n'
    })
  }

  return markdownDescription
}

function template(schema, blocks) {
  let title = 'jsee'
  // let url = schema.page && schema.page.url ? schema.page.url : ''
  let url = ('page' in schema && 'url' in schema.page) ? schema.page.url : ''
  if (schema.title) {
    title = schema.title
  } else if (schema.page && schema.page.title) {
    title = schema.page.title
  } else if (schema.model) {
    if (Array.isArray(schema.model) && schema.model.length > 0) {
      title = schema.model[0].name
    } else if (!Array.isArray(schema.model)) {
      title = schema.model.name
    }
  }
  const safeTitle = escapeHtml(title)
  const attrTitle = escapeAttr(title)
  const safeDescription = escapeAttr(blocks.descriptionTxt)
  const safeUrl = sanitizeUrl(url)
  const attrUrl = escapeAttr(safeUrl)
  const ldJson = safeJsonForScript({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    headline: title,
    name: title,
    url: safeUrl,
    description: blocks.descriptionTxt
  })

  return `<!DOCTYPE html>

<!-- Generated by JSEE (https://jsee.org) -->
<!-- Do not edit this file directly. Edit the source files and run jsee to generate this file. -->
<!-- License: MIT (https://opensource.org/licenses/MIT) -->

<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">

  <!-- Open Graph -->
  <meta property="og:title" content="${attrTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:url" content="${attrUrl}" />
  <meta property="og:site_name" content="${attrTitle}" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${attrTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />

  <!-- Structured Data -->
  <script type="application/ld+json">${ldJson}</script>

  <!-- Canonical Link -->
  <link rel="canonical" href="${attrUrl}" />

  <!-- Favicon -->
  <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAD9/f0AAAAAAPj4+AAMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAAAAABERAAAAAAAAEREAAAAAAAAREQABERESABERAAETMzAAEREAARAAAAAREQABEAAAABERAAEQARAAEREAARABEAAREQABEAAAABERAAEQAAAAEREAAREREAAREQABEREQABERAAAAAAAAEREAAAAAAAAREQAAAAAAABHAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAA" rel="icon" type="image/x-icon" />

  <!-- Styles -->
  <style>
    /** Main */
    html { font-size: 16px; }
    body, h1, h2, h3, h4, h5, h6, p, blockquote, pre, hr, dl, dd, ol, ul, figure { margin: 0; padding: 0; }
    body { font: 400 16px/1.5 -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", "Segoe UI Symbol", "Segoe UI Emoji", "Apple Color Emoji", Roboto, Helvetica, Arial, sans-serif; color: #111111; background-color: #fdfdfd; -webkit-text-size-adjust: 100%; -webkit-font-feature-settings: "kern" 1; -moz-font-feature-settings: "kern" 1; -o-font-feature-settings: "kern" 1; font-feature-settings: "kern" 1; font-kerning: normal; display: flex; min-height: 100vh; flex-direction: column; overflow-wrap: break-word; }
    h1, h2, h3, h4, h5, h6, p, blockquote, pre, ul, ol, dl, figure, .highlight { margin-bottom: 15px; }
    hr { margin-top: 30px; margin-bottom: 30px; border: 0; border-top: 1px solid #ececec; }
    main { display: block; /* Default value of display of main element is 'inline' in IE 11. */ }
    img { max-width: 100%; vertical-align: middle; }
    figure > img { display: block; }
    figcaption { font-size: 14px; }
    ul, ol { margin-left: 30px; }
    li > ul, li > ol { margin-bottom: 0; }
    h1, h2, h3, h4, h5, h6 { font-weight: 400; }
    a { color: #2a7ae2; text-decoration: none; }
    a:visited { color: #1756a9; }
    a:hover { color: #111111; text-decoration: underline; }
    .social-media-list a:hover, .pagination a:hover { text-decoration: none; }
    .social-media-list a:hover .username, .pagination a:hover .username { text-decoration: underline; }
    blockquote { color: #828282; border-left: 4px solid #e8e8e8; padding-left: 15px; font-size: 1.125rem; font-style: italic; }
    blockquote > :last-child { margin-bottom: 0; }
    blockquote i, blockquote em { font-style: normal; }
    pre, code { font-family: "Menlo", "Inconsolata", "Consolas", "Roboto Mono", "Ubuntu Mono", "Liberation Mono", "Courier New", monospace; font-size: 0.9375em; border: 1px solid #e8e8e8; border-radius: 3px; background-color: #eeeeff; }
    code { padding: 1px 5px; }
    pre { padding: 8px 12px; overflow-x: auto; }
    pre > code { border: 0; padding-right: 0; padding-left: 0; }
    .wrapper { max-width: calc(800px - (30px)); margin-right: auto; margin-left: auto; padding-right: 15px; padding-left: 15px; }
    @media screen and (min-width: 800px) { .wrapper { max-width: calc(1024px - (30px * 2)); padding-right: 30px; padding-left: 30px; } }
    .wrapper:after { content: ""; display: table; clear: both; }
    .orange { color: #f66a0a; }
    .grey { color: #828282; }
    .svg-icon { width: 16px; height: 16px; display: inline-block; fill: currentColor; padding: 5px 3px 2px 5px; vertical-align: text-bottom; }
    table { margin-bottom: 30px; width: 100%; text-align: left; color: #3f3f3f; border-collapse: collapse; border: 1px solid #e8e8e8; }
    table tr:nth-child(even) { background-color: #f7f7f7; }
    table th, table td { padding: 10px 15px; }
    table th { background-color: #f0f0f0; border: 1px solid #e0e0e0; }
    table td { border: 1px solid #e8e8e8; }
    @media screen and (max-width: 800px) { table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; -ms-overflow-style: -ms-autohiding-scrollbar; } }
    .site-header { border-bottom: 1px solid #e8e8e8; min-height: 55.95px; position: relative; }
    .site-header .wrapper { min-height: 54px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .site-header .wrapper:after { content: none; }
    .site-title { font-size: 1.625rem; font-weight: 800; letter-spacing: -1px; line-height: 1.2; margin-bottom: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .site-title, .site-title:visited { color: #424242; }
    .jsee-header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; font-size: 12px; line-height: 1; }
    .jsee-header-badge, .jsee-header-button { border: 1px solid #e0e0e0; border-radius: 4px; background: #f8f8f8; color: #555; padding: 6px 10px; font: inherit; line-height: 1; white-space: nowrap; }
    .jsee-header-badge { font-family: Menlo, Inconsolata, Consolas, Roboto Mono, Ubuntu Mono, Liberation Mono, Courier New, monospace; }
    .jsee-header-button { cursor: pointer; }
    .jsee-header-button:hover { background: #f0f0f0; color: #111; }
    .jsee-header-toggle { display: flex; align-items: center; gap: 4px; color: #666; cursor: pointer; white-space: nowrap; }
    @media screen and (max-width: 600px) { .site-header .wrapper { flex-wrap: wrap; gap: 8px; padding-top: 10px; padding-bottom: 10px; } .site-title { flex: 1 1 100%; white-space: normal; } .jsee-header-actions { width: 100%; justify-content: flex-start; } }
    .site-nav { position: absolute; top: 9px; right: 15px; background-color: #fdfdfd; border: 1px solid #e8e8e8; border-radius: 5px; text-align: right; }
    .site-nav .nav-trigger { display: none; }
    .site-nav .menu-icon { float: right; width: 36px; height: 26px; line-height: 0; padding-top: 10px; text-align: center; }
    .site-nav .menu-icon > svg path { fill: #424242; }
    .site-nav label[for="nav-trigger"] { display: block; float: right; width: 36px; height: 36px; z-index: 2; cursor: pointer; }
    .site-nav input ~ .trigger { clear: both; display: none; }
    .site-nav input:checked ~ .trigger { display: block; padding-bottom: 5px; }
    .site-nav .page-link { color: #111111; line-height: 1.5; display: block; padding: 5px 10px; margin-left: 20px; }
    .site-nav .page-link:not(:last-child) { margin-right: 0; }
    @media screen and (min-width: 600px) { .site-nav { position: static; float: right; border: none; background-color: inherit; } .site-nav label[for="nav-trigger"] { display: none; } .site-nav .menu-icon { display: none; } .site-nav input ~ .trigger { display: block; } .site-nav .page-link { display: inline; padding: 0; margin-left: auto; } .site-nav .page-link:not(:last-child) { margin-right: 20px; } }
    .site-footer { border-top: 1px solid #e8e8e8; padding: 30px 0; }
    .footer-heading { font-size: 1.7rem; line-height: 1.7rem; font-weight: 200; margin-bottom: 5px;}
    .footer-heading a { color: #a2a2a2; text-decoration: none; }
    .footer-heading a:hover { color: #828282; }
    .footer-org p { font-size: 0.65rem; color: #828282; }
    .feed-subscribe .svg-icon { padding: 5px 5px 2px 0; }
    .contact-list, .social-media-list, .pagination { list-style: none; margin-left: 0; }
    .footer-col-wrapper, .social-links { font-size: 0.9375rem; color: #828282; }
    .footer-col { margin-bottom: 15px; }
    .footer-col-1, .footer-col-2 { width: calc(50% - (30px / 2)); }
    .footer-col-3 { width: calc(100% - (30px / 2)); }
    @media screen and (min-width: 800px) { .footer-col-1 { width: calc(35% - (30px / 2)); } .footer-col-2 { width: calc(20% - (30px / 2)); } .footer-col-3 { width: calc(45% - (30px / 2)); } }
    @media screen and (min-width: 600px) { .footer-col-wrapper { display: flex; } .footer-col { width: calc(100% - (30px / 2)); padding: 0 15px; } .footer-col:first-child { padding-right: 15px; padding-left: 0; } .footer-col:last-child { padding-right: 0; padding-left: 15px; } }
    /** Page content */
    .page-content { padding: 30px 0; flex: 1 0 auto; }
    .page-heading { font-size: 2rem; }
    .post-list-heading { font-size: 1.75rem; }
    .post-list { margin-left: 0; list-style: none; }
    .post-list > li { margin-bottom: 30px; }
    .post-meta { font-size: 14px; color: #828282; }
    .post-link { display: block; font-size: 1.5rem; }
    /** Posts */
    .post-header { margin-bottom: 30px; }
    .post-title, .post-content h1 { font-size: 2.625rem; letter-spacing: -1px; line-height: 1.15; }
    @media screen and (min-width: 800px) { .post-title, .post-content h1 { font-size: 2.625rem; } }
    .post-content { margin-bottom: 30px; }
    .post-content h1, .post-content h2, .post-content h3 { margin-top: 60px; }
    .post-content h4, .post-content h5, .post-content h6 { margin-top: 30px; }
    .post-content h2 { font-size: 1.75rem; }
    @media screen and (min-width: 800px) { .post-content h2 { font-size: 2rem; } }
    .post-content h3 { font-size: 1.375rem; }
    @media screen and (min-width: 800px) { .post-content h3 { font-size: 1.625rem; } }
    .post-content h4 { font-size: 1.25rem; }
    .post-content h5 { font-size: 1.125rem; }
    .post-content h6 { font-size: 1.0625rem; }
    .social-media-list, .pagination { display: table; margin: 0 auto; }
    .social-media-list li, .pagination li { float: left; margin: 5px 10px 5px 0; }
    .social-media-list li:last-of-type, .pagination li:last-of-type { margin-right: 0; }
    .social-media-list li a, .pagination li a { display: block; padding: 7.5px; border: 1px solid #e8e8e8; }
    .social-media-list li a:hover, .pagination li a:hover { border-color: #dbdbdb; }
    /** Pagination navbar */
    .pagination { margin-bottom: 30px; }
    .pagination li a, .pagination li div { min-width: 41px; text-align: center; box-sizing: border-box; }
    .pagination li div { display: block; padding: 7.5px; border: 1px solid transparent; }
    .pagination li div.pager-edge { color: #e8e8e8; border: 1px dashed; }
    /** Grid helpers */
    @media screen and (min-width: 800px) { .one-half { width: calc(50% - (30px / 2)); } }
    /** Jsee elements */
    .app-container { background-color: #F0F1F4; border-bottom: 1px solid #e8e8e8; padding-bottom: 55px }
    .schema-description { background-color: #f8f8fa; padding: 20px; margin-top: 20px; border-radius: 10px; border: 1px solid #e8e8e8; }
    .schema-description h2, .schema-description h3, .schema-description h4 { margin-top: 10px; }
    /** Logos */
    .logo_footer { margin-left: -3px; }
    .logo_footer svg { opacity: 0.35; }
    .logo_footer:hover svg { opacity: 1; }
    .social-links { display: flex; justify-content: right; }
    .social-links .social-media-list, .social-links .pagination { margin: 0; }
  </style>
  <link type="application/atom+xml" rel="alternate" href="/feed.xml" title="hashr" />
  ${blocks.gaHtml}
</head>
<body>
  ${blocks.hiddenElementHtml}
  <header class="site-header">
    <div class="wrapper">
      <span class="site-title">${safeTitle}</span>
      ${blocks.headerRightHtml}
    </div>
  </header>
  <div class="page-content app-container">
    <div class="wrapper">
      <div id="jsee-container"></div>
    </div>
  </div>
  <main class="page-content" aria-label="Content">
    <div class="wrapper">
      <article class="post">
        <div class="post-content">
          ${blocks.descriptionHtml}
        </div>
      </article>
    </div>
  </main>
  <footer class="site-footer h-card">
    <data class="u-url" href="/"></data>
    <div class="wrapper">
      <div class="footer-col-wrapper">
        <div class="footer-col">
          ${blocks.orgHtml}
        </div>
        <div class="footer-col">
          <div class="social-links">
            <ul class="social-media-list">
              ${blocks.socialHtml}
            </ul>
          </div>
        </div>
      </div>
    </div>
  </footer>
  ${blocks.jseeHtml}
  <script>
    ${blocks.schemaScript}
    var currentSchema = schemaServer || schemaClient
    var container = document.getElementById('jsee-container')
    var env = new JSEE({
      container: container,
      schema: currentSchema
    })
    var toggle = document.getElementById('exec-toggle')
    if (toggle) {
      toggle.addEventListener('change', function () {
        env.destroy()
        currentSchema = this.checked ? schemaClient : schemaServer
        env = new JSEE({ container: container, schema: currentSchema })
      })
    }
    var downloadBtn = document.getElementById('download-html-btn')
    if (downloadBtn) {
      var downloadTitle = ${safeJsonForScript(title)}
      function formatHtmlSize(bytes) {
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
        if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB'
        return bytes + ' B'
      }
      function getDownloadHtml() {
        return '<!DOCTYPE html>\\n' + document.documentElement.outerHTML
      }
      function getDownloadFilename() {
        var base = (downloadTitle || 'jsee').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
        return (base || 'jsee') + '.html'
      }
      function updateDownloadLabel() {
        var html = getDownloadHtml()
        var size = new Blob([html], { type: 'text/html' }).size
        downloadBtn.textContent = 'Download HTML - ' + formatHtmlSize(size)
      }
      downloadBtn.addEventListener('click', function () {
        var html = getDownloadHtml()
        var blob = new Blob([html], { type: 'text/html' })
        var url = URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = getDownloadFilename()
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(function () { URL.revokeObjectURL(url) }, 0)
      })
      setTimeout(updateDownloadLabel, 0)
    }
  </script>
</body>
</html>`
}

async function command (pargv) {
  const { inspectSchema, validateDescriptor, ArtifactStore, formatRun, failedRun, BODY_LIMIT, ARTIFACT_LIMIT } = require('./transport')
  const argv = minimist(pargv.slice(1), { boolean: ['json'], string: ['input', 'artifact-dir'], default: { input: '-', 'max-body-bytes': BODY_LIMIT, 'max-artifact-bytes': ARTIFACT_LIMIT } })
  let schema, schemaPath
  try {
    if (argv._.length !== 1) throw new Error('Usage: jsee ' + pargv[0] + ' schema.json [--input -] [--json]')
    schemaPath = path.resolve(String(argv._[0]))
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
    if (pargv[0] === 'validate') {
      const body = validateDescriptor(schema)
      return { body, exitCode: body.valid ? 0 : 2 }
    }
    const description = inspectSchema(schema)
    if (pargv[0] === 'inspect') return { body: description, exitCode: 0 }
  } catch (error) { return { body: failedRun('JSEE_SCHEMA_INVALID', error.message), exitCode: 2 } }
  let data
  try {
    const limit = argv['max-body-bytes']
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('max-body-bytes must be a positive integer')
    const source = argv.input === '-' ? process.stdin : fs.createReadStream(path.resolve(argv.input))
    const chunks = []
    let size = 0
    for await (const chunk of source) {
      size += chunk.length
      if (size > limit) throw Object.assign(new Error('Input exceeds ' + limit + ' bytes'), { code: 'JSEE_BODY_TOO_LARGE' })
      chunks.push(chunk)
    }
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) || '{}')
  } catch (error) { return { body: failedRun(error.code === 'JSEE_BODY_TOO_LARGE' ? error.code : 'JSEE_REQUEST_INVALID', error.message), exitCode: 2 } }
  const run = await invokeSchema(schema, data, { schemaPath, log: console.error })
  let store
  try {
    if (run.status !== 'succeeded') return { body: run, exitCode: 1 }
    store = new ArtifactStore({ directory: argv['artifact-dir'] || path.resolve('.jsee-artifacts'), maxBytes: argv['max-artifact-bytes'] })
    const body = formatRun(schema, run, store)
    return { body, exitCode: body.status === 'succeeded' ? 0 : 1 }
  } catch (error) { return { body: failedRun('JSEE_OUTPUT_INVALID', error.message, run.runId), exitCode: 1 } }
}

async function gen (pargv, returnHtml=false) {
  const canonical = pargv[0] === 'serve'
  if (canonical) {
    if (!pargv[1] || pargv[1].startsWith('-')) throw new Error('Usage: jsee serve schema.json [--port 3000]')
    pargv = ['--inputs', pargv[1], '--serve', ...pargv.slice(2)]
  }
  // Determine if JSEE CLI is imported or run directly
  const mainPath = require.main && require.main.path ? require.main.path : process.cwd()
  const mainFilename = require.main && require.main.filename ? require.main.filename : ''
  const imported = path.dirname(__dirname) !== path.dirname(mainPath)

  // First pass over CLI arguments
  // JSEE-level args
  const argvAlias = {
    inputs: 'i',
    outputs: 'o',
    description: 'd',
    port: 'p',
    version: 'v',
    fetch: ['f', 'bundle', 'b'],
    execute: 'e',
    cdn: 'c',
    runtime: 'r',
    serve: 's'
  }
  const argvDefault = {
    execute: 'auto', // execute the model code on the server (auto = server-side when serving local .js models)
    fetch: false, // bundle runtime, local code and imports into generated output
    inputs: 'schema.json', // default input is schema.json in the current working directory
    port: 3000, // default port for the server
    host: '127.0.0.1', // bind dev server to localhost by default
    version: 'latest', // default version of JSEE runtime to use
    verbose: false, // verbose mode
    cdn: false,
    runtime: 'auto',
    serve: false,
    run: false
  }
  const booleanArgs = ['help', 'h', 'html', 'client', 'serve', 'run']
  let argv = minimist(pargv, {
    alias: argvAlias,
    default: argvDefault,
    boolean: booleanArgs,
  })

  // ── jsee init <template> ──────────────────────────────────────────
  if (argv._[0] === 'init') {
    const tpl = argv._[1] || 'minimal'
    const cwd = process.cwd()

    if (argv.html) {
      // Single index.html with inline schema + CDN script
      const dest = path.join(cwd, 'index.html')
      if (fs.existsSync(dest)) {
        console.log('index.html already exists, skipping')
        return
      }
      let htmlContent
      if (tpl === 'chat') {
        htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chat</title>
</head>
<body>
  <div id="jsee-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
  <script>
    new JSEE({
      container: document.getElementById('jsee-container'),
      schema: {
        model: { code: function chat(inputs) { return { chat: 'You said: ' + inputs.message } }, worker: false },
        inputs: [{ name: 'message', type: 'string', enter: true }],
        outputs: [{ name: 'chat', type: 'chat' }]
      }
    })
  </script>
</body>
</html>`
      } else {
        htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My App</title>
</head>
<body>
  <div id="jsee-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
  <script>
    new JSEE({
      container: document.getElementById('jsee-container'),
      schema: {
        model: { code: function greet(inputs) { return { greeting: (inputs.name + '\\n').repeat(inputs.count) } }, worker: false },
        inputs: [
          { name: 'name', type: 'string', default: 'World' },
          { name: 'count', type: 'slider', min: 1, max: 10, default: 3 }
        ],
        outputs: [{ name: 'greeting', type: 'code' }]
      }
    })
  </script>
</body>
</html>`
      }
      fs.writeFileSync(dest, htmlContent)
      console.log('Created index.html')
      return
    }

    // Multi-file scaffolding
    const files = {}
    if (tpl === 'chat') {
      files['schema.json'] = JSON.stringify({
        model: { url: 'model.js', name: 'chat', worker: false },
        inputs: [{ name: 'message', type: 'string', enter: true }],
        outputs: [{ name: 'chat', type: 'chat' }]
      }, null, 2) + '\n'
      files['model.js'] = `function chat(inputs) {
  return { chat: 'You said: ' + inputs.message }
}
`
      files['README.md'] = `# Chat

A chat app built with [JSEE](https://jsee.org).

## Run

\`\`\`bash
npx @jseeio/jsee schema.json
\`\`\`
`
    } else {
      // minimal (default)
      files['schema.json'] = JSON.stringify({
        model: { url: 'model.js', name: 'greet' },
        inputs: [
          { name: 'name', type: 'string', default: 'World' },
          { name: 'count', type: 'slider', min: 1, max: 10, default: 3 }
        ],
        outputs: [{ name: 'greeting', type: 'code' }]
      }, null, 2) + '\n'
      files['model.js'] = `function greet(inputs) {
  return { greeting: (inputs.name + '\\n').repeat(inputs.count) }
}
`
      files['README.md'] = `# My App

A web app built with [JSEE](https://jsee.org).

## Run

\`\`\`bash
npx @jseeio/jsee schema.json
\`\`\`
`
    }

    let created = 0
    for (const [filename, content] of Object.entries(files)) {
      const dest = path.join(cwd, filename)
      if (fs.existsSync(dest)) {
        console.log(`${filename} already exists, skipping`)
      } else {
        fs.writeFileSync(dest, content)
        console.log(`Created ${filename}`)
        created++
      }
    }
    if (created === 0) {
      console.log('All files already exist, nothing to do')
    }
    return
  }

  if (argv.help || argv.h) {
    console.log(`
Usage: jsee [schema.json|package] [data...] [options]
       jsee init [template] [--html]

Commands:
  inspect schema.json      Describe inputs, outputs and capabilities without loading models
  validate schema.json     Check computation structure and input defaults
  run schema.json          Execute the whole pipeline; JSON stdin/stdout by default
    --input <file|->        Read JSON from a file or stdin
    --artifact-dir <dir>    Persist output files (default: .jsee-artifacts)
  serve schema.json        Serve UI, POST /run, GET /schema and /openapi.json
    --max-body-bytes <n>    JSON request limit (default: 52428800)
    --max-artifact-bytes <n> Artifact quota (default: 67108864)
  init [template]           Scaffold a new JSEE project (templates: minimal, chat)
    --html                  Generate a single index.html instead of separate files

Options:
  -i, --inputs <file>       Input schema file (default: schema.json)
  -o, --outputs <file>      Output HTML file path
  -d, --description <file>  Markdown description file to include
      --host <addr>         Dev server host (default: 127.0.0.1)
  -p, --port <number>       Dev server port (default: 3000)
  -v, --version <version>   JSEE runtime version (default: latest)
  -b, --bundle[=mode]      Bundle runtime + dependencies into output
                           modes: default, hybrid, pyodide, pyodide-single, offline-strict
  -f, --fetch               Alias for --bundle
  -s, --serve               Serve explicitly (default when no output is provided)
      --run                 Execute the model once and write pipeable outputs
  -e, --execute             Execute model server-side (auto-enabled when serving local .js models)
      --client              Force client-side execution (disable auto server-side)
  -c, --cdn <url|bool>      Rewrite model URLs for CDN deployment
  -r, --runtime <mode>      Runtime: auto|local|cdn|inline or a custom URL/path (default: auto)
      --verbose             Enable verbose logging

Data inputs:
  Positional args after the schema file are mapped to schema inputs in order.
  Named args (--name=value) are matched to schema inputs by name.
  Values are auto-detected: numbers, JSON arrays/objects, file paths, or strings.
  Inputs set from the CLI are locked (non-editable) in the GUI.

Examples:
  jsee init                         Scaffold minimal project (schema.json + model.js)
  jsee init chat                    Scaffold chat project
  jsee init --html                  Generate single index.html
  jsee schema.json                  Start dev server with schema
  jsee @scope/app --serve           Start dev server from a JSEE app package
  jsee schema.json 42 hello         Pass positional data to first two inputs
  jsee schema.json --a=100 --b=200  Pass named data inputs
  jsee schema.json data.csv         Pass a file path as input
  jsee schema.json -o app.html      Generate static HTML file
  jsee schema.json -o app.html --bundle  Generate self-contained HTML with bundled runtime
  jsee @statsim/gen --run --dataset Moons --format CSV --nSamples 500
  jsee @statsim/gen --run --dataset Moons --file moons.csv
  jsee -p 8080                      Start dev server on port 8080
  jsee --host 0.0.0.0 -p 8080       Expose dev server on the local network
  jsee report.pdf                   Serve a PDF file (auto-detected viewer)
  jsee data/                        Serve a folder (file browser with preview)

Documentation: https://jsee.org
    `.trim())
    return
  }

  // Check if first positional arg is a file/directory or JSEE app package.
  let identityResult = null
  let packageInput = null
  if (!imported && argv._.length > 0) {
    identityResult = generateIdentitySchema(argv._[0], process.cwd())
    if (!identityResult) {
      packageInput = resolveJseePackageInput(argv._[0], process.cwd())
    }
  }

  // Set argv.inputs to the first positional argument if it looks like a schema/script/package.
  if (!identityResult && !packageInput && !imported && argv._.length > 0 && argv.inputs === argvDefault.inputs) {
    argv.inputs = argv._[0]
  }

  function log (...args) {
    if (argv.verbose) {
      console.log('[JSEE CLI]', ...args)
    }
  }

  log('Imported:', imported)
  log('Current working directory:', process.cwd())
  log('Script location:', __dirname)
  log('Script file:', __filename)
  log('Require location:', mainPath)
  log('Require file:', mainFilename)

  let cwd = process.cwd()
  let inputs = argv.inputs
  let outputs = argv.serve ? false : argv.outputs
  let description = argv.description || ''

  if (packageInput || (!identityResult && typeof inputs === 'string')) {
    const resolvedPackageInput = packageInput || resolveJseePackageInput(inputs, cwd)
    if (resolvedPackageInput) {
      packageInput = resolvedPackageInput
      cwd = packageInput.packageRoot
      inputs = [packageInput.schemaPath]
      if (!description && packageInput.descriptionPath) {
        description = path.relative(cwd, packageInput.descriptionPath)
      }
    } else if (looksLikeMissingPackageInput(inputs, cwd)) {
      throw new Error(`Cannot resolve JSEE app package ${inputs}. Install it in this project or let npm provide both packages:\n  ${getPackageInputInstallHint(inputs)}`)
    }
  }
  let schema
  let schemaPath
  let descriptionTxt = ''
  let descriptionHtml = ''
  let modelFuncs = {}

  // Determine the inputs and outputs
  // if inputs is a string with js file names, split it into an array
  if (typeof inputs === 'string') {
    if (inputs.includes('.js') || inputs.includes('.json') || inputs.includes(',')) {
      inputs = inputs.split(',')
    }
  }

  // if outputs is a string with js file names, split it into an array
  if (typeof outputs === 'string' && !argv.run) {
    outputs = outputs.split(',')
  }

  if (identityResult) {
    schema = identityResult.schema
    schemaPath = null
    log('Identity mode:', identityResult.serveFile ? 'file' : 'folder')
    if (identityResult.serveFile) {
      const outputType = schema.outputs[0].type
      const textTypes = ['table', 'markdown', 'html', 'object', 'code']
      if (textTypes.includes(outputType)) {
        schema.outputs[0].value = fs.readFileSync(identityResult.serveFile.resolved, 'utf8')
      } else {
        schema.outputs[0].value = identityResult.serveFile.path
      }
    }
  } else if (inputs.length === 0) {
    console.error('No inputs provided')
    process.exit(1)
  } else if ((inputs.length === 1) && (inputs[0].includes('.json'))) {
    // Input is json schema
    // Curren working directory if not provided
    // schema = require(path.join(cwd, inputs[0]))
    // switch to fs.readFileSync to reload the schema if it changes
    schemaPath = inputs[0].startsWith('/') ? inputs[0] : path.join(cwd, inputs[0])
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  } else {
    // Array of js files
    // Generate schema
    let jsdocData = getJsdocToMarkdown().getTemplateDataSync({ files: inputs.map(f => path.join(cwd, f)) })
    schema = genSchema(jsdocData)
  }
  log('Schema path:', schemaPath)
  assertSchemaVersion(schema)

  // Second pass over CLI arguments
  // Iterate over schema inputs and update argv aliases
  if (schema.inputs) {
    schema.inputs.forEach((inp, inp_index) => {
      if (inp.name) {
        const inputName = sanitizeName(inp.name)
        const inputAliases = []
        if (inp.alias) inputAliases.push(...toArray(inp.alias))
        if (inp.name !== inputName) inputAliases.push(inp.name)
        if (inputAliases.length) {
          argvAlias[inputName] = inputAliases
        }
        // Use positional arguments as schema input defaults
        if (imported && argv._.length > inp_index) {
          log('Using positional argument for input:', inputName, argv._[inp_index])
          argvDefault[inputName] = detectArgValue(argv._[inp_index])
        } else if (!imported && argv._.length > inp_index + 1) {
          // Skip first positional arg (schema file), map rest to inputs
          const val = argv._[inp_index + 1]
          log('Using positional argument for input:', inputName, val)
          argvDefault[inputName] = detectArgValue(val)
        }
        // We don't need to duplicate defaults here, as we handle them on the frontend
        // else if (inp.default) {
        //   argvDefault[inputName] = inp.default
        // }
      }
    })
  }
  // Update argv with the new aliases and defaults
  argv = minimist(pargv, {
    alias: argvAlias,
    default: argvDefault,
    boolean: booleanArgs
  })

  // Now deactivate the inputs present in argv
  // If you set parameter on the command line, it should not be editable in the GUI
  // E.g. file selected
  const dataFromArgvWithoutFileLoading = getDataFromArgv(schema, argv, false)
  log('Data from argv without file loading:', dataFromArgvWithoutFileLoading)
  if (schema.inputs) {
    schema.inputs.forEach(inp => {
      // Here data contains unsanitized input names
      if (inp.name in dataFromArgvWithoutFileLoading) {
        inp.default = dataFromArgvWithoutFileLoading[inp.name]
        inp.disabled = true // Deactivate the input if it's present in argv
      }
    })
  }
  log('Argv:', argv)

  // Bundle/offline generation
  // Check if schema has model, convert to array if needed
  if (!schema.model) {
    // console.error('No model found in schema')
    // process.exit(1)
    // It's still valid schema, can be only render function or vis of inputs/outputs
    schema.model = [] 
  }
  if (!Array.isArray(schema.model)) {
    schema.model = [schema.model]
  }

  if (argv.run) {
    const data = Object.assign(
      {},
      getSchemaInputDefaults(schema),
      getDataFromArgv(schema, argv, true)
    )
    const result = await runSchemaOnce(schema, data, schemaPath, cwd, log)
    emitRunOutputs(schema, result, argv, outputs, process.cwd())
    return result
  }

  // Resolve server-side execution mode
  const hasOutputs = Array.isArray(outputs) ? outputs.length > 0 : Boolean(outputs)
  let shouldExecute = argv.execute
  if (shouldExecute === 'auto') {
    const isServing = !hasOutputs
    if (argv.client) {
      shouldExecute = false
    } else if (isServing) {
      shouldExecute = schema.model.every(m =>
        m.url && m.url.endsWith('.js') && !isHttpUrl(m.url))
    } else {
      shouldExecute = false
    }
  } else {
    shouldExecute = Boolean(shouldExecute)
  }

  // Store original models before execute/CDN mutations (for client-side toggle)
  let computationSchema
  if (canonical) {
    const { inspectSchema } = require('./transport')
    const description = inspectSchema(schema)
    if (!description.capabilities.invoke) throw new Error(description.capabilities.reason)
    schema.model.forEach(model => { if (!model.name) model.name = getModelExportName(model) })
    inspectSchema(schema) // Inferred endpoint names must also be unique before any model loads.
    if (schema.model.some(model => model.name === 'run')) throw new Error('Model endpoint /run conflicts with canonical /run; rename the model or use legacy --serve')
    computationSchema = cloneSchema(schema)
    shouldExecute = true
  }
  const originalModels = JSON.parse(JSON.stringify(schema.model))

  // Server-side execution
  // Prepare the model functions to run on the server side
  // Schema model will be updated with the server url and POST method
  if (shouldExecute) {
    await Promise.all(schema.model.map(async m => {
      log('Preparing a model to run on the server side:', m.name, m.url)
      modelFuncs[m.name] = await loadCliModelFunction(m, schemaPath, cwd, log, schema.inputs)
      m.type = 'post'
      m.url = `/${m.name}`
      m.worker = false
    }))
  }
  
  // Switch to CDN for model files
  if (argv.cdn) {
    let cdn = ''
    if (typeof argv.cdn === 'string') {
      cdn = argv.cdn
    } else if (typeof argv.cdn === 'boolean') {
      // Check package.json in cwd
      const packageJsonPath = path.join(cwd, 'package.json')
      if (fs.existsSync(packageJsonPath)) {
        const target = require(packageJsonPath)
        const packageName = target.name
        cdn = `https://cdn.jsdelivr.net/npm/${packageName}@${target.version}/`
      } else {
        console.error(`No package.json found: ${packageJsonPath}`)
        process.exit(1)
      }
    } else {
      console.error('Invalid CDN argument. Use --cdn <url> or --cdn true to use package.json version.')
      process.exit(1)
    }
    log('Using CDN for model files:', cdn)
    schema.model.forEach(m => {
      if (m.url) {
        // If url is relative, make it absolute
        if (!m.url.startsWith('http')) {
          m.url = joinUrl(cdn, m.url)
          log(`Updated ${m.name} model URL to: ${m.url}`)
        }
      }
    })
  }

  log('Schema:', schema)

  // Generate description block
  if (description) {
    const descriptionPath = path.isAbsolute(description) ? description : path.join(cwd, description)
    const descriptionMd = fs.readFileSync(descriptionPath, 'utf8')
    descriptionHtml = getMarkdownConverter().render(descriptionMd)

    if (descriptionMd.includes('---')) {
      descriptionTxt = descriptionMd
        .split('---')[0]
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/#/g, '')
        .replace(/\*/g, '')
        .trim()
    }
  }
  descriptionHtml += genHtmlFromSchema(schema)

  // Generate jsee code
  let jseeHtml = ''
  let hiddenElementHtml = ''
  const assetRoot = schemaPath ? path.dirname(schemaPath) : cwd
  const bundleMode = resolveBundleMode(argv.fetch)
  const shouldBundle = bundleMode !== 'none'
  const offlineStrictBundle = isOfflineStrictBundleMode(bundleMode)
  const pyodideAssetBundle = isPyodideBundleMode(bundleMode)
  const pyodideSingleFileBundle = isPyodideSingleFileBundleMode(bundleMode)
  const runtimeMode = resolveRuntimeMode(argv.runtime, shouldBundle, hasOutputs)
  if (shouldBundle) {
    const bundleOutputDirs = getBundleOutputDirectories(outputs, cwd)
    const getPyodideAssetDir = createPyodideAssetDirResolver()
    // Fetch jsee code from the CDN or local server
    const jseeCode = await loadRuntimeCode(argv.version, schema)
    jseeHtml = `<script>${escapeScriptContent(jseeCode)}</script>`
    // Fetch model files and store them in hidden elements
    hiddenElementHtml += '<div id="hidden-storage" style="display: none;">'
    const hiddenAssetKeys = new Set()
    const appendHiddenAsset = (src, value) => {
      if (!src || hiddenAssetKeys.has(src)) return
      hiddenAssetKeys.add(src)
      hiddenElementHtml += hiddenAssetScript(src, value)
    }

    const bundleBlocks = collectFetchBundleBlocks(schema)
    for (let m of bundleBlocks) {
      if (offlineStrictBundle) {
        assertOfflineStrictModel(m, assetRoot, bundleOutputDirs)
      }
      if (m.type === 'get' || m.type === 'post') {
        continue
      }
      if (m.url) {
        // Fetch model from the local file system (remote URLs not yet supported here)
        const modelPath = path.resolve(assetRoot, m.url)
        if (!m.name) m.name = getModelExportName(m)
        const modelSource = fs.readFileSync(modelPath, 'utf8')
        // One hidden asset serves every stage at this URL, so it must expose all requested entries.
        const exportNames = [...new Set(bundleBlocks.filter(block => block.url === m.url).map(getModelExportName))]
        const modelCode = await bundleModelCode(m, modelPath, modelSource, exportNames)
        appendHiddenAsset(m.url, modelCode)
      }

      const pyodideRuntime = pyodideSingleFileBundle
        ? await preparePyodideSingleFileBundle(m, assetRoot, getPyodideAssetDir)
        : pyodideAssetBundle
          ? await preparePyodideAssetsForBundle(m, assetRoot, bundleOutputDirs, getPyodideAssetDir)
          : await readPyodideRuntimeForBundle(m, assetRoot)
      if (pyodideRuntime) {
        appendHiddenAsset(pyodideRuntime.src, pyodideRuntime.code)
        if (pyodideRuntime.manifestSrc) {
          appendHiddenAsset(pyodideRuntime.manifestSrc, JSON.stringify(pyodideRuntime.manifest))
        }
        if (pyodideRuntime.indexURL && isNetworkUrl(pyodideRuntime.indexURL)) {
          console.error(`Warning: Pyodide indexURL remains remote in bundled output: ${pyodideRuntime.indexURL}`)
        }
      }
      const imports = toArray(m.imports)
      if (imports.length && m.type !== 'py') {
        m.imports = imports
        for (let [index, i] of imports.entries()) {
          if (typeof i !== 'string') {
            continue
          }
          const importMeta = resolveFetchImport(i, m.url, assetRoot)
          if (!importMeta) {
            continue
          }
          m.imports[index] = importMeta.schemaEntry

          let importCode
          if (importMeta.localFilePath) {
            importCode = fs.readFileSync(importMeta.localFilePath, 'utf8')
          } else {
            // Create cache directory if it doesn't exist
            const cacheDir = path.join(os.homedir(), '.cache', 'jsee')
            fs.mkdirSync(cacheDir, { recursive: true })

            // Create a hash of the importUrl
            const hash = crypto.createHash('sha256').update(importMeta.importUrl).digest('hex')
            const cacheFilePath = path.join(cacheDir, `${hash}.js`)

            let useCache = false

            // Check if cache file exists and is less than 1 day old
            if (fs.existsSync(cacheFilePath)) {
              const stats = fs.statSync(cacheFilePath)
              const mtime = new Date(stats.mtime)
              const now = new Date()
              const ageInDays = (now - mtime) / (1000 * 60 * 60 * 24)

              if (ageInDays < 1) {
                log('Using cached import:', importMeta.importUrl)
                importCode = fs.readFileSync(cacheFilePath, 'utf8')
                useCache = true
              }
            }

            if (!useCache) {
              const response = await fetch(importMeta.remoteUrl)
              if (!response.ok) {
                console.error(`Failed to fetch ${importMeta.remoteUrl}: ${response.statusText}`)
                process.exit(1)
              }
              importCode = await response.text()
              fs.writeFileSync(cacheFilePath, importCode, 'utf8')
              log('Fetched and stored to cache:', importMeta.importUrl)
            }
          }
          appendHiddenAsset(importMeta.importUrl, importCode)
        }
      }
    }
    hiddenElementHtml += '</div>'
  } else {
    if (runtimeMode === 'inline') {
      const jseeCode = await loadRuntimeCode(argv.version, schema)
      jseeHtml = `<script>${escapeScriptContent(jseeCode)}</script>`
    } else if (runtimeMode === 'cdn') {
      const bundle = getBundleFilename(schema)
      jseeHtml = `<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@${escapeAttr(argv.version)}/dist/${bundle}"></script>`
    } else if (runtimeMode === 'local') {
      const bundle = getBundleFilename(schema)
      jseeHtml = `<script src="http://${escapeAttr(getDisplayHost(argv.host))}:${argv.port}/dist/${bundle}"></script>`
    } else {
      // Custom path/URL passed via --runtime (e.g. ./node_modules/.../jsee.js)
      jseeHtml = `<script src="${escapeAttr(runtimeMode)}"></script>`
    }
  }

  let socialHtml = ''
  let gaHtml = ''
  let orgHtml = ''

  if (schema.page) {
    if (schema.page.ga) {
      const gaId = sanitizeGoogleAnalyticsId(schema.page.ga)
      if (gaId) {
        gaHtml = `
        <script id="ga-src" async src="https://www.googletagmanager.com/gtag/js?id=${escapeAttr(gaId)}"></script>
        <script id="ga-body">
          window[${safeJsonForScript(`ga-disable-${gaId}`)}] = window.doNotTrack === "1" || navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || navigator.msDoNotTrack === "1";
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', ${safeJsonForScript(gaId)});
        </script>
      `
      }
    }

    // Social media links
    if (schema.page.social) {
      // iterate over dict with k, v pairs
      for (let [name, url] of Object.entries(schema.page.social)) {
        const safeName = escapeHtml(name)
        const safeUrl = sanitizeUrl(url)
        switch (name) {
          case 'twitter':
            socialHtml += `<li><a rel="me" href="https://twitter.com/${escapeAttr(url)}">Twitter</a></li>`
            break
          case 'github':
            socialHtml += `<li><a rel="me" href="https://github.com/${escapeAttr(url)}">GitHub</a></li>`
            break
          case 'facebook':
            socialHtml += `<li><a rel="me" href="https://www.facebook.com/${escapeAttr(url)}">Facebook</a></li>`
            break
          case 'linkedin':
            socialHtml += `<li><a rel="me" href="https://www.linkedin.com/company/${escapeAttr(url)}">LinkedIn</a></li>`
            break
          case 'instagram':
            socialHtml += `<li><a rel="me" href="https://www.instagram.com/${escapeAttr(url)}">Instagram</a></li>`
            break
          case 'youtube':
            socialHtml += `<li><a rel="me" href="https://www.youtube.com/${escapeAttr(url)}">YouTube</a></li>`
            break
          default:
            socialHtml += `<li><a rel="me" href="${escapeAttr(safeUrl)}">${safeName}</a></li>`
        }
      }
    }

    if (schema.page.org) {
      orgHtml = `<div class="footer-org"><h4 class="footer-heading"><a href="${escapeAttr(sanitizeUrl(schema.page.org.url))}">${escapeHtml(schema.page.org.name)}</a></h4>`
      if (schema.page.org.description) {
        orgHtml += `<p>${escapeHtml(schema.page.org.description)}</p>`
      }
      orgHtml += '</div>'
    }

  }

  // Build right-side header status/action. Serve mode shows only runtime status; bundled files can download themselves.
  let headerRightHtml = ''
  let schemaScript = ''
  const isServing = !hasOutputs
  if (isServing) {
    const toggleHtml = shouldExecute
      ? '<label class="jsee-header-toggle"><input type="checkbox" id="exec-toggle">Browser</label>'
      : ''
    headerRightHtml = `<div class="jsee-header-actions">${toggleHtml}<span class="jsee-header-badge">${escapeHtml(getDisplayHost(argv.host))}:${argv.port}</span></div>`
  } else if (shouldBundle) {
    headerRightHtml = '<div class="jsee-header-actions"><button id="download-html-btn" class="jsee-header-button" type="button" title="Download this standalone HTML file">Download HTML</button></div>'
  }
  if (shouldExecute) {
    const clientSchema = JSON.parse(JSON.stringify(schema))
    clientSchema.model = originalModels
    schemaScript = `var schemaServer = ${safeJsonForScript(schema)}\n    var schemaClient = ${safeJsonForScript(clientSchema)}`
  } else {
    schemaScript = `var schemaServer = ${safeJsonForScript(schema)}\n    var schemaClient = null`
  }

  const html = template(schema, {
    descriptionHtml: pad(descriptionHtml, 8, 1),
    descriptionTxt: descriptionTxt,
    gaHtml: pad(gaHtml, 2, 1),
    jseeHtml: jseeHtml,
    hiddenElementHtml: hiddenElementHtml,
    socialHtml: pad(socialHtml, 2, 1),
    orgHtml: pad(orgHtml, 2, 1),
    headerRightHtml: headerRightHtml,
    schemaScript: schemaScript,
  })

  if (returnHtml) {
    // Return the html as a string
    return html
  } else if (outputs) {
    // Store the html in the output file
    for (let o of outputs) {
      if (o === 'stdout') {
        log(html)
      } else if (o.includes('.html')) {
        writeOutputFile(cwd, o, html)
      } else if (o.includes('.json')) {
        writeOutputFile(cwd, o, JSON.stringify(schema, null, 2))
      } else if (o.includes('.md')) {
        writeOutputFile(cwd, o, genMarkdownFromSchema(schema))
      } else {
        console.error('Invalid output file:', o)
      }
    }
  } else {
    // Serve the html
    const express = require('express')
    const app = express()
    const appRoot = path.resolve(schemaPath ? path.dirname(schemaPath) : cwd)
    const endpointRoots = [appRoot]
    if (identityResult && identityResult.serveDir) endpointRoots.push(identityResult.serveDir)
    if (identityResult && identityResult.serveFile) endpointRoots.push(path.dirname(identityResult.serveFile.resolved))
    let artifactStore
    if (canonical) {
      const { ArtifactStore, formatRun, failedRun, responseStatus, canonicalOpenAPI, BODY_LIMIT } = require('./transport')
      const limit = argv['max-body-bytes'] === undefined ? BODY_LIMIT : argv['max-body-bytes']
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('max-body-bytes must be a positive integer')
      artifactStore = new ArtifactStore({ http: true, maxBytes: argv['max-artifact-bytes'] })
      app.get('/schema', (req, res) => res.json(computationSchema))
      app.get('/openapi.json', (req, res) => res.json(canonicalOpenAPI(computationSchema)))
      app.get('/__jsee/artifacts/:run/:index', (req, res) => {
        const id = req.params.run + '/' + req.params.index
        const artifact = artifactStore.get(id)
        if (!artifact) return res.status(404).json({ error: 'Unknown artifact' })
        try {
          const filename = resolveInside(artifactStore.root, id)
          const encoded = encodeURIComponent(artifact.name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16))
          res.set({ 'Content-Type': artifact.mime, 'Content-Disposition': "attachment; filename*=UTF-8''" + encoded, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
          res.sendFile(filename)
        } catch (error) { sendEndpointError(res, error) }
      })
      app.post('/run', (req, res, next) => {
        if (!req.is('application/json')) return res.status(415).json(failedRun('JSEE_UNSUPPORTED_MEDIA', 'Canonical /run accepts application/json'))
        next()
      }, express.raw({ type: 'application/json', limit }), async (req, res) => {
        let data
        try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(req.body) || '{}') } catch (error) {
          return res.status(400).json(failedRun('JSEE_REQUEST_INVALID', error.message))
        }
        const run = await invokeSchema(computationSchema, data, { schemaPath, cwd, log, _modelFunctions: modelFuncs })
        const response = formatRun(computationSchema, run, artifactStore)
        res.status(responseStatus(response)).json(response)
      })
      app.use('/run', (error, req, res, next) => {
        if (!error) return next()
        const run = failedRun(error.type === 'entity.too.large' ? 'JSEE_BODY_TOO_LARGE' : 'JSEE_REQUEST_INVALID', error.message)
        res.status(responseStatus(run)).json(run)
      })
      app.all('/run', (req, res) => res.status(405).json({ error: 'Use POST /run' }))
    }
    // CORS
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      next()
    })
    app.use(express.json({ limit: API_BODY_LIMIT }))
    app.use(express.raw({ type: 'multipart/form-data', limit: API_BODY_LIMIT }))
    app.use((error, req, res, next) => {
      if (!error) return next()
      const status = error.status || error.statusCode || 400
      if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed' || error instanceof SyntaxError) {
        return res.status(status).json({ error: error.message || 'invalid request body' })
      }
      next(error)
    })
    // API discovery
    app.get('/api', (req, res) => {
      const models = schema.model.map(m => ({
        name: m.name,
        endpoint: m.url || '/' + m.name,
        method: 'POST'
      }))
      res.json({ schema, models })
    })
    // OpenAPI spec
    app.get('/api/openapi.json', (req, res) => {
      res.json(generateOpenAPISpec(schema))
    })
    if (shouldExecute) {
      // Create post endpoint for executing the model
      schema.model.forEach(m => {
        app.post(m.url, async (req, res) => {
          log(`Executing model: ${m.name}`)
          if (m.name in modelFuncs) {
            const modelFunc = modelFuncs[m.name]
            try {
              const dataFromArgv = getDataFromArgv(schema, argv)
              const contentType = req.headers['content-type'] || ''
              let dataFromGUI = req.body
              if (contentType.includes('multipart/form-data') && Buffer.isBuffer(req.body)) {
                dataFromGUI = parseMultipart(contentType, req.body)
              }
              const data = prepareInputs(schema.inputs, { ...dataFromGUI, ...dataFromArgv })
              log('Data for model execution:', data)
              const result = await modelFunc(data)
              if (m.stream === true && isStreamResult(result)) {
                await writeSseStream(res, result)
                log(`Model ${m.name} streamed successfully`)
                return
              }
              res.json(serializeResult(result))
              log(`Model ${m.name} executed successfully: `, result)
            } catch (error) {
              console.error('Error executing model:', error)
              if (res.headersSent) {
                res.end()
                return
              }
              res.status(error.code === 'JSEE_INPUT_INVALID' ? 400 : 500).json({ error: error.message })
            }
          } else {
            res.status(404).json({ error: 'Unknown model: ' + m.name })
          }
        })
        log('Model execution endpoints created:', m.url)
      })
    }
    // Serve folder file listing as JSON
    app.get('/__jsee/folder', (req, res) => {
      const dirPath = req.query.path
      try {
        const resolved = resolveInsideAny(endpointRoots, dirPath)
        if (!fs.statSync(resolved).isDirectory()) {
          return res.status(404).json({ error: 'directory not found' })
        }
        res.json(readDirListing(resolved, dirPath))
      } catch (error) {
        sendEndpointError(res, error)
      }
    })
    // Serve individual files for viewer output
    app.get('/__jsee/file', (req, res) => {
      const filePath = req.query.path
      try {
        const resolved = resolveInsideAny(endpointRoots, filePath)
        if (!fs.statSync(resolved).isFile()) {
          return res.status(404).json({ error: 'file not found' })
        }
        res.sendFile(resolved)
      } catch (error) {
        sendEndpointError(res, error)
      }
    })
    app.get('/', async (req, res) => {
      log('Serving index.html')
      res.send(await gen(pargv, true))
    })
    // app.get('/dist/jsee.runtime.js', (req, res) => {
    //   // __dirname points to this file location (it's jsee/src/cli.js, likely in node_modules)
    //   // so we need to go up one level to get to the dist folder with jsee.runtime.js
    //   const pathToJSEE = path.join(__dirname, '..', 'dist', 'jsee.runtime.js')
    //   log(`Serving jsee.runtime.js from: ${pathToJSEE}`)
    //   res.sendFile(pathToJSEE)
    // })
    app.use('/dist', containedStatic(path.join(__dirname, '..', 'dist'))) // Serve static files from the dist folder
    // app.use(express.static(cwd))
    // app.use(express.static(require.main.path)) // Serve static files from the main module path
    // app.use(express.static(path.join(require.main.path, '..'))) // Serve static files from the parent directory of the main module path
    app.use(containedStatic(appRoot)) // Serve static files from the app root
    const server = app.listen(argv.port, argv.host, () => {
      console.log(`JSEE app is running: http://${getDisplayHost(argv.host)}:${argv.port}`)
    })
    if (artifactStore) {
      server.on('close', () => artifactStore.close())
      server.on('error', () => artifactStore.close())
      const cleanup = () => artifactStore.close()
      process.once('exit', cleanup)
      server.once('close', () => process.removeListener('exit', cleanup))
    }
    return server
  }
}

module.exports = gen
module.exports.command = command
module.exports.collectFetchBundleBlocks = collectFetchBundleBlocks
module.exports.resolveLocalImportFile = resolveLocalImportFile
module.exports.resolveFetchImport = resolveFetchImport
module.exports.resolveRuntimeMode = resolveRuntimeMode
module.exports.resolveBundleMode = resolveBundleMode
module.exports.isOfflineStrictBundleMode = isOfflineStrictBundleMode
module.exports.isPyodideBundleMode = isPyodideBundleMode
module.exports.isPyodideSingleFileBundleMode = isPyodideSingleFileBundleMode
module.exports.resolveOutputPath = resolveOutputPath
module.exports.resolveJseePackageInput = resolveJseePackageInput
module.exports.readJseePackageInput = readJseePackageInput
module.exports.findPackageRoot = findPackageRoot
module.exports.runPackage = runPackage
module.exports.looksLikeMissingPackageInput = looksLikeMissingPackageInput
module.exports.getPackageInputInstallHint = getPackageInputInstallHint
module.exports.isPackageSpecifier = isPackageSpecifier
module.exports.writeOutputFile = writeOutputFile
module.exports.needsFullBundle = needsFullBundle
module.exports.shouldBundleModelCode = shouldBundleModelCode
module.exports.bundleModelCode = bundleModelCode
module.exports.runSchemaOnce = runSchemaOnce
module.exports.invokeSchema = invokeSchema
module.exports.emitRunOutputs = emitRunOutputs
module.exports.escapeHtml = escapeHtml
module.exports.escapeAttr = escapeAttr
module.exports.safeJsonForScript = safeJsonForScript
module.exports.escapeScriptContent = escapeScriptContent
module.exports.encodeAssetForHtml = encodeAssetForHtml
module.exports.hiddenAssetScript = hiddenAssetScript
module.exports.sanitizeUrl = sanitizeUrl
module.exports.sanitizeGoogleAnalyticsId = sanitizeGoogleAnalyticsId
module.exports.joinUrl = joinUrl
module.exports.resolveInside = resolveInside
module.exports.resolveInsideAny = resolveInsideAny
module.exports.isAsyncIterable = isAsyncIterable
module.exports.isIterable = isIterable
module.exports.isStreamResult = isStreamResult
module.exports.writeSseStream = writeSseStream
