const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const http = require('http')
const gen = require('../../src/cli')
const { collectFetchBundleBlocks, resolveLocalImportFile, resolveFetchImport, resolveRuntimeMode, resolveBundleMode, isPyodideBundleMode, isPyodideSingleFileBundleMode, needsFullBundle, shouldBundleModelCode, resolveJseePackageInput, looksLikeMissingPackageInput, getPackageInputInstallHint, findPackageRoot, runPackage, isPackageSpecifier, bundleModelCode, safeJsonForScript, hiddenAssetScript, resolveInside, joinUrl, sanitizeGoogleAnalyticsId, isStreamResult, writeSseStream } = gen

function extractHiddenCode (html, src) {
  const marker = `data-src="${src}"`
  const markerIndex = html.indexOf(marker)
  if (markerIndex === -1) throw new Error(`Missing hidden block for ${src}`)
  const tagStart = html.lastIndexOf('<script', markerIndex)
  const openEnd = html.indexOf('>', markerIndex)
  const closeStart = html.indexOf('</script>', openEnd)
  const content = html.slice(openEnd + 1, closeStart)
  const tag = html.slice(tagStart, openEnd)
  if (tag.includes('data-encoding="base64"')) {
    return Buffer.from(content, 'base64').toString('utf8')
  }
  return content
}

function runHiddenModel (code, name, input) {
  const context = { console }
  context.globalThis = context
  vm.runInNewContext(code, context)
  return context[name](input)
}

