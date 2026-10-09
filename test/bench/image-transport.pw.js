// Manual benchmark: npx playwright test test/bench/image-transport.pw.js --workers=1
const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const reportDirectory = path.resolve(process.env.JSEE_BENCH_DIR || 'tmp/bench/image-transport')
test.beforeAll(() => fs.mkdirSync(reportDirectory, { recursive: true }))

test('measure encoded files versus borrowed bitmap copies transferred to a worker', async ({ page, browser }) => {
  test.setTimeout(120000)
  await page.goto('/load/')
  const session = await page.context().newCDPSession(page)
  const heap = async () => { await session.send('HeapProfiler.collectGarbage'); return session.send('Runtime.getHeapUsage') }
  const before = await heap()
  const result = await page.evaluate(async () => {
    const workerURL = URL.createObjectURL(new Blob([`
      onmessage = async ({ data }) => {
        let image
        try {
          image = data.bitmap || await createImageBitmap(new Blob([data.bytes], { type: 'image/png' }))
          const canvas = new OffscreenCanvas(32, 32), ctx = canvas.getContext('2d')
          ctx.drawImage(image, 0, 0, 32, 32)
          const pixels = ctx.getImageData(0, 0, 32, 32).data
          let sum = 0
          for (const value of pixels) sum += value
          image.close()
          postMessage({ sum, closed: image.width === 0 })
        } catch (error) { image?.close(); postMessage({ error: error.message }) }
      }
    `], { type: 'text/javascript' }))
    const worker = new Worker(workerURL)
    const send = (payload, transfer=[]) => new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data)
      worker.onerror = reject
      worker.postMessage(payload, transfer)
    })
    const rows = []
    try {
      for (const [width, height] of [[640, 480], [1280, 720], [1920, 1080]]) {
        const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height
        const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(width, height)
        let seed = 42
        for (let i = 0; i < pixels.data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          pixels.data[i] = seed & 255;pixels.data[i + 1] = seed >>> 8 & 255;pixels.data[i + 2] = seed >>> 16 & 255;pixels.data[i + 3] = 255
        }
        ctx.putImageData(pixels, 0, 0)
        const samples = { file: [], bitmap: [] }, checksums = new Set()
        let encodedBytes, copiesClosed = true
        for (let i = 0; i < 25; i++) for (const mode of (i % 2 ? ['bitmap', 'file'] : ['file', 'bitmap'])) {
          // Dirty the source in both modes; static canvas snapshots may otherwise be cached.
          ctx.putImageData(pixels, 0, 0)
          const start = performance.now()
          let output
          if (mode === 'file') {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
            const file = new File([blob], 'frame.png', { type: 'image/png' })
            encodedBytes = file.size
            output = await send({ bytes: await file.arrayBuffer() })
          } else {
            const caller = await createImageBitmap(canvas)
            // A model borrows its input: transfer a dedicated copy, keeping the
            // caller's bitmap valid for other pipeline stages or display.
            const copy = await createImageBitmap(caller)
            output = await send({ bitmap: copy }, [copy])
            copiesClosed = copiesClosed && copy.width === 0 && caller.width === width
            caller.close()
          }
          const elapsed = performance.now() - start
          checksums.add(output.sum);copiesClosed = copiesClosed && output.closed
          if (i >= 5) samples[mode].push(elapsed)
        }
        rows.push({ width, height, encodedBytes, samples, equalPixels: checksums.size === 1, copiesClosed })
      }
    } finally { worker.terminate(); URL.revokeObjectURL(workerURL) }
    return { rows, userAgent: navigator.userAgent, isolation: window.crossOriginIsolated }
  })
  const after = await heap()
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
  for (const row of result.rows) {
    expect(row.equalPixels).toBe(true)
    expect(row.copiesClosed).toBe(true)
    row.latencyMs = Object.fromEntries(Object.entries(row.samples).map(([mode, samples]) => [mode, { median: percentile(samples, .5), p95: percentile(samples, .95) }]))
  }
  const report = { ...result, browser: browser.version(), pageHeap: { before, after }, limits: 'Synthetic dense canvas, 5 warmups +20 sequential samples per mode; capture/transport/decode and 32x32 pixel reduction included. Heap is page JS/embedder only, excludes worker/GPU allocations; no total-memory claim.' }
  const directory = reportDirectory
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(result.rows.map(({ width, height, latencyMs }) => ({ width, height, latencyMs }))))
})

