const fs = require('fs')
const os = require('os')
const path = require('path')
const gen = require('../../src/cli')
const { collectFetchBundleBlocks, resolveFetchImport, resolveRuntimeMode } = gen

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
  test('resolves local CSS import paths', () => {
    const result = resolveFetchImport('./styles/app.css', 'apps/demo/model.js', '/tmp')
    expect(result.schemaImport).toBe('apps/demo/styles/app.css')
    expect(result.localFilePath).toBe(path.join('/tmp', 'apps/demo/styles/app.css'))
    expect(result.remoteUrl).toBeNull()
  })

  test('keeps remote CSS imports as remote URLs', () => {
    const result = resolveFetchImport('https://cdn.example.com/lib.css', 'model.js', '/tmp')
    expect(result.remoteUrl).toBe('https://cdn.example.com/lib.css')
    expect(result.localFilePath).toBeNull()
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

  test('passes through custom URL/path as runtime mode', () => {
    expect(resolveRuntimeMode('./dist/jsee.js', false, false)).toBe('./dist/jsee.js')
    expect(resolveRuntimeMode('https://example.com/jsee.js', false, true)).toBe('https://example.com/jsee.js')
    expect(resolveRuntimeMode('./node_modules/@jseeio/jsee/dist/jsee.js', true, true)).toBe('./node_modules/@jseeio/jsee/dist/jsee.js')
  })
})

describe('output writes', () => {
  test('writes absolute output paths and keeps json output intact', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-cli-output-'))
    const schemaPath = path.join(tmpDir, 'schema.json')
    const jsonOutputPath = path.join(tmpDir, 'result.json')
    const htmlOutputPath = path.join(tmpDir, 'result.html')

    fs.writeFileSync(schemaPath, JSON.stringify({
      model: [
        {
          name: 'demo',
          type: 'function',
          code: 'function demo () { return 1 }'
        }
      ],
      inputs: [],
      outputs: []
    }, null, 2))

    try {
      await gen(['--inputs', schemaPath, '--outputs', `${jsonOutputPath},${htmlOutputPath}`])

      const jsonContent = fs.readFileSync(jsonOutputPath, 'utf8')
      const htmlContent = fs.readFileSync(htmlOutputPath, 'utf8')

      expect(() => JSON.parse(jsonContent)).not.toThrow()
      expect(htmlContent).toContain('<!DOCTYPE html>')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
