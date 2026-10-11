function positive (value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(name + ' must be positive and finite')
}
function finite (value, name) {
  if (!Number.isFinite(value)) throw new Error(name + ' must be finite')
}

// Coordinates are oriented source pixels and CSS pixels. DPR only affects paint.
function imageTransform ({ width, height, viewWidth, viewHeight, fit='contain', zoom=1, panX=0, panY=0, mirror=false }) {
  for (const [name, value] of Object.entries({ width, height, viewWidth, viewHeight, zoom })) positive(value, name)
  finite(panX, 'panX'); finite(panY, 'panY')
  if (!['contain', 'cover', 'fill'].includes(fit)) throw new Error('fit must be contain, cover or fill')
  const scale = (fit === 'cover' ? Math.max : Math.min)(viewWidth / width, viewHeight / height)
  const sx = (fit === 'fill' ? viewWidth / width : scale) * zoom
  const sy = (fit === 'fill' ? viewHeight / height : scale) * zoom
  const left = (viewWidth - width * sx) / 2 + panX, top = (viewHeight - height * sy) / 2 + panY
  return {
    sx: mirror ? -sx : sx, sy, left: mirror ? left + width * sx : left, top,
    toView: ({ x, y }) => ({ x: left + (mirror ? width - x : x) * sx, y: top + y * sy }),
    toSource: ({ x, y }) => {
      const px = (x - left) / sx, py = (y - top) / sy, sourceX = mirror ? width - px : px
      return { x: sourceX, y: py, inside: sourceX >= 0 && sourceX <= width && py >= 0 && py <= height }
    }
  }
}

function dimensions (source) {
  if (source && 'videoWidth' in source) return { width: source.videoWidth, height: source.videoHeight }
  if (source && 'naturalWidth' in source) return { width: source.naturalWidth, height: source.naturalHeight }
  return { width: source?.width || 0, height: source?.height || 0 }
}
function rectangle (rect) {
  if (!rect) throw new Error('Mask requires an explicit extent in source pixels')
  finite(rect.x, 'x'); finite(rect.y, 'y'); positive(rect.width, 'width'); positive(rect.height, 'height')
}
function opacity (value=1) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('opacity must be between 0 and 1')
  return value
}

