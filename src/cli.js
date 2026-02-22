const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const minimist = require('minimist')
const jsdoc2md = require('jsdoc-to-markdown')
const showdown = require('showdown')
const showdownKatex = require('showdown-katex')
const converter = new showdown.Converter({
  extensions: [
    showdownKatex({
      throwOnError: true,
      displayMode: true,
      errorColor: '#1500ff',
      output: 'mathml'
    }),
  ],
  tables: true
})
showdown.setFlavor('github')

const { getModelFuncJS, sanitizeName, generateOpenAPISpec, serializeResult, parseMultipart, fileExtToOutputType } = require('./utils.js')

// left padding of multiple lines
function pad (str, len, start=0) {
  return str.split('\n').map((s, i) => i >= start ? ' '.repeat(len) + s : s).join('\n')
}

function depad (str, len) {
  return str.split('\n').map(s => s.slice(len)).join('\n')
}

function toArray (value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// Auto-detect CLI argument type: file path, number, JSON array/object, or string
function detectArgValue (value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return value
  // File on disk
  if (fs.existsSync(value) && fs.statSync(value).isFile()) return value
  // Number
  if (value !== '' && !isNaN(value)) return Number(value)
  // JSON array or object
  if (value.startsWith('[') || value.startsWith('{')) {
    try { return JSON.parse(value) } catch (e) { /* not JSON */ }
  }
  return value
}

function readDirListing (resolved, relative) {
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
  return entries
    .filter(e => e.isFile() && !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      path: path.posix.join(relative, e.name),
      size: fs.statSync(path.join(resolved, e.name)).size,
      type: fileExtToOutputType(e.name),
      selected: true
    }))
}

function generateIdentitySchema (target, cwd) {
  const resolved = path.isAbsolute(target) ? target : path.join(cwd, target)
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null

  if (stat && stat.isDirectory()) {
    const files = readDirListing(resolved, target)
    return {
      schema: {
        model: {
          name: 'identity',
          type: 'function',
          worker: false,
          autorun: true,
          code: `function identity(inputs) {
  var files = inputs.files || []
  var selected = files.filter(function (f) { return f.selected !== false })
  var stats = { files: selected.length, totalSize: selected.reduce(function (s, f) { return s + (f.size || 0) }, 0), types: {} }
  selected.forEach(function (f) { var t = f.type || 'unknown'; stats.types[t] = (stats.types[t] || 0) + 1 })
  return { stats: stats, preview: selected.length > 0 ? '/__jsee/file?path=' + encodeURIComponent(selected[0].path) : null }
}`
        },
        inputs: [{
          name: 'files',
          type: 'folder',
          default: files,
          disabled: true,
          reactive: true,
          select: true
        }],
        autorun: true
      },
      identity: true,
      serveDir: resolved
    }
  }

  if (stat && stat.isFile()) {
    const ext = path.extname(target).toLowerCase()
    if (ext === '.json' || ext === '.js') return null
    const outputType = fileExtToOutputType(target)
    return {
      schema: {
        inputs: [],
        outputs: [{ name: path.basename(target), type: outputType }],
        autorun: true
      },
      identity: true,
      serveFile: { path: target, resolved }
    }
  }

  return null
}

function collectFetchBundleBlocks (schema) {
  return []
    .concat(toArray(schema.model))
    .concat(toArray(schema.view))
    .concat(toArray(schema.render))
    .filter(Boolean)
}

function isHttpUrl (value) {
  return /^https?:\/\//i.test(value)
}

function toRuntimeUrl (value) {
  try {
    return (new URL(value)).href
  } catch (error) {
    return (new URL(value, 'https://cdn.jsdelivr.net/npm/')).href
  }
}

function isLocalJsImport (value) {
  if (typeof value !== 'string') return false
  const lower = value.toLowerCase()
  if (!lower.endsWith('.js') && !lower.includes('.js?')) return false
  if (isHttpUrl(value)) return false
  return value.startsWith('./') || value.startsWith('../') || value.startsWith('/') || value.startsWith('file://')
}

function isLocalCssImport (value) {
  if (typeof value !== 'string') return false
  const lower = value.toLowerCase()
  if (!lower.endsWith('.css') && !lower.includes('.css?')) return false
  if (isHttpUrl(value)) return false
  return value.startsWith('./') || value.startsWith('../') || value.startsWith('/') || value.startsWith('file://')
}

function getImportUrlValue (importValue) {
  if (typeof importValue === 'string') return importValue
  if (importValue && typeof importValue === 'object' && typeof importValue.url === 'string') {
    return importValue.url
  }
  return null
}

// Resolve an import path to a local file by checking candidate locations on disk.
// Returns the absolute file path if found, null otherwise.
// This replaces heuristic prefix detection (isLocalJsImport/isLocalCssImport) with
// a definitive filesystem check — no heuristic can reliably distinguish bare-relative
// local paths like "dist/core.js" from npm package subpaths like "chart.js/dist/chart.min.js".
function resolveLocalImportFile (importUrlValue, modelUrl, cwd) {
  if (!importUrlValue || typeof importUrlValue !== 'string') return null
  if (isHttpUrl(importUrlValue)) return null

  const modelDir = modelUrl && !isHttpUrl(modelUrl) ? path.dirname(modelUrl) : '.'
  const candidates = []

  if (importUrlValue.startsWith('./') || importUrlValue.startsWith('../')) {
    // Explicit relative: prefer model-relative (colocated helpers), fallback to cwd
    candidates.push(path.resolve(cwd, path.join(modelDir, importUrlValue)))
    candidates.push(path.resolve(cwd, importUrlValue))
  } else if (importUrlValue.startsWith('/')) {
    // Absolute from project root
    candidates.push(path.resolve(cwd, importUrlValue.slice(1)))
  } else {
    // Bare relative (dist/core.js): prefer cwd (schema-relative), fallback to model-relative
    candidates.push(path.resolve(cwd, importUrlValue))
    candidates.push(path.resolve(cwd, path.join(modelDir, importUrlValue)))
  }

  for (const fp of candidates) {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return fp
  }
  return null
}

function resolveFetchImport (importValue, modelUrl, cwd) {
  const importUrlValue = getImportUrlValue(importValue)
  if (!importUrlValue) return null
  const importIsObject = importValue && typeof importValue === 'object'

  const localFilePath = resolveLocalImportFile(importUrlValue, modelUrl, cwd)

  if (localFilePath) {
    // Keep the raw import string as the lookup key (importUrl) so that
    // data-src in the bundled HTML matches what the runtime's loadFromDOM
    // will look up before getUrl transforms the path.
    return {
      schemaImport: importUrlValue,
      schemaEntry: importIsObject ? { ...importValue, url: importUrlValue } : importUrlValue,
      importUrl: importUrlValue,
      localFilePath,
      remoteUrl: null
    }
  }

  // Remote: npm package or explicit HTTP URL
  const remoteUrl = isHttpUrl(importUrlValue)
    ? importUrlValue
    : `https://cdn.jsdelivr.net/npm/${importUrlValue}`
  return {
    schemaImport: importUrlValue,
    schemaEntry: importIsObject ? { ...importValue, url: importUrlValue } : importUrlValue,
    importUrl: toRuntimeUrl(importUrlValue),
    localFilePath: null,
    remoteUrl
  }
}

