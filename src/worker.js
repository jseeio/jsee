const utils = require('./utils')
const { imageFrames, assertFrameResult } = require('./image-frame')

function log () {
  const args = Array.prototype.slice.call(arguments)
  args.unshift('[Worker]')
  postMessage({ _status: 'log', _log: args })
}

function progress (value, details, requestId) {
  postMessage({ _status: 'progress', _progress: value, _progressDetails: details, requestId })
}

let initialized = false
let cancelled = false
let streamInputConfig = {}
let runToken = null

function isCancelled () {
  return cancelled === true
}

function getStreamOptions () {
  const context = createRunContext()
  return {
    isCancelled: context.isCancelled,
    onProgress: context.progress
  }
}

function createRunContext () {
  const token = runToken
  const active = () => token && token.active && runToken === token && !isCancelled()
  return {
    log: (...args) => { if (active()) log(...args) },
    progress: (value, details) => { if (active()) progress(value, details, token.requestId) },
    signal: token?.controller.signal,
    isCancelled: () => !active()
  }
}

async function initPython (model) {
  const security = utils.normalizeSecurityOptions(model._security)
  utils.assertEvalAllowed(security, 'Pyodide model code in worker')
  const pyodideOptions = utils.normalizePyodideOptions(model, { resolveUrl: true })
  if (pyodideOptions.code) {
    utils.assertEvalAllowed(security, 'cached Pyodide loader script in worker')
  }
  const runtimeOptions = await utils.preparePyodideRuntimeOptions(pyodideOptions, self)
  utils.assertPyodideNetworkAllowed(runtimeOptions, security, 'Pyodide runtime in worker')
  const loadPyodide = await utils.loadPyodideRuntime(runtimeOptions, self)
  const pyodide = await loadPyodide(utils.getPyodideLoadOptions(runtimeOptions))
  if (model.imports && Array.isArray(model.imports) && model.imports.length) {
    if (security.allowNetwork === false && !runtimeOptions.embeddedAssets) {
      throw new Error('security.allowNetwork is false; blocked Pyodide package loading')
    }
    const packages = model.imports
      .map(i => typeof i === 'string' ? i : i.url)
      .filter(Boolean)
    await pyodide.loadPackage(packages)
  } else if (security.allowNetwork === false) {
    log('Skipping Pyodide loadPackagesFromImports because security.allowNetwork is false')
  } else {
    await pyodide.loadPackagesFromImports(model.code)
  }
  const entry = utils.getPyodideEntryName(model)
  const bindInputs = (data) => utils.bindPyodideInputs(pyodide, data, self, {
    warn: message => log('[Pyodide input warning]', message)
  })
  if (entry) {
    await pyodide.runPythonAsync(model.code)
    const callCode = utils.buildPyodideEntryCallCode(entry)
    return async (data) => {
      bindInputs(data)
      const result = await pyodide.runPythonAsync(callCode)
      return utils.pyodideResultToJs(result)
    }
  }
  return async (data) => {
    bindInputs(data)
    const result = await pyodide.runPythonAsync(model.code)
    return utils.pyodideResultToJs(result)
  }
}

function importClassicCode (code) {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try { importScripts(url) } finally { URL.revokeObjectURL(url) }
}