function imageView (container, initial, { canvas: supplied, overlay=false, onSelect, onError }={}) {
  const canvas = supplied || document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('Image view requires a 2D canvas')
  if (!supplied) container.append(canvas)
  const oldStyle = canvas.getAttribute('style'), oldLabel = canvas.getAttribute('aria-label'), oldPosition = container.style.position
  if (overlay) {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: onSelect ? 'auto' : 'none' })
  } else Object.assign(canvas.style, { width: '100%', height: '100%' })
  canvas.setAttribute('aria-label', 'Image with annotations')
  let disposed = false, revision = -1, epoch = 0, source, drawable, owned, cleanupLoad = () => {}, masks = []
  let data = {}, viewport = { zoom: 1, panX: 0, panY: 0 }, selection = null, ready = Promise.resolve(true)
  let transform, origin = { x: 0, y: 0 }, mediaBox
  const release = () => { cleanupLoad(); cleanupLoad = () => {}; owned?.close?.(); owned = null }
  const notifyError = error => { if (!disposed) onError?.(error) }
  function geometry () {
    if (!drawable) return null
    const size = dimensions(drawable), rect = canvas.getBoundingClientRect()
    if (!size.width || !size.height || !rect.width || !rect.height) return null
    let width = rect.width, height = rect.height, fit = data.fit || 'contain', objectPosition
    origin = { x: 0, y: 0 }
    if (overlay) {
      const media = drawable.getBoundingClientRect(), css = getComputedStyle(drawable)
      width = media.width; height = media.height
      origin = { x: media.left - rect.left, y: media.top - rect.top }
      fit = ['contain', 'cover'].includes(css.objectFit) ? css.objectFit : 'fill'
      objectPosition = css.objectPosition.split(/\s+/)
    }
    if (!width || !height) return null
    mediaBox = { width, height }
    const options = { ...size, viewWidth: width, viewHeight: height, fit, ...viewport }
    if (objectPosition) {
      const base = imageTransform(options)
      const offset = (text, space) => {
        if (!/^-?(?:\d+\.?\d*|\.\d+)(?:%|px)$/.test(text)) throw new Error('Overlay object-position requires pixel or percentage coordinates')
        return text.endsWith('%') ? parseFloat(text) / 100 * space : parseFloat(text)
      }
      const spaceX = width - size.width * base.sx, spaceY = height - size.height * base.sy
      let left = offset(objectPosition[0], spaceX)
      if (data.mirror) left = spaceX - left
      options.panX = left - base.left
      options.panY = offset(objectPosition[1], spaceY) - base.top
    }
    return imageTransform({ ...options, mirror: !!data.mirror })
  }
  function draw () {
    if (disposed) return
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height)
    transform = geometry()
    if (!transform) return
    const t = transform, size = dimensions(drawable)
    context.save(); context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.beginPath(); context.rect(origin.x, origin.y, mediaBox.width, mediaBox.height); context.clip()
    context.setTransform(dpr * t.sx, 0, 0, dpr * t.sy, dpr * (t.left + origin.x), dpr * (t.top + origin.y))
    context.save(); context.beginPath(); context.rect(0, 0, size.width, size.height); context.clip()
    if (!overlay) context.drawImage(drawable, 0, 0, size.width, size.height)
    for (const mask of masks) {
      context.globalAlpha = mask.opacity
      context.imageSmoothingEnabled = false
      const e = mask.extent; context.drawImage(mask.canvas, e.x, e.y, e.width, e.height)
    }
    context.globalAlpha = 1
    context.lineWidth = 2 / Math.abs(t.sx)
    for (const box of data.boxes || []) {
      context.strokeStyle = box.color || '#ffffff'; context.strokeRect(box.x, box.y, box.width, box.height)
    }
    for (const point of [...(data.points || []), ...(selection ? [selection] : [])]) {
      context.beginPath(); context.arc(point.x, point.y, (point.radius || 4) / Math.abs(t.sx), 0, Math.PI * 2)
      context.fillStyle = point.color || '#ffffff'; context.fill(); context.strokeStyle = '#333333'; context.stroke()
    }
    context.restore(); context.restore()
  }
  function compileMasks (values) {
    return values.map(mask => {
      rectangle(mask.extent); positive(mask.width, 'mask.width'); positive(mask.height, 'mask.height')
      if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.data?.length !== mask.width * mask.height * 4) throw new Error('Mask requires width * height * 4 RGBA bytes')
      if (!(mask.data instanceof Uint8Array) && !(mask.data instanceof Uint8ClampedArray) && !(Array.isArray(mask.data) && mask.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255))) throw new Error('Mask data must contain RGBA bytes')
      const alpha = opacity(mask.opacity)
      const bytes = new Uint8ClampedArray(mask.data)
      const layer = document.createElement('canvas'); layer.width = mask.width; layer.height = mask.height
      layer.getContext('2d').putImageData(new ImageData(bytes, mask.width, mask.height), 0, 0)
      return { canvas: layer, extent: { ...mask.extent }, opacity: alpha }
    })
  }
  function update (next) {
    if (disposed) return false
    if (!next || !Number.isSafeInteger(next.revision) || next.revision < 0) throw new Error('Image revision must be a nonnegative safe integer')
    if (next.revision < revision) return false
    const changed = next.revision !== revision
    if (!changed && next.source !== undefined && next.source !== source) throw new Error('A different source requires a new revision')
    if (changed && next.source === undefined) throw new Error('A new image revision requires a source')
    const candidate = { ...(changed ? {} : data), ...next }
    for (const box of candidate.boxes || []) rectangle(box)
    for (const point of candidate.points || []) { finite(point.x, 'point.x'); finite(point.y, 'point.y'); if (point.radius !== undefined) positive(point.radius, 'point.radius') }
    if (candidate.fit !== undefined && !['contain', 'cover', 'fill'].includes(candidate.fit)) throw new Error('fit must be contain, cover or fill')
    if (candidate.mirror !== undefined && typeof candidate.mirror !== 'boolean') throw new Error('mirror must be boolean')
    if (candidate.source != null && typeof candidate.source !== 'string' && !(candidate.source instanceof Blob) && !['HTMLImageElement', 'HTMLVideoElement', 'HTMLCanvasElement', 'ImageBitmap', 'OffscreenCanvas'].some(name => typeof globalThis[name] === 'function' && candidate.source instanceof globalThis[name])) throw new Error('Unsupported image source')
    const nextMasks = next.masks !== undefined || changed ? compileMasks(candidate.masks || []) : masks
    if (overlay && candidate.source && typeof candidate.source.getBoundingClientRect !== 'function') throw new Error('Overlay mode requires an existing image or video element')
    data = candidate; masks = nextMasks
    if (!changed) { draw(); return true }
    revision = next.revision; source = next.source; selection = null; viewport = { zoom: 1, panX: 0, panY: 0 }
    const current = ++epoch; release(); drawable = null; draw()
    const accept = (value, owns=false) => {
      if (disposed || current !== epoch) { if (owns) value?.close?.(); return false }
      drawable = value; if (owns) owned = value
      if (value?.addEventListener) {
        for (const event of ['load', 'loadedmetadata', 'resize']) value.addEventListener(event, draw)
        if (overlay) resize.observe(value)
        cleanupLoad = () => {
          for (const event of ['load', 'loadedmetadata', 'resize']) value.removeEventListener(event, draw)
          if (overlay) resize.unobserve(value)
        }
      }
      draw(); return true
    }
    if (typeof source === 'string') {
      const image = new Image()
      image.src = source
      cleanupLoad = () => { image.src = '' }
      ready = image.decode().then(() => accept(image), error => { if (current === epoch) notifyError(error); return false })
    } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
      ready = createImageBitmap(source, { imageOrientation: 'from-image' }).then(bitmap => accept(bitmap, true), error => { if (current === epoch) notifyError(error); return false })
    } else {
      ready = Promise.resolve(accept(source))
    }
    return true
  }
  function sourceToClient (point) {
    transform = geometry()
    if (!transform) return null
    const p = transform.toView(point), rect = canvas.getBoundingClientRect()
    return { x: p.x + origin.x + rect.left, y: p.y + origin.y + rect.top }
  }
  function clientToSource (point) {
    transform = geometry()
    if (!transform) return null
    const rect = canvas.getBoundingClientRect()
    const local = { x: point.x - rect.left - origin.x, y: point.y - rect.top - origin.y }, result = transform.toSource(local)
    result.inside = result.inside && local.x >= 0 && local.x <= mediaBox.width && local.y >= 0 && local.y <= mediaBox.height
    return result
  }
  const click = event => {
    const point = clientToSource({ x: event.clientX, y: event.clientY })
    if (!point?.inside) return
    selection = { x: point.x, y: point.y }; draw()
    onSelect?.({ ...selection, revision })
  }
  if (onSelect) canvas.addEventListener('click', click)
  const resize = new ResizeObserver(draw); resize.observe(container)
  window.addEventListener('resize', draw)
  const view = {
    update, sourceToClient, clientToSource,
    get ready () { return ready },
    getState: () => ({ revision, ...viewport, selection: selection && { ...selection } }),
    setSelection (point) {
      if (point) { finite(point.x, 'selection.x'); finite(point.y, 'selection.y') }
      selection = point ? { x: point.x, y: point.y } : null; draw()
    },
    setViewport (patch) {
      if (overlay) throw new Error('Overlay viewport belongs to its host media element')
      const next = { ...viewport, ...patch }; positive(next.zoom, 'zoom'); finite(next.panX, 'panX'); finite(next.panY, 'panY')
      viewport = next; draw()
    },
    dispose () {
      if (disposed) return
      disposed = true; epoch++; release(); resize.disconnect(); window.removeEventListener('resize', draw)
      canvas.removeEventListener('click', click); masks = []; drawable = null; source = null; data = {}; selection = null
      if (!supplied) canvas.remove()
      else { context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, canvas.width, canvas.height); oldStyle === null ? canvas.removeAttribute('style') : canvas.setAttribute('style', oldStyle) }
      oldLabel === null ? canvas.removeAttribute('aria-label') : canvas.setAttribute('aria-label', oldLabel)
      container.style.position = oldPosition
    }
  }
  try { update(initial) } catch (error) { view.dispose(); throw error }
  return view
}

module.exports = { imageTransform, imageView }
