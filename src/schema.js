function assertSchemaVersion (schema) {
  if (schema && typeof schema.schemaVersion !== 'undefined' && schema.schemaVersion !== 1) {
    throw new Error('Unsupported schemaVersion: expected 1 or an absent version')
  }
}

function getOptionValue (option) {
  if (option && typeof option === 'object') {
    if (typeof option.value !== 'undefined') return option.value
    if (typeof option.name !== 'undefined') return option.name
    if (typeof option.label !== 'undefined') return option.label
  }
  return option
}

function setProperty (object, name, value) {
  // Schema names are data, including names such as __proto__.
  Object.defineProperty(object, name, { value, enumerable: true, writable: true, configurable: true })
}

function cloneSchema (value, seen=new WeakMap()) {
  if (!value || typeof value !== 'object') return value
  // Clone descriptor containers while preserving function and opaque runtime value identities.
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  if (seen.has(value)) return seen.get(value)
  const copy = Array.isArray(value) ? [] : {}
  seen.set(value, copy)
  Object.keys(value).forEach(key => setProperty(copy, key, cloneSchema(value[key], seen)))
  return copy
}

function collectInputValues (inputs, read=input => input.value) {
  const values = {}
  for (const input of inputs || []) {
    if (!input || input.type === 'button' || input.type === 'action') continue
    if (input.type === 'group') {
      const nested = collectInputValues(input.elements, read)
      if (input.name) setProperty(values, input.name, nested)
      else Object.keys(nested).forEach(name => setProperty(values, name, nested[name]))
    } else if (input.name) {
      const value = read(input)
      if (typeof value !== 'undefined') setProperty(values, input.name, value)
    }
  }
  return values
}

function getInputDefaultValue (input) {
  if (!input || typeof input !== 'object') return undefined
  if (input.type === 'group' && Array.isArray(input.elements)) {
    return collectInputValues(input.elements, getInputDefaultValue)
  }
  if (Object.prototype.hasOwnProperty.call(input, 'default')) return input.default

  switch (input.type) {
    case 'int':
    case 'float':
    case 'number':
      return 0
    case 'string':
    case 'text':
      return ''
    case 'color':
      return '#000000'
    case 'categorical':
    case 'select':
    case 'radio':
      return input.options && input.options.length ? getOptionValue(input.options[0]) : ''
    case 'bool':
    case 'checkbox':
    case 'toggle':
      return false
    case 'multi-select':
      return []
    case 'range':
      return [input.min || 0, input.max || 100]
    case 'slider':
      return input.min || 0
    case 'object':
      return {}
    case 'table':
      return []
    case 'folder':
      return input.default || []
    case 'file':
      return ''
    default:
      return undefined
  }
}

function optionSchema (options) {
  const values = options.map(getOptionValue)
  const types = [...new Set(values.map(value => {
    if (value === null) return 'null'
    if (Number.isInteger(value)) return 'integer'
    if (Array.isArray(value)) return 'array'
    return typeof value
  }))]
  return { type: types.length === 1 ? types[0] : types, enum: values }
}

function tableOutputJsonSchema (allowMatrix=true) {
  return {
    oneOf: [
      {
        type: 'object',
        properties: {
          columns: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array', items: {} } }
        },
        required: ['columns', 'rows'],
        additionalProperties: true
      },
      {
        type: 'array',
        items: { type: 'object', additionalProperties: true }
      },
      ...(allowMatrix ? [{
        // The browser table also accepts a header row followed by array rows.
        type: 'array', minItems: 1, items: { type: 'array', items: {} }
      }] : [])
    ]
  }
}

function artifactInputSchema () {
  return { type: 'object', properties: { artifact: { type: 'string', minLength: 1 } }, required: ['artifact'], additionalProperties: false }
}

function assertJsonValue (value, seen=new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value) || typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || seen.has(value) || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected a finite JSON value')
  seen.add(value)
  Object.values(value).forEach(item => assertJsonValue(item, seen))
  seen.delete(value)
}

