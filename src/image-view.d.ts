export interface ImagePoint { x: number; y: number }
export interface ImageRect extends ImagePoint { width: number; height: number }
export interface ImageMask {
  width: number
  height: number
  /** Row-major RGBA bytes. No model-specific decoding or normalization. */
  data: Uint8Array | Uint8ClampedArray | number[]
  extent: ImageRect
  opacity?: number
}
export interface ImageViewData {
  /** Monotonically increasing source revision. A new revision requires source. */
  revision: number
  source?: string | Blob | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas | null
  boxes?: (ImageRect & { color?: string })[]
  points?: (ImagePoint & { color?: string; radius?: number })[]
  masks?: ImageMask[]
  mirror?: boolean
  fit?: 'contain' | 'cover' | 'fill'
}
export interface ImageViewport { zoom: number; panX: number; panY: number }
export interface ImageView {
  /** False for a stale revision or disposed view. */
  update(data: ImageViewData): boolean
  readonly ready: Promise<boolean>
  sourceToClient(point: ImagePoint): ImagePoint | null
  clientToSource(point: ImagePoint): (ImagePoint & { inside: boolean }) | null
  getState(): ImageViewport & { revision: number; selection: ImagePoint | null }
  setSelection(point: ImagePoint | null): void
  setViewport(patch: Partial<ImageViewport>): void
  dispose(): void
}
export function imageView(container: HTMLElement, initial: ImageViewData, options?: {
  canvas?: HTMLCanvasElement
  /** Annotations over an existing image/video element; host owns its viewport. */
  overlay?: boolean
  onSelect?: (point: ImagePoint & { revision: number }) => void
  onError?: (error: Error) => void
}): ImageView
export function imageTransform(options: Partial<ImageViewport> & { width: number; height: number; viewWidth: number; viewHeight: number; mirror?: boolean; fit?: 'contain' | 'cover' | 'fill' }): {
  sx: number; sy: number; left: number; top: number
  toView(point: ImagePoint): ImagePoint
  toSource(point: ImagePoint): ImagePoint & { inside: boolean }
}
