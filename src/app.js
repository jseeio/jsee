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
const { sanitizeName, debounce } = require('./utils.js')

const STORAGE_KEY = 'jsee:inputs'

function saveInputsToStorage (inputs) {
  try {
    const values = {}
    inputs.forEach((input, index) => {
      if (input.type === 'file' || input.type === 'action' || input.type === 'button') return
      if (input.type === 'group') return // skip groups for now
      const key = input.name || `input_${index}`
      values[key] = input.value
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch (e) { /* quota exceeded or private mode */ }
}

function loadInputsFromStorage (inputs) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const values = JSON.parse(raw)
    let restored = false
    inputs.forEach((input, index) => {
      if (input.type === 'file' || input.type === 'action' || input.type === 'button') return
      if (input.type === 'group') return
      const key = input.name || `input_${index}`
      if (typeof values[key] !== 'undefined') {
        input.value = values[key]
        restored = true
      }
    })
    return restored
  } catch (e) { return false }
}

function clearInputsStorage () {
  try { localStorage.removeItem(STORAGE_KEY) } catch (e) { /* ignore */ }
}

function setInputValue (input, value) {
  if (input.type === 'file') {
    // For file inputs, we need to set the url
    input.url = value
    input.file = null // Reset file object
  } else {
    // For other inputs, we can set the value directly
    input.value = value
  }
}

function resetInputs (inputs, example) {
  inputs.forEach((input, index) => {
    const inputName = input.name ? sanitizeName(input.name) : `input_${index}`
    if (example && input.name && example[input.name]) {
      // Object (unsanitized)
      setInputValue(input, example[input.name])
    } else if (example && inputName && example[inputName]) {
      // Object (sanitized)
      setInputValue(input, example[inputName])
    } else if (example && Array.isArray(example) && typeof example[index] !== 'undefined') {
      // Array
      setInputValue(input, example[index])
    } else if (input.default) {
      // Default value
      setInputValue(input, input.default)
    } else {
      switch (input.type) {
        case 'int':
        case 'float':
        case 'number':
          input.value = 0
          break
        case 'string':
        case 'text':
          input.value = ''
          break
        case 'color':
          input.value = '#000000'
          break
        case 'categorical':
        case 'select':
          input.value = input.options ? input.options[0] : ''
          break
        case 'bool':
        case 'checkbox':
          input.value = false
          break
        case 'file':
          input.file = null
          input.value = ''
          break
        case 'slider':
          input.value = input.min || 0
          break
        case 'range':
          input.value = [input.min || 0, input.max || 100]
          break
        case 'radio':
          input.value = input.options ? input.options[0] : ''
          break
        case 'toggle':
          input.value = false
          break
        case 'date':
          input.value = ''
          break
        case 'multi-select':
          input.value = []
          break
        case 'group':
          resetInputs(input.elements)
          break
        default:
          input.value = ''
      }
    }
  })
}

function createVueApp (env, mountedCallback, logMain) {
  function log () {
    logMain('[Vue]', ...arguments)
  }

  // Vue's data is based on schema
  const dataInit = env.schema

  // Reset input values to default ones
  resetInputs(dataInit.inputs)

  // Restore saved inputs from localStorage (unless URL params are present or persist: false)
  const hasUrlParams = new URLSearchParams(window.location.search).toString().length > 0
  if (env.schema.persist !== false && !hasUrlParams) {
    loadInputsFromStorage(dataInit.inputs)
  }

  if (!('outputs' in dataInit)) {
    dataInit.outputs = []
  }

  // Flag that shows if data was changed from initial conditions
  dataInit.dataChanged = false
  // Flag for autorun feedback
  dataInit.clickRun = false

  function len(s) {
    return s.length;
  }

  let filtrexOptions = {
    extraFunctions: { len }
  }

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

  // Determine a container for Vue app
  const container = env.container
    ? (typeof env.container === 'string')
      ? document.querySelector(env.container)
      : env.container
    : document.body

  // Determine a template and GUI framework
  const framework = (env.schema.design && typeof env.schema.design.framework !== 'undefined')
    ? env.schema.design.framework
    : 'minimal'

  let template
  let render
  if (
    env.schema.design
    && env.schema.design.template
    && (
      typeof env.schema.design.template === 'string'
      || env.schema.design.template === false
    )
  ) {
    template = env.schema.design.template
    render = null
  } else {
    template = null //'<vue-app/>'
    render = () => {
      return h(components[framework].app)
    }
  }

  log('Initializing Vue app...')
  const app = createApp({
    template,
    render,
    data () {
      return dataInit
    },
    watch: {
      inputs: {
        deep: true,
        immediate: false,
        // schema.reactive enables global re-run on any input change (debounced).
        // Per-input reactivity uses the 'inchange' event from inputs with reactive: true.
        handler: debounce(function (v) {
          this.dataChanged = true
          if (env.schema.persist !== false) {
            saveInputsToStorage(this.inputs)
          }
          if (env.schema.reactive) {
            this.run('reactive')
          }
        }, 300)
      }
    },
    mounted () {
      mountedCallback(container)
    },
    methods: {
      display (index) {
        const res = index < displayFunctions.length
          ? displayFunctions[index](this.$data)
          : true
        return res
      },
      reset (example) {
        // Reset input values to default ones
        // If example is provided, use it as a new default
        resetInputs(this.inputs, example)
        clearInputsStorage()
        this.$nextTick(() => {
          this.dataChanged = false
        })
      },
      run (caller) {
        this.clickRun = true
        // Catch to prevent unhandled rejection from button/autorun clicks
        env.run(caller).catch(err => console.error('Run error:', err))
        setTimeout(() => {
          this.clickRun = false
        }, 150)
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