function resolveRuntimeMode (runtime, fetchEnabled, outputs) {
  const requestedRuntime = runtime || 'auto'
  const availableModes = ['auto', 'local', 'cdn', 'inline']
  if (!availableModes.includes(requestedRuntime)) {
    return requestedRuntime // custom URL/path passthrough
  }
  if (requestedRuntime !== 'auto') {
    return requestedRuntime
  }
  if (fetchEnabled) {
    return 'inline'
  }
  return outputs ? 'cdn' : 'local'
}

function resolveOutputPath (cwd, outputPath) {
  if (path.isAbsolute(outputPath)) {
    return outputPath
  }
  return path.join(cwd, outputPath)
}

const FULL_BUNDLE_TYPES = ['chart', '3d', 'map', 'pdf']

function needsFullBundle (schema) {
  const outputs = schema.outputs || []
  const check = (list) => list.some(o => {
    if (FULL_BUNDLE_TYPES.includes(o.type)) return true
    if (o.type === 'group' && o.elements) return check(o.elements)
    return false
  })
  return check(outputs)
}

function getBundleFilename (schema) {
  return needsFullBundle(schema) ? 'jsee.full.js' : 'jsee.core.js'
}

async function loadRuntimeCode (version, schema) {
  const bundle = schema ? getBundleFilename(schema) : 'jsee.core.js'
  if (version === 'dev' || version === 'latest') {
    const filePath = path.join(__dirname, '..', 'dist', bundle)
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8')
    }
    return fs.readFileSync(path.join(__dirname, '..', 'dist', 'jsee.core.js'), 'utf8')
  }
  const response = await fetch(`https://cdn.jsdelivr.net/npm/@jseeio/jsee@${version}/dist/${bundle}`)
  return response.text()
}

function getDataFromArgv (schema, argv, loadFiles=true) {
  let data = {}
  if (schema.inputs) {
    schema.inputs.forEach(inp => {
      const inputName = sanitizeName(inp.name)
      if (inputName in argv) {
        switch (inp.type) {
          case 'file':
            if (!loadFiles) {
              // If we don't want to load files, just set the value to the file path
              data[inp.name] = argv[inputName]
              break
            } else if (fs.existsSync(argv[inputName])) {
              data[inp.name] = fs.readFileSync(argv[inputName], 'utf8')
            } else {
              console.error(`File not found: ${argv[inputName]}`)
              process.exit(1)
            }
            break
          case 'folder':
            if (!loadFiles) {
              data[inp.name] = argv[inputName]
              break
            }
            const dirPath = argv[inputName]
            const resolved = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath)
            if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
              data[inp.name] = readDirListing(resolved, dirPath)
            }
            break
          case 'int':
            data[inp.name] = parseInt(argv[inputName], 10)
            break
          case 'float':
            data[inp.name] = parseFloat(argv[inputName])
            break
          case 'string':
          default:
            data[inp.name] = argv[inputName]
        }
      }
    })
  }
  return data
}

function genSchema (jsdocData) {
  let schema = {
    model: [],
    inputs: [],
    outputs: [],
  }
  for (let d of jsdocData) {
    const model = {
      name: d.name ? d.name : d.meta.filename.split('.')[0],
      description: d.description ? d.description : '',
      type: d.kind,
      container: 'args',
      url: path.relative(process.cwd(), path.join(d.meta.path, d.meta.filename)),
      worker: false
    }
    if (d.requires) {
      model.imports = d.requires.map(r => r.replace('module:', ''))
    }
    if (d.params) {
      // Check if all params have the same name before '.'
      const names = new Set(d.params.map(p => p.name.split('.')[0]))
      if ((d.params.length > 1) && (names.size === 1)) {
        // Object
        model.container = 'object'
        d.params.slice(1).forEach(p => {
          const inp = {
            name: p.name.split('.')[1],
            type: p.type.names[0],
            description: p.description,
          }
          if (p.defaultvalue) {
            inp.default = p.defaultvalue
          }
          schema.inputs.push(inp)
        })
      } else {
        // Array
        model.container = 'args'
        d.params.forEach(p => {
          const inp = {
            name: p.name,
            type: p.type.names[0],
            description: p.description,
          }
          if (p.defaultvalue) {
            inp.default = p.defaultvalue
          }
          schema.inputs.push(inp)
        })
      }
    }
    if (d.returns) {
      d.returns.forEach(r => {
        r.name = r.name ? r.name : r.description.split('-')[0].trim()
        r.description = r.description.split('-').slice(1).join('-').trim()
      })
      const names = new Set(d.returns.map(r => r.name.split('.')[0]))
      if ((d.returns.length > 1) && (names.size === 1)) {
        // Object
        d.returns.slice(1).forEach(p => {
          const out = {
            name: p.name.split('.')[1],
            type: p.type.names[0],
            description: p.description,
          }
          schema.outputs.push(out)
        })
      } else {
        // Array
        d.returns.forEach(p => {
          const out = {
            name: p.name,
            type: p.type.names[0],
            description: p.description,
          }
          schema.outputs.push(out)
        })
      }
    }
    if (d.customTags) {
      d.customTags.forEach(t => {
        if (t.tag === 'worker') {
          model.worker = true
        }
      })
    }
    schema.model.push(model)
  }
  return schema
}

function genHtmlFromSchema(schema) {
  let htmlDescription = '<br><div class="schema-description">';

  // Process the model section
  if (schema.model && schema.model.length > 0) {
    schema.model.forEach(model => {
      htmlDescription += `<h3><strong>${model.name}</strong></h3>`
      if (model.description) {
        htmlDescription += `<p>${model.description}</p>`
      }
    })
  }

  // Process the inputs section
  if (schema.inputs && schema.inputs.length > 0) {
    htmlDescription += '<h4>Inputs</h4><ul>';
    schema.inputs.forEach(input => {
      htmlDescription += `<li><strong>${input.name}</strong> (${input.type})`
      if (input.description) {
        htmlDescription += ` - ${input.description}`
      }
    })
    htmlDescription += '</ul>';
  }

  // Process the outputs section
  if (schema.outputs && schema.outputs.length > 0) {
    htmlDescription += '<h4>Outputs</h4><ul>';
    schema.outputs.forEach(output => {
      htmlDescription += `<li><strong>${output.name}</strong> (${output.type})`
      if (output.description) {
        htmlDescription += ` - ${output.description}`
      }
    })
    htmlDescription += '</ul>';
  }
  htmlDescription += '</div>';
  return htmlDescription;
}