function assertValueSchema (schema, at='valueSchema') {
  assertJsonValue(schema)
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error(at + ': expected schema object')
  const keywords = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description']
  for (const key of Object.keys(schema)) if (!keywords.includes(key)) throw new Error(at + ': unsupported keyword ' + key)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.length || new Set(types).size !== types.length || types.some(type => !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type))) throw new Error(at + '.type: invalid JSON type')
  }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) throw new Error(at + '.properties: expected object')
    for (const [name, child] of Object.entries(schema.properties)) assertValueSchema(child, at + '.properties.' + name)
  }
  if (schema.items !== undefined) assertValueSchema(schema.items, at + '.items')
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(name => typeof name !== 'string') || new Set(schema.required).size !== schema.required.length)) throw new Error(at + '.required: expected unique strings')
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') throw new Error(at + '.additionalProperties: expected boolean')
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) throw new Error(at + '.enum: expected nonempty array')
  if (schema.description !== undefined && typeof schema.description !== 'string') throw new Error(at + '.description: expected string')
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]) || !['minimum', 'maximum'].includes(key) && (!Number.isInteger(schema[key]) || schema[key] < 0))) throw new Error(at + '.' + key + ': invalid bound')
  }
}

function getValueSchema (field) {
  if (!Object.hasOwn(field, 'valueSchema')) return undefined
  if (field.type !== 'object') throw new Error('valueSchema is only supported for type object')
  assertValueSchema(field.valueSchema)
  return cloneSchema(field.valueSchema)
}

function assertShapedValue (field, value, at=field.name) {
  const shape = getValueSchema(field)
  if (shape === undefined) return
  assertJsonValue(value)
  const errors = jsonShapeErrors(value, shape, at)
  if (errors.length) throw new Error(errors.join('; '))
}

function jseeInputsToJsonSchema (inputs) {
  if (inputs != null && !Array.isArray(inputs)) throw new Error('inputs/elements should be an array')
  const properties = {}
  const required = []
  const add = (name, prop) => {
    if (typeof name !== 'string' || !name) throw new Error('Input name should be a nonempty string')
    if (Object.prototype.hasOwnProperty.call(properties, name)) throw new Error(`Duplicate input name: ${name}`)
    setProperty(properties, name, prop)
  }
  for (const inp of inputs || []) {
    if (!inp || typeof inp !== 'object') throw new Error('Input should be an object')
    const valueSchema = getValueSchema(inp)
    if (inp.type === 'button' || inp.type === 'action') continue
    if (inp.type === 'group' && !inp.name) {
      const nested = jseeInputsToJsonSchema(inp.elements)
      Object.keys(nested.properties).forEach(name => add(name, nested.properties[name]))
      required.push(...nested.required)
      continue
    }
    const prop = {}
    if (inp.description) prop.description = inp.description
    switch (inp.type) {
      case 'group':
        Object.assign(prop, jseeInputsToJsonSchema(inp.elements))
        break
      case 'table':
        Object.assign(prop, tableOutputJsonSchema(false))
        break
      case 'object':
        if (valueSchema) Object.assign(prop, valueSchema)
        break
      case 'image': case 'audio': case 'video':
        Object.assign(prop, artifactInputSchema())
        prop['x-jsee-accept'] = inp.accept || inp.type + '/*'
        break
      case 'file':
        prop.type = 'string'
        if (inp.raw || inp.stream) {
          prop.type = ['string', 'object']
          prop.properties = { kind: { type: 'string', enum: ['url'] }, url: { type: 'string' } }
          prop.required = ['kind', 'url']
        }
        break
      case 'folder':
        prop.type = 'array'
        prop.items = { type: 'object' }
        break
      case 'int':
        prop.type = 'integer'
        break
      case 'float': case 'number': case 'slider':
        prop.type = 'number'
        break
      case 'bool': case 'checkbox': case 'toggle':
        prop.type = 'boolean'
        break
      case 'select': case 'categorical': case 'radio':
        Object.assign(prop, inp.options && inp.options.length ? optionSchema(inp.options) : { type: 'string' })
        break
      case 'range':
        prop.type = 'array'
        prop.items = { type: 'number' }
        prop.minItems = 2
        prop.maxItems = 2
        break
      case 'multi-select':
        prop.type = 'array'
        prop.items = inp.options && inp.options.length ? optionSchema(inp.options) : { type: 'string' }
        break
      default:
        prop.type = 'string'
    }
    if (inp.arrayBuffer === true) {
      prop.type = 'array'
      prop.items = { type: 'number' }
    }
    if (inp.type === 'file' && !inp.raw && !inp.stream) {
      const legacy = { ...prop }
      delete legacy.description
      for (const key of Object.keys(prop)) if (key !== 'description') delete prop[key]
      prop.oneOf = [legacy, artifactInputSchema()]
      if (inp.accept) prop['x-jsee-accept'] = inp.accept
    }
    if (['integer', 'number'].includes(prop.type)) {
      if (inp.min !== undefined) prop.minimum = inp.min
      if (inp.max !== undefined) prop.maximum = inp.max
      if (inp.step !== undefined) prop.multipleOf = inp.step
    }
    if (inp.default !== undefined) prop.default = inp.default
    if (valueSchema === undefined && (inp.nullable === true || inp.default === null)) {
      const types = Array.isArray(prop.type) ? prop.type : [prop.type]
      if (prop.oneOf) prop.oneOf.push({ type: 'null' })
      else if (prop.type) prop.type = [...new Set([...types, 'null'])]
      if (prop.enum && !prop.enum.includes(null)) prop.enum.push(null)
    }
    add(inp.name, prop)
    if (inp.required === true || (inp.required !== false && inp.default === undefined)) required.push(inp.name)
  }
  return { type: 'object', properties, required }
}

