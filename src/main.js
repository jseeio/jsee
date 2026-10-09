import { createVueApp } from './app'
import workerSource from '../dist/jsee.worker.mjs?worker-source'
import classicWorkerSource from '../dist/jsee.worker.js?worker-source'

const utils = require('./utils')
const { outputLookupNames, collectOutputNames, cleanOutputMetadata } = utils
const { findInput, assertShapedValue, cloneSchema, collectInputValues, prepareInputs } = require('./schema')
const { Pipeline, validatePipeline, stageSchema, projectResults, identified } = require('./pipeline')
const { fingerprint } = require('./fingerprint')
const { prepareStageInputs, portableValue, decodeFileDefaults } = require('./pipeline-data')
const isObject = utils.isObject
const { DEFAULT_CONTAINER, DEFAULT_WORKER_TIMEOUT } = require('./constants')

const { Notyf } = require('notyf')
const notyf = new Notyf({
  types: [
    {
      type: 'success',
      background: '#00d1b2',
    },
    {
      type: 'error',
      background: '#f14668',
      duration: 2000,
      dismissible: true
    }
  ]
})

const Overlay = require('./overlay')
const ImageInput = require('./image-input')
const { imageFrames, withImageFrames, assertFrameResult } = require('./image-frame')

require('notyf/notyf.min.css')

/* global EXTENDED */
if (typeof EXTENDED !== 'undefined' && EXTENDED) {
  require('./extended-imports')
}

const fetch = window['fetch']
const Blob = window['Blob']

let instanceCounter = 0

function makeInstanceUid (value) {
  instanceCounter += 1
  const source = value || `instance-${instanceCounter}`
  const safe = String(source)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return `jsee-${safe || `instance-${instanceCounter}`}`
}

// const Worker = window['Worker']

const getName = utils.getName

