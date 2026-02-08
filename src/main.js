import { createVueApp } from './app'
import Worker from './worker.js'

const utils = require('./utils')
const isObject = utils.isObject

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

const Overlay = require('./overlay')

require('notyf/notyf.min.css')

const fetch = window['fetch']
const Blob = window['Blob']

let verbose = true
function log () {
  if (verbose) {
    console.log(`[JSEE v${VERSION}]`, ...arguments)
    const logElement = document.querySelector('#log')
    if (logElement) {
      logElement.innerHTML += `\n${[...arguments].join(' ')}`
      logElement.scrollTop = logElement.scrollHeight // auto scroll to bottom
      if (logElement.innerHTML.length > 10000) {
        logElement.innerHTML = logElement.innerHTML.slice(-10000)
      }
    }
  }
}

// const Worker = window['Worker']

// Deep clone a simple object
function clone (obj) {
  // return JSON.parse(JSON.stringify(obj))
  return Object.assign({}, obj)
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
    // So two ways to init JSEE:
    // 1. new JSEE({schema: ..., container: ..., verbose: ...}) <- params object
    // 2. new JSEE(schema, container, verbose) <- args
    // This check converts args to params object (2 -> 1)
    if (('model' in params) || (typeof params === 'string') || (typeof params === 'function') || !(typeof alt1 === 'undefined')) {
      params = {
        'schema': params,
        'container': alt1,
        'verbose': alt2
      }
    }

    // Set global verbose flag
    // This check sets verbose to true in all cases except when params.verbose is explicitly set to false
    verbose = !(params.verbose === false)
    this.container = params.container
    this.schema = params.schema || params.config // Previous naming
    this.utils = utils
    this.__version__ = VERSION

    // Check if schema is provided
    if (typeof this.schema === 'undefined') {
      notyf.error('No schema provided')
      throw new Error('No schema provided')
    }

    // Check if container is provided
    if (typeof this.container === 'undefined') {
      // Check if 'jsee-container' exists
      if (document.querySelector('#jsee-container')) {
        this.container = '#jsee-container'
        log(`Using default container: ${this.container}`)
      } else {
        notyf.error('No container provided')
        throw new Error('No container provided')
      }
    }

    this.init()
  }

  log (...args) {
    log(...args)
  }

  notify (txt) {
    notyf.success(txt)
  }

  progress (i) {
    // Check if progress div is defined
    let progress = document.querySelector('#progress')
    if (!progress) {
      progress = document.createElement('div')
      progress.setAttribute('id', 'progress')
      progress.style = 'position: fixed; top: 0; left: 0; width: 0; height: 3px; background: #00d1b2; z-index: 1000;'
      document.body.appendChild(progress)
    }
    progress.style.width = `${i}%`
  }

  async init () {
    // At this point this.schema is defined but can be in different forms (e.g. string, object, function)
    await this.initSchema() // Inits: this.schema (object)
    await this.initModel() // Inits: this.model (array of objects)
    await this.initInputs() // Inits: schema inputs based on url
    await this.initVue() // Inits: this.app, this.data
    await this.initPipeline() // Inits: this.pipeline (function)
    if (this.schema.autorun || this.schema.inputs.some(input => input.disabled && input.reactive)) {
      // 1. If autorun is enabled in the schema, run the model immediately
      // 2. Server-side inputs: If there are inputs with disabled and reactive flags
      // (we assume that they are set by the server and trigger the model run)
      log('[Init] First run of the model due to autorun or reactive inputs')
      this.run('init')
    }
  }

  async initSchema () {
    // Check if schema is a string (url to json)
    if (typeof this.schema === 'string') {
      this.schemaUrl = this.schema.indexOf('json') ? this.schema : this.schema + '.json'

      // Check if schema is present in the hidden DOM element
      const schema = utils.loadFromDOM(this.schemaUrl)
      if (schema) {
        // Schema block found in the hidden element, use its content
        this.schema = JSON.parse(schema);
        log(`Loaded schema from the hidden DOM element for ${this.schemaUrl}:`, this.schema);
      } else {
        // Fetch schema from the URL
        log('Fetching schema from:', this.schemaUrl)
        this.schema = await fetch(this.schemaUrl)
        this.schema = await this.schema.json()
        log('Loaded schema from URL:', this.schema)
      }
    }

    // Check if schema is a function (model)
    if (typeof this.schema === 'function') {
      this.schema = {
        model: {
          code: this.schema,
        }
      }
    }

    // At this point schema should be an object
    if (!isObject(this.schema)) {
      notyf.error('Schema is in a wrong format')
      throw new Error(`Schema is in a wrong format: ${this.schema}`)
    }
  }

  async initModel () {
    // Model is the main part of the schema that defines all computations
    // At the end it should be an array of objects that define a sequence of tasks
    this.model = []

    // Check if there's a render or view defined in the schema
    let view = this.schema.render || this.schema.view
    if (isObject(view)) {
      // If view is an object, convert it to an array
      view = [view] // Convert to array if it's an object
    }
    if (Array.isArray(view)) {
      view.forEach(v => {
        v.worker = false // Render should not be in a worker
      })
      log('View is defined in the schema')
    }

    // Check if model is a function (model)
    ;[this.schema.model, view].forEach(m => {
      // Function -> {code: Function}
      if (typeof m === 'function') {
        this.model.push({
          code: m
        })
      } else if (Array.isArray(m)) {
        // concatenate
        this.model = this.model.concat(m)
      } else if (isObject(m)) {
        this.model.push(m)
      }
    })

    // Check if model is empty
    if (this.model.length === 0) {
      notyf.error('Model is in a wrong format')
      throw new Error(`Model is in a wrong format: ${this.schema.model}`)
    }

    // Put worker and imports inside model blocks
    ;['worker', 'imports'].forEach(key => {
      if (typeof this.schema[key] !== 'undefined') {
        this.model[0][key] = this.schema[key]
        delete this.schema[key]
      }
    })

    // Check if autorun is defined
    if (typeof this.model[0]['autorun'] !== 'undefined') {
      this.schema.autorun = this.model[0]['autorun']
      delete this.model[0]['autorun']
    }

    // Async for-loop over this.model
    for (const [i, m] of this.model.entries()) {
      if (typeof m.worker === 'undefined') {
        m.worker = i === 0 // Run first model in a web worker
      }

      // Load code if url is provided
      if (m.url && (m.url.includes('.js') || m.url.includes('.py'))) {
        // Try to get the code from a hidden DOM element first
        const modelCode = utils.loadFromDOM(m.url)
        if (modelCode) {
          // Code block found in the hidden element, use its content
          m.code = modelCode
          log(`Loaded code from the hidden DOM element for ${m.url}`);
        } else {
          // Update model URL if needed
          if (!m.url.includes('/') && this.schemaUrl && this.schemaUrl.includes('/')) {
            m.url = window.location.protocol + '//' + window.location.host + this.schemaUrl.split('/').slice(0, -1).join('/') + '/' + m.url
            log(`Changed the old model URL to ${m.url} (based on the schema URL)`)
          }
          log('Loaded code from:', m.url)
          m.code = await fetch(m.url)
          m.code = await m.code.text()
        }
      }

      // Update model name if absent
      if (typeof m.name === 'undefined'){
        if ((m.url) && (m.url.includes('.js'))) {
          m.name = m.url.split('/').pop().split('.')[0]
          log('Use model name from url:', m.name)
        } else if (m.code) {
          m.name = getName(m.code)
          log('Use model name from code:', m.name)
        }
      }

      // Check if imports are string -> convert to array
      if (typeof m.imports === 'string') {
        m.imports = [m.imports]
      }

      // Infer model type
      if (typeof m.type === 'undefined') {
        m.type = getModelType(m)
      }

      // Load imports from hidden DOM element
      if (m.imports && Array.isArray(m.imports) && m.imports.length) {
        for (let [i, imp] of m.imports.entries()) {
          if (typeof imp === 'string') {
            // Convert string to object
            m.imports[i] = {
              url: imp
            }
            imp = m.imports[i]
          }
          if (!m.type.includes('py')) {
            imp.url = utils.getUrl(imp.url) 
            imp.code = utils.loadFromDOM(imp.url)
          }
        }
      }
      console.log('Imports:', m.imports)
    } // end of model-loop

    log('Models initialized:', this.model.length)
  }

  async initInputs () {
    // Check inputs
    // Relies on model.code
    // So run after possible fetching
    if (typeof this.schema.inputs === 'undefined') {
      this.model[0].container = 'args'
      this.schema.inputs = getInputs(this.model[0])
    }

    // Read URL params, e.g. ?input1=1&input2=2
    const urlParams = new URLSearchParams(window.location.search)
    log('URL params:', urlParams)

    // Iterate over inputs and set values from URL
    this.schema.inputs.forEach(input => {
      // Set default input type
      if (typeof input.type === 'undefined') {
        input.type = 'string'
      }

      // Get input value from URL params
      let paramValue = null
      if (urlParams.has(input.name)) {
        paramValue = urlParams.get(input.name);
      } else if (urlParams.has(utils.sanitizeName(input.name))) {
        paramValue = urlParams.get(utils.sanitizeName(input.name));
      } else if (input.alias) {
        // Handle alias as either a string or an array of strings
        if (Array.isArray(input.alias)) {
          for (let alias of input.alias) {
            if (urlParams.has(alias)) {
              paramValue = urlParams.get(alias);
              break;
            }
          }
        } else if (typeof input.alias === 'string' && urlParams.has(input.alias)) {
          paramValue = urlParams.get(input.alias);
        }
      }
      log(`Param value for ${input.name}:`, paramValue)

      // Set input value from URL param with type conversion
      if (paramValue !== null) {
        if (input.type === 'file') {
          input.url = paramValue;
        } else {
          switch (input.type) {
            case 'number':
              paramValue = Number(paramValue);
              break;
            case 'boolean':
              paramValue = paramValue === 'true';
              break;
            case 'json':
              try {
                paramValue = JSON.parse(paramValue);
              } catch (e) {
                console.error(`Failed to parse JSON for input ${input.name}:`, e);
              }
              break;
            default:
              break;
          }
          input.default = paramValue
        }
      }
    })
    log('Inputs are:', this.schema.inputs)
  }

  initVue () {
    return new Promise((resolve, reject) => {
      try {
        log('Initializing VUE')
        this.app = createVueApp(this, (container) => {
          // Called when the app is mounted
          // FYI "this" here refers to port object
          this.outputsContainer = container.querySelector('#outputs')
          this.inputsContainer = container.querySelector('#inputs')
          this.modelContainer = container.querySelector('#model')
          // Init overlay
          this.overlay = new Overlay(this.inputsContainer ? this.inputsContainer : this.outputsContainer)
          // Add stop button to the overlay if interval is defined
          if (this.schema.interval) {
            this.stopElement = document.createElement('button')
            this.stopElement.innerHTML = 'Stop'
            this.stopElement.style = 'background: white; color: #333; border: 1px solid #DDD; padding: 10px; border-radius: 5px; cursor: pointer;'
            this.stopElement.addEventListener('hover', () => {
              log('Stopping the pipeline')
              this.running = false
            })
            this.overlay.element.innerHTML = ''
            this.overlay.element.appendChild(this.stopElement)
          }
          resolve()
        }, log)
        this.data = this.app.$data
      } catch (err) {
        reject(err)
      }
    })
  }

  async initPipeline () {
    // Initial identity operation (just pass the input to output)
    this.pipeline = (inputs) => inputs
    // Async for-loop over this.model (again)
    for (const [i, m] of this.model.entries()) {
      let modelFunc
      if (m.worker) {
        // Init worker model
        log(`[Init pipeline] Initializing model ${i} in a worker: ${m.name || m.url}`)
        modelFunc = await this.initWorker(m)
      } else {
        // Init specific model types
        log(`[Init pipeline] Initializing model ${i} in the main thread: ${m.name || m.url}`)
        switch (m.type) {
          case 'py':
            modelFunc = await this.initPython(m)
            break
          case 'tf':
            modelFunc = await this.initTF(m)
            break
          case 'function':
          case 'class':
          case 'async-init':
          case 'async-function':
            modelFunc = await this.initJS(m)
            break
          case 'get':
          case 'post':
            log('Initializing API model')
            modelFunc = await this.initAPI(m)
            break
          default:
            notyf.error('No type information')
            throw new Error(`No type information: ${m.type}`)
        }
      }

      this.pipeline = (p => {
        return async (inputs) => {
          const resPrev = await p(inputs)
          // Early stop if resPrev is object and has stop flag
          if (isObject(resPrev) && resPrev.stop) {
            log('[Pipeline] Stopping the pipeline due to stop flag in the result')
            return resPrev
          }
          const resNext = await modelFunc(resPrev)
          if (isObject(resNext) && isObject(resPrev)) {
            // If both results are objects, merge them
            log(`[Pipeline] Merging results: ${Object.keys(resPrev).join(', ')} + ${Object.keys(resNext).join(', ')}`)
            return Object.assign({}, resPrev, resNext)
          } else if (typeof resNext !== 'undefined') {
            // If next result is defined, return it
            return resNext
          } else {
            // Otherwise return previous result (pass through)
            log('[Pipeline] Passing through the previous result')
            return resPrev
          }
        }
      })(this.pipeline)

      notyf.success('Pipeline initialized')
      this.overlay.hide()
    }
  }

  async initWorker (model) {
    // Init worker
    const worker = new Worker()

    // Init worker with the model
    if (typeof model.code === 'function') {
      log('Convert code in schema to string for WebWorker')
      model.code = model.code.toString()
    }

    // Wrap anonymous functions
    if (!model.name) {
      model.code = `function anon () { return (${model.code})(...arguments) }`
      model.name = 'anon'
    }

    const modelFunc = (inputs) => new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const res = e.data
        if ((typeof res === 'object') && (res._status)) {
          switch (res._status) {
            case 'loaded':
              notyf.success('Loaded model (in worker)')
              log('Loaded model (in worker):', res)
              resolve(res)
              break
            case 'log':
              log(...res._log)
              break
            case 'progress':
              this.progress(res._progress)
              break
            case 'error':
              notyf.error(res._error)
              log('Error from worker:', res._error)
              reject(res._error)
              break
          }
        } else {
          log('Response from worker:', res)
          resolve(res)
        }
      }
      worker.onerror = (e) => {
        notyf.error(e.message)
        log('Error from worker:', e)
        reject(e)
      }
      worker.postMessage(inputs)
    })

    // Initial worker call with model definition
    await modelFunc(model)

    // Worker will be in the context of each modelFunc
    return modelFunc
  }

  async initPython (model) {
    // Add loading indicator
    this.overlay.show()
    await utils.importScripts(['https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js'])
    const pyodide = await loadPyodide()
    if (model.imports && Array.isArray(model.imports) && model.imports.length) {
      await pyodide.loadPackage(model.imports.url)
    } else {
      await pyodide.loadPackagesFromImports(model.code)
    }
    return async (data) => {
      for (let key in data) {
        window[key] = data[key]
      }
      return await pyodide.runPythonAsync(model.code);
    }
  }

  async initJS (model) {
    // 1. String input <- loaded from url or code(string)
    // 2. Target object (can be function, class or a function with async init <- code(object)
    // 3. Model function

    // We always start from 1 or 2
    // For window execution we go: [1 ->] 2 -> 3
    // For worker: [2 ->] 1 -> Worker

    // Main: Initialize model in main window

    // Load imports if defined (before calling the model)
    if (model.imports && model.imports.length) {
      log('Loading imports from schema')
      await utils.importScripts(...model.imports)
      notyf.success('Loaded: JS imports')
    }

    // Target here represents raw JS object (e.g. class), not the final callable function
    let target
    if (typeof model.code === 'string') {
      // 1 -> 2
      // Danger zone
      if (model.name) {
        log('Evaluating code from string (has name)')
        target = Function(
          `${model.code} ;return ${model.name}`
        )()
      } else {
        log('Evaluating code from string (no name)')
        target = eval(`(${model.code})`) // ( ͡° ͜ʖ ͡°) YEAHVAL
      }
    } else {
      target = model.code
    }

    const modelFunc = await utils.getModelFuncJS(model, target, this)
    return modelFunc
  }

  initAPI (model) {
    log('Initializing API model:', model)
    this.overlay.hide()
    if (model.worker) {
      // Worker:
      this.worker.postMessage(model)
    } else {
      // Main:
      return utils.getModelFuncAPI(model, log)
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

  async run (caller='run') {
    // caller can be:
    // 1. custom input button name
    // 2. `run`
    // 3. `autorun`
    const schema = this.schema
    const data = this.data
    this.running = true

    log('Running the pipeline...')
    // Collect input values
    let inputValues = {}
    data.inputs.forEach(input => {
      // Skip buttons
      if (input.name && !(input.type == 'action' || input.type == 'button')) {
        inputValues[input.name] = getValue(input)
      }
    })
    // Add caller to input values so we can change model behavior based on it
    inputValues.caller = caller

    log('Input values:', inputValues)
    // We have all input values here, pass them to worker, window.modelFunc or tf
    if (!schema.model.autorun) {
      this.overlay.show()
    }

    // Run pipeline
    const results = await this.pipeline(inputValues)

    // Output results
    this.output(results)

    // Check if interval is defined
    if (schema.interval && this.running && (caller === 'run')) {
      log('Interval is defined:', schema.interval)
      await utils.delay(schema.interval)
      await this.run(caller)
    }

    // Hide overlay
    this.overlay.hide()
    return
  }

  async outputAsync (res) {
    this.output(res)
    await delay(1)
  }

  output (res) {
    // TODO: Think about all edge cases
    // * No output field, but reactivity

    if (typeof res === 'undefined') {
      return
    }

    log('[Output] Got output results of type:', typeof res)

    const inputNames = this.schema.inputs ? this.schema.inputs.map(i => i.name) : []
    log('Input names:', inputNames)

    if (isObject(res)) {
      // Drop system fields
      delete res.caller
      delete res.stop
      delete res._status
      delete res._log
      delete res._progress
      log('Processing results as an object:', res)

      if (Object.keys(res).every(key => inputNames.includes(key))) {
        // Update input fields from results
        // e.g. loading a csv file and updating list of target variables
        // This will be dynamically updated in the UI
        log('Updating inputs from results with keys:', Object.keys(res))
        this.data.inputs.forEach((input, i) => {
          if (input.name && (typeof res[input.name] !== 'undefined')) {
            log(`Updating input: ${input.name} with data: ${res[input.name]}`)
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
      } else if (this.data.outputs && this.data.outputs.length) {
        // Update outputs from results
        log('Updating outputs from results with keys:', Object.keys(res))
        this.data.outputs.forEach((output, i) => {
          // try output.name, sanitized output.name, output.alias
          const r = res[output.name] 
            || res[utils.sanitizeName(output.name)] 
            || (output.alias && res[output.alias])
          if (typeof r !== 'undefined') {
            log(`Updating output: ${output.name} with data: ${typeof r}`)
            output.value = r
          }
        })
      } else if (!this.schema.render && !this.schema.view) {
        // There's no render or view defined in the schema, also:
        // No outputs defined, create outputs from results
        log('Creating outputs from results with keys:', Object.keys(res))
        this.data.outputs = Object.keys(res)
          .filter(key => !inputNames.includes(key))
          .filter(key => key !== 'caller') // Filter out caller
          .map(key => {
            return {
              'name': key,
              'type': typeof res[key],
              'value': res[key]
            }
          })
      }
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

  async download (title='output') {
    // Cache the model
    const clone = document.cloneNode(true)

    // Change #download-btn to 'Offline: version'
    const downloadBtn = clone.getElementById('download-btn')
    downloadBtn.textContent = 'Offline: latest'
    downloadBtn.disabled = true
    downloadBtn.style.cursor = 'not-allowed'

    let hiddenElement = clone.getElementById('hidden-storage');
    if (!hiddenElement) {
      hiddenElement = clone.createElement('div');
      hiddenElement.style.display = 'none'; // Make it hidden
      hiddenElement.id = 'hidden-storage'; // Assign an ID
      clone.body.prepend(hiddenElement)
    }

    function storeInHiddenElement (url, value) {
      const element = clone.createElement('script')
      element.type = 'text/plain' // Make it non-executable
      element.style.display = 'none' // Make it hidden
      element.setAttribute('data-src', url) // Use data attribute for key
      element.textContent = typeof value === 'object' ? JSON.stringify(value) : value
      hiddenElement.appendChild(element)
      console.log('[Hidden store] Stored:', url)
    }

    // Remove Google Analytics script tags
    try {
      clone.getElementById('ga-src').remove()
      clone.getElementById('ga-body').remove()
    } catch (error) {
      console.error('Error removing GA script tags:', error.message)
    }

    console.log('Caching schema:', env.schema)
    storeInHiddenElement(env.schemaUrl, env.schema)

    console.log('Caching models:', env.model)
    for (const model of env.model) {
      storeInHiddenElement(model.url, model.code)
      // Iterate over imports
      if (model.imports) {
        for (let imp of model.imports) {
          // Store the import
          const response = await fetch(imp.url)
          const content = await response.text()
          storeInHiddenElement(imp.url, content)
          // Remove any src-based script tags with the same URL
          const script = clone.querySelector('script[src="' + imp.url + '"]')
          if (script) {
            script.remove()
          }
        }
      }
    }

    // append dummy src script for webpack fix
    // const dummyScript = document.createElement('script')
    // dummyScript.src = 'https://example.com/dummy.js'
    // clone.body.appendChild(dummyScript)

    // Find all external script tags and replace them with inline script tags
    const externalScripts = Array.from(clone.querySelectorAll('script[src]'))
    for (const script of externalScripts) {
      try {
        const response = await fetch(script.src);
        if (!response.ok) throw new Error('Network response was not ok for script:' + script.src);
        const content = await response.text()
        const inlineScript = document.createElement('script')
        inlineScript.textContent = content
        inlineScript.setAttribute('data-src', script.src)
        script.parentNode.replaceChild(inlineScript, script)
      } catch (error) {
        console.error("Error fetching script:", error.message);
      }
    }
    // Prepare the HTML for download and trigger the download
    const html = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML
    console.log(html)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = title + '.html'
    a.click()
    URL.revokeObjectURL(url)
  }
}
