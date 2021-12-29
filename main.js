import { createVueApp } from './src/app'
import Worker from './src/worker.js'

const utils = require('./src/utils')

const { Notyf } = require('notyf')
const notyf = new Notyf({
  types: [
    {
      type: 'success',
      background: '#00d1b2',
    },
    {
      type: 'error',
      background: '#f14668',
      duration: 2000,
      dismissible: true
    }
  ]
})

// const createVueApp = require('./src/app')
const Overlay = require('./src/overlay')

require('notyf/notyf.min.css')

const fetch = window['fetch']
const Blob = window['Blob']

let verbose = true
function log () {
  if (verbose) {
    console.log(`[JSEE v${VERSION}]`, ...arguments)
  }
}

// const Worker = window['Worker']

// Deep clone a simple object
function clone (obj) {
  // return JSON.parse(JSON.stringify(obj))
  return Object.assign({}, obj)
}

// https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
function isObject (item) {
  return (typeof item === 'object' && !Array.isArray(item) && item !== null)
}

function getName (code) {
  switch (typeof code) {
    case 'function':
      return code.name
    case 'string':
      const words = code.split(' ')
      const functionIndex = words.findIndex((word) => word == 'function')
      const name = words[functionIndex + 1]
      return name.includes('(') ? undefined : name
    default:
      return undefined
  }
}

// Return input value
function getValue (input) {
  if (input.type === 'group') {
    const value = {}
    input.elements.forEach(el => {
      value[el.name] = getValue(el)
    })
    return value
  } else {
    return input.value
  }
}

function getModelType (model) {
  if (model.code && typeof model.code === 'string' && model.code.split(' ').map(v => v.trim()).includes('def')) {
    return 'py'
  } else if (model.url) {
    return 'post'
  }
  return 'function'
}

// Nice trick to get a function parameters by Jack Allan
// From: https://stackoverflow.com/a/9924463/2998960
const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg
const ARGUMENT_NAMES = /([^\s,]+)/g
function getParamNames (func) {
  const fnStr = func.toString().replace(STRIP_COMMENTS, '')
  let result = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')')).match(ARGUMENT_NAMES)
  if (result === null)
    result = []
  return result
}

function getInputs (model) {
  if (model.code) {
    const params = getParamNames(model.code).filter(p => !['(', ')', '#', '{', '}'].some(c => p.includes(c)))
    log('Trying to infer inputs from params:', params)
    return params.map(p => ({
      'name': p,
      'type': 'string'
    }))
  }
  return []
}

function getFunctionContainer (target) {
  // Check if the number of parameters is > 1, then 'args'
}

export default class JSEE {
  constructor (params, alt1, alt2) {

    // Check if JSEE was initialized with args rather than with a params object
    if (('model' in params) || (typeof params === 'string') || (typeof params === 'function') || !(typeof alt === 'undefined')) {
      params = {
        'schema': params,
        'container': alt1,
        'verbose': alt2
      }
    }

    // Set global verbose flag
    verbose = !(params.verbose === false)

    // Previous naming
    params.schema = params.schema || params.config

    log('Initializing JSEE with parameters: ', params)
    this.params = params
    this.__version__ = VERSION

    // Get schema then initialize a new environment
    switch (typeof params.schema) {
      case 'object':
        log('Received schema as object')
        if (typeof params.schema.model === 'function') {
          params.schema.model = {
            code: params.schema.model
          }
        }
        this.init(params.schema)
        break
      case 'function':
        log('Received schema as function')
        params.schema = {
          model: {
            code: params.schema,
          }
        }
        this.init(params.schema)
        break
      case 'string':
        log('Received schema as string')
        this.schemaUrl = params.schema.indexOf('json') ? params.schema : params.schema + '.json'
        fetch(this.schemaUrl)
          .then(res => res.json())
          .then(res => {
            log('Loaded schema from url')
            this.init(res)
          })
          .catch((err) => {
            console.error(err)
          })
        break
      default:
        log('No schema provided')
        notyf.error('No schema provided')
    }
  }

  notify (txt) {
    notyf.success(txt)
  }

