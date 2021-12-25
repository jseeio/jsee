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

function log () {
  console.log(`[JSEE v${VERSION}]`, ...arguments)
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
  const words = code.split(' ')
  const functionIndex = words.findIndex((word) => word == 'function')
  return words[numberIndex + 1]
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

function getType (model) {
  if (model.code) {
    let target
    if (typeof model.code === 'string') {
      if (model.code.split(' ').map(v => v.trim()).includes('def')) {
        return 'py'
      }
      target = eval('(' + model.code + ')')
    } else {
      target = model.code
    }
    if (typeof target === 'function') {
      if (/^class[\s{]/.test(toString.call(target))) {
        return 'class'
      } else {
        return 'function'
      }
    }
  } else if (model.url) {
    const lastWordInURL = model.url.split('/').pop()
    if (lastWordInURL.includes('py')) {
      return 'py'
    } else if (lastWordInURL.includes('js')) {
      return 'js'
    } else {
      return 'post'
    }
  }
  return undefined
}

// Nice trick by Jack Allan
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
    const params = getParamNames(model.code)
    return params.map(p => ({
      'name': p,
      'type': 'string'
    }))
  }
  return []
}

export default class JSEE {
  constructor (params) {
    log('Initializing JSEE with parameters: ', params)
    params.schema = params.schema || params.config
    this.params = params
    this.__version__ = VERSION

    // Get schema then initialize a model 
    if (params.schema) {
      if (typeof params.schema === 'object') {
        log('Received schema as object')
        this.init(params.schema)
      } else if (typeof params.schema === 'string') {
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
      }
    }
  }

  notify (txt) {
    notyf.success(txt)
  }

  // Initialize model from schema
  init (schema) {
    log('Initializing schema', schema)

    // Update model URL if needed 
    if (schema.model.url && !schema.model.url.includes('/') && this.schemaUrl && this.schemaUrl.includes('/')) {
      let oldModelUrl = schema.model.url
      log('Schema URL:', this.schemaUrl)
      schema.model.url = window.location.protocol + '//' + window.location.host + this.schemaUrl.split('/').slice(0, -1).join('/') + '/' + oldModelUrl
      log('Changed the old model URL to absolute one:', oldModelUrl, schema.model.url)
    }

    // Check for worker flag
    if (typeof schema.model.worker === 'undefined') {
      schema.model.worker = true
    }

    // Check inputs
    if (typeof schema.inputs === 'undefined') {
      schema.inputs = getInputs(schema.model)
    }
    schema.inputs.forEach(input => {
      if (typeof input.type === 'undefined') {
        input.type = 'string'
      }
    })

    // Check if name is present, if not - get name from the file
    if (typeof schema.model.name === 'undefined') {
      // Two options here
      if (schema.model.url) {
        // 1. Get the name from the file name
        schema.model.name = schema.model.url.split('/').pop().split('.')[0]
        log('Use name from url: ', schema.model.name)
      } else if (schema.model.code) {
        // 2. Get the name from the url
        // TODO: WILL NOT WORK. CODE IS STRING
        schema.model.name = schema.model.code.name
        log('Use name from code: ', schema.model.name)
      }
    }

    this.schema = clone(schema)

    // Init Vue app
    // ------------
    this.app = createVueApp(this, this.schema, (container) => {
      // Called when the app is mounted
      // FYI "this" here refers to port object
      this.outputsContainer = container.querySelector('#outputs')
      this.inputsContainer = container.querySelector('#inputs')
      this.modelContainer = container.querySelector('#model')
      // Init overlay
      this.overlay = new Overlay(this.inputsContainer ? this.inputsContainer : this.outputsContainer)
    })
    this.data = this.app.$data

    // Init WebWorker
    // --------------
    if (this.schema.model.worker) {
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

    // Infer model type
    if (typeof this.schema.model.type === 'undefined') {
      this.schema.model.type = getType(this.schema.model)
    }

    // Init Model
    // ----------
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

    // Init render
    // -----------
    if (this.schema.render && this.schema.render.url) {
      log('Init render in window')
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

  initPython () {
    // Add loading indicator
    this.overlay.show()
    let script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.18.1/full/pyodide.js'
    script.onload = async () => {
      this.pyodide = await loadPyodide({ indexURL : "https://cdn.jsdelivr.net/pyodide/v0.18.1/full/" });
      notyf.success('Loaded: Python')
      const resRaw = await fetch(this.schema.model.url)
      const res = await resRaw.text()
      this.pymodel = res
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
    // Worker: Initialize worker with the model
    if (this.schema.model.worker) {
      if (this.schema.model.url) {
        fetch(this.schema.model.url)
          .then(res => res.text())
          .then(res => {
            log('Loaded JS code for worker from:', this.schema.model.url)
            this.schema.model.code = res
            this.worker.postMessage(this.schema.model)
          })
      } else if (this.schema.model.code) {
        if (typeof this.schema.model.code !== 'string') {
          log('Convert code in schema to string for WebWorker')
          this.schema.model.code = this.schema.model.code.toString()
        }
        this.worker.postMessage(this.schema.model)
      } else {
        notyf.error('No code provided')
      }
    } else {
      // Main: Initialize model in main window

      const prepModelFunc = () => {
        // Classes are not added to window. So there is an extra check.
        // https://stackoverflow.com/questions/37711603/javascript-es6-class-definition-not-accessible-in-window-global
        const target = this.schema.model.type === 'class'
          ? eval(this.schema.model.name)
          : window[this.schema.model.name]
        // Need promise here in case of async init
        Promise.resolve(utils.getModelFuncJS(this.schema.model, target, log))
          .then(m => {
            this.overlay.hide()
            notyf.success('Loaded: JS model')
            this.modelFunc = m 
          })
      }

      if (this.schema.model.url) {
        log('Init model in main window from URL:', this.schema.model.url)
        let script = document.createElement('script')
        script.src = this.schema.model.url
        script.onload = () => {
          log('Loaded: script file')
          prepModelFunc()
        }
        document.head.appendChild(script)
      } else if (this.schema.model.code) {
        // Danger zone
        if (typeof this.schema.model.code === 'string') {
          if (this.schema.model.name) {
            log('Evaluating code from string (has name)')
            this.modelFunc = Function(
              `${this.schema.model.code} ;return ${this.schema.model.name}`
            )()
          } else {
            log('Evaluating code from string (no name)')
            this.modelFunc = eval(`(${this.schema.model.code})`) // ( ͡° ͜ʖ ͡°) YEAHVAL
          }
        } else {
          prepModelFunc()
        }
      }

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
      log('Pass inputs in an object')
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
        this.pyodide.runPythonAsync(this.pymodel, () => {})
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
