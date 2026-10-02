// Contract inspection and terminal output handling shared by CLI, HTTP and MCP.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { pathToFileURL } = require('url')
const { resolveInside, makeHttpError } = require('./files')
const { assertSchemaVersion, prepareInputs, jseeInputsToJsonSchema } = require('./schema')
const { isBinaryLike, isRecordObject, outputLookupNames, normalizeFileOutputValue, flattenJseeOutputs,
  jseeOutputsToJsonSchema, invocationUnsupportedReason } = require('./utils')
const vocabulary = require('../schema.json').definitions

const BODY_LIMIT = 50 * 1024 * 1024
const ARTIFACT_LIMIT = 64 * 1024 * 1024

function uploadTool (computationId) {
  return { name: computationId === 'upload_artifact' ? 'jsee_upload_artifact' : 'upload_artifact',
    description: 'Upload bytes in base64 chunks of at most 262144 decoded bytes. First call omits upload; continue with upload and returned offset. final publishes an artifact; cancel discards pending bytes. Pass {artifact: result.artifact} to file inputs. MIME is declared, not decoded.',
    inputSchema: { type: 'object', properties: {
      upload: { type: 'string' }, data: { type: 'string', maxLength: 349528 }, offset: { type: 'integer', minimum: 0 },
      name: { type: 'string' }, mime: { type: 'string' }, final: { type: 'boolean' }, cancel: { type: 'boolean' }
    }, additionalProperties: false } }
}

function validateDescriptor (schema) {
  const errors = []
  const warnings = []
  if (!isRecordObject(schema)) return { valid: false, errors: ['Schema should be an object'], warnings }
  try { assertSchemaVersion(schema) } catch (error) { errors.push(error.message) }
  for (const key of ['title', 'description']) {
    if (schema[key] !== undefined && typeof schema[key] !== 'string') errors.push(key + ' should be a string')
  }
  if (schema.id !== undefined && (typeof schema.id !== 'string' || !/^[a-zA-Z][\w.-]{0,127}$/.test(schema.id))) errors.push('id should be a stable identifier (letters, digits, _, ., -)')
  const checkFields = (fields, kind, prefix, names=new Set()) => {
    if (!Array.isArray(fields)) { errors.push(prefix + ' should be an array'); return }
    fields.forEach((field, index) => {
      const at = `${prefix}[${index}]`
      if (!isRecordObject(field)) { errors.push(at + ' should be an object'); return }
      if (field.type !== undefined && !vocabulary[kind + 'Type'].enum.includes(field.type)) errors.push(at + '.type is not recognized')
      if (field.name !== undefined && (typeof field.name !== 'string' || !field.name)) errors.push(at + '.name should be a nonempty string')
      if (field.type === 'group') {
        const scope = kind === 'output' || !field.name ? names : new Set()
        checkFields(field.elements, kind, at + '.elements', scope)
        if (kind === 'output' || !field.name) return
      } else if (!['button', 'action', 'blank', 'function'].includes(field.type) && !field.name) errors.push(at + '.name is required')
      if (field.name) {
        if (names.has(field.name)) errors.push(at + '.name is duplicated')
        names.add(field.name)
      }
      if (field.alias !== undefined && !(typeof field.alias === 'string' || Array.isArray(field.alias) && field.alias.every(v => typeof v === 'string'))) errors.push(at + '.alias should contain strings')
      if (kind === 'input') {
        for (const key of ['required', 'nullable', 'raw', 'stream', 'arrayBuffer']) {
          if (field[key] !== undefined && typeof field[key] !== 'boolean') errors.push(at + '.' + key + ' should be boolean')
        }
        if (field.accept !== undefined && typeof field.accept !== 'string') errors.push(at + '.accept should be a string')
        if (['image', 'audio', 'video', 'object', 'table'].includes(field.type) && (field.arrayBuffer || field.raw || field.stream)) errors.push(at + ': raw, stream and arrayBuffer are not supported for this input type')
        for (const key of ['min', 'max', 'step']) {
          if (field[key] !== undefined && (typeof field[key] !== 'number' || !Number.isFinite(field[key]))) errors.push(at + '.' + key + ' should be finite')
        }
        if (field.min > field.max) errors.push(at + '.min exceeds max')
        if (field.step !== undefined && field.step <= 0) errors.push(at + '.step should be positive')
        if (field.options !== undefined && !Array.isArray(field.options)) errors.push(at + '.options should be an array')
        if (field.validate) warnings.push(at + '.validate is evaluated only by the browser UI')
        if (field.default !== undefined && field.name) {
          try { prepareInputs([{ ...field, required: false }], { [field.name]: field.default }) } catch (error) { errors.push(at + '.default: ' + error.message) }
        }
      }
    })
  }
  checkFields(schema.inputs === undefined ? [] : schema.inputs, 'input', 'inputs')
  checkFields(schema.outputs === undefined ? [] : schema.outputs, 'output', 'outputs')
  const models = Array.isArray(schema.model) ? schema.model : schema.model ? [schema.model] : []
  if (!models.length) errors.push('Invocation requires one or more model objects')
  const names = new Set()
  models.forEach((model, index) => {
    const at = `model[${index}]`
    if (!isRecordObject(model)) { errors.push(at + ' should be an object'); return }
    if (model.type !== undefined && !vocabulary.modelType.enum.includes(model.type)) errors.push(at + '.type is not recognized')
    for (const key of ['name', 'url', 'entry']) {
      if (model[key] !== undefined && (typeof model[key] !== 'string' || !model[key])) errors.push(at + '.' + key + ' should be a nonempty string')
    }
    if (model.entry && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(model.entry)) errors.push(at + '.entry is invalid')
    if (!model.url && !model.code) errors.push(at + ' needs url or code')
    if (model.code !== undefined && !['string', 'function'].includes(typeof model.code)) errors.push(at + '.code should be a string or function')
    if (model.container !== undefined && !['object', 'args'].includes(model.container)) errors.push(at + '.container is invalid')
    if (model.name && names.has(model.name)) errors.push(at + '.name is duplicated')
    names.add(model.name)
  })
  return { valid: !errors.length, errors, warnings }
}