  init (schema) {
    this.loadCode(schema).then((code) => { // -> code
      this.initSchema(schema, code) // -> this.schema
      this.initVue() // -> this.app, this.data
      this.initWorker() // -> this.worker
      this.initRender() // -> this.renderFunc
      this.initModel() // -> this.modelFunc (depends on this.worker)
    })
  }

  loadCode (schema) {
    const initPromise = new Promise((resolve, reject) => {
      // Unwind this ball of possible cases
      let url = schema.model.url
      if (url && (url.includes('.js') || url.includes('.py'))) {
        // Update model URL if needed
        if (!url.includes('/') && this.schemaUrl && this.schemaUrl.includes('/')) {
          url = window.location.protocol + '//' + window.location.host + this.schemaUrl.split('/').slice(0, -1).join('/') + '/' + url
          log(`Changed the old model URL to ${url} (based on the schema URL)`)
        }
        fetch(url)
          .then(res => res.text())
          .then(res => {
            log('Loaded code from:', url)
            resolve(res)
          })
      } else if (!(typeof schema.model.code === 'undefined')) {
        log('Code is: schema.model.code')
        resolve(schema.model.code)
      } else {
        log('No code. Probably API...')
        resolve(undefined)
      }
    })

    return initPromise
  }

  initSchema (schema, code) {
    log('Initializing schema')

    // Check for empty model block
    if (typeof schema.model === 'undefined') {
      schema.model = {}
    }

    schema.model.code = code

    // Check for super minimal config
    // Check for worker flag
    if (typeof schema.model.worker === 'undefined') {
      schema.model.worker = true
    }

    // Check inputs
    // Relies on model.code
    // So run after possible fetching
    if (typeof schema.inputs === 'undefined') {
      schema.model.container = 'args'
      schema.inputs = getInputs(schema.model)
    }

    // Relies on input check
    // Set default input type
    schema.inputs.forEach(input => {
      if (typeof input.type === 'undefined') {
        input.type = 'string'
      }
    })

    // Infer model type
    if (typeof schema.model.type === 'undefined') {
      schema.model.type = getModelType(schema.model)
    }

    // Update model name if absent
    if (typeof schema.model.name === 'undefined'){
      if ((schema.model.url) && (schema.model.url.includes('.js'))) {
        schema.model.name = schema.model.url.split('/').pop().split('.')[0]
        log('Use model name from url: ', schema.model.name)
      } else if (schema.model.code) {
        schema.model.name = getName(schema.model.code)
      }
    }

    // At this point we have all code in model.code or api
    this.schema = clone(schema)
  }

  initVue () {
    log('Initializing VUE')
    this.app = createVueApp(this, (container) => {
      // Called when the app is mounted
      // FYI "this" here refers to port object
      this.outputsContainer = container.querySelector('#outputs')
      this.inputsContainer = container.querySelector('#inputs')
      this.modelContainer = container.querySelector('#model')
      // Init overlay
      this.overlay = new Overlay(this.inputsContainer ? this.inputsContainer : this.outputsContainer)
    }, log)
    this.data = this.app.$data
  }

  initWorker () {
    if (this.schema.model.worker) {
      log('Initializing Worker')
      this.worker = new Worker()
      this.worker.onmessage = (e) => {
        this.overlay.hide()
        const res = e.data
        if ((typeof res === 'object') && (res._status)) {
          switch (res._status) {
            case 'loaded':
              notyf.success('Loaded: JS model (in worker)')
              break
            case 'log':
              log(...res._log)
              break
          }
        } else {
          log('Response from worker:', res)
          this.output(res)
        }
      }
      this.worker.onerror = (e) => {
        this.overlay.hide()
        notyf.error(e.message)
        log('Error from worker:', e)
      }
    }
  }

