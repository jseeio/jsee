let previous
export async function predict ({ image }) {
  const borrowed = image instanceof ImageBitmap
  const frame = borrowed ? image : await createImageBitmap(new Blob([image], { type: 'image/png' }))
  try {
    const canvas = new OffscreenCanvas(32, 32), ctx = canvas.getContext('2d')
    ctx.drawImage(frame, 0, 0, 32, 32)
    const pixels = ctx.getImageData(0, 0, 32, 32).data
    let sum = 0
    for (const value of pixels) sum += value
    const previousClosed = !previous || previous.width === 0
    previous = frame
    return { sum, width: frame.width, previousClosed }
  } finally { if (!borrowed) frame.close() }
}