function canonicalOutputSchema (outputs) {
  const outputSchema = jseeOutputsToJsonSchema(outputs)
  outputSchema.additionalProperties = false
  outputSchema.required = []
  for (const output of flattenJseeOutputs(outputs)) {
    outputSchema.required.push(output.name)
    const reference = { type: 'object', properties: { artifact: { type: 'string' } }, required: ['artifact'], additionalProperties: false }
    if (output.type === 'file') outputSchema.properties[output.name] = reference
    else if (['image', 'audio', 'video'].includes(output.type)) outputSchema.properties[output.name] = { anyOf: [reference, outputSchema.properties[output.name]] }
  }
  // Ajv-based clients skip __proto__ in properties; the exact-name pattern preserves its contract.
  if (Object.hasOwn(outputSchema.properties || {}, '__proto__')) outputSchema.patternProperties = { '^__proto__$': outputSchema.properties.__proto__ }
  return outputSchema
}

function inspectSchema (schema) {
  const validation = validateDescriptor(schema)
  if (!validation.valid) throw Object.assign(new Error(validation.errors.join('; ')), { code: 'JSEE_SCHEMA_INVALID' })
  const outputSchema = canonicalOutputSchema(schema.outputs)
  const reason = invocationUnsupportedReason(schema)
  return { id: schema.id || 'computation', schemaVersion: schema.schemaVersion || 1,
    title: schema.title || schema.id || 'Computation', description: schema.description || '',
    inputSchema: jseeInputsToJsonSchema(schema.inputs), outputSchema,
    capabilities: { runtime: 'node', invoke: !reason, reason, streaming: false, cancellation: false },
    warnings: validation.warnings }
}

function failedRun (code, message, runId=crypto.randomUUID()) {
  return { runId, status: 'failed', error: { code, message } }
}

function responseStatus (run) {
  if (run.status === 'succeeded') return 200
  return { JSEE_SCHEMA_INVALID: 400, JSEE_INPUT_INVALID: 400, JSEE_REQUEST_INVALID: 400,
    JSEE_BODY_TOO_LARGE: 413, JSEE_CAPABILITY_UNSUPPORTED: 422, JSEE_ARTIFACT_LIMIT: 507 }[run.error.code] || 500
}

