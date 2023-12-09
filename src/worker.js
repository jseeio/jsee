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

function initJS (model) {
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
    log('Load code as a string')
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
  Promise.resolve(utils.getModelFuncJS(model, target, log))
    .then(m => {
      postMessage({_status: 'loaded'})
      this.modelFunc = m
    })
}

function initAPI (model) {
  log('Init API')
  this.modelFunc = utils.getModelFuncAPI(model, log)
}

onmessage = function (e) {

  var data = e.data
  log('Received message of type:', typeof data)

  if ((typeof data === 'object') && ((data.url) || (data.code))) {
    /*
      INIT MESSAGE
    */
    let model = data
    log('Init...')

    switch (model.type) {
      case 'tf':
        initTF(model)
        break
      case 'py':
        initPython(model)
        break
      case 'function':
      case 'class':
      case 'async-init':
      case 'async-function':
        initJS(model)
        break
      case 'get':
      case 'post':
        initAPI(model)
        break
    }
  } else {
    /*
    :w
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
      // JavaScript model
      log('Calling JavaScript model')
      if (this.container === 'args') {
        log('Applying inputs as arguments')
        res = this.modelFunc.apply(null, data)
      } else {
        // JS object or array
        log('Applying inputs as object/array')
        res = this.modelFunc(data, log, async (res) => {
          const r = await res
          postMessage(r)
          await utils.delay(1)
        })
      }
      // Return promise value or just regular value
      // Promise.resolve handles both cases
      Promise.resolve(res).then(r => { postMessage(r) })
    }
  }
}