  initRender () {
    if (this.schema.render && this.schema.render.url) {
      log('Initializing a render function')
      let script = document.createElement('script')
      script.src = this.schema.render.url
      script.onload = () => {
        notyf.success('Loaded: JS render')
        log('Loaded JS render')

        // Initializing the render (same in worker)
        if (this.schema.render.type === 'class') {
          log('Init render as class')
          const renderClass = new window[this.schema.render.name]()
          this.renderFunc = (...a) => {
            return renderClass[this.schema.render.method || 'render'](...a)
          }
        } else if (this.schema.render.type === 'async-init') {
          log('Init render function with promise')
          window[this.schema.render.name]().then((m) => {
            log('Async rebder init resolved: ', m)
            this.renderFunc = m
          })
        } else {
          log('Init render as function')
          this.renderFunc = window[this.schema.render.name]
        }
      }
      document.head.appendChild(script)
    }
  }

  initModel () {
    log('Initializing a model function')
    switch (this.schema.model.type) {
      case 'py':
        this.initPython()
        break
      case 'tf':
        this.initTF()
        break
      case 'function':
      case 'class':
      case 'async-init':
      case 'async-function':
        this.initJS()
        break
      case 'get':
      case 'post':
        this.initAPI()
        break
      default:
        notyf.error('No type information')
        break
    }
  }

  initPython () {
    // Add loading indicator
    this.overlay.show()
    let script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.18.1/full/pyodide.js'
    script.onload = async () => {
      this.pyodide = await loadPyodide({ indexURL : "https://cdn.jsdelivr.net/pyodide/v0.18.1/full/" });
      notyf.success('Loaded: Python')
      log('Loaded python code:', res)
      // Check if micropip is used
      if (res.includes('micropip')) {
        await this.pyodide.loadPackage('micropip')
        log('Loaded micropip')
      }
      // Import packages if defined
      if ('packages' in this.schema.model) {
        await this.pyodide.loadPackage(this.schema.model.packages)
        log('Loaded packages from schema')
      } else {
        await this.pyodide.loadPackagesFromImports(res)
        log('Loaded packages from Python code')
      }
      this.overlay.hide()
    }
    document.head.appendChild(script)
  }

  initJS () {
    // 1. String input <- loaded from url or code(string)
    // 2. Target object (can be function, class or a function with async init <- code(object)
    // 3. Model function

    // We always start from 1 or 2
    // For window execution we go: [1 ->] 2 -> 3
    // For worker: [2 ->] 1 -> Worker

    if (this.schema.model.worker) {
      // Worker: Initialize worker with the model
      // 2 -> 1
      if (typeof this.schema.model.code === 'function') {
        log('Convert code in schema to string for WebWorker')
        this.schema.model.code = this.schema.model.code.toString()
      }
      // Wrap anonymous functions
      if (!this.schema.model.name) {
        this.schema.model.code = `function anon () { return (${this.schema.model.code})(...arguments) }`
        this.schema.model.name = 'anon'
      }
      this.worker.postMessage(this.schema.model)
    } else {
      // Main: Initialize model in main window

      // Target here represents raw JS object (e.g. class), not the final callable function
      let target
      if (typeof this.schema.model.code === 'string') {
        // 1 -> 2
        // Danger zone
        if (this.schema.model.name) {
          log('Evaluating code from string (has name)')
          target = Function(
            `${this.schema.model.code} ;return ${this.schema.model.name}`
          )()
        } else {
          log('Evaluating code from string (no name)')
          target = eval(`(${this.schema.model.code})`) // ( ͡° ͜ʖ ͡°) YEAHVAL
        }
      } else {
        target = this.schema.model.code
      }

      // Need promise here in case of async init
      Promise.resolve(utils.getModelFuncJS(this.schema.model, target, log))
        .then(m => {
          this.overlay.hide()
          notyf.success('Loaded: JS model')
          this.modelFunc = m 
        })
    }
  }

  initAPI () {
    this.overlay.hide()
    if (this.schema.model.worker) {
      // Worker:
      this.worker.postMessage(this.schema.model)
    } else {
      // Main:
      this.modelFunc = utils.getModelFuncAPI(model, log)
    }
  }

  initTF () {
    let script = document.createElement('script')
    script.src = 'dist/tf.min.js'
    script.onload = () => {
      log('Loaded TF.js')
      this.overlay.hide()
      window['tf'].loadLayersModel(this.schema.model.url).then(res => {
        log('Loaded Tensorflow model')
      })
    }
    document.head.appendChild(script)
  }