function genMarkdownFromSchema(schema) {
  let markdownDescription = '';

  // Process the model section
  if (schema.model && schema.model.length > 0) {
    schema.model.forEach(model => {
      markdownDescription += `### **${model.name}**\n`;
      if (model.description) {
        markdownDescription += `${model.description}\n\n`;
      }
    });
  }

  // Process the inputs section
  if (schema.inputs && schema.inputs.length > 0) {
    markdownDescription += '#### Inputs\n';
    schema.inputs.forEach(input => {
      markdownDescription += `- **${input.name}** (${input.type})`;
      if (input.description) {
        markdownDescription += ` - ${input.description}`;
      }
      markdownDescription += '\n';
    });
  }

  // Process the outputs section
  if (schema.outputs && schema.outputs.length > 0) {
    markdownDescription += '#### Outputs\n';
    schema.outputs.forEach(output => {
      markdownDescription += `- **${output.name}** (${output.type})`;
      if (output.description) {
        markdownDescription += ` - ${output.description}`;
      }
      markdownDescription += '\n';
    });
  }

  return markdownDescription;
}

function template(schema, blocks) {
  let title = 'jsee'
  // let url = schema.page && schema.page.url ? schema.page.url : ''
  let url = ('page' in schema && 'url' in schema.page) ? schema.page.url : ''
  if (schema.title) {
    title = schema.title
  } else if (schema.page && schema.page.title) {
    title = schema.page.title
  } else if (schema.model) {
    if (Array.isArray(schema.model) && schema.model.length > 0) {
      title = schema.model[0].name
    } else if (!Array.isArray(schema.model)) {
      title = schema.model.name
    }
  }

  return `<!DOCTYPE html>

<!-- Generated by JSEE (https://jsee.org) -->
<!-- Do not edit this file directly. Edit the source files and run jsee to generate this file. -->
<!-- License: MIT (https://opensource.org/licenses/MIT) -->

<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${blocks.descriptionTxt}">

  <!-- Open Graph -->
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${blocks.descriptionTxt}" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="${title}" />
  <meta property="og:type" content="website" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${blocks.descriptionTxt}" />

  <!-- Structured Data -->
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","headline":"${title}","name":"${title}","url":"${url}", "description":"${blocks.descriptionTxt}"}</script>

  <!-- Canonical Link -->
  <link rel="canonical" href="${url}" />

  <!-- Favicon -->
  <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAD9/f0AAAAAAPj4+AAMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAAAAABERAAAAAAAAEREAAAAAAAAREQABERESABERAAETMzAAEREAARAAAAAREQABEAAAABERAAEQARAAEREAARABEAAREQABEAAAABERAAEQAAAAEREAAREREAAREQABEREQABERAAAAAAAAEREAAAAAAAAREQAAAAAAABHAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAA" rel="icon" type="image/x-icon" />

  <!-- Styles -->
  <style>
    /** Main */
    html { font-size: 16px; }
    body, h1, h2, h3, h4, h5, h6, p, blockquote, pre, hr, dl, dd, ol, ul, figure { margin: 0; padding: 0; }
    body { font: 400 16px/1.5 -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", "Segoe UI Symbol", "Segoe UI Emoji", "Apple Color Emoji", Roboto, Helvetica, Arial, sans-serif; color: #111111; background-color: #fdfdfd; -webkit-text-size-adjust: 100%; -webkit-font-feature-settings: "kern" 1; -moz-font-feature-settings: "kern" 1; -o-font-feature-settings: "kern" 1; font-feature-settings: "kern" 1; font-kerning: normal; display: flex; min-height: 100vh; flex-direction: column; overflow-wrap: break-word; }
    h1, h2, h3, h4, h5, h6, p, blockquote, pre, ul, ol, dl, figure, .highlight { margin-bottom: 15px; }
    hr { margin-top: 30px; margin-bottom: 30px; border: 0; border-top: 1px solid #ececec; }
    main { display: block; /* Default value of display of main element is 'inline' in IE 11. */ }
    img { max-width: 100%; vertical-align: middle; }
    figure > img { display: block; }
    figcaption { font-size: 14px; }
    ul, ol { margin-left: 30px; }
    li > ul, li > ol { margin-bottom: 0; }
    h1, h2, h3, h4, h5, h6 { font-weight: 400; }
    a { color: #2a7ae2; text-decoration: none; }
    a:visited { color: #1756a9; }
    a:hover { color: #111111; text-decoration: underline; }
    .social-media-list a:hover, .pagination a:hover { text-decoration: none; }
    .social-media-list a:hover .username, .pagination a:hover .username { text-decoration: underline; }
    blockquote { color: #828282; border-left: 4px solid #e8e8e8; padding-left: 15px; font-size: 1.125rem; font-style: italic; }
    blockquote > :last-child { margin-bottom: 0; }
    blockquote i, blockquote em { font-style: normal; }
    pre, code { font-family: "Menlo", "Inconsolata", "Consolas", "Roboto Mono", "Ubuntu Mono", "Liberation Mono", "Courier New", monospace; font-size: 0.9375em; border: 1px solid #e8e8e8; border-radius: 3px; background-color: #eeeeff; }
    code { padding: 1px 5px; }
    pre { padding: 8px 12px; overflow-x: auto; }
    pre > code { border: 0; padding-right: 0; padding-left: 0; }
    .wrapper { max-width: calc(800px - (30px)); margin-right: auto; margin-left: auto; padding-right: 15px; padding-left: 15px; }
    @media screen and (min-width: 800px) { .wrapper { max-width: calc(1024px - (30px * 2)); padding-right: 30px; padding-left: 30px; } }
    .wrapper:after { content: ""; display: table; clear: both; }
    .orange { color: #f66a0a; }
    .grey { color: #828282; }
    .svg-icon { width: 16px; height: 16px; display: inline-block; fill: currentColor; padding: 5px 3px 2px 5px; vertical-align: text-bottom; }
    table { margin-bottom: 30px; width: 100%; text-align: left; color: #3f3f3f; border-collapse: collapse; border: 1px solid #e8e8e8; }
    table tr:nth-child(even) { background-color: #f7f7f7; }
    table th, table td { padding: 10px 15px; }
    table th { background-color: #f0f0f0; border: 1px solid #e0e0e0; }
    table td { border: 1px solid #e8e8e8; }
    @media screen and (max-width: 800px) { table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; -ms-overflow-style: -ms-autohiding-scrollbar; } }
    .site-header { border-bottom: 1px solid #e8e8e8; min-height: 55.95px; line-height: 54px; position: relative; }
    .site-title { font-size: 1.625rem; font-weight: 800; letter-spacing: -1px; margin-bottom: 0; float: left; }
    @media screen and (max-width: 600px) { .site-title { padding-right: 45px; } }
    .site-title, .site-title:visited { color: #424242; }
    .site-nav { position: absolute; top: 9px; right: 15px; background-color: #fdfdfd; border: 1px solid #e8e8e8; border-radius: 5px; text-align: right; }
    .site-nav .nav-trigger { display: none; }
    .site-nav .menu-icon { float: right; width: 36px; height: 26px; line-height: 0; padding-top: 10px; text-align: center; }
    .site-nav .menu-icon > svg path { fill: #424242; }
    .site-nav label[for="nav-trigger"] { display: block; float: right; width: 36px; height: 36px; z-index: 2; cursor: pointer; }
    .site-nav input ~ .trigger { clear: both; display: none; }
    .site-nav input:checked ~ .trigger { display: block; padding-bottom: 5px; }
    .site-nav .page-link { color: #111111; line-height: 1.5; display: block; padding: 5px 10px; margin-left: 20px; }
    .site-nav .page-link:not(:last-child) { margin-right: 0; }
    @media screen and (min-width: 600px) { .site-nav { position: static; float: right; border: none; background-color: inherit; } .site-nav label[for="nav-trigger"] { display: none; } .site-nav .menu-icon { display: none; } .site-nav input ~ .trigger { display: block; } .site-nav .page-link { display: inline; padding: 0; margin-left: auto; } .site-nav .page-link:not(:last-child) { margin-right: 20px; } }
    .site-footer { border-top: 1px solid #e8e8e8; padding: 30px 0; }
    .footer-heading { font-size: 1.7rem; line-height: 1.7rem; font-weight: 200; margin-bottom: 5px;}
    .footer-heading a { color: #a2a2a2; text-decoration: none; }
    .footer-heading a:hover { color: #828282; }
    .footer-org p { font-size: 0.65rem; color: #828282; }
    .feed-subscribe .svg-icon { padding: 5px 5px 2px 0; }
    .contact-list, .social-media-list, .pagination { list-style: none; margin-left: 0; }
    .footer-col-wrapper, .social-links { font-size: 0.9375rem; color: #828282; }
    .footer-col { margin-bottom: 15px; }
    .footer-col-1, .footer-col-2 { width: calc(50% - (30px / 2)); }
    .footer-col-3 { width: calc(100% - (30px / 2)); }
    @media screen and (min-width: 800px) { .footer-col-1 { width: calc(35% - (30px / 2)); } .footer-col-2 { width: calc(20% - (30px / 2)); } .footer-col-3 { width: calc(45% - (30px / 2)); } }
    @media screen and (min-width: 600px) { .footer-col-wrapper { display: flex; } .footer-col { width: calc(100% - (30px / 2)); padding: 0 15px; } .footer-col:first-child { padding-right: 15px; padding-left: 0; } .footer-col:last-child { padding-right: 0; padding-left: 15px; } }
    /** Page content */
    .page-content { padding: 30px 0; flex: 1 0 auto; }
    .page-heading { font-size: 2rem; }
    .post-list-heading { font-size: 1.75rem; }
    .post-list { margin-left: 0; list-style: none; }
    .post-list > li { margin-bottom: 30px; }
    .post-meta { font-size: 14px; color: #828282; }
    .post-link { display: block; font-size: 1.5rem; }
    /** Posts */
    .post-header { margin-bottom: 30px; }
    .post-title, .post-content h1 { font-size: 2.625rem; letter-spacing: -1px; line-height: 1.15; }
    @media screen and (min-width: 800px) { .post-title, .post-content h1 { font-size: 2.625rem; } }
    .post-content { margin-bottom: 30px; }
    .post-content h1, .post-content h2, .post-content h3 { margin-top: 60px; }
    .post-content h4, .post-content h5, .post-content h6 { margin-top: 30px; }
    .post-content h2 { font-size: 1.75rem; }
    @media screen and (min-width: 800px) { .post-content h2 { font-size: 2rem; } }
    .post-content h3 { font-size: 1.375rem; }
    @media screen and (min-width: 800px) { .post-content h3 { font-size: 1.625rem; } }
    .post-content h4 { font-size: 1.25rem; }
    .post-content h5 { font-size: 1.125rem; }
    .post-content h6 { font-size: 1.0625rem; }
    .social-media-list, .pagination { display: table; margin: 0 auto; }
    .social-media-list li, .pagination li { float: left; margin: 5px 10px 5px 0; }
    .social-media-list li:last-of-type, .pagination li:last-of-type { margin-right: 0; }
    .social-media-list li a, .pagination li a { display: block; padding: 7.5px; border: 1px solid #e8e8e8; }
    .social-media-list li a:hover, .pagination li a:hover { border-color: #dbdbdb; }
    /** Pagination navbar */
    .pagination { margin-bottom: 30px; }
    .pagination li a, .pagination li div { min-width: 41px; text-align: center; box-sizing: border-box; }
    .pagination li div { display: block; padding: 7.5px; border: 1px solid transparent; }
    .pagination li div.pager-edge { color: #e8e8e8; border: 1px dashed; }
    /** Grid helpers */
    @media screen and (min-width: 800px) { .one-half { width: calc(50% - (30px / 2)); } }
    /** Jsee elements */
    .app-container { background-color: #F0F1F4; border-bottom: 1px solid #e8e8e8; padding-bottom: 55px }
    #save-html-btn:hover { background-color: #f0f0f0 !important; }
    .schema-description { background-color: #f8f8fa; padding: 20px; margin-top: 20px; border-radius: 10px; border: 1px solid #e8e8e8; }
    .schema-description h2, .schema-description h3, .schema-description h4 { margin-top: 10px; }
    /** Logos */
    .logo_footer { margin-left: -3px; }
    .logo_footer svg { opacity: 0.35; }
    .logo_footer:hover svg { opacity: 1; }
    .social-links { display: flex; justify-content: right; }
    .social-links .social-media-list, .social-links .pagination { margin: 0; }
  </style>
  <link type="application/atom+xml" rel="alternate" href="/feed.xml" title="hashr" />
  ${blocks.gaHtml}
</head>
<body>
  ${blocks.hiddenElementHtml}
  ${blocks.serveBarHtml}
  <header class="site-header">
    <div class="wrapper">
      <span class="site-title">${title}</span>
    </div>
  </header>
  <div class="page-content app-container">
    <div class="wrapper">
      <div id="jsee-container"></div>
    </div>
  </div>
  <main class="page-content" aria-label="Content">
    <div class="wrapper">
      <article class="post">
        <div class="post-content">
          ${blocks.descriptionHtml}
        </div>
      </article>
    </div>
  </main>
  <footer class="site-footer h-card">
    <data class="u-url" href="/"></data>
    <div class="wrapper">
      <div class="footer-col-wrapper">
        <div class="footer-col">
          ${blocks.orgHtml}
        </div>
        <div class="footer-col">
          <div class="social-links">
            <ul class="social-media-list">
              ${blocks.socialHtml}
            </ul>
          </div>
        </div>
      </div>
    </div>
  </footer>
  ${blocks.jseeHtml}
  <script>
    ${blocks.schemaScript}
    var currentSchema = schemaServer || schemaClient
    var container = document.getElementById('jsee-container')
    var env = new JSEE({
      container: container,
      schema: currentSchema
    })
    var toggle = document.getElementById('exec-toggle')
    if (toggle) {
      toggle.addEventListener('change', function () {
        env.destroy()
        currentSchema = this.checked ? schemaClient : schemaServer
        env = new JSEE({ container: container, schema: currentSchema })
      })
    }
    var saveBtn = document.getElementById('save-html-btn')
    if (saveBtn) {
      saveBtn.addEventListener('click', function () { env.download("${title}") })
    }
  </script>
</body>
</html>`
}

