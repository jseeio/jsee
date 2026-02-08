const path = require('path')
const { collectFetchBundleBlocks, resolveFetchImport, resolveRuntimeMode } = require('../../src/cli')

describe('collectFetchBundleBlocks', () => {
  test('collects model, view and render blocks', () => {
    const schema = {
      model: { name: 'model', url: './model.js' },
      view: { name: 'view', url: './view.js' },
      render: { name: 'render', url: './render.js' }
    }

    const blocks = collectFetchBundleBlocks(schema)

    expect(blocks.map(b => b.name)).toEqual(['model', 'view', 'render'])
  })

  test('supports arrays and skips missing sections', () => {
    const schema = {
      model: [
        { name: 'm1', url: './m1.js' },
        { name: 'm2', url: './m2.js' }
      ],
      view: [{ name: 'v1', url: './v1.js' }]
    }

    const blocks = collectFetchBundleBlocks(schema)

    expect(blocks.map(b => b.name)).toEqual(['m1', 'm2', 'v1'])
  })
})

describe('resolveFetchImport', () => {
  test('resolves local relative import paths against model location', () => {
    const cwd = '/tmp/jsee-workspace'
    const result = resolveFetchImport('./helpers/math.js', 'apps/qrcode/model.js', cwd)

    expect(result.schemaImport).toBe('apps/qrcode/helpers/math.js')
    expect(result.importUrl).toBe('https://cdn.jsdelivr.net/npm/apps/qrcode/helpers/math.js')
    expect(result.localFilePath).toBe(path.join(cwd, 'apps/qrcode/helpers/math.js'))
    expect(result.remoteUrl).toBeNull()
  })

  test('keeps package imports as remote URLs', () => {
    const result = resolveFetchImport('chart.js', 'apps/qrcode/model.js', '/tmp/jsee-workspace')

    expect(result.schemaImport).toBe('chart.js')
    expect(result.importUrl).toBe('https://cdn.jsdelivr.net/npm/chart.js')
    expect(result.localFilePath).toBeNull()
    expect(result.remoteUrl).toBe('https://cdn.jsdelivr.net/npm/chart.js')
  })

  test('supports object imports and preserves extra fields', () => {
    const result = resolveFetchImport(
      { url: './helpers/math.js', integrity: 'sha-123' },
      'apps/qrcode/model.js',
      '/tmp/jsee-workspace'
    )

    expect(result.schemaEntry).toEqual({
      url: 'apps/qrcode/helpers/math.js',
      integrity: 'sha-123'
    })
    expect(result.importUrl).toBe('https://cdn.jsdelivr.net/npm/apps/qrcode/helpers/math.js')
    expect(result.localFilePath).toBe(path.join('/tmp/jsee-workspace', 'apps/qrcode/helpers/math.js'))
    expect(result.remoteUrl).toBeNull()
  })
})

describe('resolveRuntimeMode', () => {
  test('defaults to cdn for generated output when fetch is disabled', () => {
    expect(resolveRuntimeMode('auto', false, true)).toBe('cdn')
  })

  test('defaults to local for served apps when fetch is disabled', () => {
    expect(resolveRuntimeMode('auto', false, false)).toBe('local')
  })

  test('uses inline mode when fetch is enabled', () => {
    expect(resolveRuntimeMode('auto', true, true)).toBe('inline')
  })

  test('honors explicit runtime mode', () => {
    expect(resolveRuntimeMode('local', true, true)).toBe('local')
    expect(resolveRuntimeMode('inline', false, false)).toBe('inline')
  })

  test('throws on invalid runtime mode', () => {
    expect(() => resolveRuntimeMode('invalid', false, false)).toThrow('Invalid runtime mode')
  })
})
