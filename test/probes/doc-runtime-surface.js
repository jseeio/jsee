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
  assert(readme.includes('`' + type + '`'), `Schema reference does not document model type ${type}`)
})

inputTypes.forEach(type => {
  assert(readme.includes('`' + type + '`') || readme.includes(type), `Schema reference does not document input type ${type}`)
})

descriptor.definitions.outputType.enum.forEach(type => {
  assert(readme.includes('`' + type + '`'), `Schema reference does not document output type ${type}`)
})

const modelTypeSection = readme.match(/- `type` \(string[\s\S]*?\n  - `entry`/)
assert(modelTypeSection, 'Schema reference model type section not found')
assert(countBacktickToken(modelTypeSection[0], 'module') === 1, 'Schema reference appears to duplicate module model type entries')
assert(/`code` \(function or string\)/.test(readme), 'Schema reference should document model.code as function or string')
assert(/Outputs also support `alias` \(string or array/.test(readme), 'Schema reference should document output alias arrays')
assert(/`get`[\s\S]*`post`/.test(readme), 'Schema reference should document get/post API model types')
assert(!/`tf`/.test(readme), 'Schema reference should not document removed tf model type')

// Parse Markdown so fenced code and inline example URLs are not treated as navigation.
const path = require('path')
const markdown = require('markdown-it')({ html: true })
const documents = ['README.md', 'py/README.md']
const anchorCache = new Map()
function anchors (file) {
  if (anchorCache.has(file)) return anchorCache.get(file)
  const source = fs.readFileSync(file, 'utf8')
  const tokens = markdown.parse(source, {})
  const ids = new Set()
  const counts = new Map()
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return
    const text = tokens[index + 1].children.map(child => child.content).join('')
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-')
    const count = counts.get(base) || 0
    ids.add(count ? `${base}-${count}` : base)
    counts.set(base, count + 1)
  })
  for (const match of source.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) ids.add(match[1])
  anchorCache.set(file, ids)
  return ids
}
let links = 0
for (const file of documents) {
  const tokens = markdown.parse(fs.readFileSync(file, 'utf8'), {})
  for (const token of tokens.flatMap(token => token.children || [])) {
    if (token.type !== 'link_open') continue
    const href = token.attrGet('href')
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) continue
    const [target, hash] = href.split('#')
    const resolved = target ? path.resolve(path.dirname(file), decodeURIComponent(target)) : path.resolve(file)
    assert(fs.existsSync(resolved), `${file}: missing link target ${href}`)
    if (hash && resolved.endsWith('.md')) {
      assert(anchors(resolved).has(decodeURIComponent(hash)), `${file}: missing anchor ${href}`)
    }
    links++
  }
}
assert(fs.readFileSync('README.md', 'utf8').includes('pip install jsee'), 'Landing page must document the Python package install')
console.log(`probe-doc-runtime-surface: ok (${documents.length} pages, ${links} local links)`)
