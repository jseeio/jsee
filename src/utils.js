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

module.exports = {
  getModelFuncJS,
  getModelFuncAPI
}
