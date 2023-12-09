const utils = require('./utils')

function log () {
  const args = Array.prototype.slice.call(arguments);
  args.unshift('[Worker]')
  postMessage({_status: 'log', _log: args})
}

function initTF (model) {
  throw new Error('Tensorflow in worker (not implemented)')
}

function initPython (model) {
  throw new Error('Python in worker (not implemented)')
}

async function initJS (model) {
  log('Init JS')
  this.container = model.container

  // Load imports
  if (model.imports && model.imports.length) {
    log('Loading imports...')
    for (let imp of model.imports) {
      // Try creating an url
      const url = utils.getUrl(imp)
      log('Importing:', url)
      importScripts(url)
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
  let modelFunc = await utils.getModelFuncJS(model, target, { log })
  postMessage({_status: 'loaded'})

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
    /*
      INIT MESSAGE
    */
    log('Init...')
    let m = data
    switch (m.type) {
      case 'tf':
        this.modelFunc = await initTF(m)
        break
      case 'py':
        this.modelFunc = await initPython(m)
        break
      case 'function':
      case 'class':
      case 'async-init':
      case 'async-function':
        this.modelFunc = await initJS(m)
        break
      case 'get':
      case 'post':
        this.modelFunc = await initAPI(m)
        break
      default:
        throw new Error(`No type information: ${m.type}`)
    }
  } else {
    /*
    CALL MESSAGE
    */
    var res
    if (typeof this.modelFunc === 'string') {
      // Python model:
      log('Calling Python model')
      /*
      const keys = Object.keys(data)
      for (let key of keys) {
        self[key] = data[key];
      }
      self.pyodide.runPythonAsync(this.model, () => {})
        .then((res) => {
          console.log('[Worker] Py results: ', typeof res, res)
	  postMessage(res)
        })
        .catch((err) => {
          // self.postMessage({error : err.message});
        })
      */
    } else {
      const results = await this.modelFunc(data)
      postMessage(results)
    }
  }
}