function jsonPath (at, key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? (at ? at + '.' : '') + key : at + '[' + JSON.stringify(key) + ']'
}

function jsonValue (value, at, seen=new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const binary = isBinaryLike(value)
  let kind
  if (binary) kind = 'bytes'
  else if (typeof value === 'number') kind = String(value)
  else if (seen.has(value)) kind = 'circular reference'
  else if (!Array.isArray(value) && !isRecordObject(value)) {
    kind = typeof value === 'object' ? Object.prototype.toString.call(value).slice(8, -1) : typeof value
  }
  if (kind) throw new Error(at + ': ' + kind + ' is not a JSON value' + (binary ? '; declare binary output as type file' : ''))
  seen.add(value)
  // Array.from visits holes too: otherwise JSON serialization silently turns them into null.
  const result = Array.isArray(value)
    ? Array.from(value, (v, index) => jsonValue(v, `${at}[${index}]`, seen))
    : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonValue(v, jsonPath(at, k), seen)]))
  seen.delete(value)
  return result
}

// Validate only the JSON Schema vocabulary emitted by our built-in output mappings.
// This is not an author-supplied JSON Schema interpreter. Fail closed if mappings grow.
function outputShapeError (value, schema, at='outputs') {
  const supported = ['type', 'oneOf', 'anyOf', 'properties', 'required', 'items', 'additionalProperties', 'patternProperties']
  for (const key of Object.keys(schema)) if (!supported.includes(key)) return at + ': unsupported output schema keyword ' + key
  if (schema.anyOf && !schema.anyOf.some(option => !outputShapeError(value, option, at))) return at + ': does not match the declared output shape'
  if (schema.oneOf && schema.oneOf.filter(option => !outputShapeError(value, option, at)).length !== 1) return at + ': does not match the declared output shape'
  const matches = { object: isRecordObject(value), array: Array.isArray(value), string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value), integer: Number.isInteger(value), boolean: typeof value === 'boolean' }
  if (schema.type && !matches[schema.type]) return at + ': expected ' + schema.type
  if (Array.isArray(value) && schema.items) {
    for (let index = 0; index < value.length; index++) {
      const error = outputShapeError(value[index], schema.items, `${at}[${index}]`)
      if (error) return error
    }
  }
  if (isRecordObject(value)) {
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) return at + '.' + name + ': required'
    for (const name of Object.keys(value)) {
      const properties = schema.properties || {}
      let declared = Object.hasOwn(properties, name)
      for (const [pattern, rule] of Object.entries(schema.patternProperties || {})) {
        if (!new RegExp(pattern).test(name)) continue
        declared = true
        const error = outputShapeError(value[name], rule, at + '.' + name)
        if (error) return error
      }
      if (Object.hasOwn(properties, name)) {
        const error = outputShapeError(value[name], properties[name], at + '.' + name)
        if (error) return error
      } else if (!declared && schema.additionalProperties === false) return at + '.' + name + ': undeclared output'
    }
  }
  return null
}

class ArtifactStore {
  constructor ({ directory, maxBytes=ARTIFACT_LIMIT, http=false, uriPrefix }={}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('max-artifact-bytes must be a positive integer')
    this.temporary = !directory
    this.root = directory ? path.resolve(directory) : fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-artifacts-'))
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
    this.maxBytes = maxBytes
    this.http = http
    this.uriPrefix = uriPrefix
    this.bytes = 0
    this.uploads = new Map()
    this.pendingBytes = 0
    this.entries = new Map()
    if (!this.temporary) this.load()
  }