// HTML accept is a selection hint; transports compare it against stored declarations,
// not client overrides. This does not decode media or establish content authenticity.
function matchesFileAccept (accept, name='', mime='') {
  if (!accept) return true
  const media = mime.split(';')[0].trim().toLowerCase()
  return accept.split(',').some(token => {
    token = token.trim().toLowerCase()
    if (token === '*/*') return true
    if (token.startsWith('.')) return name.toLowerCase().endsWith(token)
    if (token.endsWith('/*')) return media.startsWith(token.slice(0, -1))
    return token === media
  })
}

function jsonShapeErrors (value, schema, path) {
  const errors = []
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const sameValue = (a, b) => {
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key]))
  }
  const matches = (value, type) => {
    if (type === 'integer') return Number.isInteger(value)
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (type === 'null') return value === null
    if (type === 'array') return Array.isArray(value)
    if (type === 'object') return isRecord(value)
    return typeof value === type
  }
  const check = (value, prop, path) => {
    const supported = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description', 'default', 'oneOf', 'anyOf', 'patternProperties', 'x-jsee-accept']
    for (const key of Object.keys(prop)) if (!supported.includes(key)) { errors.push(path + ': unsupported schema keyword ' + key); return }
    if (prop.anyOf && !prop.anyOf.some(option => !jsonShapeErrors(value, option, path).length)) errors.push(`${path}: does not match the declared shape`)
    if (prop.patternProperties && isRecord(value)) {
      for (const [pattern, rule] of Object.entries(prop.patternProperties)) {
        for (const key of Object.keys(value)) if (new RegExp(pattern).test(key)) check(value[key], rule, path + '.' + key)
      }
    }
    if (prop.oneOf) {
      const count = prop.oneOf.filter(option => {
        const start = errors.length
        check(value, option, path)
        return errors.splice(start).length === 0
      }).length
      if (count !== 1) errors.push(`${path}: does not match the declared input shape`)
    }
    if (prop.minLength !== undefined && typeof value === 'string' && [...value].length < prop.minLength) errors.push(`${path}: string is too short`)
    if (prop.maxLength !== undefined && typeof value === 'string' && [...value].length > prop.maxLength) errors.push(`${path}: string is too long`)
    if (isRecord(value) && prop.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(prop.properties || {}, key))) errors.push(`${path}: undeclared property`)

    const types = Array.isArray(prop.type) ? prop.type : [prop.type]
    if (prop.type && !types.some(type => matches(value, type))) {
      errors.push(`${path}: expected ${types.join(' or ')}`)
      return
    }
    if (prop.enum && !prop.enum.some(option => sameValue(option, value))) errors.push(`${path}: value is not in options`)
    if (value === null) return
    if (typeof value === 'number' && prop.minimum !== undefined && value < prop.minimum) errors.push(`${path}: minimum is ${prop.minimum}`)
    if (typeof value === 'number' && prop.maximum !== undefined && value > prop.maximum) errors.push(`${path}: maximum is ${prop.maximum}`)
    if (typeof value === 'number' && prop.multipleOf > 0) {
      const ratio = value / prop.multipleOf
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) errors.push(`${path}: expected a multiple of ${prop.multipleOf}`)
    }
    if (Array.isArray(value)) {
      if (prop.minItems !== undefined && value.length < prop.minItems) errors.push(`${path}: too few items`)
      if (prop.maxItems !== undefined && value.length > prop.maxItems) errors.push(`${path}: too many items`)
      if (prop.items) value.forEach((item, index) => check(item, prop.items, `${path}[${index}]`))
    }
    if (isRecord(value)) {
      for (const name of prop.required || []) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) errors.push(`${path}.${name}: required`)
      }
      for (const name of Object.keys(prop.properties || {})) {
        if (Object.prototype.hasOwnProperty.call(value, name)) check(value[name], prop.properties[name], `${path}.${name}`)
      }
    }
  }
  check(value, schema, path)
  return errors
}