async function initJS (model) {
  log('Init JS')
  self.container = model.container
  const security = utils.normalizeSecurityOptions(model._security)

  if (model.imports && model.imports.length) {
    log('Loading imports...')
    for (let [index, imp] of model.imports.entries()) {
      // Workers have no DOM — CSS is injected on the main thread in initModel()
      if (utils.isCssImport(imp.url)) {
        log('Skipping CSS import in worker:', imp.url)
        continue
      }
      if (imp.code) {
        utils.assertEvalAllowed(security, `worker import[${index}] inline script`)
        log('Importing from DOM:', imp.url)
        importClassicCode(imp.code)
      } else {
        utils.assertNetworkAllowed(imp._rawUrl || imp.url, security, `worker import[${index}]`)
        log('Importing from network:', imp.url)
        importScripts(imp.url)
      }
    }
  }

  let target
  if (model.type === 'module') {
    if (!model.url) {
      throw new Error('type: module requires model.url')
    }
    utils.assertNetworkAllowed(model.url, security, 'worker module model URL')
    const moduleUrl = model._moduleUrl || model.url
    log('Loading module model from:', moduleUrl)
    const mod = await import(/* webpackIgnore: true */ moduleUrl)
    target = utils.getModuleModelTarget(mod, model)
  } else if (model.code) {
    utils.assertEvalAllowed(security, 'worker JavaScript model.code')
    log('Load code as a string', model)
    importClassicCode(model.code)
  } else if (model.url) {
    utils.assertNetworkAllowed(model.url, security, 'worker model URL')
    const workerUrl = model._workerUrl || model.url
    log('Load script from URL:', workerUrl)
    importScripts(workerUrl)
  } else {
    log('No script provided')
  }

  if (model.type === 'class') {
    utils.assertEvalAllowed(security, 'worker class lookup')
    target = eval(model.name)
  } else if (model.type !== 'module') {
    target = self[model.name]
  }

  let modelFunc = await utils.getModelFuncJS(model, target, {
    log,
    progress,
    isCancelled
  }, model._inputNames, createRunContext)

  return modelFunc
}

function initAPI (model) {
  log('Init API')
  const request = utils.getModelFuncAPI(model, log, undefined, model._security)
  return data => {
    const token = runToken
    return request(data, {
      signal: token.controller.signal,
      onChunk: model.stream ? value => {
        if (!token.controller.signal.aborted) postMessage({ _jsee: 'partial', requestId: token.requestId, value })
      } : undefined
    })
  }
}

self.onmessage = async function (e) {
  const message = e.data
  // Inspect the runtime envelope before unwrapping model data, which may use any keys.
  if (message && message._jsee === 'cancel') {
    if (!runToken?.active || message.requestId !== runToken.requestId) return
    cancelled = true
    runToken.controller.abort()
    log('Cancel command received')
    return
  }
  const data = message && message._jsee === 'run' ? message.value : message
  log('Received message of type:', typeof data)

  if (utils.isWorkerInitMessage(data, initialized)) {
    try {
      log('Init...')
      let m = data
      streamInputConfig = (m && typeof m._streamInputConfig === 'object' && m._streamInputConfig)
        ? m._streamInputConfig
        : {}

      switch (m.type) {
        case 'py':
          self.modelFunc = await initPython(m)
          break
        case 'function':
        case 'class':
        case 'module':
        case 'async-init':
        case 'async-function':
          self.modelFunc = await initJS(m)
          break
        case 'get':
        case 'post':
          self.modelFunc = await initAPI(m)
          break
        default:
          throw new Error(`No type information: ${m.type}`)
      }
      initialized = true
      postMessage({ _jsee: 'loaded', requestId: data._requestId })
    } catch (error) {
      postMessage({
        _jsee: 'error',
        requestId: data._requestId,
        _error: error && error.message ? error.message : String(error)
      })
    }
  } else {
    const frames = message?._imageFrames ? imageFrames(data) : []
    const token = runToken = { active: true, controller: new AbortController(), requestId: message.requestId }
    try {
      cancelled = false
      const runData = utils.wrapStreamInputs(data, streamInputConfig, getStreamOptions())
      log('Run model')
      const results = await self.modelFunc(runData)
      if (frames.length) assertFrameResult(results)
      log('Results:', results)
      // Returned values never share the control namespace used by model-posted messages.
      postMessage(token.controller.signal.aborted
        ? { _jsee: 'cancelled', requestId: token.requestId }
        : { _jsee: 'result', requestId: token.requestId, value: results })
    } catch (error) {
      postMessage(token.controller.signal.aborted
        ? { _jsee: 'cancelled', requestId: token.requestId }
        : { _jsee: 'error', requestId: token.requestId, _error: error })
    } finally {
      frames.forEach(frame => frame.close())
      token.active = false
    }
  }
}