  load () {
    const entries = new Map()
    let bytes = 0
    for (const dir of fs.readdirSync(this.root)) {
      if (!/^[0-9a-f-]{36}$/.test(dir)) continue
      const manifest = dir + '/manifest.json'
      if (!fs.existsSync(path.join(this.root, manifest))) continue
      const records = JSON.parse(fs.readFileSync(resolveInside(this.root, manifest), 'utf8'))
      if (!Array.isArray(records)) throw new Error('Invalid artifact manifest')
      for (const [index, record] of records.entries()) {
        if (!record || record.id !== dir + '/' + index || !Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f0-9]{64}$/.test(record.sha256) || typeof record.name !== 'string' || typeof record.mime !== 'string') throw new Error('Invalid artifact manifest')
        const filename = resolveInside(this.root, record.id)
        if (!fs.statSync(filename).isFile()) throw new Error('Invalid artifact file')
        entries.set(record.id, { ...record, path: filename, uri: pathToFileURL(filename).href })
        bytes += record.size
        if (entries.size > 1024 || bytes > this.maxBytes) throw Object.assign(new Error('Artifact store limit exceeded'), { code: 'JSEE_ARTIFACT_LIMIT' })
      }
    }
    this.entries = entries
    this.bytes = bytes
  }

  commit (runId, files) {
    if (this.temporary) return this.commitFiles(runId, files)
    // Cross-process writers serialize quota checks and publication. An interrupted writer
    // leaves a lock: fail closed until the owner removes it after checking no writer lives.
    const lock = path.join(this.root, '.write-lock')
    fs.mkdirSync(lock, { mode: 0o700 })
    try {
      this.load()
      return this.commitFiles(runId, files)
    } finally { fs.rmdirSync(lock) }
  }

  commitFiles (runId, files) {
    const size = files.reduce((sum, file) => sum + file.bytes.length, 0)
    if (size + this.bytes + this.pendingBytes > this.maxBytes || this.entries.size + files.length > 1024) {
      throw Object.assign(new Error('Artifact store limit exceeded'), { code: 'JSEE_ARTIFACT_LIMIT' })
    }
    if (!files.length) return []
    if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error('Invalid run ID')
    const directory = path.join(this.root, runId)
    fs.mkdirSync(directory, { mode: 0o700 })
    try {
      const result = files.map((file, index) => {
        const id = runId + '/' + index
        const filename = path.join(directory, String(index))
        fs.writeFileSync(filename, file.bytes, { flag: 'wx', mode: 0o600 })
        return { id, output: file.output === undefined ? '' : file.output, name: file.name, mime: file.mime, size: file.bytes.length,
          sha256: crypto.createHash('sha256').update(file.bytes).digest('hex'),
          uri: this.uriPrefix ? this.uriPrefix + id : this.http ? '/__jsee/artifacts/' + id : pathToFileURL(filename).href }
      })
      if (!this.temporary) {
        // Publish the complete registration batch atomically for concurrent readers.
        fs.writeFileSync(path.join(directory, 'manifest.pending'), JSON.stringify(result), { flag: 'wx', mode: 0o600 })
        fs.renameSync(path.join(directory, 'manifest.pending'), path.join(directory, 'manifest.json'))
      }
      result.forEach((artifact, index) => this.entries.set(artifact.id, { ...artifact, path: path.join(directory, String(index)) }))
      this.bytes += size
      return result
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true })
      throw error
    }
  }

  ingest (bytes, { name='file', mime='application/octet-stream' }={}) {
    if (typeof name !== 'string' || typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+(?:;[^\r\n]*)?$/.test(mime)) throw new Error('Invalid upload name or MIME type')
    name = name.replace(/\\/g, '/').split('/').pop().replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 255) || 'file'
    const [metadata] = this.commit(crypto.randomUUID(), [{ output: '', name, mime, bytes }])
    return { artifact: metadata.id, metadata }
  }

  upload (part) {
    if (!isRecordObject(part) || Object.keys(part).some(key => !['upload', 'data', 'offset', 'name', 'mime', 'final', 'cancel'].includes(key))) throw new Error('Invalid upload fields')
    for (const key of ['upload', 'name', 'mime']) if (part[key] !== undefined && (typeof part[key] !== 'string' || part[key].length > 1024)) throw new Error('Invalid upload ' + key)
    for (const key of ['final', 'cancel']) if (part[key] !== undefined && typeof part[key] !== 'boolean') throw new Error('Invalid upload ' + key)
    const { upload, data='', offset=0, final=false, cancel=false } = part
    let pending = upload ? this.uploads.get(upload) : null
    if (upload && !pending) throw new Error('Unknown upload')
    if (cancel) {
      if (pending) { this.pendingBytes -= pending.size; this.uploads.delete(upload) }
      return { cancelled: true }
    }
    if (typeof data !== 'string' || data.length > 349528) throw new Error('Invalid or oversized base64 chunk (maximum 262144 bytes)')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.length > 262144 || bytes.toString('base64') !== data) throw new Error('Invalid base64 chunk')
    if (!Number.isSafeInteger(offset) || offset !== (pending ? pending.size : 0)) throw new Error('Upload offset mismatch')
    if (this.bytes + this.pendingBytes + bytes.length > this.maxBytes || !pending && this.uploads.size >= 16) throw Object.assign(new Error('Artifact store limit exceeded'), { code: 'JSEE_ARTIFACT_LIMIT' })
    const id = upload || crypto.randomUUID()
    if (!pending) pending = { chunks: [], size: 0, name: part.name, mime: part.mime }
    pending.chunks.push(bytes)
    pending.size += bytes.length
    this.pendingBytes += bytes.length
    this.uploads.set(id, pending)
    if (!final) return { upload: id, offset: pending.size }
    this.uploads.delete(id)
    this.pendingBytes -= pending.size
    return this.ingest(Buffer.concat(pending.chunks), pending)
  }

  get (id) { return this.entries.get(id) }
  pathFor (id) {
    if (!this.entries.has(id)) throw makeHttpError('Unknown artifact', 404)
    return resolveInside(this.root, id)
  }
  read (id) {
    const filename = this.pathFor(id)
    const metadata = this.get(id)
    if (fs.statSync(filename).size !== metadata.size) throw makeHttpError('Artifact integrity check failed', 409)
    const bytes = fs.readFileSync(filename)
    if (bytes.length !== metadata.size || crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) throw makeHttpError('Artifact integrity check failed', 409)
    return bytes
  }
  close () { this.uploads.clear(); this.pendingBytes = 0; if (this.temporary) fs.rmSync(this.root, { recursive: true, force: true }) }
}