  run () {
    const schema = this.schema
    const data = this.data
    log('Running the model...')
    // Collect input values
    let inputValues

    if (schema.model && schema.model.container && schema.model.container === 'args') {
      log('Pass inputs as function arguments')
      inputValues = data.inputs.map(input => getValue(input))
    } else {
      log('Pass inputs as object')
      inputValues = {}
      data.inputs.forEach(input => {
        if (input.name) {
          inputValues[input.name] = getValue(input)
        }
      })
    }
    log('Input values:', inputValues)
    // We have all input values here, pass them to worker, window.modelFunc or tf
    if (!schema.model.autorun) {
      this.overlay.show()
    }
    switch (schema.model.type) {
      case 'tf':
        break
      case 'py':
        data.inputs.forEach(input => {
          this.pyodide.globals.set(input.name, input.value);
        })
        this.pyodide.runPythonAsync(this.schema.model.code, () => {})
          .then((res) => {
            if (schema.outputs && schema.outputs.length) {
              const resultObj = {}
              schema.outputs.forEach(output => {
                resultObj[output.name] = this.pyodide.globals.get(output.name).toJs()
              })
              this.output(resultObj)
            } else {
              this.output(res)
            }
          })
          .catch((err) => {
            log(err)
            window['M'].toast({html: 'Error in code'})
          })
        break

      case 'class':
      case 'function':
      case 'async-init':
      case 'async-function':
      case 'get':
      case 'post':
        if (this.schema.model.worker) {
          this.worker.postMessage(inputValues)
        } else {
          // Run in main window
          var res
          if (this.schema.model.container === 'args') {
            res = this.modelFunc.apply(null, inputValues)
          } else {
            log('Applying inputs as object')
            res = this.modelFunc(inputValues)
          }
          log('modelFunc results:', res)
          Promise.resolve(res).then(r => { this.output(r) })
        }
        break
    }
  }

  output (res) {
    // TODO: Think about all edge cases
    // * No output field, but reactivity
    this.overlay.hide()

    if (typeof res === 'undefined') {
      return
    }

    log('Got output results of type:', typeof res)

    // Process results (res)
    const inputNames = this.schema.inputs.map(i => i.name)
    if (isObject(res) && Object.keys(res).every(key => inputNames.includes(key))) {
      // Update inputs from results
      log('Updating inputs:', Object.keys(res))
      this.data.inputs.forEach((input, i) => {
        if (input.name && (typeof res[input.name] !== 'undefined')) {
          log('Updating input: ', input.name, 'with data:', res[input.name])
          const r = res[input.name]
          if (typeof r === 'object') {
            Object.keys(r).forEach(k => {
              input[k] = r[k]
            })
          } else {
            input.value = r
          }
        }
      })
    } else if (this.renderFunc) {
      // Pass results to a custom render function
      log('Calling a render function...')
      this.renderFunc(res)
    } else if (Array.isArray(res) && res.length) {
      // Result is array
      if (this.data.outputs && this.data.outputs.length) {
        // We have outputs defined
        if (this.data.outputs.length === res.length) {
          // Same length
          this.data.outputs.forEach((output, i) => {
            output.value = res[i]
          })
        } else {
          // Different length
          this.data.outputs[0].value = res
        }
      } else {
        // Outputs are not defined
        this.data.outputs = [{
          'type': 'array',
          'value': res
        }]
      }
    } else if (typeof res === 'object') {
      if (this.data.outputs && this.data.outputs.length) {
        this.data.outputs.forEach((output, i) => {
          if (output.name && (typeof res[output.name] !== 'undefined')) {
            log('Updating output: ', output.name)
            output.value = res[output.name]
          }
        })
      } else {
        this.data.outputs = [{
          'type': 'object',
          'value': res
        }]
      }
    } else if (this.schema.outputs && this.schema.outputs.length === 1) {
      // One output value passed as raw js object
      this.data.outputs[0].value = res
    } else {
      this.data.outputs = [{
        'type': typeof res,
        'value': res
      }]
    }
  }
}
