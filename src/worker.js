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

function initTF (model) {
  throw new Error('Tensorflow in worker (not implemented)')
}

async function initPython (model) {
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js')
  const pyodide = await loadPyodide()
  if (model.imports && Array.isArray(model.imports) && model.imports.length) {
    await pyodide.loadPackage(model.imports.map(i => i.url))
  } else {
    await pyodide.loadPackagesFromImports(model.code)
  }
  return async (data) => {
    for (let key in data) {
      self[key] = data[key]
    }
    return await pyodide.runPythonAsync(model.code)
  }
}

async function initJS (model) {
  log('Init JS')
  this.container = model.container

  if (model.imports && model.imports.length) {
    log('Loading imports...')
    for (let imp of model.imports) {
      if (imp.code) {
        log('Importing from DOM:', imp.url)
        importScripts(URL.createObjectURL(new Blob([imp.code], { type: 'text/javascript' })))
      } else {
        log('Importing from network:', imp.url)
        importScripts(imp.url)
      }
    }
  }

  if (model.code) {
    log('Load code as a string', model)
    importScripts(URL.createObjectURL(new Blob([model.code], { type: 'text/javascript' })))
  } else if (model.url) {
    log('Load script from URL:', model.url)
    importScripts(model.url)
  } else {
    log('No script provided')
  }

  const target = model.type === 'class'
    ? eval(model.name)
    : this[model.name]

  let modelFunc = await utils.getModelFuncJS(model, target, {
    log,
    progress,
    isCancelled
  })

  return modelFunc
}

function initAPI (model) {
  log('Init API')
  return utils.getModelFuncAPI(model, log)
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
    log('Init...')
    let m = data
    streamInputConfig = (m && typeof m._streamInputConfig === 'object' && m._streamInputConfig)
      ? m._streamInputConfig
      : {}

    switch (m.type) {
      case 'tf':
        self.modelFunc = await initTF(m)
        break
      case 'py':
        self.modelFunc = await initPython(m)
        break
      case 'function':
      case 'class':
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