function prepareInputs (inputs, data) {
  const errors = []
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const visit = (fields, target, prefix='') => {
    for (const input of fields || []) {
      if (input.type === 'button' || input.type === 'action') continue
      if (input.type === 'group' && !input.name) {
        visit(input.elements, target, prefix)
        continue
      }
      const name = input.name
      const path = prefix + name
      if (!Object.prototype.hasOwnProperty.call(target, name)) {
        if (input.required === true) errors.push(`${path}: required`)
        else if (input.default !== undefined) setProperty(target, name, cloneSchema(input.default))
        else if (input.required !== false) errors.push(`${path}: required`)
        if (!Object.prototype.hasOwnProperty.call(target, name)) continue
      }
      const value = target[name]
      if (input.valueSchema === undefined && value === null && (input.nullable === true || input.default === null)) continue
      if (input.type === 'group') {
        if (!isRecord(value)) errors.push(`${path}: expected object`)
        else {
          setProperty(target, name, { ...value })
          visit(input.elements, target[name], path + '.')
        }
      } else if (value && ((['file', 'image', 'audio', 'video'].includes(input.type) || input.arrayBuffer === true) && (ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === '[object ArrayBuffer]') || (['file', 'image', 'audio', 'video'].includes(input.type) && typeof Blob !== 'undefined' && value instanceof Blob))) {
        // Multipart decoding produces binary values after transport-level string validation.
        continue
      } else {
        if (['table', 'object'].includes(input.type)) {
          try { assertJsonValue(value) } catch (error) { errors.push(path + ': ' + error.message); continue }
        }
        errors.push(...jsonShapeErrors(value, jseeInputsToJsonSchema([input]).properties[name], path))
      }
    }
  }
  const result = isRecord(data) ? { ...data } : {}
  if (!isRecord(data)) errors.push('inputs: expected object')
  else visit(inputs, result)
  if (errors.length) {
    const error = new Error(errors.join('; '))
    error.status = 400
    error.code = 'JSEE_INPUT_INVALID'
    throw error
  }
  return result
}

module.exports = { getValueSchema, assertValueSchema, assertShapedValue, jsonShapeErrors, tableOutputJsonSchema, matchesFileAccept, assertSchemaVersion, cloneSchema, getOptionValue, collectInputValues, getInputDefaultValue, jseeInputsToJsonSchema, prepareInputs }
