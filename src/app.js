const { cloneSchema, collectInputValues: collectValues, getOptionValue, getInputDefaultValue } = require('./schema')
// import Vue from 'vue'
// import { createApp } from 'vue'
// import { createApp } from 'vue/dist/vue.esm-bundler'
// import { createApp, h } from 'vue/dist/vue.runtime.esm-bundler.js'

import { createApp, h } from 'vue' // <- resolved in webpack.config based on RUNTIME

import minimalApp from '../templates/minimal-app.vue'
import minimalInput from '../templates/minimal-input.vue'
import minimalOutput from '../templates/minimal-output.vue'

const defaultTheme = {
  'app': minimalApp,
  'input': minimalInput,
  'output': minimalOutput
}

const components = {
  'minimal': defaultTheme,
  'bulma': defaultTheme // backward compat alias
}

const filtrex = require('filtrex')
const JsonViewer = require('vue3-json-viewer').default
const { sanitizeName, debounce, createValidateFn, runValidation, normalizeSecurityOptions } = require('./utils.js')

const LEGACY_STORAGE_KEY = 'jsee:inputs'
const STORAGE_SKIP_TYPES = new Set(['file', 'image', 'audio', 'video', 'folder', 'action', 'button'])

function stableHash (value) {
  const text = String(value == null ? '' : value)
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i)
    hash = hash >>> 0
  }
  return hash.toString(36)
}

function optionIncludesValue (options, value) {
  if (!Array.isArray(options) || options.length === 0) return true
  return options
    .map(getOptionValue)
    .some(option => option === value || String(option) === String(value))
}

function isNumberWithinInputRange (input, value, integer=false) {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) return false
  if (integer && !Number.isInteger(numberValue)) return false
  if (typeof input.min !== 'undefined' && numberValue < Number(input.min)) return false
  if (typeof input.max !== 'undefined' && numberValue > Number(input.max)) return false
  return true
}

function isValidStoredInputValue (input, value) {
  switch (input.type) {
    case 'int':
      return isNumberWithinInputRange(input, value, true)
    case 'float':
    case 'number':
    case 'slider':
      return isNumberWithinInputRange(input, value)
    case 'range':
      return Array.isArray(value)
        && value.length === 2
        && value.every(v => isNumberWithinInputRange(input, v))
        && Number(value[0]) <= Number(value[1])
    case 'bool':
    case 'checkbox':
    case 'toggle':
      return typeof value === 'boolean'
    case 'categorical':
    case 'select':
    case 'radio':
      return optionIncludesValue(input.options, value)
    case 'multi-select':
      return Array.isArray(value) && value.every(v => optionIncludesValue(input.options, v))
    case 'color':
      return typeof value === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)
    case 'date':
      return typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value))
    case 'string':
    case 'text':
      return typeof value === 'string'
    default:
      return true
  }
}

function normalizeStoredInputValue (input, value) {
  switch (input.type) {
    case 'int':
      return Math.trunc(Number(value))
    case 'float':
    case 'number':
    case 'slider':
      return Number(value)
    case 'range':
      return [Number(value[0]), Number(value[1])]
    default:
      return value
  }
}

function shouldPersistInput (input) {
  return input
    && input.type !== 'group'
    && input.disabled !== true
    && !STORAGE_SKIP_TYPES.has(input.type)
}

function getInputStorageBase (input, index) {
  const name = input.name ? sanitizeName(input.name) : `input_${index}`
  return `${index}_${name}`
}

function getInputStorageKey (input, index, path) {
  return path.concat(getInputStorageBase(input, index)).join('.')
}

function forEachStorageInput (inputs, callback, path=[]) {
  if (!Array.isArray(inputs)) return
  inputs.forEach((input, index) => {
    if (!input) return
    const key = getInputStorageKey(input, index, path)
    if (input.type === 'group') {
      forEachStorageInput(input.elements, callback, path.concat(getInputStorageBase(input, index)))
      return
    }
    callback(input, index, key, path)
  })
}

function normalizeInputShape (inputs, path=[]) {
  if (!Array.isArray(inputs)) return []
  return inputs.map((input, index) => {
    const key = getInputStorageKey(input || {}, index, path)
    if (!input) {
      return { key, type: 'unknown' }
    }
    const shape = {
      key,
      name: input.name || '',
      type: input.type || 'string'
    }
    if (typeof input.min !== 'undefined') shape.min = input.min
    if (typeof input.max !== 'undefined') shape.max = input.max
    if (Array.isArray(input.options)) shape.options = input.options.map(getOptionValue)
    if (input.type === 'group') {
      shape.elements = normalizeInputShape(input.elements, path.concat(getInputStorageBase(input, index)))
    }
    return shape
  })
}

function getContainerStorageId (container) {
  if (typeof container === 'string') return container
  if (!container || typeof document === 'undefined') return 'body'
  if (container.id) return `#${container.id}`
  if (container.dataset && container.dataset.jseeId) return `[data-jsee-id="${container.dataset.jseeId}"]`
  if (container === document.body) return 'body'
  const siblings = Array.prototype.slice.call(document.body.querySelectorAll('*'))
  const index = siblings.indexOf(container)
  const tag = container.tagName ? container.tagName.toLowerCase() : 'element'
  return `${tag}:${index}`
}

