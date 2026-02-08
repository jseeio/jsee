// https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
function isObject (item) {
  return (typeof item === 'object' && !Array.isArray(item) && item !== null)
}

const VALID_INPUT_TYPES = [
  'int',
  'float',
  'number',
  'string',
  'color',
  'text',
  'categorical',
  'select',
  'bool',
  'checkbox',
  'file',
  'group',
  'action',
  'button'
]

const VALID_MODEL_TYPES = [
  'function',
  'class',
  'async-init',
  'async-function',
  'get',
  'post',
  'py',
  'tf'
]

function sanitizeName (inputName) {
  return inputName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

async function getModelFuncJS (model, target, app) {
  let modelFunc
  switch (model.type) {
    case 'class':
      app.log('Init class')
      const modelClass = new target()
      modelFunc = (...a) => {
        return modelClass[model.method || 'predict'](...a)
      }
      break
    case 'async-init':
      app.log('Function with async init')
      modelFunc = await target()
      break
    default:
      app.log('Init function')
      modelFunc = target
  }

  // Wrap modelFunc to take into account container
  // Possible cases:
  if (model.container === 'args') {
    return (...a) => {
      if (Array.isArray(a[0]) && a[0].length && a.length === 1) {
        return modelFunc(...a[0])
      } else if (isObject(a[0]) && a.length === 1) {
        return modelFunc(...Object.values(a[0]))
      } else {
        return modelFunc(...a)
      }
    }
  } else {
    return (...a) => {
      if (isObject(a[0]) && a.length === 1) {
        // In case when we have only one input object
        // Pass log and callback to the model function
        return modelFunc(a[0], app)
      } else {
        return modelFunc(...a)
      }
    }
  }
}

function getUrl (url) {
  let newUrl
  try {
    newUrl = (new URL(url)).href
  } catch (e) {
    newUrl = (new URL(url, 'https://cdn.jsdelivr.net/npm/')).href
  }
  return newUrl
}

function loadFromDOM (url) {
  const scriptElement = document.querySelector(`script[data-src="${url}"]`)
  if (scriptElement) {
    return scriptElement.textContent
  } else {
    return null
  }
}

function importScriptAsync (imp, async=true) {
  return new Promise((resolve, reject) => {
    try {
      const scriptElement = document.createElement('script')
      scriptElement.type = 'text/javascript'
      if (imp.code) {
        // Create script element from import.code
        scriptElement.textContent = imp.code
        // Create event element to notify about script load
        const eventElement = document.createElement('script')
        eventElement.type = 'text/javascript'
        eventElement.textContent = `document.dispatchEvent(new CustomEvent('${imp.url}', {detail: {url: '${imp.url}'}}));`
        document.addEventListener(imp.url, (ev) => {
          console.log('Script loaded from cache:', ev.detail.url)
          resolve({ status: true })
        })
        document.body.appendChild(scriptElement)
        document.body.appendChild(eventElement)
      } else {
        // Create script element from import.url
        scriptElement.async = async
        scriptElement.src = imp.url
        scriptElement.addEventListener('load', (ev) => {
          console.log('Script loaded:', imp.url)
          resolve({ status: true })
        })
        scriptElement.addEventListener('error', (ev) => {
          reject({
            status: false,
            message: `Failed to import ${imp.url}`
          })
        })
        document.body.appendChild(scriptElement);
      }
    } catch (error) {
      reject(error)
    }
  })
}

async function importScripts (...imports) {
  // Load scripts in parallel
  // return Promise.all(imports.map(importScriptAsync))
  // Load scripts in sequence. Possible ordering issues.
  for (const imp of imports) {
    await importScriptAsync(imp);
  }
}

function getModelFuncAPI (model, log=console.log) {
  switch (model.type) {
    case 'get':
      return (data) => {
        const query = new URLSearchParams(data).toString()
        const finalURL = model.url +'?' + query
        log('Sending GET request to:', finalURL)
        const resPromise = fetch(finalURL)
          .then(response => response.json())
        return resPromise
      }
    case 'post':
      return (data) => {
        log('Sending POST request to', model.url)
        const resPromise = fetch(model.url, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        }).then(response => response.json())
        return resPromise
      }
  }
}

