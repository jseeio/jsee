const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
// Directory examples must also run when the HTTP root is the example itself.
// Build-owned copies stay ignored and travel with the folder when it is deployed.
for (const name of ['scores', 'persistent-renderers', 'image-annotations']) {
  const destination = path.join(root, 'examples', name, 'dist')
  fs.mkdirSync(destination, { recursive: true })
  fs.copyFileSync(path.join(root, 'dist/jsee.core.js'), path.join(destination, 'jsee.core.js'))
}
