const { matchesFileAccept } = require('./schema')
const { isImageBitmap } = require('./image-frame')

// Acquisition owns DOM listeners and camera tracks, not model execution. Awaiting
// onFrame is the backpressure boundary: capture nothing while a consumer is busy.
class ImageInput {
  constructor ({ input, target, picker, video, onImage, onFrame, onState=() => {}, onError=() => {}, onDispose=() => {} }) {
    if (!input || input.type !== 'image') throw new TypeError('Image acquisition requires an image input')
    if (!target || typeof target.addEventListener !== 'function') throw new TypeError('Image input requires a target element')
    this.input = input
    this.video = video
    this.onImage = onImage
    this.onFrame = onFrame
    this.onState = onState
    this.onError = onError
    this.onDispose = onDispose
    this.active = false
    this.pending = false
    this.live = false
    this.disposed = false
    this.epoch = 0
    this.listeners = []
    const listen = (element, event, callback) => {
      element.addEventListener(event, callback)
      this.listeners.push(() => element.removeEventListener(event, callback))
    }
    const accept = files => this.select(files).catch(error => this.fail(error))
    // A nested app owns accepted media events; its host must not ingest them too.
    if (picker) listen(picker, 'change', () => { accept(picker.files); picker.value = '' })
    listen(target, 'paste', event => {
      if (event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
      const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'))
      if (!this.locked && files.length) { event.preventDefault(); event.stopPropagation(); accept(files) }
    })
    listen(target, 'dragover', event => { if (!this.locked && [...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault() })
    listen(target, 'drop', event => {
      if (!this.locked && event.dataTransfer?.files.length) { event.preventDefault(); event.stopPropagation(); accept(event.dataTransfer.files) }
    })
    listen(document, 'visibilitychange', () => { if (document.hidden) this.stop().catch(error => this.fail(error)) })
  }

  get locked () { return this.disposed || this.input.disabled || this.input.readonly }
  state () { if (!this.disposed) this.onState({ active: this.active, pending: this.pending, live: this.live }) }
  fail (error) { if (!this.disposed && error.name !== 'AbortError') this.onError(error) }

  async select (files) {
    if (this.locked || !files?.length) return
    const file = files[0]
    if (files.length !== 1 || !matchesFileAccept('image/*', file.name, file.type) || !matchesFileAccept(this.input.accept, file.name, file.type)) {
      throw new Error('Choose one image matching ' + (this.input.accept || 'image/*'))
    }
    const stopped = this.stop()
    const epoch = this.epoch
    await stopped
    if (!this.locked && this.epoch === epoch) await this.onImage?.(file)
  }

  async start ({ live=false }={}) {
    if (this.locked) return
    const config = this.input.capture || {}
    if (!config.camera || live && !config.live) throw new Error('Camera mode is not enabled by this image input')
    if (!this.video) throw new Error('Camera capture requires a video element')
    if (live && !this.onFrame) throw new Error('Live capture requires a frame consumer')
    if (config.transport !== undefined && !['file', 'bitmap'].includes(config.transport)) throw new Error('capture.transport must be file or bitmap')
    if (live && config.transport === 'bitmap' && typeof createImageBitmap !== 'function') throw new Error('Bitmap capture requires createImageBitmap')
    const fps = config.maxFps ?? 5
    if (!Number.isFinite(fps) || fps <= 0 || fps > 60) throw new Error('capture.maxFps must be between 0 and 60')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera capture requires mediaDevices.getUserMedia on a secure origin')
    const stopped = this.stop()
    const epoch = this.epoch
    await stopped
    if (this.locked || this.epoch !== epoch) return
    this.pending = true; this.state()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: config.facingMode || 'environment' }, audio: false })
      if (this.locked || this.epoch !== epoch) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream
      for (const track of stream.getTracks()) track.addEventListener?.('ended', () => {
        if (this.stream === stream) this.stop().catch(error => this.fail(error))
      }, { once: true })
      this.video.srcObject = stream
      await this.video.play()
      if (this.epoch !== epoch) return
      if (this.locked) { this.release(); return }
      this.pending = false; this.active = true; this.live = live; this.state()
      if (live) {
        this.loop = this.pump(epoch, 1000 / fps).catch(async error => {
          // Do not await this.loop from its own failure cleanup.
          if (this.epoch === epoch) { this.release(); this.fail(error) }
        })
      }
    } catch (error) {
      if (this.epoch === epoch) { this.release(); throw error }
    }
  }

  async capture (live=false) {
    if (!this.video?.videoWidth || !this.video.videoHeight) return null
    if (live && this.input.capture?.transport === 'bitmap') return createImageBitmap(this.video)
    const format = [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp']]
      .find(([mime, ext]) => matchesFileAccept(this.input.accept, 'camera.' + ext, mime))
    if (!format) throw new Error('Camera snapshots require PNG, JPEG or WebP in accept')
    const canvas = document.createElement('canvas')
    canvas.width = this.video.videoWidth; canvas.height = this.video.videoHeight
    canvas.getContext('2d').drawImage(this.video, 0, 0)
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Camera snapshot failed')), format[0]))
    if (blob.type !== format[0]) throw new Error('Camera snapshot format is unsupported: ' + format[0])
    return new File([blob], 'Camera snapshot.' + format[1], { type: blob.type })
  }

  async pump (epoch, interval) {
    while (!this.locked && this.epoch === epoch) {
      const started = performance.now()
      const frame = await this.capture(true)
      try {
        if (this.locked || this.epoch !== epoch) break
        if (frame) await this.onFrame(frame)
      } finally { if (isImageBitmap(frame)) frame.close() }
      if (this.locked || this.epoch !== epoch) break
      await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, Math.max(0, interval - (performance.now() - started))) })
      this.wake = null
    }
    if (this.epoch === epoch) this.release()
  }

  release () {
    this.epoch++
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    if (this.video) this.video.srcObject = null
    clearTimeout(this.timer); this.wake?.(); this.wake = null
    this.active = this.pending = this.live = false
    this.state()
  }

  async stop ({ snapshot=false }={}) {
    const epoch = this.epoch, loop = this.loop
    // Capture starts before tracks stop; selection is published only after the
    // last consumer settles. A dispose or source change invalidates this frame.
    const frame = snapshot && this.active ? this.capture() : null
    this.release()
    const stoppedEpoch = this.epoch
    const file = await frame
    if (loop) await loop
    if (this.loop === loop) this.loop = null
    if (file && !this.locked && this.epoch === stoppedEpoch && stoppedEpoch === epoch + 1) await this.onImage?.(file)
    return file
  }

  dispose () {
    if (this.disposed) return
    this.disposed = true
    this.release()
    this.listeners.splice(0).forEach(remove => remove())
    this.onDispose()
  }
}
module.exports = ImageInput