function toArrayBuffer (value) {
  const buffer = Buffer.from(value)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

async function captureStdout (fn) {
  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = function (chunk, encoding, callback) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'))
    if (typeof encoding === 'function') encoding()
    if (typeof callback === 'function') callback()
    return true
  }
  try {
    await fn()
  } finally {
    process.stdout.write = originalWrite
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJseePackage (tmpDir, specifier, schema, modelCode) {
  const parts = specifier.startsWith('@') ? specifier.split('/') : [specifier]
  const packageDir = specifier.startsWith('@')
    ? path.join(tmpDir, 'node_modules', parts[0], parts[1])
    : path.join(tmpDir, 'node_modules', specifier)
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: specifier,
    version: '1.0.0',
    main: 'model.js',
    exports: { '.': './model.js' },
    jsee: 'schema.json'
  }, null, 2))
  fs.writeFileSync(path.join(packageDir, 'schema.json'), JSON.stringify(schema, null, 2))
  fs.writeFileSync(path.join(packageDir, 'model.js'), modelCode)
  fs.writeFileSync(path.join(packageDir, 'README.md'), `# ${specifier}\n`)
  return packageDir
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

  test('finds package root from nested bin directory', () => {
    const binDir = path.join(packageDir, 'bin')
    fs.mkdirSync(binDir)

    expect(findPackageRoot(binDir)).toBe(packageDir)
  })

  test('runs package apps from a package bin directory', async () => {
    const binDir = path.join(packageDir, 'bin')
    const outputPath = path.join(tmpDir, 'package-run', 'index.html')
    fs.mkdirSync(binDir)
    const before = process.cwd()

    await runPackage(binDir, ['--outputs', outputPath, '--bundle'])

    expect(process.cwd()).toBe(before)
    const html = fs.readFileSync(outputPath, 'utf8')
    expect(html).toContain('Demo App')
    const code = extractHiddenCode(html, 'model.js')
    expect(runHiddenModel(code, 'demo', { x: 6 })).toEqual({ y: 7 })
  })

  test('shows download button only for bundled generated html', async () => {
    const html = await gen(['--inputs', '@statsim/demo', '--outputs', path.join(tmpDir, 'bundle.html'), '--bundle'], true)

    expect(html).toContain('id="download-html-btn"')
    expect(html).toContain("return '<!DOCTYPE html>\\n' + document.documentElement.outerHTML")
    expect(html).toContain('Download HTML')
    expect(html).not.toContain('localhost:3000')
    expect(html).not.toContain('id="save-html-btn"')
  })

  test('shows port status without download button for served html', async () => {
    const html = await gen(['--inputs', '@statsim/demo', '--port', '4567'], true)

    expect(html).toContain('localhost:4567')
    expect(html).not.toContain('id="download-html-btn"')
    expect(html).not.toContain('save-html-btn')
  })

  test('runs package input once and writes a single output to stdout', async () => {
    const stdout = await captureStdout(() =>
      gen(['--inputs', '@statsim/demo', '--run', '--x', '4'])
    )

    expect(stdout).toBe('5\n')
  })

  test('accepts raw camelCase schema input names in run mode', async () => {
    writeJseePackage(tmpDir, '@statsim/camel-demo', {
      model: { name: 'camelDemo', url: 'model.js', worker: false },
      inputs: [{ name: 'nSamples', type: 'int', default: 2 }],
      outputs: [{ name: 'rows', type: 'number' }]
    }, `module.exports = function camelDemo (input) {
  return { rows: input.nSamples }
}
`)

    const stdout = await captureStdout(() =>
      gen(['--inputs', '@statsim/camel-demo', '--run', '--nSamples', '4'])
    )

    expect(stdout).toBe('4\n')
  })

  test.each(require('../fixtures/output-contracts.json'))('run output contract: $name', async fixture => {
    writeJseePackage(tmpDir, '@statsim/output-contract', {
      model: { name: 'compute', url: 'model.js', worker: false },
      inputs: [], outputs: fixture.outputs
    }, `module.exports = function compute () { return ${JSON.stringify(fixture.result)} }`)
    const stdout = await captureStdout(() => gen(['--inputs', '@statsim/output-contract', '--run']))
    const expected = Object.keys(fixture.expected).length === 1
      ? Object.values(fixture.expected)[0] : fixture.expected
    expect(JSON.parse(stdout)).toEqual(expected)
  })

  test('streams a single file output to stdout', async () => {
    writeJseePackage(tmpDir, '@statsim/file-demo', {
      model: { name: 'fileDemo', url: 'model.js', worker: false },
      inputs: [{ name: 'name', type: 'string', default: 'World' }],
      outputs: [{ name: 'file', type: 'file' }]
    }, `module.exports = function fileDemo (input) {
  return { file: { filename: 'demo.txt', content: 'hello ' + input.name, mime: 'text/plain' } }
}
`)

    const stdout = await captureStdout(() =>
      gen(['--inputs', '@statsim/file-demo', '--run', '--name', 'Ada'])
    )

    expect(stdout).toBe('hello Ada')
  })

  test('writes a named output target in run mode', async () => {
    writeJseePackage(tmpDir, '@statsim/file-demo', {
      model: { name: 'fileDemo', url: 'model.js', worker: false },
      inputs: [{ name: 'name', type: 'string', default: 'World' }],
      outputs: [{ name: 'file', type: 'file' }]
    }, `module.exports = function fileDemo (input) {
  return { file: { filename: 'demo.txt', content: 'hello ' + input.name, mime: 'text/plain' } }
}
`)
    const outputPath = path.join(tmpDir, 'named.txt')

    await gen(['--inputs', '@statsim/file-demo', '--run', '--name', 'Ada', '--file', outputPath])

    expect(fs.readFileSync(outputPath, 'utf8')).toBe('hello Ada')
  })

  test('writes all outputs into a directory in run mode', async () => {
    writeJseePackage(tmpDir, '@statsim/multi-demo', {
      model: { name: 'multiDemo', url: 'model.js', worker: false },
      inputs: [],
      outputs: [
        { name: 'train', type: 'table' },
        { name: 'test', type: 'table' },
        { name: 'note', type: 'text' }
      ]
    }, `module.exports = function multiDemo () {
  return {
    train: [{ x: 1, y: 2 }],
    test: [{ x: 3, y: 4 }],
    note: 'ready'
  }
}
`)
    const outputDir = path.join(tmpDir, 'run-output')

    await gen(['--inputs', '@statsim/multi-demo', '--run', '--outputs', outputDir])

    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'train.json'), 'utf8'))).toEqual([{ x: 1, y: 2 }])
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'test.json'), 'utf8'))).toEqual([{ x: 3, y: 4 }])
    expect(fs.readFileSync(path.join(outputDir, 'note.txt'), 'utf8')).toBe('ready\n')
  })

  test('runPackage writes run output targets relative to the caller cwd', async () => {
    const filePackageDir = writeJseePackage(tmpDir, '@statsim/file-demo', {
      model: { name: 'fileDemo', url: 'model.js', worker: false },
      inputs: [],
      outputs: [{ name: 'file', type: 'file' }]
    }, `module.exports = function fileDemo () {
  return { file: { filename: 'demo.txt', content: 'hello bin', mime: 'text/plain' } }
}
`)
    const binDir = path.join(filePackageDir, 'bin')
    fs.mkdirSync(binDir)

    await runPackage(binDir, ['--run', '--file', 'from-bin.txt'])

    expect(fs.readFileSync(path.join(tmpDir, 'from-bin.txt'), 'utf8')).toBe('hello bin')
    expect(fs.existsSync(path.join(filePackageDir, 'from-bin.txt'))).toBe(false)
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

describe('HTML embedding safety', () => {
  test('safeJsonForScript escapes script-breaking characters', () => {
    const value = {
      title: '</script><script>window.bad = true</script>',
      text: 'a & b'
    }
    const json = safeJsonForScript(value)

    expect(json).not.toContain('</script>')
    expect(json).not.toContain('<script>')
    expect(json).toContain('\\u003c/script\\u003e')
    expect(JSON.parse(json)).toEqual(value)
    expect(safeJsonForScript(undefined)).toBe('null')
  })

  test('hidden asset scripts store base64 content', () => {
    const code = `function demo () {
  return '</script><script>window.bad = true</script>'
}
`
    const html = hiddenAssetScript('model.js', code)

    expect(html).toContain('data-encoding="base64"')
    expect(html).not.toContain('<script>window.bad = true</script>')
    expect(extractHiddenCode(html, 'model.js')).toBe(code)
  })

  test('bundled model and schema title survive script end tags', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-script-safe-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.writeFileSync(path.join(tmpDir, 'model.js'), `function demo () {
  return { text: '</script><script>window.bad = true</script>' }
}
`)
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        title: '</script><script>window.titleBad = true</script>',
        model: { name: 'demo', url: 'model.js', worker: false },
        inputs: [],
        outputs: [{ name: 'text', type: 'code' }]
      }, null, 2))

      const html = await gen(['schema.json', '--outputs', 'app.html', '--bundle'], true)
      const code = extractHiddenCode(html, 'model.js')

      expect(code).toContain('window.bad = true')
      expect(html).not.toContain('<script>window.bad = true</script>')
      expect(html).not.toContain('<script>window.titleBad = true</script>')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('bundles configured local Pyodide loader script', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-bundle-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.mkdirSync(path.join(tmpDir, 'pyodide'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.js'), 'globalThis.loadPyodide = function () {}\n')
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        model: {
          type: 'py',
          worker: false,
          pyodide: {
            url: 'pyodide/pyodide.js',
            indexURL: 'pyodide/'
          },
          code: '1 + 1'
        },
        outputs: [{ name: 'result', type: 'code' }]
      }, null, 2))

      const html = await gen(['schema.json', '--outputs', 'app.html', '--bundle'], true)
      expect(extractHiddenCode(html, 'pyodide/pyodide.js')).toBe('globalThis.loadPyodide = function () {}\n')
      expect(html).toContain('"indexURL":"pyodide/"')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('offline-strict bundle mode rejects remote Pyodide runtime dependencies', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-strict-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.writeFileSync(path.join(tmpDir, 'schema-default.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          code: 'result = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))
      await expect(gen(['--inputs', 'schema-default.json', '--outputs', 'app.html', '--bundle=offline-strict'], true))
        .rejects.toThrow(/requires explicit model\.pyodide/)

      fs.writeFileSync(path.join(tmpDir, 'schema-remote.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.js',
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v314.0.2/full/'
          },
          code: 'result = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))
      await expect(gen(['--inputs', 'schema-remote.json', '--outputs', 'app.html', '--bundle=offline-strict'], true))
        .rejects.toThrow(/Pyodide indexURL remains remote/)

      fs.mkdirSync(path.join(tmpDir, 'pyodide'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.js'), 'globalThis.loadPyodide = function () {}\n')
      fs.writeFileSync(path.join(tmpDir, 'schema-local-wrong-output-dir.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: 'pyodide/pyodide.js',
            indexURL: 'pyodide/'
          },
          code: 'result = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))
      await expect(gen(['--inputs', 'schema-local-wrong-output-dir.json', '--outputs', 'dist/app.html', '--bundle=offline-strict'], true))
        .rejects.toThrow(/relative to the generated HTML/)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('offline-strict bundle mode accepts explicit local Pyodide assets', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-strict-local-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.mkdirSync(path.join(tmpDir, 'pyodide'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.js'), 'globalThis.loadPyodide = function () {}\n')
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: 'pyodide/pyodide.js',
            indexURL: '../pyodide/'
          },
          code: 'result = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))

      const html = await gen(['--inputs', 'schema.json', '--outputs', 'dist/app.html', '--bundle=offline-strict'], true)
      expect(extractHiddenCode(html, 'pyodide/pyodide.js')).toBe('globalThis.loadPyodide = function () {}\n')
      expect(html).not.toContain('data-src="https://cdn.jsdelivr.net/pyodide/v0.24.1')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('pyodide bundle mode copies local Pyodide assets next to generated HTML', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-assets-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.mkdirSync(path.join(tmpDir, 'pyodide', 'packages'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.js'), 'globalThis.loadPyodide = function () {}\n')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.asm.wasm'), 'wasm')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'python_stdlib.zip'), 'stdlib')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'repodata.json'), '{"packages":{}}')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'packages', 'demo.whl'), 'wheel')
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: 'pyodide/pyodide.js',
            indexURL: 'pyodide/'
          },
          code: 'result = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))

      const html = await gen(['--inputs', 'schema.json', '--outputs', 'dist/app.html', '--bundle=pyodide'], true)

      expect(extractHiddenCode(html, 'pyodide/pyodide.js')).toBe('globalThis.loadPyodide = function () {}\n')
      expect(html).toContain('"url":"pyodide/pyodide.js"')
      expect(html).toContain('"indexURL":"pyodide/"')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'pyodide', 'pyodide.asm.wasm'), 'utf8')).toBe('wasm')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'pyodide', 'python_stdlib.zip'), 'utf8')).toBe('stdlib')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'pyodide', 'packages', 'demo.whl'), 'utf8')).toBe('wheel')

      const sameDirHtml = await gen(['--inputs', 'schema.json', '--outputs', 'app.html', '--bundle=pyodide'], true)
      expect(extractHiddenCode(sameDirHtml, 'pyodide/pyodide.js')).toBe('globalThis.loadPyodide = function () {}\n')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('pyodide bundle mode fetches remote Pyodide assets and declared packages', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-remote-assets-'))
    const originalCwd = process.cwd()
    const originalFetch = global.fetch
    const unique = `https://example.invalid/${Date.now()}-${Math.random().toString(16).slice(2)}/full/`
    const lockFile = {
      info: { platform: 'test' },
      packages: {
        numpy: {
          file_name: 'numpy-1.0.0.whl',
          depends: ['dep']
        },
        dep: {
          file_name: 'packages/dep-1.0.0.whl',
          depends: []
        }
      }
    }
    const files = new Map([
      [`${unique}pyodide.js`, 'globalThis.loadPyodide = function () {}\n'],
      [`${unique}pyodide.asm.mjs`, 'asm-js'],
      [`${unique}pyodide.asm.wasm`, 'wasm'],
      [`${unique}python_stdlib.zip`, 'stdlib'],
      [`${unique}pyodide-lock.json`, JSON.stringify(lockFile)],
      [`${unique}numpy-1.0.0.whl`, 'numpy-wheel'],
      [`${unique}packages/dep-1.0.0.whl`, 'dep-wheel']
    ])

    process.chdir(tmpDir)
    global.fetch = async url => {
      const key = String(url)
      if (!files.has(key)) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          arrayBuffer: async () => toArrayBuffer('')
        }
      }
      const body = files.get(key)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => toArrayBuffer(body),
        text: async () => String(body)
      }
    }

    try {
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: `${unique}pyodide.js`,
            indexURL: unique,
            packages: ['numpy']
          },
          imports: ['numpy'],
          code: 'import numpy\nresult = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))

      const html = await gen(['--inputs', 'schema.json', '--outputs', 'dist/app.html', '--bundle=pyodide'], true)

      expect(extractHiddenCode(html, 'full/pyodide.js')).toBe('globalThis.loadPyodide = function () {}\n')
      expect(html).toContain('"url":"full/pyodide.js"')
      expect(html).toContain('"indexURL":"full/"')
      expect(html).toContain('"packages":["numpy"]')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'full', 'pyodide.asm.mjs'), 'utf8')).toBe('asm-js')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'full', 'pyodide.asm.wasm'), 'utf8')).toBe('wasm')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'full', 'python_stdlib.zip'), 'utf8')).toBe('stdlib')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'full', 'pyodide-lock.json'), 'utf8')).toBe(JSON.stringify(lockFile))
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'full', 'numpy-1.0.0.whl'), 'utf8')).toBe('numpy-wheel')
      expect(fs.readFileSync(path.join(tmpDir, 'dist', 'full', 'packages', 'dep-1.0.0.whl'), 'utf8')).toBe('dep-wheel')
    } finally {
      global.fetch = originalFetch
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('pyodide single-file mode embeds remote Pyodide assets in hidden manifest', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-single-'))
    const originalCwd = process.cwd()
    const originalFetch = global.fetch
    const unique = `https://pyodide.example.test/full-${Date.now()}/`
    const lockFile = {
      info: { platform: 'probe' },
      packages: {
        numpy: {
          file_name: 'numpy-1.0.0.whl',
          depends: ['dep']
        },
        dep: {
          file_name: 'packages/dep-1.0.0.whl',
          depends: []
        }
      }
    }
    const files = new Map([
      [`${unique}pyodide.js`, 'globalThis.loadPyodide = function () {}\n'],
      [`${unique}pyodide.asm.mjs`, 'asm-js'],
      [`${unique}pyodide.asm.wasm`, 'wasm'],
      [`${unique}python_stdlib.zip`, 'stdlib'],
      [`${unique}pyodide-lock.json`, JSON.stringify(lockFile)],
      [`${unique}numpy-1.0.0.whl`, 'numpy-wheel'],
      [`${unique}packages/dep-1.0.0.whl`, 'dep-wheel']
    ])

    process.chdir(tmpDir)
    global.fetch = async url => {
      const key = String(url)
      if (!files.has(key)) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          arrayBuffer: async () => toArrayBuffer('')
        }
      }
      const body = files.get(key)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => toArrayBuffer(body),
        text: async () => String(body)
      }
    }

    try {
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: `${unique}pyodide.js`,
            indexURL: unique,
            packages: ['numpy']
          },
          imports: ['numpy'],
          code: 'import numpy\nresult = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))

      const html = await gen(['--inputs', 'schema.json', '--outputs', 'dist/app.html', '--bundle=pyodide-single'], true)
      const manifestMatch = html.match(/data-src="(jsee:pyodide-assets:[^"]+)"/)
      expect(manifestMatch).toBeTruthy()
      const manifest = JSON.parse(extractHiddenCode(html, manifestMatch[1]))

      expect(extractHiddenCode(html, `${unique}pyodide.js`)).toBe('globalThis.loadPyodide = function () {}\n')
      expect(html).toContain('"indexURL":"jsee-pyodide://')
      expect(html).toContain('"assets":{"type":"embedded","manifest":"')
      expect(manifest.baseURL).toMatch(/^jsee-pyodide:\/\/full-/)
      expect(Buffer.from(manifest.assets['pyodide.asm.wasm'].base64, 'base64').toString('utf8')).toBe('wasm')
      expect(Buffer.from(manifest.assets['python_stdlib.zip'].base64, 'base64').toString('utf8')).toBe('stdlib')
      expect(Buffer.from(manifest.assets['pyodide-lock.json'].base64, 'base64').toString('utf8')).toBe(JSON.stringify(lockFile))
      expect(Buffer.from(manifest.assets['numpy-1.0.0.whl'].base64, 'base64').toString('utf8')).toBe('numpy-wheel')
      expect(Buffer.from(manifest.assets['packages/dep-1.0.0.whl'].base64, 'base64').toString('utf8')).toBe('dep-wheel')
      expect(fs.existsSync(path.join(tmpDir, 'dist', 'full', 'pyodide.asm.wasm'))).toBe(false)
    } finally {
      global.fetch = originalFetch
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('pyodide single-file mode embeds local Pyodide directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-single-local-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.mkdirSync(path.join(tmpDir, 'pyodide', 'packages'), { recursive: true })
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.js'), 'globalThis.loadPyodide = function () {}\n')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.asm.js'), 'globalThis._createPyodideModule = function () {}\n')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide.asm.wasm'), 'wasm')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'python_stdlib.zip'), 'stdlib')
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'pyodide-lock.json'), JSON.stringify({
        info: { platform: 'probe' },
        packages: {
          demo: {
            file_name: 'packages/demo.whl',
            depends: []
          }
        }
      }))
      fs.writeFileSync(path.join(tmpDir, 'pyodide', 'packages', 'demo.whl'), 'wheel')
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          pyodide: {
            url: 'pyodide/pyodide.js',
            indexURL: 'pyodide/',
            packages: ['demo']
          },
          imports: ['demo'],
          code: 'import demo\nresult = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))

      const html = await gen(['--inputs', 'schema.json', '--outputs', 'dist/app.html', '--bundle=pyodide-single'], true)
      const manifestMatch = html.match(/data-src="(jsee:pyodide-assets:[^"]+)"/)
      expect(manifestMatch).toBeTruthy()
      const manifest = JSON.parse(extractHiddenCode(html, manifestMatch[1]))

      expect(extractHiddenCode(html, 'pyodide/pyodide.js')).toBe('globalThis.loadPyodide = function () {}\n')
      expect(Buffer.from(manifest.assets['pyodide.asm.js'].base64, 'base64').toString('utf8')).toBe('globalThis._createPyodideModule = function () {}\n')
      expect(Buffer.from(manifest.assets['packages/demo.whl'].base64, 'base64').toString('utf8')).toBe('wheel')
      expect(html).toContain('"indexURL":"jsee-pyodide://pyodide/"')
      expect(fs.existsSync(path.join(tmpDir, 'dist', 'pyodide', 'pyodide.asm.wasm'))).toBe(false)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('pyodide bundle mode requires explicit Pyodide assets', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-pyodide-assets-required-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.writeFileSync(path.join(tmpDir, 'schema-default.json'), JSON.stringify({
        model: {
          name: 'calc',
          type: 'py',
          code: 'result = 1'
        },
        outputs: [{ name: 'result', type: 'number' }]
      }, null, 2))
      await expect(gen(['--inputs', 'schema-default.json', '--outputs', 'app.html', '--bundle=pyodide'], true))
        .rejects.toThrow(/requires explicit model\.pyodide/)
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('resolves bundle modes without changing legacy bundle flags', () => {
    expect(resolveBundleMode(false)).toBe('none')
    expect(resolveBundleMode(true)).toBe('default')
    expect(resolveBundleMode('hybrid')).toBe('hybrid')
    expect(resolveBundleMode('pyodide')).toBe('pyodide')
    expect(resolveBundleMode('pyodide-single')).toBe('pyodide-single')
    expect(resolveBundleMode('offline-strict')).toBe('offline-strict')
    expect(resolveBundleMode('strict')).toBe('offline-strict')
    expect(resolveBundleMode('unexpected')).toBe('default')
    expect(isPyodideBundleMode('pyodide')).toBe(true)
    expect(isPyodideBundleMode('default')).toBe(false)
    expect(isPyodideSingleFileBundleMode('pyodide-single')).toBe(true)
    expect(isPyodideSingleFileBundleMode('pyodide')).toBe(false)
  })

  test('sanitizes Google Analytics IDs in generated metadata', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-ga-safe-'))
    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
        page: { ga: 'G-ABC_123' },
        model: { code: 'function demo () { return { y: 1 } }', worker: false },
        inputs: [],
        outputs: [{ name: 'y', type: 'number' }]
      }, null, 2))
      fs.writeFileSync(path.join(tmpDir, 'unsafe.json'), JSON.stringify({
        page: { ga: 'G-OK</script><script>window.bad=true</script>' },
        model: { code: 'function demo () { return { y: 1 } }', worker: false },
        inputs: [],
        outputs: [{ name: 'y', type: 'number' }]
      }, null, 2))

      const html = await gen(['--inputs', 'schema.json', '--outputs', path.join(tmpDir, 'ga.html')], true)
      const unsafeHtml = await gen(['--inputs', 'unsafe.json', '--outputs', path.join(tmpDir, 'unsafe-ga.html')], true)

      expect(sanitizeGoogleAnalyticsId('G-ABC_123')).toBe('G-ABC_123')
      expect(sanitizeGoogleAnalyticsId('G-ABC</script>')).toBe('')
      expect(html).toContain('googletagmanager.com')
      expect(html).toContain('G-ABC_123')
      expect(unsafeHtml).not.toContain('<script>window.bad=true</script>')
      expect(unsafeHtml).not.toContain('googletagmanager.com')
    } finally {
      process.chdir(originalCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('Node server streaming helpers', () => {
  test('closes a backpressured generator when the response disconnects', async () => {
    const { EventEmitter } = require('events')
    let finalized = false
    let advanced = false
    async function * chunks () {
      try {
        yield { first: 1 }
        advanced = true
        yield { second: 2 }
      } finally { finalized = true }
    }
    const res = Object.assign(new EventEmitter(), {
      writeHead () {},
      write () {
        setImmediate(() => { this.destroyed = true; this.emit('close') })
        return false
      },
      end: jest.fn()
    })
    let timer
    try {
      await Promise.race([writeSseStream(res, chunks()), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('waited for drain after disconnect')), 100)
      })])
      expect(finalized).toBe(true)
      expect(advanced).toBe(false)
      expect(res.listenerCount('drain')).toBe(0)
      expect(res.listenerCount('close')).toBe(0)
      expect(res.listenerCount('error')).toBe(0)
    } finally { clearTimeout(timer) }
  })

  test('reports generator errors in the stream with one completion sentinel', async () => {
    async function * chunks () { yield false; throw new Error('generator failed') }
    const body = []
    const res = { writeHead () {}, write (chunk) { body.push(chunk); return true }, end () {} }
    await writeSseStream(res, chunks())
    expect(body.join('')).toBe('data: {"result":false}\n\nevent: error\ndata: {"error":"generator failed"}\n\ndata: [DONE]\n\n')
  })

  test('detects generators without treating normal arrays as streams', () => {
    function * syncGenerator () {
      yield { count: 1 }
    }

    expect(isStreamResult(syncGenerator())).toBe(true)
    expect(isStreamResult((async function * () { yield 1 })())).toBe(true)
    expect(isStreamResult([{ count: 1 }])).toBe(false)
    expect(isStreamResult('abc')).toBe(false)
    expect(isStreamResult(Buffer.from('abc'))).toBe(false)
    expect(isStreamResult(new Uint8Array([1, 2]))).toBe(false)
    expect(isStreamResult(new Set([1, 2]))).toBe(false)
  })

  test('writes SSE frames with serialized result chunks', async () => {
    async function * chunks () {
      yield { count: 1 }
      yield 2
    }
    const res = {
      chunks: [],
      headers: null,
      statusCode: null,
      ended: false,
      writeHead (statusCode, headers) {
        this.statusCode = statusCode
        this.headers = headers
      },
      write (chunk) {
        this.chunks.push(chunk)
        return true
      },
      once () {},
      end () {
        this.ended = true
      }
    }

    await writeSseStream(res, chunks())
    const body = res.chunks.join('')

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toContain('text/event-stream')
    expect(body).toContain('data: {"count":1}')
    expect(body).toContain('data: {"result":2}')
    expect(body).toContain('data: [DONE]')
    expect(res.ended).toBe(true)
  })
})

