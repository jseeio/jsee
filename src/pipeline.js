const { isRecordObject } = require('./utils')
const { cloneSchema } = require('./schema')
const { own, list, fields, same, sameContent, defaults, prepareStageInputs, decodeFileDefaults } = require('./pipeline-data')
const { fingerprint } = require('./fingerprint')
const read = (value, path) => path.reduce((current, key) => current && own(current, key) ? current[key] : undefined, value)
const merge = (previous, next) => isRecordObject(previous) && isRecordObject(next) ? { ...previous, ...next } : next === undefined ? previous : next
const identified = schema => list(schema.model).some(model => model?.id !== undefined)

function stageSchema (schema, stage) {
  return { inputs: stage.scope ? schema.inputs?.find(input => input.name === stage.scope)?.elements || [] : schema.inputs || [],
    outputs: fields(schema.outputs).filter(output => output.name?.startsWith(stage.id + '.')).map(output => ({ ...output, name: output.name.slice(stage.id.length + 1) })) }
}

// This validates stage wiring, not module schemas. Authors flatten modules before
// passing the document to JSEE; both named stages and legacy lists use one loop.
function validatePipeline (schema) {
  const models = list(schema.model)
  if (models.some(model => model?.schema)) throw new Error('Flatten module schemas into ordinary model stages before execution')
  if (!identified(schema)) return { named: false, nodes: new Map(models.map((model, i) => [i, model])), order: models.map((_, i) => i), dependencies: new Map() }
  const nodes = new Map(), dependencies = new Map()
  for (const model of models) {
    if (!model || typeof model.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(model.id) || nodes.has(model.id)) throw new Error('Pipeline requires unique stage ids on every model')
    if (model.enabled !== undefined && typeof model.enabled !== 'boolean') throw new Error(model.id + ': enabled must be boolean')
    if (model.scope && !schema.inputs?.some(input => input.type === 'group' && input.name === model.scope)) throw new Error(model.id + ': unknown input scope ' + model.scope)
    nodes.set(model.id, model)
  }
  for (const model of models) {
    const deps = new Set(model.from ? [model.from] : [])
    for (const [name, binding] of Object.entries(model.bindings || {})) {
      if (!binding || [own(binding, 'stage'), own(binding, 'input'), own(binding, 'value')].filter(Boolean).length !== 1) throw new Error(model.id + ': invalid binding ' + name)
      if (own(binding, 'stage')) {
        deps.add(binding.stage)
        if (!Array.isArray(binding.path) || binding.path.some(part => typeof part !== 'string')) throw new Error(model.id + ': stage binding requires a path array')
      } else if (own(binding, 'input') && (!Array.isArray(binding.input) || !binding.input.length || binding.input.some(part => typeof part !== 'string'))) throw new Error(model.id + ': input binding requires a path array')
    }
    for (const dep of deps) if (!nodes.has(dep)) throw new Error(model.id + ': missing source ' + dep)
    dependencies.set(model.id, [...deps])
  }
  const order = [], seen = new Set(), active = new Set()
  const visit = id => {
    if (active.has(id)) throw new Error('Pipeline contains a cycle at ' + id)
    if (seen.has(id)) return
    active.add(id); dependencies.get(id).forEach(visit); active.delete(id); seen.add(id); order.push(id)
  }
  nodes.forEach((_, id) => visit(id))
  return { named: true, nodes, order, dependencies }
}

function activeOutputs (schema) {
  const disabled = new Set(list(schema.model).filter(model => model?.enabled === false).map(model => model.id))
  return fields(schema.outputs).filter(output => !disabled.has(output.name?.split('.')[0]))
}

function projectResults (schema, results) {
  const available = {}
  for (const [id, result] of Object.entries(results)) if (isRecordObject(result)) {
    for (const [name, value] of Object.entries(result)) available[id + '.' + name] = value
  }
  const output = {}
  for (const field of activeOutputs(schema)) {
    const name = [field.name, ...list(field.alias)].find(name => own(available, name))
    if (name) output[field.name] = available[name]
  }
  return output
}