function resolveArtifactInputs (fields, inputs, store) {
  const result = { ...inputs }
  for (const field of fields || []) {
    if (field.type === 'group' && !field.name) {
      Object.assign(result, resolveArtifactInputs(field.elements, result, store))
    } else if (field.type === 'group' && isRecordObject(result[field.name])) {
      Object.defineProperty(result, field.name, { value: resolveArtifactInputs(field.elements, result[field.name], store), enumerable: true, writable: true, configurable: true })
    } else if (['file', 'image', 'audio', 'video'].includes(field.type) && isRecordObject(result[field.name]) && Object.hasOwn(result[field.name], 'artifact')) {
      const id = result[field.name].artifact
      const metadata = store && store.get(id)
      if (!metadata) throw new Error(field.name + ': unknown or unavailable artifact')
      if (field.raw || field.stream) throw new Error(field.name + ': artifact references do not support raw/stream mode')
      const accepts = require('./schema').matchesFileAccept
      if (!accepts(field.accept, metadata.name, metadata.mime) || field.type !== 'file' && !accepts(field.type + '/*', metadata.name, metadata.mime)) throw new Error(field.name + ': artifact MIME/name does not match accept')
      const bytes = store.read(id)
      const value = field.arrayBuffer === true || field.type !== 'file'
        ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        : new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      Object.defineProperty(result, field.name, { value, enumerable: true, writable: true, configurable: true })
    }
  }
  return result
}