function hasOwn (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function resolveOutputResult (res, output) {
  for (const name of outputLookupNames(output)) {
    if (hasOwn(res, name)) {
      return { found: true, value: res[name] }
    }
  }
  return { found: false, value: undefined }
}

function getModelType (model) {
  if (typeof model.code === 'string' && model.code.trim().length > 0) {
    if (model.code.split(' ').map(v => v.trim()).includes('def')) {
      return 'py'
    }
    return 'function'
  }
  if (isPythonModelUrl(model.url)) {
    return 'py'
  }
  if (isJavascriptModelUrl(model.url)) {
    return 'function'
  }
  if (model.url) {
    return 'post'
  }
  return 'function'
}

function urlPathMatchesExtension (value, extension) {
  if (typeof value !== 'string') return false
  const clean = value.split('#')[0].split('?')[0]
  return clean.toLowerCase().endsWith(extension)
}

function isJavascriptModelUrl (value) {
  return urlPathMatchesExtension(value, '.js') || urlPathMatchesExtension(value, '.mjs')
}

function isPythonModelUrl (value) {
  return urlPathMatchesExtension(value, '.py')
}

function collectStreamInputConfig (inputs, config={}) {
  if (!Array.isArray(inputs)) {
    return config
  }
  inputs.forEach(input => {
    if (!isObject(input)) {
      return
    }
    if (input.type === 'group') {
      collectStreamInputConfig(input.elements, config)
      return
    }
    if (input.type === 'file' && input.stream === true && input.name) {
      config[input.name] = { stream: true }
    }
  })
  return config
}

function applySecurityToInputs (inputs, security) {
  if (!Array.isArray(inputs)) return
  const options = utils.normalizeSecurityOptions(security)
  inputs.forEach(input => {
    if (!isObject(input)) return
    if (input.type === 'group') {
      applySecurityToInputs(input.elements, options)
      return
    }
    if (options.allowFileViewer === false && ['file', 'folder', 'image', 'audio', 'video'].includes(input.type)) {
      input.disabled = true
      input._securityBlocked = 'security.allowFileViewer'
    }
  })
}

export default class JSEE {
  constructor (params, alt1, alt2) {
    // Check if JSEE was initialized with args rather than with a params object
    // So two ways to init JSEE:
    // 1. new JSEE({schema: ..., container: ..., verbose: ...}) <- params object
    // 2. new JSEE(schema, container, verbose) <- args
    // This check converts args to params object (2 -> 1)
    if (('model' in params) || (typeof params === 'string') || (typeof params === 'function') || !(typeof alt1 === 'undefined')) {
      params = {
        'schema': params,
        'container': alt1,
        'verbose': alt2
      }
    }

    this.verbose = params.verbose !== false
    this.controls = params.controls !== false
    this.toasts = params.toasts !== false
    this.log = this.log.bind(this)
    this.uid = makeInstanceUid(params.id || params.uid)
    this.progressId = `${this.uid}-progress`
    this.overlayId = `${this.uid}-overlay`
    this._listeners = new Map()
    this.regions = {}
    for (const name of ['inputs', 'outputs', 'inputGroups']) {
      const target = params.regions && params.regions[name]
      if (target !== undefined) {
        const element = typeof target === 'string' ? document.querySelector(target) : target
        if (!element || element.nodeType !== 1 || !element.isConnected) {
          throw new Error(`regions.${name} must reference a connected element`)
        }
        this.regions[name] = element
      }
    }
    this.runtimeURL = params.runtimeURL
    this.container = params.container
    this.schema = params.schema || params.config // Previous naming
    this.security = utils.normalizeSecurityOptions()
    this.utils = utils
    this.__version__ = VERSION
    this.cancelled = false
    this._cancelWorkerRun = null
    this._rejectRun = null
    this._rejectWorkerRun = null
    this._imageInputs = new Set()
    this._workers = []
    this._apiRequests = new Set()
    this._pendingRun = null
    this._runToken = null
    this._runSequence = 0
    this._workerSequence = 0
    this.showProgress = params.progress !== false
    this._intervalLoop = false
    this._intervalToken = null
    this._intervalPromise = null
    this._needsModelReinit = false
    this._destroyed = false
    this._initialized = false
    this._cancelEpoch = 0
    this._initController = new AbortController()
    this._reinitController = null

    // Check if schema is provided
    if (typeof this.schema === 'undefined') {
      this.toast('error', 'No schema provided')
      throw new Error('No schema provided')
    }

    // Check if container is provided
    if (typeof this.container === 'undefined') {
      // Check if 'jsee-container' exists
      if (document.querySelector(DEFAULT_CONTAINER)) {
        this.container = DEFAULT_CONTAINER
        this.log(`Using default container: ${this.container}`)
      } else {
        this.toast('error', 'No container provided')
        throw new Error('No container provided')
      }
    }

    const root = typeof this.container === 'string' ? document.querySelector(this.container) : this.container
    const targets = Object.values(this.regions)
    if (new Set(targets).size !== targets.length || targets.some(target => root && (target.contains(root) || root.contains(target)))) {
      throw new Error('JSEE regions must be distinct elements outside the root container')
    }

    this._initPromise = this.init()
  }

  get ready () {
    return this._initPromise.then(() => {
      this._assertReady()
      return this
    })
  }

  _assertReady () {
    if (this._destroyed) throw new Error('JSEE instance has been destroyed')
    if (!this.data || !this.pipeline) throw new Error('Await instance.ready before accessing inputs')
  }

  on (event, listener) {
    if (this._destroyed) throw new Error('JSEE instance has been destroyed')
    if (!['inputs', 'start', 'result', 'error', 'cancel', 'destroy', 'stage', 'progress'].includes(event)) {
      throw new Error(`Unknown JSEE event: ${event}`)
    }
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function')
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(listener)
    return () => this._listeners.get(event)?.delete(listener)
  }

  _emit (event, value) {
    if (event === 'inputs' && this.executor && !this.executor.busy) this.executor.refresh(value)
    // Observer failures must not alter execution or prevent other observers running.
    for (const listener of [...(this._listeners.get(event) || [])]) {
      try { listener(cloneSchema(value)) } catch (error) { this.log('Event listener error:', error) }
    }
  }

  getInputs () {
    this._assertReady()
    return cloneSchema(collectInputValues(this.data.inputs))
  }

  async setInputs (values) {
    await this.ready
    if (imageFrames(values).length) throw new Error('ImageBitmap inputs require a transient invocation and cannot be stored in the form')
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Inputs must be an object')
    const updates = []
    const visit = (inputs, supplied) => {
      for (const [name, value] of Object.entries(supplied)) {
        const field = findInput(inputs, name)
        if (!field || ['button', 'action'].includes(field.type)) throw new Error(`Unknown input: ${name}`)
        if (field.type === 'group') {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Input group ${name} must be an object`)
          visit(field.elements || [], value)
        } else updates.push([field, cloneSchema(value)])
      }
    }
    visit(this.data.inputs, values)
    // Resolve all paths first so an invalid patch cannot partially update state.
    for (const [field, value] of updates) field.value = value
    await this.app.$nextTick()
  }

  async setInputState (path, patch) {
    await this.ready
    const names = typeof path === 'string' ? [path] : path
    if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name.length)) {
      throw new TypeError('Input path must be a name or a nonempty array of names')
    }
    let fields = this.data.inputs, field
    for (const name of names) {
      field = findInput(fields, name)
      if (!field) throw new Error('Unknown input: ' + names.join(' / '))
      fields = field.type === 'group' ? field.elements : []
    }
    if (!utils.isRecordObject(patch)) throw new TypeError('Input state must be an object')
    for (const [key, value] of Object.entries(patch)) {
      if (field.type === 'group' && key !== 'display') throw new TypeError('Groups support display state only')
      if (key === 'options') {
        if (!['select', 'categorical', 'radio', 'multi-select'].includes(field.type)) throw new TypeError('options requires a choice input')
        assertShapedValue({ name: 'options', type: 'object', valueSchema: { type: 'array' } }, value)
      } else if (!['disabled', 'readonly', 'display'].includes(key)) {
        throw new TypeError('Unsupported input state property: ' + key)
      } else if (typeof value !== 'boolean') throw new TypeError(key + ' must be a boolean')
    }
    // Validate and copy before applying anything; never silently replace the selected value.
    const update = cloneSchema(patch)
    Object.assign(field, update)
    for (const source of this._imageInputs) if (source.input === field && source.locked) source.stop().catch(error => source.fail(error))
    await this.app.$nextTick()
    this.app.validateInputs()
  }

  // The same acquisition owner backs the generated control and custom layouts.
  createImageInput (path, options={}) {
    this._assertReady()
    const names = typeof path === 'string' ? [path] : path
    if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string' || !name)) throw new TypeError('Image path must be a name or array of names')
    let fields = this.data.inputs, input
    for (const name of names) { input = findInput(fields, name); fields = input?.elements || [] }
    return this._createImageInput(input, options)
  }

  _createImageInput (input, options={}) {
    const source = new ImageInput({ ...options, input,
      onImage: async file => {
        const values = this._imageValues(input, file)
        await this.setInputs(values)
        if (!source.disposed) await options.onImage?.(file)
      },
      onDispose: () => this._imageInputs.delete(source),
      onFrame: options.onFrame || (!this._namedPipeline ? file => this.invoke(this._imageValues(input, file), { transient: true }) : undefined)
    })
    this._imageInputs.add(source)
    return source
  }

  _imageValues (field, file) {
    const visit = (fields, path=[]) => {
      for (const input of fields) {
        const next = input.name ? [...path, input.name] : path
        if (input === field) return next
        if (input.elements) { const found = visit(input.elements, next); if (found) return found }
      }
    }
    const path = visit(this.data.inputs)
    if (!path) throw new Error('Image input is no longer attached')
    const values = this.getInputs()
    let target = values
    for (const name of path.slice(0, -1)) target = target[name]
    Object.defineProperty(target, path[path.length - 1], { value: file, enumerable: true, writable: true, configurable: true })
    return values
  }

  async invoke (values, options) {
    const epoch = this._cancelEpoch
    const checkStopped = () => {
      if (epoch !== this._cancelEpoch) throw new DOMException('Run cancelled', 'AbortError')
    }
    await this.ready
    checkStopped()
    if (this.running || this._invoking) throw new Error('A run is already in progress')
    this._invoking = true
    try {
      const frames = imageFrames([values, options?.overrides])
      if (frames.length && !options?.transient) throw new Error('ImageBitmap inputs require a transient invocation')
      if (frames.length && !this.model.length) throw new Error('ImageBitmap requires a local browser JavaScript model; identity mode cannot retain frames')
      const transient = options?.transient && !this._namedPipeline
      if (values !== undefined && !transient) await this.setInputs(values)
      checkStopped()
      // Invocation owns exactly one run; never resolve with a queued run's result.
      this._pipelineOptions = { ...(transient ? { ...options, overrides: values } : options), _imageFrames: frames.length > 0 }
      return await this.runOnce('invoke', true)
    } finally {
      this._invoking = false
      if (this._pendingRun && !this._destroyed) {
        const pending = this._pendingRun
        this._pendingRun = null
        this.run(pending).catch(error => this.log('Queued run error:', error))
      }
    }
  }

  async stop (options) {
    const settled = this._runToken?.done
    const result = await this.cancelCurrentRun(options)
    if (settled) await settled
    await Promise.resolve()
    return result
  }

  log (...args) {
    if (!this.verbose) return
    console.log(`[JSEE v${VERSION}]`, ...args)
    const container = typeof this.container === 'string' ? document.querySelector(this.container) : this.container
    // Prefer the instance's sink while retaining the legacy external #log sink.
    const logElement = (container && container.querySelector('#log')) || document.querySelector('#log')
    if (logElement) {
      logElement.textContent = (logElement.textContent + `\n${args.join(' ')}`).slice(-10000)
      logElement.scrollTop = logElement.scrollHeight
    }
  }

  // A host may own messages while invoke rejections and error events remain intact.
  toast (level, text) {
    if (this.toasts) notyf[level](text)
  }

  notify (txt) {
    this.toast('success', txt)
  }

  stopInterval () {
    this._intervalLoop = false
    this._intervalToken = null
    this._intervalPromise = null
    if (!this.running && this.data) {
      this.data.running = false
    }
    if (!this.running && this.overlay) {
      this.overlay.hide()
    }
  }

  cancelCurrentRun (options={}) {
    for (const source of this._imageInputs) source.stop().catch(error => source.fail(error))
    if (options.mode !== undefined && !['force', 'cooperative'].includes(options.mode)) throw new TypeError('Unknown cancellation mode')
    if (options.mode === 'cooperative') return this._stopCooperatively(options.graceMs ?? 1000)
    if (this._runToken) this._runToken.cancelled = this._runToken.forced = true
    this._runToken?.controller?.abort()
    this._cancelEpoch++
    this.executor?.cancel()
    this.log('Stopping current run')
    const cancelError = new Error('Cancelled')
    this.stopInterval()
    this.cancelled = true
    this._pendingRun = null
    this._runToken = {}
    if (this._reinitController) this._reinitController.abort()
    this._apiRequests.forEach(controller => controller.abort())
    this._apiRequests.clear()
    if (typeof this._rejectRun === 'function') {
      this._rejectRun(cancelError)
      this._rejectRun = null
    }
    if (typeof this._cancelWorkerRun === 'function') {
      this._cancelWorkerRun()
    }
    // Reject the in-flight worker promise so run() stops awaiting
    if (typeof this._rejectWorkerRun === 'function') {
      this._rejectWorkerRun(cancelError)
      this._rejectWorkerRun = null
    }
    // Terminate all workers to force-stop blocking WASM computations
    this._terminateWorkers()
    return { retained: false }
  }

  async _stopCooperatively (graceMs) {
    if (!this._initialized && !this._destroyed) throw new Error('Await instance.ready before cooperative Stop')
    if (!Number.isFinite(graceMs) || graceMs < 0) throw new TypeError('graceMs must be a finite nonnegative number')
    if (this._stopping) return this._stopping
    const token = this._runToken
    if (!this.running || !token?.active || this._needsModelReinit) {
      this._cancelEpoch++
      this.stopInterval()
      this._pendingRun = null
      // Initialization has no invocation context/settlement acknowledgement.
      if (this.running || this._invoking) this.cancelCurrentRun()
      return { retained: !this._destroyed && !this._needsModelReinit }
    }
    this._cancelEpoch++
    this.stopInterval()
    this._pendingRun = null
    this.cancelled = token.cancelled = true
    this.executor?.cancel()
    token.controller.abort()
    this._apiRequests.forEach(controller => controller.abort())
    this._cancelWorkerRun?.()
    // Keep the run slot until model cleanup settles. A cancel message alone is
    // not permission to reuse a worker or its model-owned mutable state.
    let timer
    const stopping = (async () => {
      try {
        timer = setTimeout(() => {
          // Only a worker can be preempted. Main-thread cleanup must settle before
          // cooperative reuse even if it takes longer than the grace period.
          if (this._cancelWorkerRun) this.cancelCurrentRun()
        }, graceMs)
        await token.done
        // Let invoke's finally release its own slot before the host resumes.
        await Promise.resolve()
        return { retained: !token.forced && !this._destroyed && !this._needsModelReinit }
      } finally {
        clearTimeout(timer)
        if (this._stopping === stopping) this._stopping = null
      }
    })()
    this._stopping = stopping
    return stopping
  }

  _terminateWorkers () {
    const hadWorkers = this._workers.length > 0
    this._workers.forEach(w => {
      try { w.terminate() } catch (e) { /* ignore */ }
    })
    this._workers = []
    this._cancelWorkerRun = null
    // Force model re-init on next run only when worker-backed state was torn down.
    if (hadWorkers) this._needsModelReinit = true
  }

  _createRunContext (scope) {
    const token = this._runToken
    const active = () => !this._destroyed && token && token.active && !token.cancelled && this._runToken === token
    const callbacks = { isCancelled: () => !active(), signal: token?.controller?.signal }
    callbacks.progress = (value, details) => active() ? this.progress(value, details, { runId: token.id, stageId: scope || null }) : undefined
    for (const name of ['log', 'output', 'outputAsync']) {
      callbacks[name] = (...args) => active() ? scope && ['output', 'outputAsync'].includes(name) ? this._scopeOutput(scope, ...args) : this[name](...args) : undefined
    }
    // Retain browser context fields/methods while binding callbacks to this invocation.
    // Other methods must still mutate the actual instance, not a shadow context object.
    return new Proxy(this, {
      get (target, name) {
        if (Object.prototype.hasOwnProperty.call(callbacks, name)) return callbacks[name]
        const value = Reflect.get(target, name, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  }

  isCancelled () {
    return this.cancelled === true
  }

  destroy () {
    if (this._destroyed) return
    this._destroyed = true
    this._imageInputs.forEach(source => source.dispose())
    this._imageInputs.clear()
    this._emit('destroy')
    this._listeners.clear()
    this._initController.abort()
    this.log('Destroying JSEE instance')
    // Cancel any running computation
    this.cancelCurrentRun()
    const releaseOutputs = outputs => (outputs || []).forEach(output => {
      if (output._objectUrl) { URL.revokeObjectURL(output._objectUrl); output._objectUrl = null }
      if (output.elements) releaseOutputs(output.elements)
    })
    releaseOutputs(this.data && this.data.outputs)
    // Unmount Vue app
    if (this.app && this.app.__vueApp) {
      this.app.__vueApp.unmount()
    }
    // Clean up overlay
    if (this.overlay) {
      this.overlay.destroy()
    }
    // Remove progress bar
    const progress = document.getElementById(this.progressId)
    if (progress) progress.remove()
    // Null out references
    this.app = null
    this.data = null
    this.pipeline = null
    this.executor?.dispose()
    this.model = null
    this.schema = null
    this._cancelWorkerRun = null
    this._intervalLoop = false
    this._intervalToken = null
    this._intervalPromise = null
  }

  progress (i, details, identity) {
    if (this._destroyed || this._runToken?.cancelled && identity?.runId === this._runToken.id) return
    const progressState = utils.getProgressState(i)
    if (!progressState) {
      return
    }

    const event = { ...progressState, runId: this._runToken?.active ? this._runToken.id : null, stageId: null, ...identity }
    if (details && typeof details === 'object') {
      for (const key of ['loaded', 'total']) {
        if (typeof details[key] === 'number' && Number.isFinite(details[key]) && details[key] >= 0) event[key] = details[key]
      }
      if (typeof details.phase === 'string') event.phase = details.phase
    }
    this._emit('progress', event)
    // A host listener may synchronously stop or destroy this instance.
    if (this._destroyed || !this.showProgress || event.runId !== null && event.runId !== this._runToken?.id) return

    // Check if progress div is defined
    let progress = document.getElementById(this.progressId)
    if (!progress && progressState.mode === 'determinate' && progressState.value === 0) {
      return
    }

    if (!progress) {
      progress = document.createElement('div')
      progress.setAttribute('id', this.progressId)
      progress.setAttribute('class', 'jsee-progress')
      progress.style = 'position: fixed; top: 0; left: 0; width: 0; height: 3px; background: #00d1b2; z-index: 1000;'
      document.body.appendChild(progress)
    }

    let progressStyle = document.querySelector('#jsee-progress-style')
    if (!progressStyle) {
      progressStyle = document.createElement('style')
      progressStyle.setAttribute('id', 'jsee-progress-style')
      progressStyle.textContent = `
      @keyframes jsee-progress-indeterminate {
        0% { transform: translateX(-120%); }
        100% { transform: translateX(360%); }
      }
      `
      document.head.appendChild(progressStyle)
    }

    if (progressState.mode === 'indeterminate') {
      progress.style.width = '30%'
      progress.style.animation = 'jsee-progress-indeterminate 1.2s ease-in-out infinite'
    } else {
      progress.style.animation = 'none'
      progress.style.transform = 'none'
      progress.style.width = `${progressState.value}%`
    }

    // Overlay progress bar
    if (this.overlay) {
      this.overlay.setProgress(progressState)
    }
  }

  async init () {
    // At this point this.schema is defined but can be in different forms (e.g. string, object, function)
    try {
      // Each asynchronous boundary can outlive destroy(); never start the next stage afterward.
      for (const initialize of [this.initSchema, this.initModel, this.initInputs, this.initVue, this.initPipeline]) {
        if (this._destroyed) return false
        await initialize.call(this)
      }
    } catch (error) {
      this._terminateWorkers()
      if (!this._destroyed) throw error
    }
    if (this._destroyed) return false
    this._initialized = true

    // Request notification permission if schema opts in
    if (this.schema.notify && this.security.allowNotifications !== false
        && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    if (this.schema.autorun || this.schema.inputs.some(input => input.disabled && input.reactive)) {
      // 1. If autorun is enabled in the schema, run the model immediately
      // 2. Server-side inputs: If there are inputs with disabled and reactive flags
      // (we assume that they are set by the server and trigger the model run)
      this.log('[Init] First run of the model due to autorun or reactive inputs')
      // Catch here to prevent unhandled rejection from init-time run
      const initCaller = this.schema.autorun ? 'autorun' : 'reactive'
      this.run(initCaller).catch(err => this.log('Init run error:', err))
    }
  }

  async initSchema () {
    // Check if schema is a string (url to json)
    if (typeof this.schema === 'string') {
      // indexOf returns -1 (truthy) when not found, so use includes instead
      this.schemaUrl = this.schema.includes('.json') ? this.schema : this.schema + '.json'

      // Check if schema is present in the hidden DOM element
      const schema = utils.loadFromDOM(this.schemaUrl)
      if (schema) {
        // Schema block found in the hidden element, use its content
        this.schema = JSON.parse(schema)
        this.log(`Loaded schema from the hidden DOM element for ${this.schemaUrl}:`, this.schema)
      } else {
        // Fetch schema from the URL
        this.log('Fetching schema from:', this.schemaUrl)
        const response = await fetch(this.schemaUrl, { signal: this._initController.signal })
        const schema = await response.json()
        if (this._destroyed) return
        this.schema = schema
        this.log('Loaded schema from URL:', this.schema)
      }
    }

    // Check if schema is a function (model)
    if (typeof this.schema === 'function') {
      this.schema = {
        model: {
          code: this.schema,
        }
      }
    }

    // At this point schema should be an object
    if (!isObject(this.schema)) {
      this.toast('error', 'Schema is in a wrong format')
      throw new Error(`Schema is in a wrong format: ${this.schema}`)
    }

    // Model normalization owns its descriptor copy, independently of the caller and other instances.
    this.schema = cloneSchema(this.schema)
    validatePipeline(this.schema)
    this._namedPipeline = identified(this.schema)
    this._sourceSchema = cloneSchema(this.schema)
    decodeFileDefaults(this.schema.inputs)
    // Validate schema shape early so init stages fail fast on critical issues
    const schemaValidation = utils.validateSchema(this.schema)
    schemaValidation.warnings.forEach(warning => {
      this.log('[Schema validation warning]', warning)
    })
    if (schemaValidation.errors.length) {
      const firstError = schemaValidation.errors[0]
      this.toast('error', firstError)
      throw new Error(`Schema validation failed: ${schemaValidation.errors.join('; ')}`)
    }

    this.security = utils.normalizeSecurityOptions(this.schema.security)
  }

  async initModel (signal=this._initController.signal) {
    // Model is the main part of the schema that defines all computations
    // At the end it should be an array of objects that define a sequence of tasks
    this.model = []

    // Check if there's a render or view defined in the schema
    let view = this.schema.render || this.schema.view
    if (isObject(view)) {
      // If view is an object, convert it to an array
      view = [view] // Convert to array if it's an object
    }
    if (Array.isArray(view)) {
      view.forEach(v => {
        v.worker = false // Render should not be in a worker
      })
      this.log('View is defined in the schema')
    }

    // Check if model is a function (model)
    ;[this.schema.model, view].forEach(m => {
      // Function -> {code: Function}
      if (typeof m === 'function') {
        this.model.push({
          code: m
        })
      } else if (Array.isArray(m)) {
        // concatenate
        this.model = this.model.concat(m)
      } else if (isObject(m)) {
        this.model.push(m)
      }
    })

    // Check if model is empty — allow identity pipeline (no model)
    if (this.model.length === 0) {
      this.log('No model defined, using identity pipeline')
      return
    }

    // Put worker and imports inside model blocks
    ;['worker', 'imports'].forEach(key => {
      if (typeof this.schema[key] !== 'undefined') {
        this.model[0][key] = this.schema[key]
        delete this.schema[key]
      }
    })

    // Check if autorun is defined
    if (!this._namedPipeline && typeof this.model[0]['autorun'] !== 'undefined') {
      this.schema.autorun = this.model[0]['autorun']
      delete this.model[0]['autorun']
    }

    // Async for-loop over this.model
    for (const [i, m] of this.model.entries()) {
      if (typeof m.worker === 'undefined') {
        m.worker = m.type === 'module' ? false : i === 0 // Run first model in a web worker
      }

      // Load code if url is provided
      const isJsUrl = isJavascriptModelUrl(m.url)
      const isPyUrl = isPythonModelUrl(m.url)
      const shouldLoadSourceFromUrl = m.url && (isPyUrl || (isJsUrl && this.security.allowEval !== false && m.type !== 'module'))
      if (m.url && isJsUrl && this.security.allowEval === false && m.type !== 'module') {
        const cachedModelCode = utils.loadFromDOM(m.url)
        if (cachedModelCode) {
          utils.assertEvalAllowed(this.security, `model[${i}].url cached script`)
        }
      }
      if (shouldLoadSourceFromUrl) {
        // Try to get the code from a hidden DOM element first
        const modelCode = utils.loadFromDOM(m.url)
        if (modelCode) {
          // Code block found in the hidden element, use its content
          m.code = modelCode
          this.log(`Loaded code from the hidden DOM element for ${m.url}`)
        } else {
          // Update model URL if needed
          if (!m.url.includes('/') && this.schemaUrl && this.schemaUrl.includes('/')) {
            m.url = window.location.protocol + '//' + window.location.host + this.schemaUrl.split('/').slice(0, -1).join('/') + '/' + m.url
            this.log(`Changed the old model URL to ${m.url} (based on the schema URL)`)
          }
          this.log('Loaded code from:', m.url)
          utils.assertNetworkAllowed(m.url, this.security, `model[${i}].url`)
          const response = await fetch(m.url, { signal })
          const code = await response.text()
          if (this._destroyed) return
          m.code = code
        }
      }

      // Update model name if absent
      if (typeof m.name === 'undefined'){
        if ((m.url) && isJavascriptModelUrl(m.url)) {
          m.name = m.url.split('/').pop().split('.')[0]
          this.log('Use model name from url:', m.name)
        } else if (m.code) {
          m.name = getName(m.code)
          this.log('Use model name from code:', m.name)
        }
      }

      // Check if imports are string -> convert to array
      if (typeof m.imports === 'string') {
        m.imports = [m.imports]
      }

      // Infer model type
      if (typeof m.type === 'undefined') {
        m.type = getModelType(m)
      }

      if (m.type === 'module' && m.url) {
        m._moduleUrl = utils.getUrl(m.url)
      }
      if (m.worker && m.type !== 'module' && isJsUrl && m.url && !m.code) {
        m._workerUrl = utils.getUrl(m.url)
      }

      if (m.type === 'py') {
        const pyodideOptions = utils.normalizePyodideOptions(m, { resolveUrl: true })
        const pyodideCode = utils.loadFromDOM(pyodideOptions.rawUrl) || utils.loadFromDOM(pyodideOptions.url)
        const embeddedAssets = utils.loadPyodideEmbeddedAssets(pyodideOptions)
        m._pyodide = Object.assign({}, pyodideOptions)
        if (pyodideCode) m._pyodide.code = pyodideCode
        if (embeddedAssets) m._pyodide.embeddedAssets = embeddedAssets
      }

      // Load imports from hidden DOM element
      if (m.imports && Array.isArray(m.imports) && m.imports.length) {
        for (let [importIndex, imp] of m.imports.entries()) {
          if (typeof imp === 'string') {
            // Convert string to object
            m.imports[importIndex] = {
              url: imp
            }
            imp = m.imports[importIndex]
          }
          if (!m.type.includes('py')) {
            const rawImportUrl = imp.url
            imp._rawUrl = rawImportUrl
            imp.code = imp.code || utils.loadFromDOM(rawImportUrl)  // Try raw path first (matches --fetch data-src)
            imp.url = utils.getUrl(rawImportUrl)        // Resolve to absolute URL for network/worker
            if (!imp.code) {
              imp.code = utils.loadFromDOM(imp.url)     // Fallback: resolved URL (legacy compat)
            }
            if (!imp.code) {
              utils.assertNetworkAllowed(rawImportUrl, this.security, `model[${i}].imports[${importIndex}]`)
            }
          }
        }
      }
      if (m.sha256 && (!m.code || fingerprint(typeof m.code === 'function' ? String(m.code) : m.code) !== m.sha256)) throw new Error('Model SHA-256 mismatch: ' + (m.id || m.url))
      for (const imp of m.imports || []) {
        if (!imp.sha256) continue
        if (!imp.code) {
          utils.assertNetworkAllowed(imp.url, this.security, 'pinned import')
          const response = await fetch(imp.url, { signal })
          if (!response.ok) throw new Error('Failed to load pinned import: ' + imp.url)
          imp.code = await response.text()
        }
        if (fingerprint(imp.code) !== imp.sha256) throw new Error('Import SHA-256 mismatch: ' + imp.url)
      }
      // Inject CSS imports into <head> for worker models (workers have no DOM)
      if (m.imports && Array.isArray(m.imports) && m.imports.length && m.worker) {
        const cssImports = m.imports.filter(imp => utils.isCssImport(imp.url))
        for (const imp of cssImports) {
          if (!imp.code) {
            utils.assertNetworkAllowed(imp._rawUrl || imp.url, this.security, 'worker CSS import')
          }
          await utils.importScripts(imp)
          if (this._destroyed) return
        }
      }
    } // end of model-loop

    this.log('Models initialized:', this.model.length)
  }

  async initInputs () {
    // Check inputs
    // Relies on model.code
    // So run after possible fetching
    if (typeof this.schema.inputs === 'undefined') {
      if (this.model.length > 0) {
        this.model[0].container = 'args'
        const inferred = utils.inferInputsFromModel(this.model[0], {
          inferTypes: this.schema.inferInputTypes === true
        })
        this.log('Trying to infer inputs from params:', inferred.inputs.map(input => input.name))
        inferred.warnings.forEach(warning => {
          this.log('[Schema inference warning]', warning)
        })
        this.schema.inputs = inferred.inputs
      } else {
        this.schema.inputs = []
      }
    }

    // Read URL params, e.g. ?input1=1&input2=2
    const urlParams = new URLSearchParams(window.location.search)
    this.log('URL params:', urlParams)

    // Iterate over inputs and set values from URL
    this.schema.inputs.forEach(input => {
      // Set default input type
      if (typeof input.type === 'undefined') {
        input.type = 'string'
      }

      // Get input value from URL params
      const paramValue = utils.getUrlParam(urlParams, input)
      this.log(`Param value for ${input.name}:`, paramValue)

      if (paramValue === null) return
      if (input.type === 'file') {
        input.url = paramValue
        input.urlAutoLoad = true
        return
      }
      input.default = utils.coerceParam(paramValue, input.type, input.name)
    })
    this.log('Inputs are:', this.schema.inputs)
    applySecurityToInputs(this.schema.inputs, this.security)
    this.streamInputConfig = collectStreamInputConfig(this.schema.inputs)
  }

  initVue () {
    return new Promise((resolve, reject) => {
      try {
        this.log('Initializing VUE')
        this.app = createVueApp(this, (container) => {
          // Called when the app is mounted
          // FYI "this" here refers to port object
          this.outputsContainer = (this.regions.outputs || container).querySelector('#outputs')
          this.inputsContainer = (this.regions.inputs || container).querySelector('#inputs')
          this.modelContainer = container.querySelector('#model')
          // Init overlay
          this.overlay = new Overlay(this.inputsContainer ? this.inputsContainer : this.outputsContainer, this.overlayId)
          resolve()
        }, this.log)
        this.data = this.app.$data
      } catch (err) {
        reject(err)
      }
    })
  }

  async initPipeline (checkCancelled=() => {}) {
    const stages = []
    this.pipeline = inputs => {
      const runToken = this._runToken
      const check = () => {
        if (this._runToken !== runToken) throw new Error('Cancelled')
      }
      return this.executor.run(inputs, this._pipelineOptions, check)
    }
    // Async for-loop over this.model (again)
    for (const [i, m] of this.model.entries()) {
      checkCancelled()
      let modelFunc
      if (m.worker) {
        // Init worker model
        this.log(`[Init pipeline] Initializing model ${i} in a worker: ${m.name || m.url}`)
        modelFunc = await this.initWorker(m)
      } else {
        // Init specific model types
        this.log(`[Init pipeline] Initializing model ${i} in the main thread: ${m.name || m.url}`)
        switch (m.type) {
          case 'py':
            modelFunc = await this.initPython(m)
            break
          case 'function':
          case 'class':
          case 'module':
          case 'async-init':
          case 'async-function':
            modelFunc = await this.initJS(m)
            break
          case 'get':
          case 'post':
            this.log('Initializing API model')
            modelFunc = await this.initAPI(m)
            break
          default:
            this.toast('error', 'No type information')
            throw new Error(`No type information: ${m.type}`)
        }

        if (this._destroyed) return
        const streamInputConfig = collectStreamInputConfig(stageSchema(this.schema, m).inputs)
        const hasStreamInputs = Object.keys(streamInputConfig).length > 0
        if (hasStreamInputs) {
          const originalModelFunc = modelFunc
          modelFunc = (inputs) => {
            const context = this._createRunContext()
            const wrappedInputs = utils.wrapStreamInputs(inputs, streamInputConfig, {
              isCancelled: context.isCancelled,
              onProgress: context.progress
            })
            return originalModelFunc(wrappedInputs)
          }
        }
      }

      if (this._destroyed) return
      checkCancelled()
      stages.push(modelFunc)

      this.toast('success', 'Pipeline initialized')
      this.overlay.hide()
    }

    const previous = this.executor?.snapshot()
    this.executor = new Pipeline(this._namedPipeline ? this._sourceSchema : { ...this.schema, model: this.model }, stages.map((run, index) => async values => {
      const id = this.model[index].id
      this._stagePartials = this._stagePartials || {}
      this._stagePartials[id] = {}
      const model = this.model[index]
      const frames = this._pipelineOptions?._imageFrames ? imageFrames(values) : []
      if (frames.length && (model._jseeCanonical || !['function', 'class', 'module', 'async-init', 'async-function'].includes(model.type))) throw new Error('ImageBitmap requires a local browser JavaScript model; use an image file for Python or remote calls')
      const token = this._runToken
      const result = model.worker || !frames.length ? await run(values) : await withImageFrames(values, async borrowed => {
        if (token !== this._runToken || token?.cancelled || this._destroyed) throw new DOMException('Run cancelled', 'AbortError')
        const result = await run(borrowed)
        assertFrameResult(result)
        return result
      })
      return id && utils.isRecordObject(result) ? { ...this._stagePartials[id], ...result } : result
    }), { prepare: async (schema, values, id) => {
      const model = this.model.find(model => model.id === id)
      const live = stageSchema({ inputs: this.data.inputs }, model).inputs
      return utils.wrapTypedArrayInputs(await prepareStageInputs({ ...schema, inputs: live }, values), live)
    }, output: (id, result) => this._scopeOutput(id, result), changed: (id, state) => {
      if (!this._namedPipeline) return
      const group = this.data.outputs.find(output => output._stage === id)
      if (group) group.status = state.status
      this._emit('stage', { id, ...state })
    } })
    if (previous) this.executor.restore(previous)
    if (this.model.length === 0) {
      this.log('Identity pipeline ready (no model)')
      this.overlay.hide()
    }
  }

  async initWorker (model) {
    // Init worker
    const legacyPython = model.type === 'py' && !/\.mjs(?:[?#]|$)/.test(utils.normalizePyodideOptions(model).url)
    const classic = model.type === 'py' ? legacyPython
      : !['module', 'get', 'post'].includes(model.type) || model.type === 'module' && (model.imports || []).some(imp => !utils.isCssImport(imp.url))
    const cachedEntry = model.workerUrl && utils.loadFromDOM(model.workerUrl)
    const source = cachedEntry || (classic ? classicWorkerSource : workerSource)
    let ownedUrl
    let url = model.workerUrl
    if (url && !cachedEntry) {
      utils.assertNetworkAllowed(url, this.security, 'worker entry URL')
      url = utils.getUrl(url)
    } else if (location.protocol === 'file:') {
      // Chromium rejects Blob module entry points at file origins asynchronously.
      url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(source)
    } else {
      url = ownedUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    }
    let worker
    try { worker = new globalThis.Worker(url, { type: classic ? 'classic' : 'module' }) }
    catch (error) { if (ownedUrl) URL.revokeObjectURL(ownedUrl); throw error }
    // Worker termination owns its bootstrap URL, including initialization failures.
    const terminate = worker.terminate.bind(worker)
    worker.terminate = () => { terminate(); if (ownedUrl) { URL.revokeObjectURL(ownedUrl); ownedUrl = null } }
    this._workers.push(worker)

    // Init worker with the model
    if (typeof model.code === 'function') {
      this.log('Convert code in schema to string for WebWorker')
      model.code = model.code.toString()
    }

    // Wrap anonymous functions
    if (!model.name && model.type !== 'py' && model.type !== 'module') {
      model.code = `function anon () { return (${model.code})(...arguments) }`
      model.name = 'anon'
    }

    // Timeout prevents permanently frozen UI if worker hangs (default 30s, configurable via model.timeout)
    const timeoutMs = model.timeout || DEFAULT_WORKER_TIMEOUT
    let workerInitialized = false

    const modelFunc = (inputs) => {
      const isInitCall = utils.isWorkerInitMessage(inputs, workerInitialized)
      const usesFrames = !isInitCall && this._pipelineOptions?._imageFrames
      const requestId = `${this.uid}:worker:${++this._workerSequence}`
      const token = this._runToken
      const identity = { runId: token?.active ? token.id : null, stageId: model.id || null }
      const payload = isInitCall
        ? { ...inputs, _requestId: requestId }
        : { _jsee: 'run', requestId, value: utils.toWorkerSerializable(inputs) }

      const cancelWorker = () => worker.postMessage({ _jsee: 'cancel', requestId })
      this._cancelWorkerRun = cancelWorker
      let rejectWorkerRun = null
      let acceptingMessages = true
      const workerPromise = new Promise((resolve, reject) => {
        rejectWorkerRun = reject
        this._rejectWorkerRun = reject
        worker.onmessage = (e) => {
          const res = e.data
          const frames = usesFrames ? imageFrames(res) : []
          frames.forEach(frame => frame.close())
          if (!acceptingMessages) return
          if (res && (res._jsee || ['progress', 'log'].includes(res._status)) && res.requestId !== undefined && res.requestId !== requestId) return
          if (frames.length) { reject(new Error('ImageBitmap outputs are unsupported; return image files or pixel data')); return }
          if (token?.cancelled && (res?._partial || ['partial', 'progress', 'log'].includes(res?._jsee || res?._status))) return
          if (res && (res._jsee || res._status)) {
            // Raw _status/_partial messages remain the legacy model-posted callback API.
            switch (res._jsee || res._status) {
              case 'cancelled':
                reject(new DOMException('Run cancelled', 'AbortError'))
                break
              case 'result':
                this.progress(0, undefined, identity)
                resolve(res.value)
                break
              case 'partial':
                this._modelOutput(model, res.value, true)
                break
              case 'loaded':
                this.toast('success', 'Loaded model (in worker)')
                this.log('Loaded model (in worker):', res)
                this.progress(0, undefined, identity)
                workerInitialized = true
                resolve(res)
                break
              case 'log':
                this.log(...res._log)
                break
              case 'progress':
                this.progress(res._progress, res._progressDetails, identity)
                break
              case 'error':
                this.toast('error', res._error)
                this.log('Error from worker:', res._error)
                this.progress(0, undefined, identity)
                reject(res._error)
                break
              default:
                resolve(res)
                break
            }
          } else if (res && res._partial) {
            // Partial/streaming result: update outputs without resolving the promise
            this.log('Partial result from worker:', Object.keys(res))
            const partial = { ...res }
            delete partial._partial
            this._modelOutput(model, partial, true)
          } else {
            this.log('Response from worker:', res)
            this.progress(0, undefined, identity)
            resolve(res)
          }
        }
        worker.onerror = (e) => {
          if (!acceptingMessages) return
          this.toast('error', e.message)
          this.log('Error from worker:', e)
          this.progress(0, undefined, identity)
          reject(e)
        }
        const send = (message, transfer=[]) => {
          if (!acceptingMessages || token?.cancelled || this._destroyed) throw new DOMException('Run cancelled', 'AbortError')
          try {
            // Structured cloning preserves caller-owned buffers for later runs and pipeline stages.
            if (transfer.length) message._imageFrames = true
            worker.postMessage(message, transfer)
          } catch (error) {
            const hasBinaryPayload = utils.containsBinaryPayload(message)
            if (hasBinaryPayload) {
              const message = 'Worker postMessage failed for payload with File/Blob/binary data. JSON fallback would drop that data.'
              this.log(message, error)
              reject(new Error(message))
              return
            }
            this.log('Worker postMessage failed, retrying with JSON fallback. Complex objects may lose metadata.', error)
            try {
              const fallbackPayload = JSON.parse(JSON.stringify(message))
              worker.postMessage(fallbackPayload)
            } catch (fallbackError) {
              reject(fallbackError)
            }
          }
        }
        if (usesFrames) withImageFrames(payload, send).catch(reject)
        else send(payload)
      }).finally(() => {
        // A settled stage must not keep accepting presentation callbacks while idle.
        acceptingMessages = false
      })

      // Initialization may fetch large models, but must still have a finite deadline.
      const deadline = isInitCall ? (model.initTimeout || 120000) : timeoutMs

      let timeoutId = null
      let settled = false
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (settled) return
          settled = true
          // Pipeline closures retain every worker, so rebuilding requires disposing the whole set.
          this._terminateWorkers()
          this._needsModelReinit = true
          reject(new Error(`Worker ${isInitCall ? 'initialization ' : ''}timed out after ${deadline}ms`))
        }, deadline)
      })
      return Promise.race([workerPromise, timeoutPromise])
        .finally(() => {
          settled = true
          acceptingMessages = false
          if (timeoutId !== null) clearTimeout(timeoutId)
          if (this._cancelWorkerRun === cancelWorker) this._cancelWorkerRun = null
          if (this._rejectWorkerRun === rejectWorkerRun) {
            this._rejectWorkerRun = null
          }
        })
    }

    // Initial worker call with model definition and stream input config
    const modelInitPayload = Object.assign({}, model, {
      _streamInputConfig: collectStreamInputConfig(stageSchema(this.schema, model).inputs),
      _inputNames: Object.keys(collectInputValues(stageSchema(this.schema, model).inputs, () => null)),
      _security: this.security
    })
    try { await modelFunc(modelInitPayload) } catch (error) { this._terminateWorkers(); throw error }

    // Worker will be in the context of each modelFunc
    return modelFunc
  }

  async initPython (model) {
    // Add loading indicator
    this.overlay.show()
    utils.assertEvalAllowed(this.security, 'Pyodide model code')
    const pyodideOptions = utils.normalizePyodideOptions(model, { resolveUrl: true })
    const pyodideCode = pyodideOptions.code
      || utils.loadFromDOM(pyodideOptions.rawUrl)
      || utils.loadFromDOM(pyodideOptions.url)
    const runtimeOptions = pyodideCode
      ? Object.assign({}, pyodideOptions, { code: pyodideCode })
      : pyodideOptions
    if (runtimeOptions.code) {
      utils.assertEvalAllowed(this.security, 'cached Pyodide loader script')
    }
    const preparedRuntimeOptions = await utils.preparePyodideRuntimeOptions(runtimeOptions, window)
    if (this._destroyed) return
    utils.assertPyodideNetworkAllowed(preparedRuntimeOptions, this.security)
    const loadPyodide = await utils.loadPyodideRuntime(preparedRuntimeOptions, window)
    if (this._destroyed) return
    const pyodide = await loadPyodide(utils.getPyodideLoadOptions(preparedRuntimeOptions))
    if (this._destroyed) return
    if (model.imports && Array.isArray(model.imports) && model.imports.length) {
      if (this.security.allowNetwork === false && !preparedRuntimeOptions.embeddedAssets) {
        throw new Error('security.allowNetwork is false; blocked Pyodide package loading')
      }
      const packages = model.imports
        .map(i => typeof i === 'string' ? i : i.url)
        .filter(Boolean)
      await pyodide.loadPackage(packages)
    } else if (this.security.allowNetwork === false) {
      this.log('Skipping Pyodide loadPackagesFromImports because security.allowNetwork is false')
    } else {
      await pyodide.loadPackagesFromImports(model.code)
    }
    if (this._destroyed) return
    const entry = utils.getPyodideEntryName(model)
    const bindInputs = (data) => utils.bindPyodideInputs(pyodide, data, window, {
      warn: message => this.log('[Pyodide input warning]', message)
    })
    if (entry) {
      await pyodide.runPythonAsync(model.code)
      const callCode = utils.buildPyodideEntryCallCode(entry)
      return async (data) => {
        bindInputs(data)
        const result = await pyodide.runPythonAsync(callCode)
        return utils.pyodideResultToJs(result)
      }
    }
    return async (data) => {
      bindInputs(data)
      const result = await pyodide.runPythonAsync(model.code)
      return utils.pyodideResultToJs(result)
    }
  }

  async initJS (model) {
    // 1. String input <- loaded from url or code(string)
    // 2. Target object (can be function, class or a function with async init <- code(object)
    // 3. Model function

    // We always start from 1 or 2
    // For window execution we go: [1 ->] 2 -> 3
    // For worker: [2 ->] 1 -> Worker

    // Main: Initialize model in main window

    // Load imports if defined (before calling the model)
    if (model.imports && model.imports.length) {
      this.log('Loading imports from schema')
      utils.assertImportNetworkAllowed(model.imports, this.security, 'model.imports')
      model.imports.forEach((imp, index) => {
        if (imp && imp.code && !utils.isCssImport(imp.url)) {
          utils.assertEvalAllowed(this.security, `model.imports[${index}] inline script`)
        }
      })
      await utils.importScripts(...model.imports)
      if (this._destroyed) return
      this.toast('success', 'Loaded: JS imports')
    }

    // Target here represents raw JS object (e.g. class), not the final callable function
    let target
    if (model.type === 'module') {
      if (!model.url) {
        throw new Error('type: module requires model.url')
      }
      utils.assertNetworkAllowed(model.url, this.security, 'module model URL')
      const moduleUrl = model._moduleUrl || utils.getUrl(model.url)
      this.log('Loading module model from:', moduleUrl)
      const mod = await import(/* webpackIgnore: true */ moduleUrl)
      if (this._destroyed) return
      target = utils.getModuleModelTarget(mod, model)
    } else if (typeof model.code === 'string') {
      // 1 -> 2
      // Danger zone
      utils.assertEvalAllowed(this.security, 'JavaScript model.code')
      if (model.name) {
        this.log('Evaluating code from string (has name)')
        target = Function(
          `${model.code} ;return ${model.name}`
        )()
      } else {
        this.log('Evaluating code from string (no name)')
        target = eval(`(${model.code})`) // ( ͡° ͜ʖ ͡°) YEAHVAL
      }
    } else {
      target = model.code
    }

    if (typeof target === 'undefined' && model.url && model.type !== 'module') {
      utils.assertNetworkAllowed(model.url, this.security, 'JavaScript model URL')
      const scriptUrl = utils.getUrl(model.url)
      this.log('Loading script from URL:', scriptUrl)
      await utils.importScripts(scriptUrl)
      if (this._destroyed) return
      if (!model.name) {
        throw new Error('JavaScript URL model requires model.name when code is not fetched')
      }
      target = window[model.name]
    }

    const inputNames = Object.keys(collectInputValues(stageSchema(this.schema, model).inputs, () => null))
    const modelFunc = await utils.getModelFuncJS(model, target, this, inputNames, () => this._createRunContext(model.id))
    return modelFunc
  }

  initAPI (model) {
    this.log('Initializing API model:', model)
    this.overlay.hide()
    if (model.worker) {
      // Worker:
      this.worker.postMessage(model)
    } else {
      const request = utils.getModelFuncAPI(model, this.log, undefined, this.security, this.schema.outputs)
      return async data => {
        const runToken = this._runToken
        const controller = new AbortController()
        this._apiRequests.add(controller)
        try {
          return await request(data, {
            signal: controller.signal,
            onChunk: model.stream ? chunk => {
              if (this._runToken === runToken && !controller.signal.aborted) this.output(chunk, true)
            } : undefined
          })
        } finally {
          this._apiRequests.delete(controller)
        }
      }
    }
  }

  shouldUseInterval (caller) {
    if (!utils.getIntervalDelay(this.schema && this.schema.interval)) {
      return false
    }
    return caller === 'run' || caller === 'autorun' || caller === 'init'
  }

  async startInterval (caller='run') {
    if (this._intervalLoop && this._intervalPromise) {
      return this._intervalPromise
    }

    const intervalDelay = utils.getIntervalDelay(this.schema && this.schema.interval)
    if (!intervalDelay) {
      return this.runOnce(caller)
    }

    const intervalToken = {}
    this._intervalLoop = true
    this._intervalToken = intervalToken
    this.cancelled = false
    if (this.data) this.data.running = true

    const loopPromise = (async () => {
      let nextCaller = caller === 'init' ? 'autorun' : caller
      while (this._intervalLoop && this._intervalToken === intervalToken && !this.isCancelled()) {
        const runSucceeded = await this.runOnce(nextCaller)
        nextCaller = 'interval'
        if (!runSucceeded || !this._intervalLoop || this._intervalToken !== intervalToken || this.isCancelled()) {
          break
        }
        this.log('Interval is defined:', intervalDelay)
        if (this.data) this.data.running = true
        await utils.delay(intervalDelay)
      }
    })()

    const managedPromise = loopPromise.finally(() => {
      if (this._intervalPromise === managedPromise || this._intervalToken === intervalToken) {
        this._intervalLoop = false
        this._intervalToken = null
        this._intervalPromise = null
        if (!this.running && this.data) this.data.running = false
      }
    })
    this._intervalPromise = managedPromise
    return managedPromise
  }

  async run (caller='run') {
    // Once initialized, reserve the run synchronously so immediate Stop and queue
    // ordering retain their existing behavior. Only startup needs an extra await.
    const epoch = this._cancelEpoch
    if (!this._initialized) await this._initPromise
    if (this._destroyed || epoch !== this._cancelEpoch) return false
    const runCaller = caller || 'run'
    if (this.shouldUseInterval(runCaller)) {
      return this.startInterval(runCaller)
    }
    return this.runOnce(runCaller)
  }

  async runOnce (caller='run', returnResult=false) {
    if (this._destroyed) {
      if (returnResult) throw new Error('JSEE instance has been destroyed')
      return false
    }
    // caller can be:
    // 1. custom input button name
    // 2. `run`
    // 3. `autorun`
    // 4. `interval`

    // Prevent overlapping runs: automatic calls are dropped, manual clicks queue
    if (this.running || (this._invoking && !returnResult)) {
      if (returnResult) throw new Error('A run is already in progress')
      if (caller === 'autorun' || caller === 'reactive' || caller === 'interval') return false
      this.log('Run already in progress, queuing', caller)
      this._pendingRun = caller
      return false
    }

    // Programmatic, queued, and UI calls share the browser's control validation.
    if (!this._namedPipeline && !this._pipelineOptions?.transient && this.app && this.app.validateInputs()) {
      if (returnResult) throw new Error('Invalid inputs')
      return false
    }

    const schema = this.schema
    const data = this.data
    this.running = true
    this.cancelled = false
    let runSucceeded = false
    let runResult
    let runError
    let rejectCurrentRun = null
    // Run token to detect stale results when worker.onmessage gets rebound
    const runToken = this._runToken = { active: true, controller: new AbortController(), id: `${this.uid}:${++this._runSequence}` }
    runToken.done = new Promise(resolve => { runToken.settled = resolve })
    this._emit('start', this.getInputs())
    const checkCancelled = () => {
      if (this._destroyed || runToken.cancelled || this._runToken !== runToken) throw new Error('Cancelled')
    }

    try {
      // Rebuilding owns the run slot too; keep retry set until every stage is ready.
      if (this._needsModelReinit) {
        this._reinitController = new AbortController()
        try {
          await this.initModel(this._reinitController.signal)
          checkCancelled()
          await this.initPipeline(checkCancelled)
          checkCancelled()
          this._needsModelReinit = false
        } finally {
          this._reinitController = null
          if (this._needsModelReinit) this._terminateWorkers()
        }
      }
      this.log('Running the pipeline...')
      // Collect input values
      let inputValues = collectInputValues(data.inputs)
      if (!this._namedPipeline && this._pipelineOptions?.transient) inputValues = { ...inputValues, ...this._pipelineOptions.overrides }
      // Model-driven option updates are part of the live form contract.
      if (!this._namedPipeline) inputValues = prepareInputs(data.inputs, inputValues)
      inputValues = await utils.prepareBrowserFiles(schema.inputs, inputValues, this.model.some(model => model._jseeCanonical))
      checkCancelled()
      // For folder inputs with select mode, filter to selected files
      data.inputs.forEach(input => {
        if (input.type === 'folder' && input.select && Array.isArray(inputValues[input.name])) {
          const selected = inputValues[input.name].filter(f => f.selected)
          inputValues[input.name] = selected
        }
      })

      // Preserve legacy metadata injection without overwriting declared computation inputs.
      const declaredInputs = collectInputValues(schema.inputs, () => null)
      if (!hasOwn(declaredInputs, 'caller')) inputValues.caller = caller

      // Chat mode: inject history and capture user message
      const chatOutput = this.data.outputs
        ? this.data.outputs.find(o => o.type === 'chat')
        : null
      if (chatOutput) {
        delete chatOutput._streamedResponse
        if (!hasOwn(declaredInputs, 'history')) inputValues.history = chatOutput._messages || []
        this._lastChatMessage = inputValues.message || ''
      }

      // Convert declared arrayBuffer inputs to typed arrays for WASM efficiency
      inputValues = utils.wrapTypedArrayInputs(inputValues, schema.inputs)

      this.log('Input values:', inputValues)
      this.overlay.show()
      if (this.data) this.data.running = true

      // Run pipeline
      const cancelPromise = new Promise((_, reject) => {
        rejectCurrentRun = reject
        this._rejectRun = reject
      })
      const pipelinePromise = Promise.resolve().then(() => {
        checkCancelled()
        return this.pipeline(inputValues)
      })
      pipelinePromise.catch(err => {
        if (this.cancelled || this._runToken !== runToken) {
          this.log('Cancelled pipeline settled:', err)
        }
      })
      const results = await Promise.race([pipelinePromise, cancelPromise])

      // Drop stale results if a newer run started (e.g. worker.onmessage rebound race)
      checkCancelled()

      // Output results
      this.output(results, this._namedPipeline)
      const outputs = utils.flattenJseeOutputs(schema.outputs)
      runResult = outputs.length ? {} : cloneSchema(results)
      for (const field of outputs) {
        const resolved = isObject(results) ? resolveOutputResult(results, field) : { found: outputs.length === 1, value: results }
        if (resolved.found) Object.defineProperty(runResult, field.name, { value: cloneSchema(resolved.value), enumerable: true })
      }
      this._emit('result', runResult)

      // Chat mode: clear the text input for next message
      if (chatOutput && this._lastChatMessage) {
        data.inputs.forEach(input => {
          if (input.name === 'message' || input.type === 'text') {
            input.value = ''
          }
        })
        this._lastChatMessage = null
      }

      runSucceeded = true
    } catch (err) {
      // Silently ignore cancellation errors from cancelCurrentRun()
      if (runToken.cancelled || this._runToken !== runToken) {
        runError = new DOMException('Run cancelled', 'AbortError')
        this._emit('cancel', runError)
        this.log('Run cancelled by user')
      } else {
        // Surface pipeline/worker errors so they don't silently swallow failures
        runError = err instanceof Error ? err : new Error(String(err))
        this._emit('error', runError)
        this.log('Pipeline error:', err)
        this.toast('error', typeof err === 'string' ? err : (err.message || 'Pipeline error'))
      }
    } finally {
      runToken.active = false
      runToken.settled()
      if (this._rejectRun === rejectCurrentRun) {
        this._rejectRun = null
      }
      // Always clean up UI state so overlay and running flag don't get stuck
      this.overlay.hide()
      this.running = false
      this._pipelineOptions = undefined
      if (this.data) this.data.running = this._intervalLoop === true

      // Notify user when tab is hidden and run succeeded
      if (runSucceeded && schema.notify && this.security.allowNotifications !== false && document.hidden
          && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const title = this.model[0] && (this.model[0].title || this.model[0].name) || 'JSEE'
        new Notification('Run complete', { body: title })
      }

      // Drain queued run if a manual click arrived while we were running
      if (this._pendingRun && !this._invoking) {
        const pending = this._pendingRun
        this._pendingRun = null
        this.run(pending).catch(err => this.log('Queued run error:', err))
      }
    }
    if (returnResult) {
      if (runError) throw runError
      return runResult
    }
    return runSucceeded
  }

  async outputAsync (res) {
    this.output(res)
    await utils.delay(1)
  }

  _mapResultsToOutputs (outputs, res) {
    outputs.forEach(output => {
      if (output.type === 'group' && output.elements) {
        this._mapResultsToOutputs(output.elements, res)
      } else {
        const resolved = resolveOutputResult(res, output)
        if (resolved.found) {
          const r = resolved.value
          this.log(`Updating output: ${output.name} with data: ${typeof r}`)
          if (output.type === 'file') {
            const fileValue = utils.normalizeFileOutputValue(output, r)
            if (typeof fileValue.filename === 'string') output.filename = fileValue.filename
            if (typeof fileValue.mime === 'string') output.mime = fileValue.mime
            output.value = fileValue.value
            return
          }
          if (output._objectUrl) { URL.revokeObjectURL(output._objectUrl); output._objectUrl = null }
          if (['image', 'audio', 'video'].includes(output.type)) {
            const media = utils.normalizeFileOutputValue(output, r)
            if (utils.isBinaryLike(media.value) || typeof Blob !== 'undefined' && media.value instanceof Blob) {
              const mime = media.mime || media.value.type || ''
              if (!require('./schema').matchesFileAccept(output.type + '/*', '', mime)) throw new Error('Media bytes require a matching declared MIME type')
              output._objectUrl = URL.createObjectURL(new Blob([media.value], { type: mime }))
              output.value = output._objectUrl
              return
            }
          }
          // Convert large base64 image data URLs to blob URLs for efficiency
          if (output.type === 'image' && typeof r === 'string'
              && r.startsWith('data:') && r.length > 50000) {
            try {
              const [header, b64] = r.split(',')
              const mime = header.match(/data:([^;]+)/)[1]
              const binary = atob(b64)
              const bytes = new Uint8Array(binary.length)
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
              const blob = new Blob([bytes], { type: mime })
              output._objectUrl = URL.createObjectURL(blob)
              output.value = output._objectUrl
            } catch (e) {
              output.value = r
            }
          } else {
            output.value = r
          }
        }
      }
    })
  }

  output (res, partial=false) {
    if (this._destroyed) return
    const declared = utils.flattenJseeOutputs(this.schema.outputs)
    for (const field of declared) {
      if (field.valueSchema === undefined) continue
      const resolved = isObject(res) ? resolveOutputResult(res, field) : { found: declared.length === 1, value: res }
      if (!resolved.found) {
        if (partial) continue
        throw new Error(field.name + ': missing declared output')
      }
      assertShapedValue(field, resolved.value)
    }
    // A single shaped JSON array is one value, even when it happens to contain one item.
    if (declared.length === 1 && declared[0].valueSchema !== undefined && !isObject(res)) {
      this._mapResultsToOutputs(this.data.outputs, { [declared[0].name]: res })
      return
    }
    // Edge case: no output field with reactivity is handled — undefined results exit early

    if (typeof res === 'undefined') {
      return
    }

    this.log('[Output] Got output results of type:', typeof res)

    // Normalize primitive results to {result: value} for consistent rendering
    // regardless of execution mode (browser worker vs server POST)
    if ((typeof res !== 'object' || res === null) && !Array.isArray(res)) {
      if (!(this.schema.outputs && this.schema.outputs.length)) {
        res = { result: res }
      }
    }

    const inputNames = this.schema.inputs ? this.schema.inputs.map(i => i.name) : []
    const outputNames = collectOutputNames(this.data.outputs || this.schema.outputs || [])
    this.log('Input names:', inputNames)

    if (isObject(res)) {
      // UI routing consumes fields; keep the computation's result intact for later stages.
      res = cleanOutputMetadata(res, this.data.outputs || this.schema.outputs)
      const resultKeys = Object.keys(res)
      this.log('Processing results as an object:', res)

      // Chat mode: accumulate messages instead of replacing output
      if (this.data.outputs) {
        this.data.outputs.forEach(output => {
          if (output.type !== 'chat' || typeof res[output.name] === 'undefined') return
          if (!output._messages) output._messages = []
          const previous = output._streamedResponse
          if (this._lastChatMessage && !previous) {
            output._messages.push({ role: 'user', content: this._lastChatMessage })
          }
          const response = res[output.name]
          let message
          if (typeof response === 'string') {
            message = { role: 'assistant', content: response }
          } else if (isObject(response) && response.content) {
            message = { role: response.role || 'assistant', content: response.content }
          }
          // Completion repeats the last stream value; append each delivered chunk once.
          if (message && (partial || !previous || previous.role !== message.role || previous.content !== message.content)) {
            output._messages.push(message)
          }
          if (partial) output._streamedResponse = message
          else delete output._streamedResponse
          delete res[output.name]
        })
      }

      if (this.model.length === 0) {
        // Identity mode: all keys become outputs, auto-detect types
        this.log('Identity mode: creating outputs from all result keys')
        this.data.outputs = Object.keys(res)
          .map(key => ({
            name: key,
            type: utils.inferOutputType(key, res[key]),
            value: res[key]
          }))
      } else if (this.data.outputs && this.data.outputs.length
          && resultKeys.some(key => outputNames.has(key))) {
        // Declared outputs win over input updates when names overlap.
        this.log('Updating outputs from matching result keys:', Object.keys(res))
        this._mapResultsToOutputs(this.data.outputs, res)
      } else if (!this._pipelineOptions?.transient && resultKeys.length > 0 && resultKeys.every(key => inputNames.includes(key))) {
        // Update input fields from results
        // e.g. loading a csv file and updating list of target variables
        // This will be dynamically updated in the UI
        this.log('Updating inputs from results with keys:', Object.keys(res))
        this.data.inputs.forEach((input, i) => {
          if (input.name && (typeof res[input.name] !== 'undefined')) {
            this.log(`Updating input: ${input.name} with data: ${res[input.name]}`)
            const r = res[input.name]
            if (r && typeof r === 'object') {
              Object.keys(r).forEach(k => {
                input[k] = r[k]
              })
            } else {
              input.value = r
            }
          }
        })
      } else if (this.data.outputs && this.data.outputs.length) {
        // Update outputs from results
        this.log('Updating outputs from results with keys:', Object.keys(res))
        this._mapResultsToOutputs(this.data.outputs, res)
      } else if (!this.schema.render && !this.schema.view) {
        // There's no render or view defined in the schema, also:
        // No outputs defined, create outputs from results
        this.log('Creating outputs from results with keys:', Object.keys(res))
        this.data.outputs = Object.keys(res)
          .filter(key => !inputNames.includes(key))
          .map(key => {
            return {
              'name': key,
              'type': utils.inferOutputType(key, res[key]),
              'value': res[key]
            }
          })
      }
    } else if (Array.isArray(res) && res.length) {
      // Result is array
      if (this.data.outputs && this.data.outputs.length) {
        // We have outputs defined
        if (this.data.outputs.length === res.length) {
          // Same length
          this.data.outputs.forEach((output, i) => {
            output.value = res[i]
          })
        } else {
          // Different length
          this.data.outputs[0].value = res
        }
      } else {
        // Outputs are not defined
        this.data.outputs = [{
          'type': 'array',
          'value': res
        }]
      }
    } else if (this.schema.outputs && this.schema.outputs.length === 1) {
      // One output value passed as raw js object
      this.data.outputs[0].value = res
    } else {
      this.data.outputs = [{
        'type': typeof res,
        'value': res
      }]
    }
  }

  _modelOutput (model, result, partial) {
    return model.id ? this._scopeOutput(model.id, result, partial) : this.output(result, partial)
  }

  _scopeOutput (id, result, partial=true) {
    if (!result || typeof result !== 'object') return
    const stage = this.model.find(model => model.id === id)
    const live = stageSchema({ inputs: this.data.inputs }, stage).inputs
    const outputNames = new Set(Object.keys(result).filter(name => !live.some(input => input.name === name)))
    // Grouped parameters retain their schema/identity; updates only reach
    // declared descendants within this stage's input scope.
    const update = (fields, values) => {
      for (const input of fields) {
        const value = input.name ? hasOwn(values, input.name) && values[input.name] : values
        if (!isObject(value)) continue
        if (input.type === 'group') update(input.elements || [], value)
        else if (hasOwn(value, 'options') || hasOwn(value, 'value')) Object.assign(input, value)
      }
    }
    update(live, result)
    if (this.executor?.busy && this._stagePartials?.[id]) {
      for (const name of outputNames) if (hasOwn(result, name) && typeof result[name] !== 'function') this._stagePartials[id][name] = result[name]
    }
    this.output(projectResults(this.schema, { [id]: result }), partial)
  }

  // Hosts own children mounted here and must unmount them before destroy().
  // The target is presentation only; values still enter through setInputs().
  getInputGroupContainer (name) {
    this._assertReady()
    const root = this.regions.inputGroups || this.regions.inputs || this.container
    const element = typeof root === 'string' ? document.querySelector(root) : root
    return [...element.querySelectorAll('[data-jsee-group-editor]')].find(target => target.getAttribute('data-jsee-group-editor') === name) || null
  }

  selectInputGroup (name) {
    this._assertReady()
    const groups = []
    const visit = (inputs, ancestors=[]) => {
      for (const input of inputs || []) if (input.type === 'group') {
        groups.push({ input, ancestors })
        visit(input.elements, [...ancestors, input])
      }
    }
    visit(this.data.inputs)
    const selected = groups.find(group => group.input.name === name)
    if (name !== null && !selected) throw new Error('Unknown input group: ' + name)
    this.data.selectedInputGroup = selected?.ancestors[0]?.name || name
    if (!this.regions.inputGroups && selected) {
      const visible = new Set([...selected.ancestors, selected.input,
        ...groups.filter(group => group.ancestors.includes(selected.input)).map(group => group.input)])
      for (const { input } of groups) if (['accordion', 'section'].includes(input.style) || input.collapsed !== undefined) {
        input.collapsed = !visible.has(input)
      }
    }
  }

  getStageInputs (id) {
    this._assertReady()
    if (!this.executor.nodes.has(id)) throw new Error('Unknown stage: ' + id)
    return cloneSchema(this.executor.values(id, this.getInputs()))
  }

  getStages () {
    this._assertReady()
    if (!this._namedPipeline) return {}
    if (!this.executor.busy) this.executor.refresh(this.getInputs())
    return Object.fromEntries([...this.executor.states].map(([id]) => {
      const state = this.executor.describe(id)
      const group = this.data.outputs.find(output => output._stage === id)
      if (group) group.status = state.status
      return [id, state]
    }))
  }

  planPipeline (target) {
    this._assertReady()
    if (!this.executor) throw new Error('Pipeline is not ready')
    return this.executor.plan(this.getInputs(), target)
  }

  getPipelineState () {
    this._assertReady()
    if (!this.executor) throw new Error('Pipeline is not ready')
    this.executor.refresh(this.getInputs())
    return this.executor.snapshot()
  }

  async restorePipelineState (state) {
    await this.ready
    if (!this.executor) throw new Error('Pipeline is not ready')
    this.executor.restore(state)
    await this.executor.reconcile(this.getInputs())
    for (const [id, saved] of this.executor.states) {
      if (saved.result) { this._scopeOutput(id, saved.result) }
    }
    await this.executor.run(this.getInputs(), { renderOnly: true })
  }

  getSchema () {
    this._assertReady()
    const schema = cloneSchema(this._namedPipeline ? this._sourceSchema : this.schema)
    const capture = inputs => inputs.map(input => {
      const { value, ...field } = cloneSchema(input)
      if (field.type === 'group') field.elements = capture(field.elements || [])
      else if (value !== undefined) field.default = value
      return field
    })
    schema.inputs = capture(this.data.inputs)
    return schema
  }

  async exportSchema () {
    await this.ready
    if (this.running || this._invoking) throw new Error('Stop execution before exporting')
    const schema = this.getSchema()
    const targets = Array.isArray(schema.model) ? schema.model : [schema.model]
    for (const [index, target] of targets.entries()) {
      const loaded = this.model[index]
      if (target.url) {
        target.url = new URL(loaded.url, window.location.href).href
        if (loaded.code) target.sha256 = fingerprint(typeof loaded.code === 'function' ? String(loaded.code) : loaded.code)
        delete target.code
      }
      if (loaded.imports) target.imports = loaded.imports.map(imp => ({ url: new URL(imp.url, window.location.href).href,
        ...(imp.code ? { code: imp.code } : {}), ...(imp.sha256 ? { sha256: imp.sha256 } : {}) }))
    }
    return portableValue(schema)
  }

  async exportHTML ({ runtime, title='JSEE application' }={}) {
    if (!runtime) throw new Error('Provide the pinned JSEE runtime URL for export')
    const schema = await this.exportSchema()
    const assets = new Map()
    const store = (code, css=false) => {
      const sha256 = fingerprint(code), url = 'jsee-asset-' + sha256 + (css ? '.css' : '.js')
      assets.set(url, code)
      return { url, sha256 }
    }
    const targets = Array.isArray(schema.model) ? schema.model : [schema.model]
    for (const [index, target] of targets.entries()) {
      const loaded = this.model[index]
      if (loaded.type === 'module' || loaded.type === 'py') throw new Error('HTML export currently requires JavaScript function models')
      if (!loaded.code) throw new Error('Model code is unavailable for export')
      Object.assign(target, store(typeof loaded.code === 'function' ? String(loaded.code) : loaded.code))
      delete target.code
      if (loaded.imports) target.imports = await Promise.all(loaded.imports.map(async imp => {
        let code = imp.code || utils.loadFromDOM(imp._rawUrl || imp.url)
        if (!code) {
          utils.assertNetworkAllowed(imp.url, this.security, 'export import')
          const response = await fetch(imp.url)
          if (!response.ok) throw new Error('Failed to export import: ' + imp.url)
          code = await response.text()
        }
        return store(code, utils.isCssImport(imp.url))
      }))
    }
    const response = await fetch(runtime)
    if (!response.ok) throw new Error('Failed to load the pinned runtime: ' + response.status)
    const code = (await response.text()).replace(/<\/script/gi, '<\\/script')
    const json = JSON.stringify(schema).replace(/</g, '\\u003c')
    const escapedTitle = title.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
    // Reuse the existing offline DOM cache. Identical model/import bytes are
    // stored once, even when several stage instances use the same package.
    const hidden = (await Promise.all([...assets].map(async ([url, text]) => {
      const encoded = await portableValue(new Blob([text]))
      return `<script type="application/json" data-src="${url}" data-encoding="base64">${encoded.content}</script>`
    }))).join('')
    return new Blob([`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title></head><body><div hidden>${hidden}</div><div id="app"></div><script>${code}</script><script>window.env=new JSEE({container:'#app',schema:${json},toasts:false})</script></body></html>`], { type: 'text/html' })
  }

  async download (title='output') {
    if (this._namedPipeline) {
      const blob = await this.exportHTML({ runtime: this.runtimeURL, title })
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = title + '.html'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    for (const model of this.model) {
      if (model.type === 'py' && !utils.loadPyodideEmbeddedAssets(utils.normalizePyodideOptions(model))) {
        throw new Error('Python download requires embedded runtime assets; generate the app with --bundle=pyodide-single first')
      }
    }
    // Cache the model
    const clone = document.cloneNode(true)

    const downloadBtn = clone.getElementById('download-btn')
      || clone.getElementById('download-html-btn')
      || clone.getElementById('save-html-btn')
    if (downloadBtn) {
      downloadBtn.textContent = 'Offline: latest'
      downloadBtn.disabled = true
      downloadBtn.style.cursor = 'not-allowed'
    }

    let hiddenElement = clone.getElementById('hidden-storage')
    if (!hiddenElement) {
      hiddenElement = clone.createElement('div')
      hiddenElement.style.display = 'none' // Make it hidden
      hiddenElement.id = 'hidden-storage' // Assign an ID
      clone.body.prepend(hiddenElement)
    }

    function encodeHiddenValue (value) {
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
      const bytes = new TextEncoder().encode(text)
      let binary = ''
      bytes.forEach(byte => { binary += String.fromCharCode(byte) })
      return btoa(binary)
    }

    function storeInHiddenElement (url, value) {
      const element = clone.createElement('script')
      element.type = 'application/json' // Make it non-executable
      element.style.display = 'none' // Make it hidden
      element.setAttribute('data-src', url) // Use data attribute for key
      element.setAttribute('data-encoding', 'base64')
      element.textContent = encodeHiddenValue(value)
      hiddenElement.appendChild(element)
    }

    // Remove Google Analytics script tags
    try {
      clone.getElementById('ga-src').remove()
      clone.getElementById('ga-body').remove()
    } catch (error) {
      console.error('Error removing GA script tags:', error.message)
    }

    // Remove serve bar (bundled HTML is standalone, no server)
    try { clone.getElementById('jsee-serve-bar')?.remove() } catch (e) {}

    storeInHiddenElement(this.schemaUrl, this.schema)

    for (const model of this.model) {
      storeInHiddenElement(model.url, model.code)
      if (model.workerUrl && !utils.loadFromDOM(model.workerUrl)) {
        const response = await fetch(utils.getUrl(model.workerUrl))
        if (!response.ok) throw new Error('Failed to download worker entry: ' + model.workerUrl)
        storeInHiddenElement(model.workerUrl, await response.text())
      }
      // Iterate over imports
      if (model.imports && model.type !== 'py') {
        for (let imp of model.imports) {
          // Store the import
          let content = imp.code || utils.loadFromDOM(imp._rawUrl || imp.url)
          if (!content) {
            const response = await fetch(imp.url)
            if (!response.ok) throw new Error('Failed to download import: ' + imp.url)
            content = await response.text()
          }
          storeInHiddenElement(imp.url, content)
          // Remove any src-based script tags with the same URL
          const script = clone.querySelector('script[src="' + imp.url + '"]')
          if (script) {
            script.remove()
          }
        }
      }
    }

    // append dummy src script for webpack fix
    // const dummyScript = document.createElement('script')
    // dummyScript.src = 'https://example.com/dummy.js'
    // clone.body.appendChild(dummyScript)

    // Find all external script tags and replace them with inline script tags
    const externalScripts = Array.from(clone.querySelectorAll('script[src]'))
    for (const script of externalScripts) {
      try {
        const response = await fetch(script.src)
        if (!response.ok) throw new Error('Network response was not ok for script:' + script.src)
        const content = await response.text()
        const inlineScript = document.createElement('script')
        inlineScript.textContent = content.replace(/<\/script/gi, '<\\/script')
        inlineScript.setAttribute('data-src', script.src)
        script.parentNode.replaceChild(inlineScript, script)
      } catch (error) {
        console.error('Error fetching script:', error.message)
      }
    }
    // Prepare the HTML for download and trigger the download
    const html = '<!DOCTYPE html>\n' + clone.documentElement.outerHTML
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = title + '.html'
    a.click()
    URL.revokeObjectURL(url)
  }
}