describe('path containment', () => {
  let tmpDir
  let root

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-path-safe-'))
    root = path.join(tmpDir, 'app')
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, 'inside.txt'), 'inside')
    fs.writeFileSync(path.join(root, '.env'), 'secret')
    fs.writeFileSync(path.join(tmpDir, 'outside.txt'), 'outside')
    try {
      fs.symlinkSync(path.join(tmpDir, 'outside.txt'), path.join(root, 'outside-link.txt'))
    } catch (error) {
      // Symlink support is platform-dependent.
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('resolves files inside the app root', () => {
    expect(resolveInside(root, 'inside.txt')).toBe(path.join(root, 'inside.txt'))
  })

  test('denies traversal outside the app root', () => {
    expect(() => resolveInside(root, '../outside.txt')).toThrow(/outside app root/)
    expect(() => resolveInside(root, path.join(tmpDir, 'outside.txt'))).toThrow(/outside app root/)
  })

  test('denies dotfiles and symlinks escaping the root', () => {
    expect(() => resolveInside(root, '.env')).toThrow(/denied/)
    if (fs.existsSync(path.join(root, 'outside-link.txt'))) {
      expect(() => resolveInside(root, 'outside-link.txt')).toThrow(/outside app root/)
    }
  })
})

describe('pipeline characterization', () => {
  const model = code => ({ name: 'step', code, type: 'function' })
  test('accepts the single-model descriptor form without normalization by a caller', async () => {
    const schema = { inputs: [], model: model('function step () { return { value: 42 } }') }
    expect(await gen.runSchemaOnce(schema, {}, null, process.cwd(), () => {})).toEqual({ value: 42 })
  })
  test('merges records, passes undefined through, and stops before the next model', async () => {
    const schema = { inputs: [], model: [
      model('function step () { return { count: 1, flag: false } }'),
      model('function step () {}'),
      model('function step (data) { return { count: data.count + 1, stop: true } }'),
      model('function step () { throw new Error("unreachable") }')
    ] }
    expect(await gen.runSchemaOnce(schema, { seed: 4 }, null, process.cwd(), () => {}))
      .toEqual({ seed: 4, count: 2, flag: false, stop: true })
  })
  test.each(['null', 'false', '0', '[]', '[1, 2]'])('passes %s to the following model without object merging', async value => {
    const schema = { inputs: [], model: [model('function step () { return ' + value + ' }'), model('function step (data) { return { value: data } }')] }
    expect(await gen.runSchemaOnce(schema, {}, null, process.cwd(), () => {})).toEqual({ value: JSON.parse(value) })
  })
  test('a stop flag on initial data prevents the first model from running', async () => {
    const schema = { inputs: [], model: [model('function step () { throw new Error("unreachable") }')] }
    expect(await gen.runSchemaOnce(schema, { stop: true }, null, process.cwd(), () => {})).toEqual({ stop: true })
  })
})