async function gen (pargv, returnHtml=false) {
  // Determine if JSEE CLI is imported or run directly
  const imported = path.dirname(__dirname) !== path.dirname(require.main.path)

  // First pass over CLI arguments
  // JSEE-level args
  const argvAlias = {
    inputs: 'i',
    outputs: 'o',
    description: 'd',
    port: 'p',
    version: 'v',
    fetch: 'f',
    execute: 'e',
    cdn: 'c',
    runtime: 'r',
  }
  const argvDefault = {
    execute: 'auto', // execute the model code on the server (auto = server-side when serving local .js models)
    fetch: false, // fetch the JSEE runtime from the CDN or local server
    inputs: 'schema.json', // default input is schema.json in the current working directory
    port: 3000, // default port for the server
    version: 'latest', // default version of JSEE runtime to use
    verbose: false, // verbose mode
    cdn: false,
    runtime: 'auto'
  }
  let argv = minimist(pargv, {
    alias: argvAlias,
    default: argvDefault,
    boolean: ['help', 'h', 'html', 'client'],
  })

  // ── jsee init <template> ──────────────────────────────────────────
  if (argv._[0] === 'init') {
    const tpl = argv._[1] || 'minimal'
    const cwd = process.cwd()

    if (argv.html) {
      // Single index.html with inline schema + CDN script
      const dest = path.join(cwd, 'index.html')
      if (fs.existsSync(dest)) {
        console.log('index.html already exists, skipping')
        return
      }
      let htmlContent
      if (tpl === 'chat') {
        htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chat</title>
</head>
<body>
  <div id="jsee-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
  <script>
    new JSEE({
      container: document.getElementById('jsee-container'),
      schema: {
        model: { code: function chat(message, history) { return { chat: 'You said: ' + message } }, worker: false },
        inputs: [{ name: 'message', type: 'string', enter: true }],
        outputs: [{ name: 'chat', type: 'chat' }]
      }
    })
  </script>
</body>
</html>`
      } else {
        htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My App</title>
</head>
<body>
  <div id="jsee-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
  <script>
    new JSEE({
      container: document.getElementById('jsee-container'),
      schema: {
        model: { code: function greet(name, count) { return { greeting: (name + '\\n').repeat(count) } }, worker: false },
        inputs: [
          { name: 'name', type: 'string', default: 'World' },
          { name: 'count', type: 'slider', min: 1, max: 10, default: 3 }
        ],
        outputs: [{ name: 'greeting', type: 'code' }]
      }
    })
  </script>
</body>
</html>`
      }
      fs.writeFileSync(dest, htmlContent)
      console.log('Created index.html')
      return
    }

    // Multi-file scaffolding
    const files = {}
    if (tpl === 'chat') {
      files['schema.json'] = JSON.stringify({
        model: { url: 'model.js', name: 'chat', worker: false },
        inputs: [{ name: 'message', type: 'string', enter: true }],
        outputs: [{ name: 'chat', type: 'chat' }]
      }, null, 2) + '\n'
      files['model.js'] = `function chat(message, history) {
  return { chat: 'You said: ' + message }
}
`
      files['README.md'] = `# Chat

A chat app built with [JSEE](https://jsee.org).

## Run

\`\`\`bash
npx @jseeio/jsee schema.json
\`\`\`
`
    } else {
      // minimal (default)
      files['schema.json'] = JSON.stringify({
        model: { url: 'model.js', name: 'greet' },
        inputs: [
          { name: 'name', type: 'string', default: 'World' },
          { name: 'count', type: 'slider', min: 1, max: 10, default: 3 }
        ],
        outputs: [{ name: 'greeting', type: 'code' }]
      }, null, 2) + '\n'
      files['model.js'] = `function greet(name, count) {
  return { greeting: (name + '\\n').repeat(count) }
}
`
      files['README.md'] = `# My App

A web app built with [JSEE](https://jsee.org).

## Run

\`\`\`bash
npx @jseeio/jsee schema.json
\`\`\`
`
    }

    let created = 0
    for (const [filename, content] of Object.entries(files)) {
      const dest = path.join(cwd, filename)
      if (fs.existsSync(dest)) {
        console.log(`${filename} already exists, skipping`)
      } else {
        fs.writeFileSync(dest, content)
        console.log(`Created ${filename}`)
        created++
      }
    }
    if (created === 0) {
      console.log('All files already exist, nothing to do')
    }
    return
  }

  if (argv.help || argv.h) {
    console.log(`
Usage: jsee [schema.json] [data...] [options]
       jsee init [template] [--html]

Commands:
  init [template]           Scaffold a new JSEE project (templates: minimal, chat)
    --html                  Generate a single index.html instead of separate files

Options:
  -i, --inputs <file>       Input schema file (default: schema.json)
  -o, --outputs <file>      Output HTML file path
  -d, --description <file>  Markdown description file to include
  -p, --port <number>       Dev server port (default: 3000)
  -v, --version <version>   JSEE runtime version (default: latest)
  -f, --fetch               Fetch and bundle runtime + dependencies into output
  -e, --execute             Execute model server-side (auto-enabled when serving local .js models)
      --client              Force client-side execution (disable auto server-side)
  -c, --cdn <url|bool>      Rewrite model URLs for CDN deployment
  -r, --runtime <mode>      Runtime: auto|local|cdn|inline or a custom URL/path (default: auto)
      --verbose             Enable verbose logging

Data inputs:
  Positional args after the schema file are mapped to schema inputs in order.
  Named args (--name=value) are matched to schema inputs by name.
  Values are auto-detected: numbers, JSON arrays/objects, file paths, or strings.
  Inputs set from the CLI are locked (non-editable) in the GUI.

Examples:
  jsee init                         Scaffold minimal project (schema.json + model.js)
  jsee init chat                    Scaffold chat project
  jsee init --html                  Generate single index.html
  jsee schema.json                  Start dev server with schema
  jsee schema.json 42 hello         Pass positional data to first two inputs
  jsee schema.json --a=100 --b=200  Pass named data inputs
  jsee schema.json data.csv         Pass a file path as input
  jsee schema.json -o app.html      Generate static HTML file
  jsee schema.json -o app.html -f   Generate self-contained HTML with bundled runtime
  jsee -p 8080                      Start dev server on port 8080
  jsee report.pdf                   Serve a PDF file (auto-detected viewer)
  jsee data/                        Serve a folder (file browser with preview)

Documentation: https://jsee.org
    `.trim())
    return
  }

  // Check if first positional arg is a file or directory for identity serving
  let identityResult = null
  if (!imported && argv._.length > 0) {
    identityResult = generateIdentitySchema(argv._[0], process.cwd())
  }

  // Set argv.inputs to the first positional argument if it looks like a schema/script
  if (!identityResult && !imported && argv._.length > 0 && argv.inputs === argvDefault.inputs) {
    argv.inputs = argv._[0]
  }

  function log (...args) {
    if (argv.verbose) {
      console.log('[JSEE CLI]', ...args)
    }
  }

  log('Imported:', imported)
  log('Current working directory:', process.cwd())
  log('Script location:', __dirname)
  log('Script file:', __filename)
  log('Require location:', require.main.path)
  log('Require file:', require.main.filename)

  let cwd = process.cwd()
  let inputs = argv.inputs
  let outputs = argv.outputs
  let description = argv.description
  let schema
  let schemaPath
  let descriptionTxt = ''
  let descriptionHtml = ''
  let jsdocMarkdown = ''
  let modelFuncs = {}

  // Determine the inputs and outputs
  // if inputs is a string with js file names, split it into an array
  if (typeof inputs === 'string') {
    if (inputs.includes('.js')) {
      inputs = inputs.split(',')
    }
  }

  // if outputs is a string with js file names, split it into an array
  if (typeof outputs === 'string') {
    outputs = outputs.split(',')
  }

  if (identityResult) {
    schema = identityResult.schema
    schemaPath = null
    log('Identity mode:', identityResult.serveFile ? 'file' : 'folder')
    if (identityResult.serveFile) {
      const outputType = schema.outputs[0].type
      const textTypes = ['table', 'markdown', 'html', 'object', 'code']
      if (textTypes.includes(outputType)) {
        schema.outputs[0].value = fs.readFileSync(identityResult.serveFile.resolved, 'utf8')
      } else {
        schema.outputs[0].value = identityResult.serveFile.path
      }
    }
  } else if (inputs.length === 0) {
    console.error('No inputs provided')
    process.exit(1)
  } else if ((inputs.length === 1) && (inputs[0].includes('.json'))) {
    // Input is json schema
    // Curren working directory if not provided
    // schema = require(path.join(cwd, inputs[0]))
    // switch to fs.readFileSync to reload the schema if it changes
    schemaPath = inputs[0].startsWith('/') ? inputs[0] : path.join(cwd, inputs[0])
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  } else {
    // Array of js files
    // Generate schema
    let jsdocData = jsdoc2md.getTemplateDataSync({ files: inputs.map(f => path.join(cwd, f)) })
    schema = genSchema(jsdocData)
    // jsdocMarkdown = jsdoc2md.renderSync({
    //   data: jsdocData,
    //   'param-list-format': 'list',
    // })
  }
  log('Schema path:', schemaPath)

  // Second pass over CLI arguments
  // Iterate over schema inputs and update argv aliases
  if (schema.inputs) {
    schema.inputs.forEach((inp, inp_index) => {
      if (inp.name) {
        const inputName = sanitizeName(inp.name)
        if (inp.alias) {
          argvAlias[inputName] = inp.alias
        }
        // Use positional arguments as schema input defaults
        if (imported && argv._.length > inp_index) {
          log('Using positional argument for input:', inputName, argv._[inp_index])
          argvDefault[inputName] = detectArgValue(argv._[inp_index])
        } else if (!imported && argv._.length > inp_index + 1) {
          // Skip first positional arg (schema file), map rest to inputs
          const val = argv._[inp_index + 1]
          log('Using positional argument for input:', inputName, val)
          argvDefault[inputName] = detectArgValue(val)
        }
        // We don't need to duplicate defaults here, as we handle them on the frontend
        // else if (inp.default) {
        //   argvDefault[inputName] = inp.default
        // }
      }
    })
  }
  // Update argv with the new aliases and defaults
  argv = minimist(pargv, {
    alias: argvAlias,
    default: argvDefault,
  })

  // Now deactivate the inputs present in argv
  // If you set parameter on the command line, it should not be editable in the GUI
  // E.g. file selected
  const dataFromArgvWithoutFileLoading = getDataFromArgv(schema, argv, false)
  log('Data from argv without file loading:', dataFromArgvWithoutFileLoading)
  if (schema.inputs) {
    schema.inputs.forEach(inp => {
      // Here data contains unsanitized input names
      if (inp.name in dataFromArgvWithoutFileLoading) {
        inp.default = dataFromArgvWithoutFileLoading[inp.name]
        inp.disabled = true // Deactivate the input if it's present in argv
      }
    })
  }
  log('Argv:', argv)

  // Initially in argv.fetch branch
  // Check if schema has model, convert to array if needed
  if (!schema.model) {
    // console.error('No model found in schema')
    // process.exit(1)
    // It's still valid schema, can be only render function or vis of inputs/outputs
    schema.model = [] 
  }
  if (!Array.isArray(schema.model)) {
    schema.model = [schema.model]
  }

  // Resolve server-side execution mode
  const hasOutputs = Array.isArray(outputs) ? outputs.length > 0 : Boolean(outputs)
  let shouldExecute = argv.execute
  if (shouldExecute === 'auto') {
    const isServing = !hasOutputs
    if (argv.client) {
      shouldExecute = false
    } else if (isServing) {
      shouldExecute = schema.model.every(m =>
        m.url && m.url.endsWith('.js') && !isHttpUrl(m.url))
    } else {
      shouldExecute = false
    }
  } else {
    shouldExecute = Boolean(shouldExecute)
  }

  // Store original models before execute/CDN mutations (for client-side toggle)
  const originalModels = JSON.parse(JSON.stringify(schema.model))

  // Server-side execution
  // Prepare the model functions to run on the server side
  // Schema model will be updated with the server url and POST method
  if (shouldExecute) {
    await Promise.all(schema.model.map(async m => {
      log('Preparing a model to run on the server side:', m.name, m.url)
      const target = require(path.join(schemaPath ? path.dirname(schemaPath) : cwd, m.url))
      modelFuncs[m.name] = await getModelFuncJS(m, target, {log})
      m.type = 'post'
      m.url = `/${m.name}`
      m.worker = false
    }))
  }
  
  // Switch to CDN for model files
  if (argv.cdn) {
    let cdn = ''
    console.log(argv)
    if (typeof argv.cdn === 'string') {
      cdn = argv.cdn
    } else if (typeof argv.cdn === 'boolean') {
      // Check package.json in cwd
      const packageJsonPath = path.join(cwd, 'package.json')
      if (fs.existsSync(packageJsonPath)) {
        const target = require(packageJsonPath)
        const packageName = target.name
        cdn = `https://cdn.jsdelivr.net/npm/${packageName}@${target.version}/`
      } else {
        console.error(`No package.json found: ${packageJsonPath}`)
        process.exit(1)
      }
    } else {
      console.error('Invalid CDN argument. Use --cdn <url> or --cdn true to use package.json version.')
      process.exit(1)
    }
    log('Using CDN for model files:', cdn)
    schema.model.forEach(m => {
      if (m.url) {
        // If url is relative, make it absolute
        if (!m.url.startsWith('http')) {
          m.url = path.join(cdn, m.url)
          log(`Updated ${m.name} model URL to: ${m.url}`)
        }
      }
    })
  }

  log('Schema:', schema)

  // Generate description block
  if (description) {
    const descriptionMd = fs.readFileSync(path.join(cwd, description), 'utf8')
    descriptionHtml = converter.makeHtml(descriptionMd)

    if (descriptionMd.includes('---')) {
      descriptionTxt = descriptionMd
        .split('---')[0]
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/#/g, '')
        .replace(/\*/g, '')
        .trim()
    }
  }
  descriptionHtml += genHtmlFromSchema(schema)

  // Generate jsee code
  let jseeHtml = ''
  let hiddenElementHtml = ''
  const runtimeMode = resolveRuntimeMode(argv.runtime, argv.fetch, hasOutputs)
  if (argv.fetch) {
    // Fetch jsee code from the CDN or local server
    const jseeCode = await loadRuntimeCode(argv.version, schema)
    jseeHtml = `<script>${jseeCode}</script>`
    // Fetch model files and store them in hidden elements
    hiddenElementHtml += '<div id="hidden-storage" style="display: none;">'

    const bundleBlocks = collectFetchBundleBlocks(schema)
    for (let m of bundleBlocks) {
      if (m.type === 'get' || m.type === 'post') {
        continue
      }
      if (m.url) {
        // Fetch model from the local file system (remote URLs not yet supported here)
        const modelCode = fs.readFileSync(path.join(cwd, m.url), 'utf8')
        hiddenElementHtml += `<script type="text/plain" style="display: none;" data-src="${m.url}">${modelCode}</script>`
      }
      const imports = toArray(m.imports)
      if (imports.length) {
        m.imports = imports
        for (let [index, i] of imports.entries()) {
          if (typeof i !== 'string') {
            continue
          }
          const importMeta = resolveFetchImport(i, m.url, cwd)
          if (!importMeta) {
            continue
          }
          m.imports[index] = importMeta.schemaEntry

          let importCode
          if (importMeta.localFilePath) {
            importCode = fs.readFileSync(importMeta.localFilePath, 'utf8')
          } else {
            // Create cache directory if it doesn't exist
            const cacheDir = path.join(os.homedir(), '.cache', 'jsee')
            fs.mkdirSync(cacheDir, { recursive: true })

            // Create a hash of the importUrl
            const hash = crypto.createHash('sha256').update(importMeta.importUrl).digest('hex')
            const cacheFilePath = path.join(cacheDir, `${hash}.js`)

            let useCache = false

            // Check if cache file exists and is less than 1 day old
            if (fs.existsSync(cacheFilePath)) {
              const stats = fs.statSync(cacheFilePath)
              const mtime = new Date(stats.mtime)
              const now = new Date()
              const ageInDays = (now - mtime) / (1000 * 60 * 60 * 24)

              if (ageInDays < 1) {
                log('Using cached import:', importMeta.importUrl)
                importCode = fs.readFileSync(cacheFilePath, 'utf8')
                useCache = true
              }
            }

            if (!useCache) {
              const response = await fetch(importMeta.remoteUrl)
              if (!response.ok) {
                console.error(`Failed to fetch ${importMeta.remoteUrl}: ${response.statusText}`)
                process.exit(1)
              }
              importCode = await response.text()
              fs.writeFileSync(cacheFilePath, importCode, 'utf8')
              log('Fetched and stored to cache:', importMeta.importUrl)
            }
          }
          hiddenElementHtml += `<script type="text/plain" style="display: none;" data-src="${importMeta.importUrl}">${importCode}</script>`
        }
      }
    }
    hiddenElementHtml += '</div>'
  } else {
    if (runtimeMode === 'inline') {
      const jseeCode = await loadRuntimeCode(argv.version, schema)
      jseeHtml = `<script>${jseeCode}</script>`
    } else if (runtimeMode === 'cdn') {
      const bundle = getBundleFilename(schema)
      jseeHtml = `<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@${argv.version}/dist/${bundle}"></script>`
    } else if (runtimeMode === 'local') {
      const bundle = getBundleFilename(schema)
      jseeHtml = `<script src="http://localhost:${argv.port}/dist/${bundle}"></script>`
    } else {
      // Custom path/URL passed via --runtime (e.g. ./node_modules/.../jsee.js)
      jseeHtml = `<script src="${runtimeMode}"></script>`
    }
  }

  let socialHtml = ''
  let gaHtml = ''
  let orgHtml = ''

  if (schema.page) {
    if (schema.page.ga) {
      gaHtml = `
        <script id="ga-src" async src="https://www.googletagmanager.com/gtag/js?id=${schema.page.ga}"></script>
        <script id="ga-body">
          window['ga-disable-${schema.page.ga}'] = window.doNotTrack === "1" || navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || navigator.msDoNotTrack === "1";
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${schema.page.ga}');
        </script>
      `
    }

    // Social media links
    if (schema.page.social) {
      // iterate over dict with k, v pairs
      for (let [name, url] of Object.entries(schema.page.social)) {
        switch (name) {
          case 'twitter':
            socialHtml += `<li><a rel="me" href="https://twitter.com/${url}">Twitter</a></li>`
            break
          case 'github':
            socialHtml += `<li><a rel="me" href="https://github.com/${url}">GitHub</a></li>`
            break
          case 'facebook':
            socialHtml += `<li><a rel="me" href="https://www.facebook.com/${url}">Facebook</a></li>`
            break
          case 'linkedin':
            socialHtml += `<li><a rel="me" href="https://www.linkedin.com/company/${url}">LinkedIn</a></li>`
            break
          case 'instagram':
            socialHtml += `<li><a rel="me" href="https://www.instagram.com/${url}">Instagram</a></li>`
            break
          case 'youtube':
            socialHtml += `<li><a rel="me" href="https://www.youtube.com/${url}">YouTube</a></li>`
            break
          default:
            socialHtml += `<li><a rel="me" href="${url}">${name}</a></li>`
        }
      }
    }

    if (schema.page.org) {
      orgHtml = `<div class="footer-org"><h4 class="footer-heading"><a href="${schema.page.org.url}">${schema.page.org.name}</a></h4>`
      if (schema.page.org.description) {
        orgHtml += `<p>${schema.page.org.description}</p>`
      }
      orgHtml += '</div>'
    }

  }

  // Build serve bar (only when serving, not for -o output)
  let serveBarHtml = ''
  let schemaScript = ''
  const isServing = !hasOutputs
  if (isServing) {
    const toggleHtml = shouldExecute
      ? '<label style="cursor:pointer"><input type="checkbox" id="exec-toggle" style="margin-right:4px">Browser</label>'
      : ''
    serveBarHtml = `<div id="jsee-serve-bar" style="background:#f8f8f8;border-bottom:1px solid #e0e0e0;padding:6px 15px;font-size:13px;color:#828282;display:flex;align-items:center;gap:16px">
      <span style="font-family:monospace">localhost:${argv.port}</span>
      <span style="flex:1"></span>
      ${toggleHtml}
      <button id="save-html-btn" style="background:none;border:1px solid #ddd;border-radius:3px;padding:3px 10px;font-size:12px;color:#555;cursor:pointer" title="Save as self-contained HTML file">Save HTML</button>
    </div>`
  }
  if (shouldExecute) {
    const clientSchema = JSON.parse(JSON.stringify(schema))
    clientSchema.model = originalModels
    schemaScript = `var schemaServer = ${JSON.stringify(schema, null, 2)}\n    var schemaClient = ${JSON.stringify(clientSchema, null, 2)}`
  } else {
    schemaScript = `var schemaServer = ${JSON.stringify(schema, null, 2)}\n    var schemaClient = null`
  }

  const html = template(schema, {
    descriptionHtml: pad(descriptionHtml, 8, 1),
    descriptionTxt: descriptionTxt,
    gaHtml: pad(gaHtml, 2, 1),
    jseeHtml: jseeHtml,
    hiddenElementHtml: hiddenElementHtml,
    socialHtml: pad(socialHtml, 2, 1),
    orgHtml: pad(orgHtml, 2, 1),
    serveBarHtml: serveBarHtml,
    schemaScript: schemaScript,
  })

  if (returnHtml) {
    // Return the html as a string
    return html
  } else if (outputs) {
    // Store the html in the output file
    for (let o of outputs) {
      if (o === 'stdout') {
        log(html)
      } else if (o.includes('.html')) {
        fs.writeFileSync(resolveOutputPath(cwd, o), html)
      } else if (o.includes('.json')) {
        fs.writeFileSync(resolveOutputPath(cwd, o), JSON.stringify(schema, null, 2))
      } else if (o.includes('.md')) {
        fs.writeFileSync(resolveOutputPath(cwd, o), genMarkdownFromSchema(schema))
      } else {
        console.error('Invalid output file:', o)
      }
    }
  } else {
    // Serve the html
    const express = require('express')
    const app = express()
    app.use(express.json())
    app.use(express.raw({ type: 'multipart/form-data', limit: '50mb' }))
    // CORS
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      next()
    })
    // API discovery
    app.get('/api', (req, res) => {
      const models = schema.model.map(m => ({
        name: m.name,
        endpoint: m.url || '/' + m.name,
        method: 'POST'
      }))
      res.json({ schema, models })
    })
    // OpenAPI spec
    app.get('/api/openapi.json', (req, res) => {
      res.json(generateOpenAPISpec(schema))
    })
    if (shouldExecute) {
      // Create post endpoint for executing the model
      schema.model.forEach(m => {
        app.post(m.url, async (req, res) => {
          log(`Executing model: ${m.name}`)
          if (m.name in modelFuncs) {
            const modelFunc = modelFuncs[m.name]
            try {
              const dataFromArgv = getDataFromArgv(schema, argv)
              const contentType = req.headers['content-type'] || ''
              let dataFromGUI = req.body
              if (contentType.includes('multipart/form-data') && Buffer.isBuffer(req.body)) {
                dataFromGUI = parseMultipart(contentType, req.body)
              }
              const data = { ...dataFromGUI, ...dataFromArgv }
              log('Data for model execution:', data)
              const result = await modelFunc(data)
              res.json(serializeResult(result))
              log(`Model ${m.name} executed successfully: `, result)
            } catch (error) {
              console.error('Error executing model:', error)
              res.status(500).json({ error: error.message })
            }
          } else {
            res.status(404).json({ error: 'Unknown model: ' + m.name })
          }
        })
        log('Model execution endpoints created:', m.url)
      })
    }
    // Serve folder file listing as JSON
    app.get('/__jsee/folder', (req, res) => {
      const dirPath = req.query.path
      if (!dirPath) return res.status(400).json({ error: 'path required' })
      const resolved = path.resolve(schemaPath ? path.dirname(schemaPath) : cwd, dirPath)
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return res.status(404).json({ error: 'directory not found' })
      }
      res.json(readDirListing(resolved, dirPath))
    })
    // Serve individual files for viewer output
    app.get('/__jsee/file', (req, res) => {
      const filePath = req.query.path
      if (!filePath) return res.status(400).json({ error: 'path required' })
      const resolved = path.resolve(schemaPath ? path.dirname(schemaPath) : cwd, filePath)
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        return res.status(404).json({ error: 'file not found' })
      }
      res.sendFile(resolved)
    })
    app.get('/', async (req, res) => {
      log('Serving index.html')
      res.send(await gen(pargv, true))
    })
    // app.get('/dist/jsee.runtime.js', (req, res) => {
    //   // __dirname points to this file location (it's jsee/src/cli.js, likely in node_modules)
    //   // so we need to go up one level to get to the dist folder with jsee.runtime.js
    //   const pathToJSEE = path.join(__dirname, '..', 'dist', 'jsee.runtime.js')
    //   log(`Serving jsee.runtime.js from: ${pathToJSEE}`)
    //   res.sendFile(pathToJSEE)
    // })
    app.use('/dist', express.static(path.join(__dirname, '..', 'dist'))) // Serve static files from the dist folder
    // app.use(express.static(cwd))
    // app.use(express.static(require.main.path)) // Serve static files from the main module path
    // app.use(express.static(path.join(require.main.path, '..'))) // Serve static files from the parent directory of the main module path
    app.use(express.static(schemaPath ? path.dirname(schemaPath) : cwd)) // Serve static files from the schema path or current working directory
    app.listen(argv.port, () => {
      console.log(`JSEE app is running: http://localhost:${argv.port}`)
    })
  }
}

module.exports = gen
module.exports.collectFetchBundleBlocks = collectFetchBundleBlocks
module.exports.resolveLocalImportFile = resolveLocalImportFile
module.exports.resolveFetchImport = resolveFetchImport
module.exports.resolveRuntimeMode = resolveRuntimeMode
module.exports.resolveOutputPath = resolveOutputPath
module.exports.needsFullBundle = needsFullBundle