function formatRun (schema, run, store) {
  if (run.status !== 'succeeded') return run
  try {
    const entries = []
    const files = []
    const outputs = flattenJseeOutputs(schema.outputs)
    for (const output of outputs) {
      let value = run.result
      if (isRecordObject(value)) {
        const key = outputLookupNames(output).find(name => Object.prototype.hasOwnProperty.call(value, name))
        value = key === undefined ? output.value : value[key]
      } else if (outputs.length !== 1) throw new Error('Multiple outputs require a result object')
      if (value === undefined) throw new Error('Missing declared output: ' + output.name)
      const media = ['image', 'audio', 'video'].includes(output.type)
      if (output.type === 'file' || media && (isBinaryLike(value) || isRecordObject(value) && ['content', 'value', 'data'].some(key => Object.hasOwn(value, key)))) {
        if (isRecordObject(value) && ['content', 'value', 'data'].every(key => !(key in value))) throw new Error('File outputs need content, value, or data; URLs are not fetched')
        const file = normalizeFileOutputValue(output, value)
        let bytes
        if (typeof file.value === 'string') bytes = Buffer.from(file.value, 'utf8')
        else if (ArrayBuffer.isView(file.value)) bytes = Buffer.from(file.value.buffer, file.value.byteOffset, file.value.byteLength)
        else if (file.value instanceof ArrayBuffer) bytes = Buffer.from(file.value)
        else throw new Error('File content must be text or bytes')
        const name = String(file.filename || output.name).replace(/\\/g, '/').split('/').pop().replace(/[\x00-\x1f\x7f]/g, '_').slice(0, 255) || 'file'
        const mime = file.mime || 'application/octet-stream'
        if (media && !require('./schema').matchesFileAccept(output.type + '/*', name, mime)) throw new Error('Media bytes require a matching declared MIME type')
        if (typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+(?:;[^\r\n]*)?$/.test(mime)) throw new Error('Invalid file MIME type')
        entries.push([output.name, { artifact: run.runId + '/' + files.length }])
        files.push({ output: output.name, bytes, name, mime })
      } else entries.push([output.name, jsonValue(value, jsonPath('', output.name))])
    }
    // Validate every output before persisting any file or exposing an artifact handle.
    const projected = Object.fromEntries(entries)
    const error = outputShapeError(projected, canonicalOutputSchema(schema.outputs))
    if (error) throw new Error(error)
    return { runId: run.runId, status: 'succeeded', outputs: projected, artifacts: store.commit(run.runId, files) }
  } catch (error) { return failedRun(error.code || 'JSEE_OUTPUT_INVALID', error.message, run.runId) }
}

function runResultSchema (schema) {
  return {
    type: 'object', required: ['runId', 'status', 'outputs', 'artifacts'],
    properties: {
      runId: { type: 'string' }, status: { const: 'succeeded' }, outputs: canonicalOutputSchema(schema.outputs),
      artifacts: { type: 'array', items: {
        type: 'object', required: ['id', 'output', 'name', 'mime', 'size', 'sha256', 'uri'],
        properties: {
          ...Object.fromEntries(['id', 'output', 'name', 'mime', 'sha256', 'uri'].map(name => [name, { type: 'string' }])),
          size: { type: 'integer', minimum: 0 }
        }
      } }
    }
  }
}

function canonicalOpenAPI (schema) {
  const description = inspectSchema(schema)
  return { openapi: '3.1.0', info: { title: description.title, version: '1.0.0' }, paths: {
    '/schema': { get: { responses: { 200: { description: 'Computation descriptor with local model references' } } } },
    '/__jsee/artifacts': { post: { description: 'Upload raw bytes; Content-Type declares MIME. Returns artifact ID and metadata.', parameters: [{ name: 'name', in: 'query', schema: { type: 'string' } }], requestBody: { required: true, content: { '*/*': { schema: { type: 'string', format: 'binary' } } } }, responses: { 201: { description: 'Registered artifact ID and metadata' }, 413: { description: 'Body limit exceeded' }, 507: { description: 'Artifact limit exceeded' } } } },
    '/__jsee/artifacts/{runId}/{index}': { get: {
      parameters: ['runId', 'index'].map(name => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      responses: { 200: { description: 'Artifact bytes; Content-Type and attachment name come from artifact metadata' }, 403: { description: 'Access denied' }, 404: { description: 'Unknown artifact' } }
    } },
    '/run': { post: { operationId: description.id, requestBody: { required: true, content: { 'application/json': { schema: description.inputSchema } } },
      responses: { 200: { description: 'Declared outputs and artifact references', content: { 'application/json': { schema: runResultSchema(schema) } } }, 400: { description: 'Invalid input' }, 413: { description: 'Body limit exceeded' }, 415: { description: 'JSON content type required' }, 422: { description: 'Unsupported capability' }, 500: { description: 'Execution or output error' }, 507: { description: 'Artifact limit exceeded' } } } }
  } }
}

module.exports = { uploadTool, resolveArtifactInputs, validateDescriptor, inspectSchema, ArtifactStore, formatRun, failedRun, responseStatus, canonicalOpenAPI, runResultSchema, outputShapeError, BODY_LIMIT, ARTIFACT_LIMIT }
