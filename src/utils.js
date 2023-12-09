function getModelFuncJS (model, target, log=console.log) {
  switch (model.type) {
    case 'class':
      log('Init class')
      const modelClass = new target()
      return (...a) => {
        return modelClass[model.method || 'predict'](...a)
      }
    case 'async-init':
      // TODO: Test this
      log('Function with async init')
      return target().then(m => {
        log('> Async init resolved: ', m)
        return m
      })
    default:
      log('Init function')
      return target
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
  getModelFuncJS,
  getModelFuncAPI,
  importScripts,
  getUrl,
  delay
}
