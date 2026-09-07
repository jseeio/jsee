const fs = require('fs')

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

function countBacktickToken (text, token) {
  const pattern = new RegExp('`' + token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`', 'g')
  return (text.match(pattern) || []).length
}

const descriptor = require('../../schema.json')
const readme = fs.readFileSync('README.md', 'utf8')
const inputTypes = descriptor.definitions.inputType.enum
const modelTypes = descriptor.definitions.modelType.enum

modelTypes.forEach(type => {
  assert(readme.includes('`' + type + '`'), `README does not document model type ${type}`)
})

inputTypes.forEach(type => {
  assert(readme.includes('`' + type + '`') || readme.includes(type), `README does not document input type ${type}`)
})

const modelTypeSection = readme.match(/- `type` \(string[\s\S]*?\n  - `entry`/)
assert(modelTypeSection, 'README model type section not found')
assert(countBacktickToken(modelTypeSection[0], 'module') === 1, 'README appears to duplicate module model type entries')
assert(/`code` \(function or string\)/.test(readme), 'README should document model.code as function or string')
assert(/Outputs also support `alias` \(string or array/.test(readme), 'README should document output alias arrays')
assert(/`get`[\s\S]*`post`/.test(readme), 'README should document get/post API model types')
assert(!/`tf`/.test(readme), 'README should not document removed tf model type')

console.log('probe-doc-runtime-surface: ok')
