const { imageTransform } = require('../../src/image-view')

test.each([
  [640, 480, 390, 300], [1800, 900, 300, 600], [80, 120, 1000, 300]
])('source/display coordinates round-trip with contain, zoom, pan and mirror (%i x %i)', (width, height, viewWidth, viewHeight) => {
  for (const mirror of [false, true]) for (const zoom of [1, 2.5]) {
    const t = imageTransform({ width, height, viewWidth, viewHeight, zoom, panX: 12, panY: -8, mirror })
    for (const [x, y] of [[0, 0], [width / 3, height / 4], [width, height]]) {
      const p = t.toView({ x, y }), back = t.toSource(p)
      expect(back.x).toBeCloseTo(x, 8); expect(back.y).toBeCloseTo(y, 8)
    }
  }
})

test('letterbox coordinates are outside the source, not clamped onto its edge', () => {
  const t = imageTransform({ width: 200, height: 100, viewWidth: 200, viewHeight: 200 })
  expect(t.toSource({ x: 100, y: 20 }).inside).toBe(false)
  expect(t.toSource({ x: 100, y: 50 })).toMatchObject({ x: 100, y: 0, inside: true })
})

test('fill and cover match the media box without implicit mask scaling', () => {
  const cover = imageTransform({ width: 200, height: 100, viewWidth: 100, viewHeight: 100, fit: 'cover' })
  expect(cover.toView({ x: 100, y: 50 })).toEqual({ x: 50, y: 50 })
  const fill = imageTransform({ width: 200, height: 100, viewWidth: 100, viewHeight: 100, fit: 'fill' })
  expect(fill.toView({ x: 200, y: 100 })).toEqual({ x: 100, y: 100 })
})

test('invalid image geometry rejects nonfinite and empty extents', () => {
  expect(() => imageTransform({ width: 0, height: 1, viewWidth: 1, viewHeight: 1 })).toThrow('positive')
  expect(() => imageTransform({ width: 1, height: 1, viewWidth: 1, viewHeight: 1, zoom: NaN })).toThrow('positive')
})
