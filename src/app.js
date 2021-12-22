// import Vue from 'vue'
// import { createApp } from 'vue'
// import { createApp } from 'vue/dist/vue.esm-bundler'
// import { createApp, h } from 'vue/dist/vue.runtime.esm-bundler.js'

import { createApp, h } from 'vue' // <- resolved in webpack.config based on RUNTIME

import bulmaApp from '../templates/bulma-app.vue'
import bulmaInput from '../templates/bulma-input.vue'
import bulmaOutput from '../templates/bulma-output.vue'

const components = {
  'bulma': {
    'app': bulmaApp,
    'input': bulmaInput,
    'output': bulmaOutput
  }
}

const filtrex = require('filtrex')
const JsonViewer = require('vue3-json-viewer').default

function log () {
  console.log(`[Vue]`, ...arguments)
}

function resetInputs (inputs) {
  log('Resetting inputs...')
  inputs.forEach(input => {
    if (input.default) { 
      input.value = input.default 
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
        case 'group':
          resetInputs(input.elements)
          break
        default:
          input.value = ''
      }
    }
  })
}

function createVueApp (env, dataInit, mountedCallback) {
  // Reset input values to default ones
  resetInputs(dataInit.inputs)

  if (!('outputs' in dataInit)) {
    dataInit.outputs = []
  }

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
          inputObj[input.name] = input.value
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
  const container = env.params.container
    ? (typeof env.params.container === 'string')
      ? document.querySelector(env.params.container)
      : env.params.container
    : document.body

  // Determine a template and GUI framework
  const framework = (env.schema.design && typeof env.schema.design.framework !== 'undefined')
    ? env.schema.design.framework
    : 'bulma'

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
        handler (v) {
          if (this.model.autorun) {
            env.run()
          }
        }
      }
    },
    mounted () {
      mountedCallback(container)
    },
    methods: {
      display (index) {
        const res = displayFunctions[index](this.$data)
        return res
      },
      reset () {
        resetInputs(this.inputs)
      },
      run () {
        env.run()
      },
      notify (msg) {
        env.notify(msg)
      }
    },
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

  return app.mount(container) // After app.mount() it's not the same app
}

export { createVueApp }