async function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms || 1))
}

// Simple debounce to prevent rapid-fire calls (e.g. autorun on every keystroke)
function debounce (fn, ms) {
  let timer
  return function (...args) {
    clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), ms)
  }
}

// Extract function name from code (string or function reference).
// Handles 'function name', 'async function name'. Arrow/anonymous return undefined.
function getName (code) {
  switch (typeof code) {
    case 'function':
      return code.name
    case 'string':
      const words = code.split(' ')
      const functionIndex = words.findIndex((word) => word === 'function')
      if (functionIndex === -1) return undefined
      const name = words[functionIndex + 1]
      if (!name || name.includes('(')) return undefined
      return name
    default:
      return undefined
  }
}

function validateInputSchema (input, path, report) {
  if (!isObject(input)) {
    report.errors.push(`${path} should be an object`)
    return
  }

  if ((typeof input.name !== 'undefined') && (typeof input.name !== 'string')) {
    report.warnings.push(`${path}.name should be a string`)
  }

  if ((typeof input.type !== 'undefined') && !VALID_INPUT_TYPES.includes(input.type)) {
    report.warnings.push(`${path}.type '${input.type}' is not recognized`)
  }

  if (input.type === 'group') {
    if (!Array.isArray(input.elements)) {
      report.warnings.push(`${path}.elements should be an array for group inputs`)
    } else {
      input.elements.forEach((element, index) => {
        validateInputSchema(element, `${path}.elements[${index}]`, report)
      })
    }
  }

  if (typeof input.alias !== 'undefined') {
    const validAlias = (
      typeof input.alias === 'string'
      || (Array.isArray(input.alias) && input.alias.every(alias => typeof alias === 'string'))
    )
    if (!validAlias) {
      report.warnings.push(`${path}.alias should be a string or an array of strings`)
    }
  }
}

function validateModelSchema (model, path, report) {
  if (typeof model === 'function') {
    return
  }

  if (!isObject(model)) {
    report.errors.push(`${path} should be an object or function`)
    return
  }

  if ((typeof model.type !== 'undefined') && !VALID_MODEL_TYPES.includes(model.type)) {
    report.warnings.push(`${path}.type '${model.type}' is not recognized`)
  }

  if ((typeof model.worker !== 'undefined') && (typeof model.worker !== 'boolean')) {
    report.warnings.push(`${path}.worker should be a boolean`)
  }

  if (typeof model.timeout !== 'undefined') {
    const timeoutValid = (typeof model.timeout === 'number') && !Number.isNaN(model.timeout) && (model.timeout > 0)
    if (!timeoutValid) {
      report.warnings.push(`${path}.timeout should be a positive number`)
    }
  }
}

function validateSchema (schema) {
  const report = {
    errors: [],
    warnings: []
  }

  if (!isObject(schema)) {
    report.errors.push('Schema should be an object')
    return report
  }

  const hasModel = typeof schema.model !== 'undefined'
  const hasView = (typeof schema.view !== 'undefined') || (typeof schema.render !== 'undefined')

  if (!hasModel && !hasView) {
    report.errors.push('Schema should define `model` (or `view`/`render`)')
  } else if (!hasModel && hasView) {
    report.warnings.push('Schema has no `model`, using `view`/`render` only')
  }

  if (typeof schema.inputs !== 'undefined') {
    if (!Array.isArray(schema.inputs)) {
      report.errors.push('`inputs` should be an array')
    } else {
      schema.inputs.forEach((input, index) => {
        validateInputSchema(input, `inputs[${index}]`, report)
      })
    }
  }

  if (hasModel) {
    const models = Array.isArray(schema.model)
      ? schema.model
      : [schema.model]
    models.forEach((model, index) => {
      validateModelSchema(model, `model[${index}]`, report)
    })
  }

  return report
}

module.exports = {
  isObject,
  loadFromDOM,
  getModelFuncJS,
  getModelFuncAPI,
  importScripts,
  getUrl,
  delay,
  debounce,
  sanitizeName,
  getName,
  validateSchema
}