describe('CLI schema version', () => {
  test('collects defaults from nested unnamed layout groups', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-group-defaults-'))
    const schemaPath = path.join(directory, 'schema.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      inputs: [{ type: 'group', elements: [{ type: 'group', elements: [{ name: 'x', type: 'int', default: 7 }] }] }]
    }))
    try {
      let result
      await captureStdout(async () => { result = await gen(['--inputs', schemaPath, '--run']) })
      expect(result).toEqual({ x: 7 })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  test('rejects an unsupported version before evaluating model code', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-schema-version-'))
    const schemaPath = path.join(directory, 'schema.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      schemaVersion: 2,
      model: { code: 'function model () { throw new Error("model was executed") }', name: 'model' },
      inputs: []
    }))
    try {
      await expect(gen(['--inputs', schemaPath, '--run'])).rejects.toThrow(/schemaVersion/)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('file-serving route policy equivalence', () => {
  let tmpDir
  let root
  let distFixture
  let server
  let port

  function request (url, value) {
    return new Promise((resolve, reject) => {
      const body = value === undefined ? null : JSON.stringify(value)
      const req = http.request({ hostname: '127.0.0.1', port, path: url,
        method: body === null ? 'GET' : 'POST',
        headers: body === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, res => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => { body += chunk })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      }).on('error', reject)
      req.end(body)
    })
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-route-policy-'))
    root = path.join(tmpDir, 'app')
    distFixture = fs.mkdtempSync(path.resolve(__dirname, '../../dist/c6-route-'))
    for (const directory of [root, distFixture]) {
      fs.mkdirSync(path.join(directory, 'node_modules'), { recursive: true })
      fs.mkdirSync(path.join(directory, 'nested'))
      fs.writeFileSync(path.join(directory, 'inside.txt'), 'inside')
      fs.writeFileSync(path.join(directory, '.env'), 'private')
      fs.writeFileSync(path.join(directory, 'node_modules', 'secret.txt'), 'private')
      fs.writeFileSync(path.join(tmpDir, 'outside.txt'), 'outside-canary')
      fs.symlinkSync(path.join(tmpDir, 'outside.txt'), path.join(directory, 'escape.txt'))
      fs.symlinkSync(path.join(directory, '.env'), path.join(directory, 'hidden-link.txt'))
      fs.symlinkSync(path.join(tmpDir, 'outside.txt'), path.join(directory, 'nested', 'index.html'))
    }
    const schemaPath = path.join(root, 'schema.json')
    fs.writeFileSync(schemaPath, JSON.stringify({
      model: { name: 'bounded', code: 'function bounded (data) { return { result: data.n * 2 } }' },
      inputs: [{ name: 'n', type: 'int', min: 1, max: 3 }]
    }))
    const express = require('express')
    // Capture the real application's server while letting the OS choose an isolated port.
    const listen = jest.spyOn(express.application, 'listen').mockImplementation(function () {
      server = http.createServer(this)
      return server.listen(0, '127.0.0.1')
    })
    try {
      await gen(['--inputs', schemaPath, '--serve', '--execute'])
      if (!server.listening) await new Promise(resolve => server.once('listening', resolve))
      port = server.address().port
    } finally {
      listen.mockRestore()
    }
  })

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve))
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    if (distFixture) fs.rmSync(distFixture, { recursive: true, force: true })
  })

  test.each([
    ['inside.txt', 200],
    ['escape.txt', 403],
    ['.env', 403],
    ['hidden-link.txt', 403],
    ['node_modules/secret.txt', 403],
    ['nested/index.html', 403],
    ['missing.txt', 404]
  ])('%s has equivalent access decisions on every file-serving route', async (relative, status) => {
    const responses = await Promise.all([
      request('/__jsee/file?path=' + encodeURIComponent(relative)),
      request('/' + relative),
      request('/dist/' + path.basename(distFixture) + '/' + relative)
    ])
    expect(responses.map(response => response.status)).toEqual([status, status, status])
    if (status === 200) expect(responses.map(response => response.body)).toEqual(['inside', 'inside', 'inside'])
    else responses.forEach(response => expect(response.body).not.toContain('outside-canary'))
  })

  test('encoded traversal and directory index cannot bypass containment', async () => {
    const responses = await Promise.all([
      request('/__jsee/file?path=../outside.txt'),
      request('/%2e%2e/outside.txt'),
      request('/nested/'),
      request('/dist/' + path.basename(distFixture) + '/nested/')
    ])
    expect(responses.map(response => response.status)).toEqual([403, 403, 403, 403])
  })

  test.each([[99], ['abc'], ['2'], [null], [1.5]])('rejects n=%p before calling the model', async n => {
    const response = await request('/bounded', { n })
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body).error).toContain('n')
  })

  test('rejects missing required inputs and accepts a valid bounded integer', async () => {
    const missing = await request('/bounded', {})
    expect(missing.status).toBe(400)
    const valid = await request('/bounded', { n: 2 })
    expect(valid.status).toBe(200)
    expect(JSON.parse(valid.body)).toEqual({ result: 4 })
  })
})