function getInputsStorageKey (schema, container) {
  const page = schema.page || {}
  const locationPath = (typeof window !== 'undefined' && window.location)
    ? window.location.pathname
    : 'page'
  const appId = schema.id || page.url || schema.name || schema.title || locationPath || 'app'
  const containerId = getContainerStorageId(container)
  const shape = normalizeInputShape(schema.inputs)
  return `${LEGACY_STORAGE_KEY}:${stableHash(`${appId}:${containerId}`)}:${stableHash(JSON.stringify(shape))}`
}

function getStoredValue (values, input, index, key, path) {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key]
  if (path.length === 0 && input.name && Object.prototype.hasOwnProperty.call(values, input.name)) {
    return values[input.name]
  }
  const legacyIndexKey = `input_${index}`
  if (path.length === 0 && Object.prototype.hasOwnProperty.call(values, legacyIndexKey)) {
    return values[legacyIndexKey]
  }
  return undefined
}

function saveInputsToStorage (inputs, storageKey) {
  try {
    const values = {}
    forEachStorageInput(inputs, (input, index, key) => {
      if (!shouldPersistInput(input)) return
      values[key] = input.value
    })
    localStorage.setItem(storageKey, JSON.stringify(values))
  } catch (e) { /* quota exceeded or private mode */ }
}

function loadInputsFromStorage (inputs, storageKey) {
  try {
    const raw = localStorage.getItem(storageKey) || localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return false
    const values = JSON.parse(raw)
    let restored = false
    forEachStorageInput(inputs, (input, index, key, path) => {
      if (!shouldPersistInput(input)) return
      const value = getStoredValue(values, input, index, key, path)
      if (typeof value !== 'undefined' && isValidStoredInputValue(input, value)) {
        input.value = normalizeStoredInputValue(input, value)
        restored = true
      }
    })
    return restored
  } catch (e) { return false }
}

