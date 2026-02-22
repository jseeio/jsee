const fs = require('fs')
const os = require('os')
const path = require('path')
const gen = require('../../src/cli')
const { collectFetchBundleBlocks, resolveLocalImportFile, resolveFetchImport, resolveRuntimeMode, needsFullBundle } = gen

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

describe('resolveLocalImportFile', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-resolve-'))
    // Create a project layout:
    //   dist/a.js
    //   css/x.css
    //   src/model.js
    //   src/helper.js
    fs.mkdirSync(path.join(tmpDir, 'dist'))
    fs.mkdirSync(path.join(tmpDir, 'css'))
    fs.mkdirSync(path.join(tmpDir, 'src'))
    fs.writeFileSync(path.join(tmpDir, 'dist', 'a.js'), '// a')
    fs.writeFileSync(path.join(tmpDir, 'css', 'x.css'), '/* x */')
    fs.writeFileSync(path.join(tmpDir, 'src', 'model.js'), '// model')
    fs.writeFileSync(path.join(tmpDir, 'src', 'helper.js'), '// helper')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('resolves bare-relative JS path from cwd', () => {
    const result = resolveLocalImportFile('dist/a.js', 'src/model.js', tmpDir)
    expect(result).toBe(path.join(tmpDir, 'dist', 'a.js'))
  })

  test('resolves bare-relative CSS path from cwd', () => {
    const result = resolveLocalImportFile('css/x.css', 'src/model.js', tmpDir)
    expect(result).toBe(path.join(tmpDir, 'css', 'x.css'))
  })

  test('resolves explicit-relative path against model directory', () => {
    const result = resolveLocalImportFile('./helper.js', 'src/model.js', tmpDir)
    expect(result).toBe(path.join(tmpDir, 'src', 'helper.js'))
  })

  test('returns null for nonexistent file', () => {
    const result = resolveLocalImportFile('dist/nope.js', 'src/model.js', tmpDir)
    expect(result).toBeNull()
  })

  test('returns null for HTTP URLs', () => {
    const result = resolveLocalImportFile('https://cdn.example.com/lib.js', 'src/model.js', tmpDir)
    expect(result).toBeNull()
  })

  test('returns null for npm package names', () => {
    const result = resolveLocalImportFile('lodash', 'src/model.js', tmpDir)
    expect(result).toBeNull()
  })
})

describe('resolveFetchImport', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-resolve-'))
    fs.mkdirSync(path.join(tmpDir, 'dist'))
    fs.mkdirSync(path.join(tmpDir, 'css'))
    fs.mkdirSync(path.join(tmpDir, 'src'))
    fs.writeFileSync(path.join(tmpDir, 'dist', 'core.js'), '// core')
    fs.writeFileSync(path.join(tmpDir, 'css', 'app.css'), '/* app */')
    fs.writeFileSync(path.join(tmpDir, 'src', 'model.js'), '// model')
    fs.writeFileSync(path.join(tmpDir, 'src', 'helper.js'), '// helper')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('resolves bare-relative local JS with raw importUrl', () => {
    const result = resolveFetchImport('dist/core.js', 'src/model.js', tmpDir)

    expect(result.schemaImport).toBe('dist/core.js')
    expect(result.importUrl).toBe('dist/core.js')
    expect(result.localFilePath).toBe(path.join(tmpDir, 'dist', 'core.js'))
    expect(result.remoteUrl).toBeNull()
  })

  test('resolves bare-relative local CSS with raw importUrl', () => {
    const result = resolveFetchImport('css/app.css', 'src/model.js', tmpDir)

    expect(result.schemaImport).toBe('css/app.css')
    expect(result.importUrl).toBe('css/app.css')
    expect(result.localFilePath).toBe(path.join(tmpDir, 'css', 'app.css'))
    expect(result.remoteUrl).toBeNull()
  })

  test('resolves explicit-relative local import against model dir', () => {
    const result = resolveFetchImport('./helper.js', 'src/model.js', tmpDir)

    expect(result.schemaImport).toBe('./helper.js')
    expect(result.importUrl).toBe('./helper.js')
    expect(result.localFilePath).toBe(path.join(tmpDir, 'src', 'helper.js'))
    expect(result.remoteUrl).toBeNull()
  })

  test('keeps package imports as remote URLs', () => {
    const result = resolveFetchImport('chart.js', 'src/model.js', tmpDir)

    expect(result.schemaImport).toBe('chart.js')
    expect(result.importUrl).toBe('https://cdn.jsdelivr.net/npm/chart.js')
    expect(result.localFilePath).toBeNull()
    expect(result.remoteUrl).toBe('https://cdn.jsdelivr.net/npm/chart.js')
  })

  test('keeps remote HTTP URLs unchanged', () => {
    const result = resolveFetchImport('https://cdn.example.com/lib.css', 'model.js', tmpDir)
    expect(result.remoteUrl).toBe('https://cdn.example.com/lib.css')
    expect(result.localFilePath).toBeNull()
  })

  test('supports object imports and preserves extra fields', () => {
    const result = resolveFetchImport(
      { url: './helper.js', integrity: 'sha-123' },
      'src/model.js',
      tmpDir
    )

    expect(result.schemaEntry).toEqual({
      url: './helper.js',
      integrity: 'sha-123'
    })
    expect(result.importUrl).toBe('./helper.js')
    expect(result.localFilePath).toBe(path.join(tmpDir, 'src', 'helper.js'))
    expect(result.remoteUrl).toBeNull()
  })

  test('nonexistent file falls through to remote/CDN', () => {
    const result = resolveFetchImport('dist/nope.js', 'src/model.js', tmpDir)

    expect(result.localFilePath).toBeNull()
    expect(result.remoteUrl).toBe('https://cdn.jsdelivr.net/npm/dist/nope.js')
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

describe('needsFullBundle', () => {
  test('returns false for schema without outputs', () => {
    expect(needsFullBundle({})).toBe(false)
    expect(needsFullBundle({ outputs: [] })).toBe(false)
  })

  test('returns false for basic output types', () => {
    expect(needsFullBundle({ outputs: [{ type: 'table' }, { type: 'image' }] })).toBe(false)
  })

  test('returns true for chart output', () => {
    expect(needsFullBundle({ outputs: [{ type: 'chart' }] })).toBe(true)
  })

  test('returns true for 3d output', () => {
    expect(needsFullBundle({ outputs: [{ type: '3d' }] })).toBe(true)
  })

  test('returns true for map output', () => {
    expect(needsFullBundle({ outputs: [{ type: 'map' }] })).toBe(true)
  })

  test('returns true for pdf output', () => {
    expect(needsFullBundle({ outputs: [{ type: 'pdf' }] })).toBe(true)
  })

  test('returns true for nested full types in groups', () => {
    expect(needsFullBundle({
      outputs: [{ type: 'group', elements: [{ type: 'chart' }] }]
    })).toBe(true)
  })

  test('returns false for gallery and highlight (zero-cost)', () => {
    expect(needsFullBundle({ outputs: [{ type: 'gallery' }, { type: 'highlight' }] })).toBe(false)
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
