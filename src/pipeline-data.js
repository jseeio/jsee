const { collectInputValues, getInputDefaultValue, prepareInputs } = require('./schema')
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value]
const fields = values => (values || []).flatMap(field => field.type === 'group' ? fields(field.elements) : [field])
const same = (a, b) => {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(a)) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(b))) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && same(a[key], b[key]))
}
async function sameContent (a, b) {
  if (same(a, b)) return true
  if (typeof Blob !== 'undefined' && a instanceof Blob && b instanceof Blob) {
    if (a.size !== b.size || a.type !== b.type || a.name !== b.name) return false
    const [left, right] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()])
    return sameContent(new Uint8Array(left), new Uint8Array(right))
  }
  if (a instanceof ArrayBuffer || ArrayBuffer.isView(a)) {
    if (!(b instanceof ArrayBuffer || ArrayBuffer.isView(b))) return false
    const left = a instanceof ArrayBuffer ? new Uint8Array(a) : new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    const right = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  for (const key of keys) if (!own(b, key) || !await sameContent(a[key], b[key])) return false
  return true
}
const defaults = schema => collectInputValues(schema.inputs, getInputDefaultValue)

function decodePortableFile (value) {
  if (!value || value.encoding !== 'base64' || typeof value.content !== 'string') return value
  const bytes = Uint8Array.from(atob(value.content), char => char.charCodeAt(0))
  const file = typeof File !== 'undefined' && value.filename ? new File([bytes], value.filename, { type: value.mime || '' }) : new Blob([bytes], { type: value.mime || '' })
  // Older Node hosts have Blob without a global File; retain the file contract.
  if (value.filename && !file.name) Object.defineProperty(file, 'name', { value: value.filename, enumerable: true })
  return file
}
function decodeFileDefaults (inputs) {
  for (const field of inputs || []) {
    if (field.type === 'group') decodeFileDefaults(field.elements)
    else if (field.type === 'file' && field.default) field.default = decodePortableFile(field.default)
  }
}

async function prepareStageInputs (schema, supplied) {
  const values = { ...defaults(schema), ...supplied }
  for (const field of schema.inputs || []) {
    if (field.type === 'group') {
      if (field.name) values[field.name] = await prepareStageInputs({ inputs: field.elements }, values[field.name] || {})
      continue
    }
    if (field.type !== 'file') continue
    let value = values[field.name]
    if (value && typeof value === 'object' && value.encoding === 'base64') value = decodePortableFile(value)
    else if (value && typeof value === 'object' && own(value, 'content')) value = value.content
    if (field.stream && typeof value === 'string' && /[\r\n]/.test(value)) value = new Blob([value], { type: 'text/plain' })
    if (typeof Blob !== 'undefined' && value instanceof Blob && !field.stream && !field.raw) value = field.arrayBuffer ? await value.arrayBuffer() : await value.text()
    values[field.name] = value
  }
  return prepareInputs(schema.inputs || [], values)
}

async function portableValue (value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return { encoding: 'base64', content: btoa(binary), mime: value.type || 'application/octet-stream', filename: value.name }
  }
  if (Array.isArray(value)) return Promise.all(value.map(portableValue))
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await portableValue(child)])))
  if (typeof value === 'function') return String(value)
  return value
}

module.exports = { own, list, fields, same, sameContent, defaults, decodeFileDefaults, prepareStageInputs, portableValue }
