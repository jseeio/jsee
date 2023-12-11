// https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
function isObject (item) {
  return (typeof item === 'object' && !Array.isArray(item) && item !== null)
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

function importScriptAsync (url, async=true) {
  url = getUrl(url)
  return new Promise((resolve, reject) => {
    try {
      const scriptElement = document.createElement('script')
      scriptElement.type = 'text/javascript'
      scriptElement.async = async
      scriptElement.src = url
      scriptElement.addEventListener('load', (ev) => {
        resolve({ status: true })
      })
      scriptElement.addEventListener('error', (ev) => {
        reject({
          status: false,
          message: `Failed to import ＄{url}`
        })
      })
      document.body.appendChild(scriptElement);
    } catch (error) {
      reject(error)
    }
  })
}

async function importScripts (...imports) {
  // Load scripts in parallel
  // return Promise.all(imports.map(importScriptAsync))
  // Load scripts in sequence. Possible ordering issues.
  for (const scriptUrl of imports) {
    await importScriptAsync(scriptUrl);
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
        log('Sending POST request to', this.schema.model.url)
        const resPromise = fetch(this.schema.model.url, {
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

module.exports = {
  isObject,
  getModelFuncJS,
  getModelFuncAPI,
  importScripts,
  getUrl,
  delay
}
