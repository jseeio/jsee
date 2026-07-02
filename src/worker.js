const utils = require('./utils')

function log () {
  const args = Array.prototype.slice.call(arguments)
  args.unshift('[Worker]')
  postMessage({ _status: 'log', _log: args })
}

function progress (value) {
  postMessage({ _status: 'progress', _progress: value })
}

let initialized = false
let cancelled = false
let streamInputConfig = {}

function isCancelled () {
  return cancelled === true
}

function getStreamOptions () {
  return {
    isCancelled,
    onProgress: progress
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
  if (typeof loadPyodide === 'undefined') {
    if (runtimeOptions.code) {
      importScripts(URL.createObjectURL(new Blob([runtimeOptions.code], { type: 'text/javascript' })))
    } else {
      importScripts(runtimeOptions.url)
    }
  }
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

async function initJS (model) {
  log('Init JS')
  this.container = model.container
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
        importScripts(URL.createObjectURL(new Blob([imp.code], { type: 'text/javascript' })))
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
    importScripts(URL.createObjectURL(new Blob([model.code], { type: 'text/javascript' })))
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
    target = this[model.name]
  }

  let modelFunc = await utils.getModelFuncJS(model, target, {
    log,
    progress,
    isCancelled
  })

  return modelFunc
}

function initAPI (model) {
  log('Init API')
  return utils.getModelFuncAPI(model, log, undefined, model._security)
}

onmessage = async function (e) {
  var data = e.data
  log('Received message of type:', typeof data)

  if ((typeof data === 'object') && (data._cmd === 'cancel')) {
    cancelled = true
    log('Cancel command received')
    return
  }

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
      postMessage({ _status: 'loaded' })
    } catch (error) {
      postMessage({
        _status: 'error',
        _error: error && error.message ? error.message : String(error)
      })
    }
  } else {
    try {
      cancelled = false
      const runData = utils.wrapStreamInputs(data, streamInputConfig, getStreamOptions())
      log('Run model')
      const results = await self.modelFunc(runData)
      log('Results:', results)
      postMessage(results)
    } catch (error) {
      postMessage({ _status: 'error', _error: error })
    }
  }
}