test('measure complete JSEE transient invocations with encoded and bitmap frames', async ({ page, browser }) => {
  test.setTimeout(120000)
  await page.goto('/load/')
  const result = await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false,
      inputs: [{ name: 'image', type: 'image', nullable: true, default: null }],
      model: { type: 'module', url: '/test/fixtures/image-frame-model.mjs', name: 'predict', worker: true },
      outputs: [{ name: 'sum', type: 'number' }, { name: 'previousClosed', type: 'bool' }]
    } })
    await app.ready
    const rows = []
    try {
      for (const pattern of ['gradient', 'dense']) for (const [width, height] of [[640, 480], [1280, 720], [1920, 1080]]) {
        const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height
        const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(width, height)
        let seed = 42
        for (let i = 0; i < pixels.data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          const x = i / 4 % width, y = Math.floor(i / 4 / width)
          pixels.data[i] = pattern === 'dense' ? seed & 255 : x * 255 / width
          pixels.data[i + 1] = pattern === 'dense' ? seed >>> 8 & 255 : y * 255 / height
          pixels.data[i + 2] = pattern === 'dense' ? seed >>> 16 & 255 : 100;pixels.data[i + 3] = 255
        }
        const samples = { file: [], bitmap: [] }, sums = new Set()
        let closed = true
        for (let i = 0; i < 25; i++) for (const mode of (i % 2 ? ['bitmap', 'file'] : ['file', 'bitmap'])) {
          ctx.putImageData(pixels, 0, 0)
          const started = performance.now()
          const image = mode === 'bitmap' ? await createImageBitmap(canvas) : new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'frame.png', { type: 'image/png' })
          try {
            const output = await app.invoke({ image }, { transient: true })
            sums.add(output.sum);closed = closed && output.previousClosed
          } finally { if (mode === 'bitmap') image.close() }
          if (i >= 5) samples[mode].push(performance.now() - started)
        }
        rows.push({ pattern, width, height, samples, equalPixels: sums.size === 1, previousFramesClosed: closed })
      }
    } finally { app.destroy() }
    return { rows, userAgent: navigator.userAgent }
  })
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
  for (const row of result.rows) {
    expect(row.equalPixels).toBe(true)
    expect(row.previousFramesClosed).toBe(true)
    row.latencyMs = Object.fromEntries(Object.entries(row.samples).map(([mode, samples]) => [mode, { median: percentile(samples, .5), p95: percentile(samples, .95) }]))
  }
  fs.writeFileSync(path.join(reportDirectory, 'jsee-benchmark.json'), JSON.stringify({ ...result, browser: browser.version(), limits: 'Synthetic canvases; 5 warmups +20 interleaved samples per mode. Includes capture, JSEE validation/pipeline, worker pixel reduction and output updates. No ML inference, camera hardware or total memory measurement.' }, null, 2) + '\n')
  console.log(JSON.stringify(result.rows.map(({ pattern, width, height, latencyMs }) => ({ pattern, width, height, latencyMs }))))
})

test('sample renderer heap during repeated file and bitmap invocations', async ({ page, browser }) => {
  test.setTimeout(120000)
  await page.goto('/load/')
  const session = await page.context().newCDPSession(page)
  const heap = () => session.send('Runtime.getHeapUsage')
  const collectedHeap = async () => { await session.send('HeapProfiler.collectGarbage'); return heap() }
  await page.evaluate(async () => {
    const root = document.createElement('div');document.body.append(root)
    const app = new JSEE({ container: root, verbose: false, toasts: false, schema: {
      persist: false, autorun: false, inputs: [{ name: 'image', type: 'image', nullable: true, default: null }],
      model: { type: 'module', url: '/test/fixtures/image-frame-model.mjs', name: 'predict', worker: true },
      outputs: [{ name: 'sum', type: 'number' }, { name: 'previousClosed', type: 'bool' }]
    } })
    await app.ready
    const canvas = document.createElement('canvas');canvas.width = 1280;canvas.height = 720
    const ctx = canvas.getContext('2d');ctx.fillStyle = '#369';ctx.fillRect(0, 0, canvas.width, canvas.height)
    window.frameBench = { app, async run (mode) {
      for (let i = 0; i < 10; i++) {
        ctx.fillRect(0, 0, 1, 1)
        const image = mode === 'bitmap' ? await createImageBitmap(canvas) : new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'frame.png', { type: 'image/png' })
        try {
          const output = await app.invoke({ image }, { transient: true })
          if (!output.previousClosed) throw new Error('Previous worker frame is still open')
          if (app.getInputs().image !== null) throw new Error('Frame retained in form')
        } finally { if (mode === 'bitmap') image.close() }
      }
    } }
  })
  const rows = []
  try {
    // Reverse order on the second pass to expose order/warmup effects.
    for (const mode of ['file', 'bitmap', 'bitmap', 'file']) {
      await page.evaluate(mode => window.frameBench.run(mode), mode)
      const before = await collectedHeap(), samples = []
      for (let batch = 0; batch < 10; batch++) {
        await page.evaluate(mode => window.frameBench.run(mode), mode)
        samples.push(await heap())
      }
      const after = await collectedHeap()
      rows.push({ mode, frames: 100, before, after, peakSampledUsedSize: Math.max(...samples.map(value => value.usedSize)), retainedUsedSizeDelta: after.usedSize - before.usedSize, samples })
    }
  } finally { await page.evaluate(() => { window.frameBench.app.destroy();delete window.frameBench }) }
  const report = { browser: browser.version(), width: 1280, height: 720, rows, limits: 'CDP Runtime.getHeapUsage samples only the renderer isolate. Includes JSEE/form overhead; excludes worker/GPU/process-wide memory. GC after each 100-frame block; no claim about total memory or peak graphics allocations. Model asserts previous bitmap closed and form input remains null.' }
  fs.writeFileSync(path.join(reportDirectory, 'jsee-memory.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(rows.map(({ mode, peakSampledUsedSize, retainedUsedSizeDelta }) => ({ mode, peakSampledUsedSize, retainedUsedSizeDelta }))))
})
