#!/usr/bin/env node

const minimist = require('minimist')
const fs = require('fs')
const path = require('path')
const jsdoc2md = require('jsdoc-to-markdown')
const showdown = require('showdown')
const converter = new showdown.Converter()

// left padding of multiple lines
function pad (str, len, start=0) {
  return str.split('\n').map((s, i) => i >= start ? ' '.repeat(len) + s : s).join('\n')
}

function depad (str, len) {
  return str.split('\n').map(s => s.slice(len)).join('\n')
}

const argv = minimist(process.argv.slice(2), {
  alias: {
    inputs: 'i',
    outputs: 'o',
    description: 'd',
    ga: 'g',
    port: 'p',
    version: 'v',
    fetch: 'f',
  },
  default: {
    inputs: '',
    fetch: false,
    port: 3000,
    version: 'latest'
  }
})
// Set argv.inputs to the first non-option argument if it exists
if (argv._.length > 0) {
  argv.inputs = argv._[0]
}

console.log(argv)

gen(argv)

// Adding async here breaks express. TODO: investigate
async function gen (argv, returnHtml=false) {
  let cwd = process.cwd()
  let inputs = argv.inputs
  let outputs = argv.outputs
  let imports = argv.imports
  let description = argv.description
  let ga = argv.ga
  let schema
  let descriptionHtml = ''
  let jsdocMarkdown = ''

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

  if (inputs.length === 0) {
    console.error('No inputs provided')
    process.exit(1)
  } else if ((inputs.length === 1) && (inputs[0].includes('.json'))) {
    // Input is json schema
    // Curren working directory if not provided
    schema = require(path.join(cwd, inputs[0]))
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

  // console.log('Schema:', schema)

  // Generate description block
  if (description) {
    const descriptionMd = fs.readFileSync(path.join(cwd, description), 'utf8')
    descriptionHtml = converter.makeHtml(descriptionMd)
  }

  descriptionHtml += genHtmlFromSchema(schema)

  // Generate google analytics code
  let gaHtml = ga ? `
    <script id="ga-src" async src="https://www.googletagmanager.com/gtag/js?id=${blocks.ga}"></script>
    <script id="ga-body">
      window['ga-disable-${ga}'] = window.doNotTrack === "1" || navigator.doNotTrack === "1" || navigator.doNotTrack === "yes" || navigator.msDoNotTrack === "1";
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${ga}');
    </script>
  ` : ``

  // Generate jsee code
  let jseeHtml = ''
  let hiddenElementHtml = ''
  if (argv.fetch) {
    // Fetch the jsee runtime from the CDN or local server
    if (argv.version === 'latest') {
      const jseeCode = fs.readFileSync(path.join(__dirname, '..', 'dist', 'jsee.runtime.js'), 'utf8')
      jseeHtml = `<script>${jseeCode}</script>`
    } else {
      // Pre-fetch the jsee runtime from the CDN https://cdn.jsdelivr.net/npm/@jseeio/jsee@${argv.version}/dist/jsee.runtime.js
      let jseeCode = await fetch(`https://cdn.jsdelivr.net/npm/@jseeio/jsee@${argv.version}/dist/jsee.runtime.js`)
      jseeCode = await jseeCode.text()
      jseeHtml = `<script>${jseeCode}</script>`
    }
    // Fetch model files and store them in hidden elements
    hiddenElementHtml += '<div id="hidden-storage" style="display: none;">'
    for (let m of schema.model) {
      if (m.url) {
        const modelCode = fs.readFileSync(path.join(cwd, m.url), 'utf8')
        hiddenElementHtml += `<script type="text/plain" style="display: none;" data-src="${m.url}">${modelCode}</script>`
      }
      if (m.imports) {
        for (let i of m.imports) {
          const importUrl = i.includes('.js') ? i : `https://cdn.jsdelivr.net/npm/${i}`
          let importCode = await fetch(importUrl)
          importCode = await importCode.text()
          hiddenElementHtml += `<script type="text/plain" style="display: none;" data-src="${importUrl}">${importCode}</script>`
        }
      }
    }
    hiddenElementHtml += '</div>'
  } else {
    jseeHtml = outputs
      ? `<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@${argv.version}/dist/jsee.runtime.js"></script>`
      : `<script src="http://localhost:${argv.port}/dist/jsee.runtime.js"></script>` 
  }

  const html = template(schema, {
    descriptionHtml: pad(descriptionHtml, 8, 1),
    gaHtml: pad(gaHtml, 2, 1),
    jseeHtml: jseeHtml,
    hiddenElementHtml: hiddenElementHtml
  })

  if (returnHtml) {
    // Return the html as a string
    return html
  } else if (outputs) {
    // Store the html in the output file
    for (let o of outputs) {
      if (o === 'stdout') {
        console.log(html)
      } else if (o.includes('.html')) {
        fs.writeFileSync(path.join(cwd, o), html)
      } else if (o.includes('.json')) {
        fs.writeFileSync(path.join(cwd, o), JSON.stringify(schema, null, 2))
      } else if (o.includes('.md')) {
        fs.writeFileSync(path.join(cwd, o), genMarkdownFromSchema(schema))
      } else {
        console.error('Invalid output file:', o)
      }
    }
    fs.writeFileSync(path.join(cwd, outputs[0]), html)
  } else {
    // Serve the html
    const express = require('express')
    const app = express()
    app.get('/', async (req, res) => {
      console.log('Serving the html')
      res.send(await gen(argv, true))
    })
    app.get('/dist/jsee.runtime.js', (req, res) => {
      console.log('Serving jsee.runtime.js from:', path.join(__dirname, '..', 'dist', 'jsee.runtime.js'))
      res.sendFile(path.join(__dirname, '..', 'dist', 'jsee.runtime.js'))
    })
    app.use(express.static(cwd))
    app.listen(argv.port, () => {
      console.log(`JSEE app is running at http://localhost:${argv.port}`)
    })
  }
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
  if (schema.title) {
    title = schema.title
  } else if (schema.model) {
    if (Array.isArray(schema.model)) {
      title = schema.model[0].name
    } else {
      title = schema.model.name
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="generator" content="Jekyll v4.3.3" />
  <meta property="og:title" content="hashr" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:site_name" content="hashr" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta property="twitter:title" content="hashr" />
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","headline":"${title}","name":"${title}","url":"/"}</script>
  <link href="data:image/x-icon;base64,AAABAAEAEBAQAAEABAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAgAAAAAAAAAAAAAAAEAAAAAAAAAD9/f0AAAAAAPj4+AAMDAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEQAAAAAAABERAAAAAAAAEREAAAAAAAAREQABERESABERAAETMzAAEREAARAAAAAREQABEAAAABERAAEQARAAEREAARABEAAREQABEAAAABERAAEQAAAAEREAAREREAAREQABEREQABERAAAAAAAAEREAAAAAAAAREQAAAAAAABHAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAAwAMAAMADAADAAwAA" rel="icon" type="image/x-icon" />
  <style>
    /** Main */
    html { font-size: 16px; }
    body, h1, h2, h3, h4, h5, h6, p, blockquote, pre, hr, dl, dd, ol, ul, figure { margin: 0; padding: 0; }
    body { font: 400 16px/1.5 -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", "Segoe UI Symbol", "Segoe UI Emoji", "Apple Color Emoji", Roboto, Helvetica, Arial, sans-serif; color: #111111; background-color: #fdfdfd; -webkit-text-size-adjust: 100%; -webkit-font-feature-settings: "kern" 1; -moz-font-feature-settings: "kern" 1; -o-font-feature-settings: "kern" 1; font-feature-settings: "kern" 1; font-kerning: normal; display: flex; min-height: 100vh; flex-direction: column; overflow-wrap: break-word; }
    h1, h2, h3, h4, h5, h6, p, blockquote, pre, ul, ol, dl, figure, .highlight { margin-bottom: 15px; }
    hr { margin-top: 30px; margin-bottom: 30px; }
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
    @media screen and (min-width: 800px) { .wrapper { max-width: calc(800px - (30px * 2)); padding-right: 30px; padding-left: 30px; } }
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
    .footer-heading { font-size: 1.125rem; margin-bottom: 15px; }
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
    #download-btn { float: right; margin-top: 10px; padding: 10px; background-color: white; border: none; cursor: pointer; }
    #download-btn:hover { background-color: #f0f0f0; }
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
  <header class="site-header">
    <div class="wrapper">
      <span class="site-title">${title}</span>
      <button id="download-btn" title="Bundled HTML without external dependencies">Download HTML</button>
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
          <p>
            <a href="https://jsee.io/" class="logo_footer">
              <svg width="29mm" height="13mm" viewBox="0 0 29 13" version="1.1" id="svg1274" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" style="width: 50px;">
                <defs id="defs1271"/>
                <g id="layer1">
                  <path id="path53650-9-7-8-7-5" style="fill:#000000;fill-opacity:1;stroke-width:0.033443" d="m 15.085048,2.2627646 v 1.7268189 6.9073135 h 1.726792 1.726873 1.726871 V 9.1700919 H 18.538713 16.81184 V 3.9895835 h 1.726873 1.726871 V 2.2627646 H 18.538713 16.81184 Z m 3.453665,3.453624 v 1.7268716 h 1.726871 V 5.7163886 Z"/>
                  <path id="path53647-5-5-3-6-1" style="fill:#000000;fill-opacity:1;stroke-width:0.033443" d="m 22.001709,2.2627517 v 1.7268184 6.9073269 h 1.726793 1.726871 1.726872 V 9.1700919 H 25.455373 23.728502 V 3.9895701 h 1.726871 1.726872 V 2.2627517 h -1.726872 -1.726871 z m 3.453664,3.4536369 v 1.7268716 h 1.726872 V 5.7163886 Z"/>
                  <g aria-label="JS" transform="matrix(0.05545656,0,0,0.05597005,-218.22149,96.848185)" id="text9866-2-7-20-0-9-1-4-1" style="font-size:241.925px;fill:#000000;stroke:#0024ee;stroke-width:3.31154">
                    <g id="path52502-6-4-6-8-3-0" style="fill:#000000">
                      <path id="path53644-8-2-9-0-8" style="color:#000000;-inkscape-font-specification:'Ubuntu Mono Bold';fill:#000000;stroke:none;stroke-width:3.31155;-inkscape-stroke:none" d="m 4057.5092,-1689.778 -33.3113,-0.027 v 99.6732 c 0,10.8886 -2.3949,18.0118 -6.6855,21.7303 -4.3348,3.7352 -10.0924,5.6444 -17.5448,5.6444 -4.9004,0 -9.717,-1.1428 -14.514,-3.4628 h -0.011 c -4.7842,-2.393 -9.1636,-4.8607 -13.1345,-7.4021 l -1.5765,-1.0103 -12.7499,26.5883 1.0351,0.822 c 4.8358,3.8352 10.7133,7.0544 17.6154,9.6838 7.0314,2.6785 15.6913,3.9804 25.9924,3.9804 9.8334,0 18.2685,-1.3898 25.2967,-4.2345 l 0.016,-0.01 0.016,-0.01 c 6.955,-2.9809 12.6568,-6.9906 17.029,-12.0274 l 0.011,-0.01 c 4.5181,-5.0224 7.7113,-10.908 9.5488,-17.5823 1.98,-6.6083 2.9669,-13.6189 2.9669,-21.0153 z"/>
                    </g>
                    <g id="path52504-2-7-1-6-3-5" transform="translate(95.989089,-84.950886)" style="fill:#000000">
                      <path id="path53638-1-7-4-0-0" style="color:#000000;-inkscape-font-specification:'Ubuntu Mono Bold';fill:#000000;stroke:none;stroke-width:12.5161;-inkscape-stroke:none" d="m 14820.902,-7165.5098 c -61.098,0 -110.108,15.3477 -146.047,46.5274 l -0.04,0.039 h -0.04 c -35.354,31.2211 -53.095,75.0334 -53.095,129.6602 0,27.7074 4.995,51.4357 15.298,70.9336 l 0.04,0.039 0.04,0.045 c 10.052,18.3884 22.693,34.038 37.871,46.8027 l 0.05,0.037 0.05,0.047 c 15.605,12.5992 32.778,22.9927 51.471,31.168 18.277,7.9934 35.956,15.0668 53.053,21.2324 12.58,4.837 25.165,10.284 37.761,16.3379 l 0.116,0.053 0.109,0.053 c 12.38,5.3549 23.522,11.5723 33.449,18.6446 l 0.102,0.076 0.101,0.072 c 9.746,6.3641 17.645,13.7908 23.844,22.3223 5.933,8.165 8.811,17.0897 8.811,27.5117 0,8.4874 -1.396,16.9808 -4.233,25.5703 l -0.05,0.127 -0.04,0.1328 c -2.09,7.3855 -6.277,14.3394 -12.873,21.0312 -6.408,5.904 -15.549,11.0389 -27.597,15.1055 -11.28,3.4051 -26.177,5.2285 -44.551,5.2285 -32.227,0 -59.425,-4.2332 -81.584,-12.4726 -22.161,-8.4662 -41.245,-17.504 -57.227,-27.0625 l -6.488,-3.877 -37.041,103.8457 4.35,2.6699 c 14.574,8.9537 35.758,18.5092 63.875,28.9961 l 0.06,0.037 0.06,0.039 c 28.93,10.1558 66.843,15.0469 113.996,15.0469 70.627,0 124.053,-14.4999 159.64,-44.6446 36.005,-30.6002 54.096,-74.1656 54.096,-128.8164 0,-31.9205 -5.252,-58.6401 -16.158,-80.0176 -10.645,-21.4715 -24.527,-39.3432 -41.582,-53.3886 -16.251,-14.4867 -34.421,-25.8642 -54.418,-34.0684 0,0 -0.04,9e-4 -0.04,-0.037 -18.835,-8.58 -37.086,-16.2605 -54.742,-23.0195 h -0.04 -0.04 c -11.438,-4.253 -23.183,-8.8126 -35.232,-13.6758 -11.18,-4.7508 -21.427,-10.0803 -30.781,-15.9668 -8.553,-6.3562 -15.604,-13.2064 -21.213,-20.541 -5.304,-7.5192 -7.906,-15.8372 -7.906,-25.668 0,-20.2937 6.46,-34.1264 19.728,-43.8281 13.269,-9.7017 34.264,-15.1055 63.244,-15.1055 23.752,0 44.321,3.0022 61.737,8.8614 h 0.04 0.04 c 18.467,6.0121 35.07,13.2006 49.834,21.5449 l 6.312,3.5664 37.239,-99.1895 -4.733,-2.6328 c -18.112,-10.0852 -40.336,-19.0958 -66.734,-27.1504 -26.237,-8.1912 -56.862,-12.2129 -91.906,-12.2129 z" transform="matrix(0.26580544,0,0,0.26336684,98.529211,278.95254)"/>
                    </g>
                  </g>
                </g>
              </svg>
            </a>
          </p>
        </div>
        <div class="footer-col">
          <div class="social-links">
            <ul class="social-media-list">
              <li><a rel="me" href="https://github.com/jseeio/hash" title="jseeio/hash">GitHub</a></li>
              <li><a rel="me" href="https://twitter.com/jseeio" title="jseeio">Twitter</a></li>
              <li><a rel="me" href="https://www.facebook.com/jseeio" title="jseeio">Facebook</a></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </footer>
  ${blocks.jseeHtml}
  <script>
    const schema = ${JSON.stringify(schema, null, 2)}
    const title = "${title}"
    var env = new JSEE({
      container: document.getElementById('jsee-container'),
      schema
    })
    document.getElementById('download-btn').addEventListener('click', async () => {
      env.download(title)
    })
  </script>
</body>
</html>`
}
