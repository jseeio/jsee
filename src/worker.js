const utils = require('./utils')

function log () {
  const args = Array.prototype.slice.call(arguments);
  args.unshift('[Worker]')
  postMessage({_status: 'log', _log: args})
}

function progress (value) {
  postMessage({_status: 'progress', _progress: value})
}

function initTF (model) {
  throw new Error('Tensorflow in worker (not implemented)')
}

async function initPython (model) {
  importScripts("https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js")
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
    return await pyodide.runPythonAsync(model.code);
  }
}

async function initJS (model) {
  log('Init JS')
  this.container = model.container

  // Load imports
  if (model.imports && model.imports.length) {
    log('Loading imports...')
    for (let imp of model.imports) {
      // Try creating an url
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
    // https://github.com/altbdoor/blob-worker/blob/master/blobWorker.js
    importScripts(URL.createObjectURL(new Blob([model.code], { type: 'text/javascript' })))
  } else if (model.url) {
    log('Load script from URL:', model.url)
    importScripts(model.url)
  } else {
    log('No script provided')
  }

  // Related:
  // https://stackoverflow.com/questions/37711603/javascript-es6-class-definition-not-accessible-in-window-global
  const target = model.type === 'class'
    ? eval(model.name)
    : this[model.name]

  // Need promise here in case of async init
  let modelFunc = await utils.getModelFuncJS(model, target, { log, progress })

  return modelFunc
}

function initAPI (model) {
  log('Init API')
  return utils.getModelFuncAPI(model, log)
}

onmessage = async function (e) {
  var data = e.data
  log('Received message of type:', typeof data)

  if ((typeof data === 'object') && ((data.url) || (data.code))) {
    // Init message
    log('Init...')
    let m = data
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
    postMessage({_status: 'loaded'})
  } else {
    // Execution
    try {
      log('Run model with data:', data)
      const results = await self.modelFunc(data)
      log('Results:', results)
      postMessage(results)
    } catch (error) {
      postMessage({ _status: 'error', _error: error })
    }
  }
}
