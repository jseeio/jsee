const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const gen = require('../../src/cli')
const { collectFetchBundleBlocks, resolveLocalImportFile, resolveFetchImport, resolveRuntimeMode, needsFullBundle, shouldBundleModelCode, resolveJseePackageInput, looksLikeMissingPackageInput, getPackageInputInstallHint, isPackageSpecifier } = gen

function extractHiddenCode (html, src) {
  const marker = `data-src="${src}"`
  const markerIndex = html.indexOf(marker)
  if (markerIndex === -1) throw new Error(`Missing hidden block for ${src}`)
  const openEnd = html.indexOf('>', markerIndex)
  const closeStart = html.indexOf('</script>', openEnd)
  return html.slice(openEnd + 1, closeStart)
}

function runHiddenModel (code, name, input) {
  const context = { console }
  context.globalThis = context
  vm.runInNewContext(code, context)
  return context[name](input)
}

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

describe('package input resolution', () => {
  let originalCwd
  let tmpDir
  let packageDir

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-package-'))
    packageDir = path.join(tmpDir, 'node_modules', '@statsim', 'demo')
    fs.mkdirSync(packageDir, { recursive: true })
    fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
      name: '@statsim/demo',
      version: '1.0.0',
      main: 'model.js',
      exports: { '.': './model.js' },
      jsee: 'schema.json'
    }, null, 2))
    fs.writeFileSync(path.join(packageDir, 'schema.json'), JSON.stringify({
      model: { name: 'demo', url: 'model.js', worker: false },
      inputs: [{ name: 'x', type: 'int', default: 2 }],
      outputs: [{ name: 'y', type: 'number' }]
    }, null, 2))
    fs.writeFileSync(path.join(packageDir, 'model.js'), 'function demo (input) { return { y: input.x + 1 } }\n')
    fs.writeFileSync(path.join(packageDir, 'README.md'), '# Demo App\n')
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('recognizes npm package specifiers without treating paths as packages', () => {
    expect(isPackageSpecifier('@statsim/demo')).toBe(true)
    expect(isPackageSpecifier('demo')).toBe(true)
    expect(isPackageSpecifier('./demo')).toBe(false)
    expect(isPackageSpecifier('/tmp/demo')).toBe(false)
    expect(isPackageSpecifier('https://example.com/demo')).toBe(false)
  })

  test('does not fetch missing packages itself', () => {
    expect(looksLikeMissingPackageInput('@statsim/remote-demo', tmpDir)).toBe(true)
    expect(looksLikeMissingPackageInput('schema.json', tmpDir)).toBe(false)
    expect(looksLikeMissingPackageInput('./demo', tmpDir)).toBe(false)
    expect(resolveJseePackageInput('@statsim/remote-demo', tmpDir)).toBeNull()
  })

  test('prints npm exec command for package inputs that are not installed', () => {
    expect(getPackageInputInstallHint('@statsim/gen')).toBe('npx -p @jseeio/jsee -p @statsim/gen jsee @statsim/gen --serve')
  })

  test('errors with npm exec hint when a package input is missing', async () => {
    await expect(gen(['--inputs', '@statsim/remote-demo'])).rejects.toThrow('npx -p @jseeio/jsee -p @statsim/remote-demo jsee @statsim/remote-demo --serve')
  })

  test('resolves installed package jsee metadata', () => {
    const result = resolveJseePackageInput('@statsim/demo', tmpDir)

    expect(result.packageName).toBe('@statsim/demo')
    expect(result.packageRoot).toBe(packageDir)
    expect(result.schemaPath).toBe(path.join(packageDir, 'schema.json'))
    expect(result.descriptionPath).toBe(path.join(packageDir, 'README.md'))
  })

  test('builds package input from installed jsee package', async () => {
    const outputPath = path.join(tmpDir, 'out', 'index.html')

    await gen(['--inputs', '@statsim/demo', '--outputs', outputPath, '--bundle'])

    const html = fs.readFileSync(outputPath, 'utf8')
    expect(html).toContain('Demo App')
    const code = extractHiddenCode(html, 'model.js')
    expect(runHiddenModel(code, 'demo', { x: 4 })).toEqual({ y: 5 })
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

  test('returns false for pdf output because browser-native PDF is zero-cost', () => {
    expect(needsFullBundle({ outputs: [{ type: 'pdf' }] })).toBe(false)
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

describe('model dependency bundling', () => {
  let originalCwd
  let tmpDir

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-bundle-'))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('detects module-shaped model files', () => {
    expect(shouldBundleModelCode('function gen () { return 1 }')).toBe(false)
    expect(shouldBundleModelCode('const helper = require("./helper")')).toBe(true)
    expect(shouldBundleModelCode('module.exports = function gen () {}')).toBe(true)
    expect(shouldBundleModelCode('export function gen () {}')).toBe(true)
    expect(shouldBundleModelCode('import helper from "./helper"')).toBe(true)
  })

  test('bundles require dependencies while preserving the JSEE model name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), 'module.exports = function scale (x) { return x * 2 }\n')
    fs.writeFileSync(path.join(tmpDir, 'model.js'), `const scale = require('./helper')
function gen (input) {
  return { y: scale(input.x) }
}
`)
    fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
      model: { name: 'gen', url: 'model.js', worker: false },
      inputs: [{ name: 'x', type: 'int', default: 3 }],
      outputs: [{ name: 'y', type: 'number' }]
    }, null, 2))

    const html = await gen(['schema.json', '-o', 'app.html', '--bundle'], true)
    const code = extractHiddenCode(html, 'model.js')

    expect(code).toContain('__jsee_bundle_gen')
    expect(code).not.toContain("const scale = require('./helper')")
    expect(runHiddenModel(code, 'gen', { x: 4 })).toEqual({ y: 8 })
  })

  test('supports legacy fetch alias', async () => {
    fs.writeFileSync(path.join(tmpDir, 'model.js'), `function gen (input) {
  return { y: input.x + 1 }
}
`)
    fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
      model: { name: 'gen', url: 'model.js', worker: false },
      inputs: [{ name: 'x', type: 'int', default: 3 }],
      outputs: [{ name: 'y', type: 'number' }]
    }, null, 2))

    const html = await gen(['schema.json', '-o', 'app.html', '--fetch'], true)

    expect(html).toContain('data-src="model.js"')
  })

  test('leaves plain browser-global model files unbundled', async () => {
    const source = `function gen (input) {
  return { y: input.x + 1 }
}
`
    fs.writeFileSync(path.join(tmpDir, 'model.js'), source)
    fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
      model: { name: 'gen', url: 'model.js', worker: false },
      inputs: [{ name: 'x', type: 'int', default: 3 }],
      outputs: [{ name: 'y', type: 'number' }]
    }, null, 2))

    const html = await gen(['schema.json', '-o', 'app.html', '-f'], true)
    const code = extractHiddenCode(html, 'model.js')

    expect(code).toBe(source)
    expect(code).not.toContain('__jsee_bundle_gen')
    expect(runHiddenModel(code, 'gen', { x: 4 })).toEqual({ y: 5 })
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

  test('creates parent directories for output paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-cli-nested-output-'))
    const schemaPath = path.join(tmpDir, 'schema.json')
    const nestedOutputPath = path.join(tmpDir, 'dist', 'nested', 'index.html')

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
      await gen(['--inputs', schemaPath, '--outputs', nestedOutputPath])

      expect(fs.existsSync(nestedOutputPath)).toBe(true)
      expect(fs.readFileSync(nestedOutputPath, 'utf8')).toContain('<!DOCTYPE html>')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('init scaffolds', () => {
  let originalCwd
  let tmpDir

  beforeEach(() => {
    originalCwd = process.cwd()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-init-'))
    process.chdir(tmpDir)
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('minimal scaffold model accepts the default object payload', async () => {
    await gen(['init'])

    const code = fs.readFileSync(path.join(tmpDir, 'model.js'), 'utf8')
    const greet = new Function(`${code}\nreturn greet`)()

    expect(greet({ name: 'World', count: 2 })).toEqual({
      greeting: 'World\nWorld\n'
    })
  })

  test('chat scaffold model accepts the default object payload', async () => {
    await gen(['init', 'chat'])

    const schema = JSON.parse(fs.readFileSync(path.join(tmpDir, 'schema.json'), 'utf8'))
    const code = fs.readFileSync(path.join(tmpDir, 'model.js'), 'utf8')
    const chat = new Function(`${code}\nreturn chat`)()

    expect(schema.outputs).toEqual([{ name: 'chat', type: 'chat' }])
    expect(chat({ message: 'hello', history: [] })).toEqual({
      chat: 'You said: hello'
    })
  })
})

describe('browser bundle Node stub', () => {
  test('loads in Node and throws a clear browser-only error when used', () => {
    const browserBundleOnly = require('../../src/browser-bundle-node')

    expect(browserBundleOnly.browserOnly).toBe(true)
    expect(() => browserBundleOnly()).toThrow(/browser DOM/)
  })
})