function clearInputsStorage (storageKey) {
  try {
    localStorage.removeItem(storageKey)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch (e) { /* ignore */ }
}

function setInputValue (input, value) {
  if (input.type === 'file') {
    // Only strings can seed the URL picker; nullable/opaque file defaults remain values.
    const urlDefault = typeof value === 'string' && !/[\r\n]/.test(value)
    input.url = urlDefault ? value : ''
    input.value = urlDefault ? '' : value
    input.file = null // Reset file object
  } else {
    // For other inputs, we can set the value directly
    input.value = value
  }
}

function resetInputs (inputs, example) {
  inputs.forEach((input, index) => {
    const inputName = input.name ? sanitizeName(input.name) : `input_${index}`
    if (example && input.name && typeof example[input.name] !== 'undefined') {
      // Object (unsanitized)
      setInputValue(input, example[input.name])
    } else if (example && inputName && typeof example[inputName] !== 'undefined') {
      // Object (sanitized)
      setInputValue(input, example[inputName])
    } else if (example && Array.isArray(example) && typeof example[index] !== 'undefined') {
      // Array
      setInputValue(input, example[index])
    } else if (typeof input.default !== 'undefined') {
      // Default value
      setInputValue(input, input.default)
    } else {
      if (input.type === 'group') resetInputs(input.elements)
      else {
        if (input.type === 'file') input.file = null
        const value = getInputDefaultValue(input)
        input.value = value === undefined && !['image', 'audio', 'video'].includes(input.type) ? '' : value
      }
    }
  })
}

function getValidationInputs (inputs) {
  return inputs.flatMap(input => input.type === 'group'
    ? [input, ...getValidationInputs(input.elements || [])]
    : [input])
}

function createVueApp (env, mountedCallback, logMain) {
  function log () {
    logMain('[Vue]', ...arguments)
  }

  // Vue's data is based on schema
  const dataInit = cloneSchema(env.schema)
  dataInit._security = env.security || normalizeSecurityOptions(env.schema.security)
  // Determine a container for Vue app
  const container = env.container
    ? (typeof env.container === 'string')
      ? document.querySelector(env.container)
      : env.container
    : document.body
  const storageKey = getInputsStorageKey(env.schema, container)

  // Reset input values to default ones
  resetInputs(dataInit.inputs)

  // Restore saved inputs from localStorage (unless URL params are present or persist: false)
  const hasUrlParams = new URLSearchParams(window.location.search).toString().length > 0
  if (env.schema.persist !== false && !hasUrlParams) {
    loadInputsFromStorage(dataInit.inputs, storageKey)
  }

  if (!('outputs' in dataInit)) {
    dataInit.outputs = []
  }

  // Flag that shows if data was changed from initial conditions
  dataInit.dataChanged = false
  // Flag for autorun feedback
  dataInit.clickRun = false
  // Flag for running state (toggled by main.js run/stop)
  dataInit.running = false

  function len (s) {
    return s.length
  }

  let filtrexOptions = {
    extraFunctions: { len }
  }

  // Initialize _error property on all inputs for reactivity
  const validationInputs = getValidationInputs(dataInit.inputs)
  validationInputs.forEach(input => {
    input._error = null
  })

  // Prepare validation functions for inputs with validate or required
  const validateFunctions = validationInputs.map(input =>
    createValidateFn(input, filtrex.compileExpression, filtrexOptions)
  )

  // Prepare functions that determine if inputs should be displayed
  const displayFunctions = dataInit.inputs.map(input => {
    if (input.display && input.display.length) {
      const f = filtrex.compileExpression(input.display.replace(/\'/g, '"'), filtrexOptions)
      return function DisplayConditionally (data) {
        const inputObj = {}
        data.inputs.filter(input => input.name).forEach(input => {
          // Sanitize input name. This will allow to operate with human-readable names
          // and use them as object keys. For example, 'Input 1' will be converted to 'input_1'
          const inputNameSanitized = sanitizeName(input.name) 
          inputObj[input.name] = input.value
          inputObj[inputNameSanitized] = input.value
        })
        return f(inputObj)
      }
    } else {
      return function DisplayAlways () {
        return true
      }
    }
  })

  // Determine a template and GUI framework
  const framework = (env.schema.design && typeof env.schema.design.framework !== 'undefined')
    ? env.schema.design.framework
    : 'minimal'

  const render = () => {
    return h(components[framework].app)
  }

  log('Initializing Vue app...')
  const app = createApp({
    render,
    data () {
      return { ...dataInit, selectedInputGroup: null }
    },
    provide () {
      return {
        jsee: {
          state: this,
          regions: env.regions,
          controls: env.controls,
          namedPipeline: env._namedPipeline,
          createImageInput: (input, options) => env._createImageInput(input, options),
          rerun: () => env.invoke(undefined, { force: true }).catch(error => env.toast('error', error.message)),
          display: (index) => this.display(index),
          reset: (example) => this.reset(example),
          run: (caller) => this.run(caller),
          stop: () => this.stop(),
          notify: (msg) => this.notify(msg)
        }
      }
    },
    computed: {
      inputValues () { return collectValues(this.inputs) }
    },
    watch: {
      inputValues: {
        deep: true,
        immediate: false,
        // schema.reactive enables global re-run on any input change (debounced).
        // Per-input reactivity uses the 'inchange' event from inputs with reactive: true.
        handler (v) {
          env._emit('inputs', v)
          this.inputsChanged()
        }
      }
    },
    mounted () {
      mountedCallback(container)
    },
    methods: {
      inputsChanged: debounce(function () {
        if (env._destroyed) return
        this.dataChanged = true
        if (env.schema.persist !== false) {
          saveInputsToStorage(this.inputs, storageKey)
        }
        this.validateInputs()
        if (env.schema.reactive) {
          this.run('reactive')
        }
      }, 300),
      validateInputs () {
        return runValidation(getValidationInputs(this.inputs), validateFunctions)
      },
      display (index) {
        if (typeof this.inputs[index]?.display === 'boolean') return this.inputs[index].display
        const res = index < displayFunctions.length
          ? displayFunctions[index](this.$data)
          : true
        return res
      },
      reset (example) {
        // Reset input values to default ones
        // If example is provided, use it as a new default
        resetInputs(this.inputs, example)
        clearInputsStorage(storageKey)
        // Clear DOM file inputs so re-uploading the same file triggers change event
        this.$nextTick(() => {
          const fileInputs = (env.regions.inputGroups || env.regions.inputs || container).querySelectorAll('input[type="file"]')
          fileInputs.forEach(el => { el.value = '' })
          this.dataChanged = false
        })
        // Clear dynamic select options (e.g. target populated from worker)
        this.inputs.forEach(input => {
          if ((input.type === 'select' || input.type === 'categorical') && input.options && !input._initialOptions) {
            input._initialOptions = input.default ? undefined : []
          }
        })
        // Clear outputs
        if (this.outputs) {
          this.outputs.forEach(output => {
            if (output.type === 'chat') {
              output._messages = []
            } else {
              output.value = undefined
            }
          })
        }
      },
      run (caller) {
        this.clickRun = true
        // Catch to prevent unhandled rejection from button/autorun clicks
        env.run(caller).catch(err => console.error('Run error:', err))
        setTimeout(() => {
          this.clickRun = false
        }, 150)
      },
      stop () {
        env.cancelCurrentRun()
      },
      notify (msg) {
        env.notify(msg)
      }
    }
  })

  if (framework !== false) {
    app.component('vue-app', components[framework].app)
    app.component('vue-input', components[framework].input)
    app.component('vue-output', components[framework].output)
  }

  // Json viewer
  app.use(JsonViewer)

  // Load Vue framework if present
  if (framework in window) {
    app.use(window[framework])
  }

  const component = app.mount(container) // After app.mount() it's not the same app
  component.__vueApp = app
  return component
}

export { createVueApp }
