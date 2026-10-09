// Bitmap inputs are borrowed. Each model call gets its own copy; workers own
// transferred copies, while the caller keeps its source for later stages.
const isImageBitmap = value => typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap

function imageFrames (value, seen=new WeakSet(), frames=[]) {
  if (!value || typeof value !== 'object' || seen.has(value)) return frames
  seen.add(value)
  if (isImageBitmap(value)) { frames.push(value); return frames }
  if (value instanceof Map) {
    for (const [key, child] of value) { imageFrames(key, seen, frames); imageFrames(child, seen, frames) }
  } else if (value instanceof Set) {
    for (const child of value) imageFrames(child, seen, frames)
  } else if (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    for (const child of Object.values(value)) imageFrames(child, seen, frames)
  }
  return frames
}

async function withImageFrames (value, consume) {
  const frames = imageFrames(value)
  if (!frames.length) return consume(value, [])
  const copies = new Map(), containers = new WeakMap()
  const replace = value => {
    if (copies.has(value)) return copies.get(value)
    if (!value || typeof value !== 'object' || !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value
    if (containers.has(value)) return containers.get(value)
    const result = value instanceof Map ? new Map() : value instanceof Set ? new Set() : Array.isArray(value) ? [] : {}
    containers.set(value, result)
    if (value instanceof Map) {
      for (const [key, child] of value) result.set(replace(key), replace(child))
    } else if (value instanceof Set) {
      for (const child of value) result.add(replace(child))
    } else for (const key of Object.keys(value)) Object.defineProperty(result, key, { value: replace(value[key]), enumerable: true, writable: true, configurable: true })
    return result
  }
  try {
    // Sequential creation makes partial failure cleanup deterministic.
    for (const frame of frames) copies.set(frame, await createImageBitmap(frame))
    return await consume(replace(value), [...copies.values()])
  } finally { for (const copy of copies.values()) copy.close() }
}

function assertFrameResult (value) {
  const frames = imageFrames(value)
  frames.forEach(frame => frame.close())
  if (frames.length) throw new Error('ImageBitmap is a borrowed input, not a model output; return image files or pixel data')
}

module.exports = { isImageBitmap, imageFrames, withImageFrames, assertFrameResult }