class Pipeline {
  constructor (schema, stages, { prepare=prepareStageInputs, changed=() => {}, output=() => {}, headless=false }={}) {
    this.schema = cloneSchema(schema)
    decodeFileDefaults(this.schema.inputs)
    Object.assign(this, validatePipeline(this.schema))
    this.runners = new Map([...this.nodes.keys()].map((id, i) => [id, stages[i]]))
    this.prepare = prepare; this.changed = changed; this.output = output; this.headless = headless
    this.states = new Map([...this.nodes.keys()].map(id => [id, { status: 'idle', revision: 0 }]))
    this.keys = new Map((this.named ? [...this.nodes] : []).map(([id, model]) => {
      const contract = stageSchema(this.schema, model)
      const { enabled: _enabled, ...executable } = model
      // Mutable form presentation/defaults are separate from executable identity.
      const contracts = ports => ports.map(({ default: _default, value: _value, options: _options, label: _label, title: _title, display: _display, _id, ...field }) => ({ ...field, ...(field.elements ? { elements: contracts(field.elements) } : {}) }))
      const ports = contracts(contract.inputs)
      return [id, fingerprint(JSON.stringify({ executable, ports, outputs: contracts(contract.outputs) }, (key, value) => typeof value === 'function' ? String(value) : value))]
    }))
    this.busy = false; this.epoch = 0
  }
  values (id, inputs) {
    const stage = this.nodes.get(id)
    let values = { ...defaults(stageSchema(this.schema, stage)), ...(stage.scope ? inputs[stage.scope] : inputs) }
    if (stage.from) values = merge(values, this.states.get(stage.from).result)
    for (const [name, binding] of Object.entries(stage.bindings || {})) {
      values[name] = own(binding, 'value') ? binding.value : own(binding, 'input') ? read(inputs, binding.input) : read(this.states.get(binding.stage).result, binding.path)
    }
    return values
  }
  refresh (inputs) {
    if (!this.named) return
    for (const id of this.order) {
      const state = this.states.get(id)
      if (['current', 'stale'].includes(state.status)) state.status = same(state.inputs, this.values(id, inputs)) && this.dependencies.get(id).every(dep => this.states.get(dep).status === 'current' && this.states.get(dep).revision === state.dependencies[dep]) ? 'current' : 'stale'
    }
  }
  plan (inputs, target) {
    if (!this.named) return this.order
    this.refresh(inputs)
    if (target && !this.nodes.has(target)) throw new Error('Unknown target stage: ' + target)
    const required = new Set()
    const visit = id => {
      if (required.has(id)) return
      if (this.nodes.get(id).enabled === false) throw new Error('Enable stage ' + id + ' before execution')
      required.add(id); this.dependencies.get(id).forEach(visit)
    }
    if (target) {
      visit(target)
      // Browser views follow the selected computation, without pulling in other branches.
      for (const id of this.order) if (this.nodes.get(id).render && this.nodes.get(id).enabled !== false && this.dependencies.get(id).every(dep => required.has(dep))) required.add(id)
    } else for (const id of this.order) if (this.nodes.get(id).enabled !== false) visit(id)
    return this.order.filter(id => required.has(id) && !(this.headless && this.nodes.get(id).render))
  }
  async run (inputs, { target, force=false, overrides, transient=false, renderOnly=false }={}, check=() => {}) {
    if (this.busy) throw new Error('Pipeline is already running')
    if (this.named && transient && !target) throw new Error('Transient invocation requires a target stage')
    const order = this.plan(inputs, target), epoch = this.epoch
    const valid = () => { check(); if (this.epoch !== epoch) throw new Error('Pipeline cancelled') }
    this.busy = true
    let result = inputs
    try {
      for (const id of order) {
        valid()
        const stage = this.nodes.get(id), state = this.states.get(id)
        if (!this.named && isRecordObject(result) && result.stop) break
        if (renderOnly && (!stage.render || this.dependencies.get(id).some(dep => !this.states.get(dep).result))) continue
        const temporary = transient && id === target
        if (this.named && state.status === 'current' && !(force && (!target || id === target)) && !temporary) continue
        const source = this.named ? this.values(id, inputs) : result
        const previousStatus = state.status
        state.status = 'running'; state.error = ''; this.changed(id, this.describe(id))
        try {
          const supplied = id === target && overrides ? { ...source, ...overrides } : source
          const prepared = this.named && !stage.from ? await this.prepare(stageSchema(this.schema, stage), supplied, id) : supplied
          valid()
          // `from` preserves a module's old flat-stack merge/stop semantics. A stop
          // ends that chain, not unrelated branches in the containing document.
          let next = stage.from && source?.stop ? source : await this.runners.get(id)(prepared)
          valid()
          const ports = stageSchema(this.schema, stage).outputs
          if (this.named && !isRecordObject(next) && ports.length === 1) next = { [ports[0].name]: next }
          result = merge(prepared, next)
          if (this.named) this.output(id, next)
          if (temporary) state.status = previousStatus
          else if (this.named) {
            for (const field of ports) if (field.required === true && !own(result || {}, field.name)) throw new Error(id + ': missing required output ' + field.name + '; configure the stage before running')
            state.inputs = cloneSchema(source); state.result = result; state.revision++
            state.dependencies = Object.fromEntries(this.dependencies.get(id).map(dep => [dep, this.states.get(dep).revision]))
            state.status = 'current'; this.refresh(inputs)
          }
          this.changed(id, this.describe(id))
        } catch (error) {
          if (epoch !== this.epoch) throw error
          state.status = epoch !== this.epoch ? 'cancelled' : 'error'; state.error = error.message || String(error)
          this.refresh(inputs); this.changed(id, this.describe(id)); throw error
        }
      }
      return this.named ? projectResults(this.schema, Object.fromEntries([...this.states].filter(([, state]) => state.result).map(([id, state]) => [id, state.result]))) : result
    } finally { if (epoch === this.epoch) this.busy = false }
  }
  describe (id) { return cloneSchema(this.states.get(id)) }
  snapshot () {
    if (this.busy) throw new Error('Stop execution before saving pipeline state')
    return { version: 1, stages: Object.fromEntries([...this.states].filter(([id]) => !this.nodes.get(id).render).map(([id, state]) => [id, { ...cloneSchema(state), definition: this.keys.get(id) }])) }
  }
  restore (snapshot) {
    if (this.busy) throw new Error('Stop execution before restoring pipeline state')
    if (snapshot?.version !== 1 || !isRecordObject(snapshot.stages)) throw new Error('Invalid pipeline state')
    const updates = []
    for (const [id, saved] of Object.entries(snapshot.stages)) {
      if (!this.states.has(id) || this.nodes.get(id).render || saved.definition !== this.keys.get(id)) continue
      if (!['idle', 'current', 'stale', 'error', 'cancelled'].includes(saved.status) || !Number.isSafeInteger(saved.revision) || saved.revision < 0 || (saved.status === 'current' && (!saved.inputs || !saved.dependencies || saved.result === undefined))) throw new Error('Invalid stage state')
      const { definition: _definition, ...state } = saved
      updates.push([id, cloneSchema(state)])
    }
    for (const [id, state] of updates) this.states.set(id, state)
  }
  async reconcile (inputs) {
    for (const id of this.order) {
      const state = this.states.get(id)
      if (state.status !== 'current') continue
      const values = this.values(id, inputs)
      if (await sameContent(state.inputs, values)) state.inputs = cloneSchema(values)
      else state.status = 'stale'
    }
    this.refresh(inputs)
  }
  cancel () {
    this.epoch++
    this.busy = false
    for (const [id, state] of this.states) if (state.status === 'running') { state.status = 'cancelled'; this.changed(id, this.describe(id)) }
  }
  dispose () { this.cancel(); this.states.clear() }
}
async function runPipeline (stages, inputs, checkCancelled=() => {}, schema={ model: stages.map(() => ({})) }) {
  const pipeline = new Pipeline(schema, stages)
  try { return await pipeline.run(inputs, {}, checkCancelled) } finally { pipeline.dispose() }
}
module.exports = { Pipeline, runPipeline, validatePipeline, stageSchema, projectResults, activeOutputs, identified }