describe('URL helpers', () => {
  test('joins CDN URLs with URL semantics', () => {
    expect(joinUrl('https://cdn.example.com/pkg', 'models/model.js'))
      .toBe('https://cdn.example.com/pkg/models/model.js')
    expect(joinUrl('https://cdn.example.com/pkg/', './models/model.js'))
      .toBe('https://cdn.example.com/pkg/models/model.js')
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

  test.each(['commonjs', 'esm', 'implicit'])('keeps every requested entry from a shared %s source', async style => {
    fs.writeFileSync(path.join(tmpDir, 'helper.js'), 'module.exports = value => value + 1\n')
    const functions = 'function first(data) { return { value: data.value + 1 } }\nfunction second(data) { return { value: data.value * 2 } }\n'
    const source = style === 'commonjs' ? functions + 'module.exports = { first, second }\n'
      : style === 'esm' ? functions + 'export { first, second }\n'
        : 'const helper = require("./helper")\n' + functions
    fs.writeFileSync(path.join(tmpDir, 'model.js'), source)
    fs.writeFileSync(path.join(tmpDir, 'schema.json'), JSON.stringify({
      model: [{ name: 'first', url: 'model.js' }, { name: 'second', url: 'model.js' }],
      inputs: [{ name: 'value', type: 'int', default: 3 }]
    }))
    const html = await gen(['schema.json', '-o', 'app.html', '-f'], true)
    const code = extractHiddenCode(html, 'model.js')
    expect(runHiddenModel(code, 'first', { value: 3 })).toEqual({ value: 4 })
    expect(runHiddenModel(code, 'second', { value: 4 })).toEqual({ value: 8 })
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

  test('applies package browser aliases while bundling dependencies', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'browser-alias-demo',
      browser: {
        fs: false,
        path: './path-shim.js'
      }
    }, null, 2))
    fs.writeFileSync(path.join(tmpDir, 'path-shim.js'), 'exports.join = function () { return Array.prototype.join.call(arguments, "/") }\n')
    fs.writeFileSync(path.join(tmpDir, 'legacy.js'), `const fs = require('fs')
const path = require('path')
module.exports = function legacy () {
  return path.join('a', 'b') + ':' + typeof fs.readFileSync
}
`)
    const modelPath = path.join(tmpDir, 'model.js')
    const source = `const legacy = require('./legacy')
module.exports = function gen () {
  return { y: legacy() }
}
`
    fs.writeFileSync(modelPath, source)

    const code = await bundleModelCode({ name: 'gen', url: 'model.js' }, modelPath, source)

    expect(runHiddenModel(code, 'gen', {})).toEqual({ y: 'a/b:undefined' })
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
