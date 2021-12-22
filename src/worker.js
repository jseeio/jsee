function log () {
  const args = Array.prototype.slice.call(arguments);
  args.unshift('[Worker]')
  console.log(args)
  postMessage({_status: 'log', _log: args})
}

onmessage = function (e) {
  var data = e.data
  log('Received message of type:', typeof data)

  if ((typeof data === 'object') && ((data.url) || (data.code))) {
    /*
      INIT MESSAGE
    */
    let model = data

    if (model.type === 'py') {
      // Python with Pyodide
      importScripts('https://pyodide.cdn.iodide.io/pyodide.js')
      // Check when all's loaded
      /*
      TODO: Implement same loaded as port
      let pyCheck = setInterval(() => {
        if (self.pyodide && self.pyodide.runPythonAsync && this.model && this.model.length) {
          console.log('[Worker] Pyodide lib and model loaded. Try running to preload all imports')
          self.pyodide.runPythonAsync(this.model, () => {})
            .then((res) => {
              postMessage({_status: 'loaded'})
            })
            .catch((err) => {
              postMessage({_status: 'loaded'})
            })
          clearInterval(pyCheck)
        }
      }, 500)
      */
    } else {
      // Javascript
      this.container = model.container

      if (model.code) {
        log('Load code from schema')
        // https://github.com/altbdoor/blob-worker/blob/master/blobWorker.js
        importScripts(URL.createObjectURL(new Blob([model.code], { type: 'text/javascript' })))
      } else if (model.url) {
        log('Load script from URL:', model.url)
        importScripts(model.url)
      } else {
        log('No script provided')
      }

      if (model.type === 'class') {
        log('[Worker] Init class')
        // this.modelFunc = (new this[model.name]())[model.method || 'predict']

        const modelClass = new this[model.name]()
        this.modelFunc = (...a) => {
          return modelClass[model.method || 'predict'](...a)
        }
      } else if (model.type === 'async-init') {
        log('Init function with promise')
        log(this[model.name])
        this[model.name]().then((m) => {
          log('Async init resolved: ', m)
          this.modelFunc = m
        })
      } else {
        log('Init function')
        this.modelFunc = this[model.name]
      }

      postMessage({_status: 'loaded'})
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
      // JavaScript model
      log('Calling JavaScript model')
      if (this.container === 'args') {
        log('Applying inputs as arguments')
        res = this.modelFunc.apply(null, data)
      } else {
        // JS object or array
        log('Applying inputs as object/array')
        res = this.modelFunc(data, log)
      }
      // Return promise value or just regular value
      // Promise.resolve handles both cases
      Promise.resolve(res).then(r => { postMessage(r) })
    }
  }
}
