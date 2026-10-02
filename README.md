# JSEE

Portable, schema-driven web apps for local computation.

JSEE turns a model function plus a small JSON schema into a reactive browser app, CLI-served tool, offline HTML bundle, HTTP API and MCP tool. It is meant for computations that should be easy to share, inspect, rerun and keep on the user's machine.

Use JSEE when you want:

- a self-contained UI around a JavaScript, Python, API, or WASM computation
- typed inputs, output rendering, file/folder handling, progress, and cancellation without writing app plumbing
- browser-first execution with optional Worker isolation and offline bundling
- the same computation exposed to humans through a UI and to tools through HTTP or MCP

Smallest browser example:

```html
<div id="jsee-container"></div>
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
<script>
  function multiply (a, b) {
    return a * b
  }
  new JSEE(multiply, '#jsee-container')
</script>
```

↳ [Result](https://jsee.org/test/minimal1.html)

## Installation

This checkout targets **0.9.0 for JavaScript and Python**. These repository changes are awaiting publication; registry installs may contain earlier behavior. The two packages share a major/minor compatibility line, with independent compatible patch releases. `schemaVersion` versions the descriptor format separately.

To use the current checkout, run `npm install && npm run build`, then `node bin/jsee --help`. Install the maintained Python package with `python -m pip install ./py` after that build.

**Browser CDN:**

```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
```

Pin a reviewed published version for production.

**npm CLI/dev server:**

```bash
npm install @jseeio/jsee
```

Run from npm without installing globally:

```bash
npx @jseeio/jsee schema.json -o app.html
```

Run `npx @jseeio/jsee --help` for all CLI options.

## Runtime Bundles

| Bundle | Use when | Includes |
|---|---|---|
| `dist/jsee.core.js` | Most apps, direct `<script>` tags, generated HTML | runtime, inputs, core outputs, native PDF viewer |
| `dist/jsee.full.js` | Apps that need `chart`, `3d`, or `map` without extra imports | core + Observable Plot + Three.js + Leaflet |
| `@jseeio/jsee` package entry | CLI/server-side tooling | Node CLI module |

Full bundle CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.full.js"></script>
```

The core bundle can still render `chart`, `3d`, and `map` if the app loads the required library through schema `imports`. The `pdf` output uses the browser's native PDF viewer and is available in the core bundle. The CLI and Python server choose the required runtime bundle from the schema output types.

## Quick start

Scaffold a project:

Use the CLI's maintained `jsee init` templates. The separate `create-jsee` placeholder has no implementation.

```bash
npx @jseeio/jsee init            # minimal: schema.json + model.js + README.md
npx @jseeio/jsee init chat       # chat template
npx @jseeio/jsee init --html     # single index.html with CDN script
```

Python:
```bash
jsee init                         # schema.json + model.py + README.md
jsee init chat                    # chat template
```

Or create the two files yourself:

```json
{
  "model": { "url": "model.js", "worker": true },
  "inputs": [
    { "name": "n", "type": "slider", "min": 10, "max": 1000, "default": 100 }
  ],
  "outputs": [
    { "name": "summary", "type": "number", "label": "Rows" },
    { "name": "rows", "type": "table" }
  ]
}
```

```javascript
function model ({ n }, ctx) {
  ctx.progress(10)
  const rows = Array.from({ length: n }, (_, i) => ({ i, y: Math.sin(i / 10) }))
  ctx.progress(100)
  return { summary: n, rows }
}
```

Start the dev server:

```bash
npx @jseeio/jsee schema.json     # Node (auto server-side execution)
jsee schema.json                  # Python
```

Generate a standalone HTML file:

```bash
npx @jseeio/jsee schema.json -o app.html
npx @jseeio/jsee schema.json -o app.html --bundle  # inline runtime + imports for offline use
```

## When JSEE Fits

JSEE works best for computations with a clear flow from inputs to processing to outputs. Pipelines, input updates, streaming files, custom renderers, and chat-style interfaces are supported, but JSEE is intentionally not a general application framework. If the UI needs deep bidirectional state, many custom screens, routing, or complex collaborative editing, use a normal frontend app and call JSEE-style computation modules from it.

## How it works

JSEE turns a JSON schema into a working web app. Instead of writing HTML, event handlers and output renderers, you describe `inputs`, `outputs` and a `model` in a single JSON object. JSEE reads that schema, generates a reactive Vue 3 GUI, loads dependencies, and runs your code in a Web Worker (or on the main thread, or as an API call). In many cases it can build the schema automatically by analysing a function's arguments.

```text
           Schema   Model    View/Render*  Imports*
  DEV  -►   json    js/py       js         js/css
              |       |          |            |
           ┌──▼───────▼──────────▼────────────▼──┐
           │          new JSEE(schema)            │
           │  ┌──────────────┐  ┌──────────────┐ │
           │  │ Import loader │  │Schema parser │ │
           │  └──────┬───────┘  └──────┬───────┘ │
           └─────────┼─────────────────┼─────────┘
                     |                 |
              ┌──────▼──┐       ┌──────▼──────┐ ◄~ pyodide
 USER  ◄-►   │   GUI   │ ◄--►  │  Pipeline   │ ◄~ libs
              │  Vue 3  │       │  Model(s)   │ ◄~ wasm
              └─────────┘       └─────────────┘
                                  WebWorker*

 * - optional
```

### Initialization

1. **Schema** is loaded from a URL, DOM element, function, or JS object
2. **Validation** checks schema structure and logs warnings for issues
3. **Imports** are resolved — JS scripts are loaded in sequence, CSS files are injected as `<link>` tags. In the browser, relative paths resolve against the page URL. In `--bundle` mode, the CLI checks the local filesystem first
4. **Models** initialize — code is loaded from `url`, `code`, or a hidden DOM cache (`data-src` elements used by `--bundle` output and `download()`; generated bundles store cached assets as base64 so model/import source cannot break out of the page script structure)
5. **GUI** is created — a Vue 3 app with reactive inputs, output cards, run/stop buttons and progress bar
6. **URL params** are applied — query string values (`?name=value`) set matching inputs, including `alias` matches. File URL params auto-load on init

### Execution

- **Run**: user clicks Run (or autorun/reactive triggers it). Inputs are collected and sent to the model
- **Pipeline**: when `model` is an array, models execute sequentially — each receives the merged output of the previous one. Return `{ stop: true }` to halt early
- **Runtime context**: object-container models receive a second argument (`ctx`) with `ctx.log()`, `ctx.progress(value)` (0–100 or `null` for indeterminate), and `ctx.isCancelled()` for cooperative cancellation
- **Cancellation**: `jsee.cancelCurrentRun()` or the Stop button rejects the active run, aborts its API requests, signals workers, and marks stale results so they are ignored. A cancelled pipeline cannot enter later stages even if a new run has started. Worker-backed models can be terminated. Main-thread models should check `ctx.isCancelled()` inside long async loops because JavaScript cannot preempt synchronous CPU-bound code on the main thread. Cancelling a request does not forcibly stop arbitrary code on its remote server
- **Output**: results flow to the output cards — JSON trees, HTML, SVG, code blocks, or custom render functions

### Offline & bundling

- **`jsee --bundle`** bundles everything into a single HTML file: the JSEE runtime, model/view/render code, and all imports are stored in hidden `<script data-src="..." data-encoding="base64">` elements. The result works with no network
- **`jsee.download(title)`** does the same at runtime — exports the current app as a self-contained HTML file

## Structured and media inputs

`object` accepts JSON values, including nested objects and variable-length lists. Its editor reports invalid JSON and blocks execution until corrected. `table` accepts the same values as table outputs: an array of row objects or `{ "columns": ["name"], "rows": [["Ada"]] }`. The table editor supports adding/removing rows, adding columns and editing JSON. Cells preserve JSON types: `0`, `false`, `null` and `""` are distinct. Column-specific validation is not inferred. Named groups remain useful for fixed nested forms.

`image`, `audio` and `video` provide file selection and previews. Declare `accept`, such as `"image/png"` or `"audio/*"`, to restrict selection; the media type also requires its own MIME family. Browser JS models receive an ArrayBuffer; native Python models receive bytes. Pyodide models can use `bytes(value)` on the received buffer. Canonical CLI/HTTP/MCP inputs use `{ "artifact": "<runId>/<index>" }`, rather than encoded media strings. MIME describes supplied metadata; it does not prove that a codec can decode the content. JSEE does not implicitly convert images to PIL/NumPy or audio to sample arrays.

Media outputs may return bytes (with `mime` in the output descriptor), or `{content: bytes, mime: "image/png"}`. Canonical hosts store these as reusable artifacts. Existing media URL strings remain URLs. The canonical served UI uploads selected media, invokes the whole pipeline through `/run`, and displays its artifacts. Standalone browser apps keep local file data on the device. The new editors support `disabled` and `readonly`.

## Schema blocks

The package includes a [JSON Schema for descriptor authoring](schema.json) (draft-07). Editors can use `"$schema": "./node_modules/@jseeio/jsee/schema.json"`; validators can load it with `require('@jseeio/jsee/schema.json')`. It checks known fields and nested groups without loading model code, and permits extension metadata. Runtime initialization retains its existing advisory checks for unknown options; authoring validation does not prove that a model or dependency can execute.

TypeScript authors can use the same vocabulary through the schema entry point:

```ts
import type { Schema } from '@jseeio/jsee/schema'

const schema = {
  schemaVersion: 1,
  model: { type: 'module', url: './model.js' },
  inputs: [{ name: 'count', type: 'int', default: 3 }]
} satisfies Schema
```

These declarations cover descriptors and the pure input helpers exported from `@jseeio/jsee/schema`; they do not declare the browser `JSEE` class or CLI API. `npm run test:types` checks authoring examples and runs as part of `npm test` and the production build.

JSEE takes a schema object that contains three main blocks:

- `model` — describes a model/script/API (its location, is it a function or class, should it be called automatically on every GUI change or not)
- `inputs` — list of inputs and their descriptions
- `outputs` — list of outputs and their descriptions

Extra blocks can be provided for further customization:

- `id` — optional stable computation identifier for discovery and OpenAPI, independent of the display title. Use 1–128 ASCII letters, digits, `_`, `.`, or `-`, starting with a letter. Defaults to `computation`
- `schemaVersion` — optional descriptor format version. Use the number `1`; omitting it retains the same behavior. Unsupported explicit versions are rejected before model loading. This is independent of JS/Python package versions
- `render` / `view` — visualization part (optional). Defines custom rendering code
- `design` — overall appearance (optional). Defines how the app looks overwriting defaults
- `imports` — a list of scripts and stylesheets to load before the model is initialized. CSS files (`.css` extension) are injected as `<link rel="stylesheet">` in `<head>`, JS files are loaded as scripts. In the browser, relative paths (e.g. `dist/core.js`, `./lib.js`) resolve against the page URL. With `--bundle`, the CLI resolves imports by checking the local filesystem first — if a file exists on disk it is bundled; otherwise it is fetched from CDN

  ```json
  "imports": [
    "https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js",
    "dist/my-lib.js",
    "styles/app.css"
  ]
  ```

- `examples` — a list of examples (optional). Defines a list of examples that can be used to overwrite inputs

  ```json
  "examples": [
    { "input": "My name is Anton and I am" }
  ]
  ```

## Playground

- [Codepen](https://codepen.io/jseeio/pen/NWayjJe)

## Examples

### Full schema

A complete schema with multiple inputs, outputs, theming, and a worker model:

```json
{
  "model": { "url": "model.js", "worker": true },
  "design": { "primary": "#2a7ae2", "grid": [4, 8] },
  "inputs": [
    { "name": "count", "type": "slider", "min": 10, "max": 1000, "default": 100 },
    { "name": "method", "type": "select", "options": ["linear", "quadratic"], "default": "linear" }
  ],
  "outputs": [
    { "name": "summary", "type": "number", "prefix": "n = " },
    { "name": "data", "type": "chart", "mark": "dot", "x": "x", "y": "y" },
    { "name": "raw", "type": "table" }
  ],
  "autorun": true
}
```

### Chart output

Model returns array of objects or column-oriented data:

```javascript
function model ({ count }) {
  const data = Array.from({ length: count }, (_, i) => ({
    x: i, y: Math.sin(i / 10) + Math.random() * 0.2
  }))
  return { chart: data }
}
```

Schema: `{ "name": "chart", "type": "chart", "mark": "line", "x": "x", "y": "y" }`

### Map output

Model returns markers array:

```javascript
function model () {
  return {
    map: [
      { lat: 51.505, lng: -0.09, popup: 'London' },
      { lat: 48.857, lng: 2.352, popup: 'Paris' },
      { lat: 52.52, lng: 13.405, popup: 'Berlin' }
    ]
  }
}
```

### Pipeline

Sequential models pass merged results forward:

```json
{
  "model": [
    { "url": "preprocess.js", "worker": true },
    { "url": "analyze.js", "worker": false }
  ]
}
```

First model returns `{ cleaned: [...] }`, second receives `{ cleaned: [...], ...originalInputs }`. Return `{ stop: true }` from any model to halt early.

### Multi-column layout

Use `columns` on inputs/outputs for dashboard-style layouts:

```json
{
  "inputs": [
    { "name": "a", "type": "slider", "min": 0, "max": 100, "columns": 6 },
    { "name": "b", "type": "slider", "min": 0, "max": 100, "columns": 6 }
  ],
  "outputs": [
    { "name": "total", "type": "number", "columns": 4 },
    { "name": "chart", "type": "chart", "columns": 8 }
  ]
}
```

## Schema

- `model` — Contains main parameters of the model/script
  - `url` (string) — URL of a JS/Python script or POST/GET API
  - `code` (function or string) — It's possible to pass code directly to JSEE instead of using an URL
  - `name` (string) — Name of the executed object. Default value is taken from `url` or `code`
  - `type` (string, default — `function`) — What kind of script is loaded. Influences how the code is initialized. Possible values:
    - `function`
    - `class`
    - `module` — Load an ES module URL with native dynamic import and call `model.export`, `model.name`, `default`, or `model`. Module models default to `worker: false`; set `worker: true` to run the module in JSEE's Web Worker. This is the JavaScript path intended for `security.allowEval: false`
    - `async-function`
    - `async-init`
    - `py` — Run browser Python through Pyodide. Browser Pyodide models receive Python globals `inputs` and `ctx`. Use `inputs['name']` for input values and `ctx.get('caller')` for runtime metadata. Legacy `from js import name` still works for non-colliding names, but JSEE no longer overwrites existing JavaScript globals such as `location`, `history`, `name`, `top`, or `parent`
    - `get` / `post` — Call an HTTP API model instead of local JavaScript/Python code. Use `model.stream: true` for SSE responses
    - Inference note: when `code` is present (including code loaded from a `.js` URL), JSEE treats the model as `function` unless `type` is explicitly set
    - TensorFlow.js is not a dedicated model type. Load it through `imports` and call it from a normal JavaScript `function` or `class` model
  - `entry` (string) — For Python models, selects the callable independently of the endpoint `name`. Modules load once per application. Pyodide functions can declare individual input parameters, `inputs`, and/or `ctx`; native Python passes the declared request arguments.
  - `export` (string) — For `type: "module"` models, names the ES module export to call. If omitted, JSEE tries `default` and then `model`
  - `pyodide` (string or object) — For `type: "py"` browser/Pyodide models only, overrides the Pyodide loader. By default JSEE keeps the existing pinned runtime URL for compatibility. Set a URL string, or `{ "url": ".../pyodide.js", "indexURL": ".../" }`, to opt into another version or a local Pyodide asset directory. Add `packages: ["numpy"]` to preload packages and let `--bundle=pyodide` or `--bundle=pyodide-single` fetch those package wheels from `pyodide-lock.json`. Example for local assets: `{ "url": "/pyodide/pyodide.js", "indexURL": "/pyodide/" }`. A loader override does not guarantee runtime compatibility: Pyodide 314.x requires module workers for worker execution, while JSEE currently uses classic workers.
  - `method` (string) — If `type` is `class`, `method` defines the name of the class method to call during evaluation
  - `container` (string) — How input values are passed to the function/method:
    - `object` (default) — Pass inputs wrapped in an object, i.e. `{'x': 1, 'y': 2}`
    - `args` — Pass inputs as separate arguments
    - In `object` mode, JavaScript models receive the runtime context as a second argument: `function model(inputs, ctx) { ... }`
  - `worker` (boolean) — If `true`, JSEE initializes a Web Worker to run the script
    - `ctx.log(...args)` — Write runtime logs
    - `ctx.progress(value)` — Report progress (`0..100` or `null` for indeterminate)
    - `ctx.isCancelled()` — Returns true once this invocation completes, is cancelled, or is replaced. Context callbacks belong to the invocation; late `ctx.log()`/`ctx.progress()` calls are ignored. Browser `ctx.output()`/`ctx.outputAsync()` follow the same rule. Browser instance fields and methods remain accessible through the context
  - `timeout` (number, default: `30000`) — Worker execution timeout in milliseconds. Only applies when `worker: true`. Does not apply during model initialization (loading can be slow). If exceeded, the worker is terminated with an error
  - `imports` (array) — Per-model imports loaded before this model's code executes. Accepts URLs as strings or objects `{ url: "..." }`. Top-level `imports` are moved to the first model internally
  - `model` can also be an **array of model objects** to create a pipeline. Models execute sequentially — each receives the merged output of the previous one. First model defaults to `worker: true`, others to `worker: false`. Return `{ stop: true }` from any model to halt the pipeline early
- `render` — Custom rendering script. Instead of relying on JSEE for output visualization, you can provide a custom script that visualizes the results. That can be useful if you rely on custom libs for plotting
- `design` — Design parameters
  - `layout` — Layout for the model/input/output blocks. If it's empty and the JSEE container is not, JSEE uses inner HTML as a template. If the container is empty too, it uses the default `blocks` template. Set `'sidebar'` for a fixed-width (280px) sticky input panel — inputs stay visible while scrolling outputs. Collapses to single column on mobile
  - `framework` — Design framework to use (`'minimal'` by default). If a JavaScript object with the same name is present in a global context, JSEE loads it too (using Vue's `use` method)
  - `theme` — Color theme. Set `'dark'` for dark mode
  - `primary` — Accent color (buttons, toggles, gradient). Hex string, e.g. `'#e74c3c'`
  - `secondary` — Second gradient color. Defaults to a darker shade of `primary`
  - `bg` — Background color. Derives card, input, and border colors automatically
  - `fg` — Text color. Derives secondary text color automatically
  - `font` — Font family string, e.g. `'Georgia, serif'`
  - `radius` — Border radius in pixels (number) or CSS value (string)
  - `grid` (array) — 12-column grid split for input/output sections. E.g. `[4, 8]` (default), `[6, 6]` (equal), `[3, 9]`. Values are `fr` units
  - All components use CSS custom properties that can be overridden via CSS: `--jsee-primary`, `--jsee-bg`, `--jsee-text`, `--jsee-text-secondary`, `--jsee-border`, `--jsee-input-bg`, `--jsee-input-border`, `--jsee-focus-border`, `--jsee-focus-ring`, `--jsee-card-bg`, `--jsee-bg-secondary`, `--jsee-label-bg`, `--jsee-error`, `--jsee-radius`
- `inputs` — Inputs definition
  - `name`* — Name of the input
  - `type`* — Type. Possible types:
    - `int`, `float` or `number` — Number
    - `string` — String (text input)
    - `color` — Color picker (HTML5 `<input type="color">`)
    - `text` — Textarea (auto-resizes to fit content, up to 400px)
    - `checkbox` or `bool` — Checkbox
    - `select` or `categorical` — Select (one of many `options`)
    - `slider` — Range slider (`min`, `max`, `step`)
    - `range` — Dual-handle range slider, returns `[min, max]` array
    - `radio` — Radio button group (one of many `options`)
    - `toggle` — Toggle switch (boolean)
    - `date` — Date picker
    - `multi-select` — Checkbox group, returns array of selected `options`
    - `group` — Group of inputs. Use `elements` array for child inputs. Supports three display styles via `style` property:
      - `blocks` (default) — flat list of child inputs
      - `accordion` — collapsible section (also triggered by `collapsed` or `label` props)
      - `tabs` — tabbed view where each child element becomes a tab (child groups use their `name`/`label` as tab label)
    - `object` — JSON editor for nested objects, lists or other JSON values
    - `table` — Editable table using row objects or `{columns, rows}`
    - `image`, `audio`, `video` — Typed media selection and preview; models receive bytes
    - `file` — File Input
    - `folder` — Directory input. Shows a file listing with optional selection. In the browser, uses `<input webkitdirectory>` or drag-drop. On the server, reads from a directory path. Returns array of `{name, path, size, type, selected}` objects. Props:
      - `select` (boolean) — Show checkboxes for file selection (default: all files passed)
      - `reactive` (boolean) — Trigger model run on selection change
    - `action` or `button` — Button (its `name` will be passed as a `caller` to the model unless a computation input already declares `caller`). Works as a top-level input or inside input groups
  - `default` — Default value
  - `nullable` (boolean) — Allow JSON `null` as an input value. A `null` default also permits `null`, preserving optional Python argument defaults
  - `alias` (string or array of strings) — Alternative names for URL parameter matching. E.g. `"alias": ["f", "file"]` allows `?f=value` or `?file=value` to set this input
  - `display` (string) — Filtrex expression to conditionally show/hide this input. Evaluated against current input values. E.g. `"display": "mode == 'advanced'"` shows the input only when `mode` is `"advanced"`. Supports `len()` for string length
  - `reactive` (boolean) — Trigger a model run when this input changes (see **Execution triggers** below)
  - `disabled` (boolean) — Disables the input in the UI. Built-in input controls, selectors, folder selection checkboxes, and action buttons honor this flag. When combined with `reactive: true`, triggers an initial model run on page load (useful for server-populated values)
  - `readonly` (boolean) — Prevent editing in the table/JSON/media controls while retaining the current value
  - `accept` (string) — File/media MIME types, wildcards or extensions, separated by commas; checked against file selection and stored artifact metadata
  - `enter` (boolean) — If `true` on a `string` input, pressing Enter triggers a model run (useful for chat or search inputs)
  - `raw` (boolean, file input only) — If `true`, pass the raw source to the model instead of reading text in the UI (`File` object for disk files or `{ kind: 'url', url: '...' }` for URL input)
  - `stream` (boolean, file input only) — If `true`, pass an async iterable `ChunkedReader` to the model instead of raw source handles. Supports `for await (const chunk of reader)`, `await reader.text()`, `await reader.bytes()`, and `for await (const line of reader.lines())`. Works in both main-thread and worker execution. Reader metadata (`reader.name`, `reader.size`, `reader.type`) is preserved and remains available in downstream pipeline models
  - `validate` (string) — Browser control validation using Filtrex. The variable `value` holds the current input value. Expression must return truthy for valid input. E.g. `"validate": "value >= 0 and value <= 150"`. Runs on input changes (debounced) and before browser execution, including programmatic `jsee.run()` calls. Nested groups are traversed; group expressions receive their collected field values. Invalid controls show errors and block execution
  - `required` (boolean) — Ordinary browser controls reject empty strings, null, undefined, and empty arrays, including when a `validate` expression is also present. Table/JSON controls use field-presence semantics and permit empty collections as values. HTTP/CLI contracts use it for required field presence; portable value constraints come from declared types, options, and numeric bounds
  - `error` (string) — Custom error message for `validate` or `required` failures (default: `"Invalid value"` / `"Required"`)
  - `columns` (number, 1-12) — Grid column span for this input. When any input has `columns`, the inputs section switches to a 12-column CSS grid. E.g. `"columns": 6` makes the input take half width
  - URL params for file inputs (e.g. `?file=https://...`) auto-load on init, so bookmarkable links run without an extra Load click
- `outputs` — Outputs definition. Outputs also support `alias` (string or array of strings) for matching model result keys by alternative names. Per-output `columns` (number, 1-12) sets grid column span, same as inputs
  - `name`* — Name of the output
  - `type`* — Type. Possible types:
    - `file` — Download-only file output. With a static schema filename, return the file body under the output name:
      ```json
      { "name": "report", "type": "file", "filename": "report.csv" }
      ```
      ```javascript
      return { report: "col1,col2\n1,2\n" }
      ```
      For dynamic filenames, formats, or MIME types, return a descriptor object matching the output name:
      ```javascript
      return {
        file: {
          filename: "dataset.csv",
          content: csvText,
          mime: "text/csv"
        }
      }
      ```
      Descriptor fields: `filename` or `name`; `content`, `value`, `data`, or `url`; optional `mime` or `contentType`.
    - `object` — JavaScript Object
    - `html` or `svg` — SVG element
    - `code` — Code block
    - `markdown` — Rendered Markdown (supports tables, headings, lists, etc.)
    - `image` — Image (`<img>` tag from data URL or URL)
    - `audio` — Audio player (`<audio>` from URL or data URL)
    - `video` — Video player (`<video>` from URL or data URL)
    - `table` — Virtualized table with scrolling
    - `chat` — Chat message list. Accumulates `{role, content}` messages across runs instead of replacing. Renders user/assistant bubbles with Markdown support, auto-scrolls to latest message. See **Chat mode** below
    - `group` — Group of outputs. Use `elements` array for child outputs. Supports `style: 'tabs'` for tabbed display or default blocks (stacked). Child outputs are matched by name against model results
    - `chart` — SVG chart via [Observable Plot](https://observablehq.com/plot/). Model returns array of objects, column-oriented data, or a full Plot config. Schema props: `mark` (line/dot/bar/area/etc.), `x`, `y`, `color`, `width`, `height`. Included in full bundle or load Plot via `imports`
    - `3d` — 3D model viewer via [Three.js](https://threejs.org/). Model returns a URL (GLTF/GLB), data URL, or geometry object `{vertices, faces}`. Schema props: `width`, `height`. Included in full bundle or load Three.js via `imports`
    - `map` — Interactive map via [Leaflet](https://leafletjs.com/). Model returns markers `[{lat, lng, popup}]`, `{center, markers, zoom}`, or GeoJSON. Schema props: `height`, `zoom`, `center`, `tiles`. Included in full bundle or load Leaflet via `imports`
    - `pdf` — Browser-native PDF viewer. Model returns a URL, data URL, Blob, ArrayBuffer, or Uint8Array. Schema prop: `height`. Included in the core bundle
    - `gallery` — CSS grid of images. Model returns array of URLs/data URLs. Click to expand lightbox. Schema props: `columns` (default 3), `gap` (default 8px). Zero-cost, included in core bundle
    - `highlight` — Highlighted text with labels. Model returns `[{text, label, color}]` segments. Unlabeled segments render as plain text. Zero-cost, included in core bundle
    - `gauge` — Semicircle gauge. Model returns a number or `{value, label}`. Schema props: `min` (default 0), `max` (default 100), `label`, `color`. Zero-cost, included in core bundle
    - `number` — Large KPI number display. Model returns a number or `{value, delta, label}`. Delta shown with colored up/down arrow. Schema props: `label`, `prefix` (e.g. `"$"`), `suffix` (e.g. `"%"`), `precision`
    - `alert` — Colored status banner with left accent border. Model returns a string or `{message, type}`. Four variants: `info` (blue, default), `success` (green), `warning` (amber), `error` (red). Schema prop: `alertType` (default type when value is a string)
    - `viewer` — Intelligent media viewer. Model returns a URL string. Auto-detects content type from extension: images (png, jpg, gif, svg, webp), audio (mp3, wav, ogg, flac), video (mp4, webm, mov), or iframe (fallback). Useful with `folder` input for file preview
    - `function` — Render function. Rather than returning a value, a model returns a function that JSEE will call passing the container element
    - `blank` — Empty container for custom rendering via `function` output or external code
- `examples` — List of examples
- **Execution triggers** — by default the model only runs when the user clicks Run. Three schema-level options change this:
  - `autorun` (boolean, default: `false`) — run the model once on first load, then wait for manual Run clicks
  - `reactive` (boolean, default: `false`) — re-run the model on **any** input change (debounced 300ms). Useful for lightweight models where instant feedback is desired
  - `interval` (number, default: `0`) — after an autorun or manual Run, repeat execution every N milliseconds until Stop is clicked. `0` means no repetition. The first run keeps its original `caller` value (`autorun` or `run`); scheduled repeats use `caller: "interval"`
  - Per-input `reactive` — set `reactive: true` on an **individual input** to trigger a model run only when that specific input changes (fires immediately, not debounced). Other inputs still require a manual Run click. Useful when one input is interactive (e.g. a slider) but others are expensive to recompute

  | Option | Scope | When it runs | Debounced |
  |--------|-------|-------------|-----------|
  | `autorun: true` | schema | once on load | no |
  | `reactive: true` | schema | every input change | yes (300ms) |
  | `reactive: true` | input | that input changes | no |
  | `interval: N` | schema | after autorun or Run, then every N ms | no |
- **Chat mode** — declare an output with `"type": "chat"` to enable conversational UI. The runtime manages state:
  1. User types a message in a text input and presses Run (or Enter if the input has `"enter": true`)
  2. The runtime injects `history` (array of `{role, content}` dicts) into the model payload alongside the user's `message`, unless a computation input already declares `history`
  3. The model returns `{chat: "response string"}` (or `{chat: {role, content}}`)
  4. The runtime appends both the user message and assistant response to the chat output's internal `_messages` array, clears the input, and auto-scrolls
  5. Messages render with Markdown support (code blocks, bold, links, tables)

  Works with both Workers (postMessage) and server POST — no special execution mode needed. Python shorthand: `jsee.serve(fn, chat=True)` auto-generates the schema from `fn(message, history) -> str`

- **Input persistence** — by default, JSEE saves input values to `localStorage` and restores them on page refresh. Values are namespaced by app/container/input shape, include grouped inputs, skip file/folder/action/button/disabled inputs, and are validated against type/options/min/max before restore. Priority: URL params > localStorage > schema defaults. Set `persist: false` in the schema to disable. Clicking Reset clears saved values
- **Notifications** — set `notify: true` in the schema to show a browser notification when a run completes while the tab is hidden. JSEE requests permission on first load and fires `new Notification()` after successful runs only
- **Security mode** — set `security.mode: "secure"` or `security.trusted: false` to opt into stricter trust settings. Secure mode defaults `allowEval`, `allowNetwork`, `allowRawHtml`, `allowNotifications`, and `allowFileViewer` to `false`; explicit booleans such as `security.allowNetwork: true` can override individual defaults. `allowEval: false` blocks inline JavaScript/Python model code, cached hidden JavaScript assets, Blob-script worker execution, worker class lookup, and Pyodide source execution; use `type: "module"` with a module URL for the no-eval JavaScript path. Module models default to the main thread and can opt into `worker: true`. `allowNetwork: false` blocks API model requests plus network model/import/Pyodide runtime loads when JSEE can evaluate the schema before the request; same-origin relative model/import URLs are checked as relative schema URLs even when JSEE later resolves them for browser or worker loading. `allowRawHtml: false` sanitizes `html`, `svg`, `markdown`, and `chat` outputs, disables raw HTML inside Markdown, removes event handlers/scripts/unsafe URLs, and preserves ordinary Markdown formatting. `allowNotifications: false` skips browser Notification permission requests and completion notifications. `allowFileViewer: false` disables built-in file/folder input controls and replaces file/media outputs (`image`, `audio`, `video`, `pdf`, `gallery`, `viewer`, `file`) with a blocked placeholder. Loading the schema URL itself happens before schema security can be known
These security flags gate JSEE-managed operations. They do not sandbox arbitrary model code, intercept all network calls, restrict the host filesystem, or enforce CPU/memory limits. Web Workers provide a separate execution thread and message passing; they retain browser worker capabilities such as network access. Deployment isolation must be provided and tested by the host.

- **CSP deployment matrix** — for strict CSP/no-eval deployments, prefer `security.mode: "secure"` plus `type: "module"`. The current browser bundle injects built-in CSS at runtime, so built-in UI styles require `style-src 'unsafe-inline'`. Worker-backed models use JSEE's current Blob worker bootstrap, so they require `worker-src blob:` even when the user model itself is an ES module

  Baseline same-origin module policy:

  ```http
  Content-Security-Policy:
    default-src 'self';
    script-src 'self';
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:;
    font-src 'self' data:;
    connect-src 'self';
    worker-src 'none';
    object-src 'none';
    base-uri 'none';
    form-action 'none'
  ```

  Use `worker-src blob:` instead of `worker-src 'none'` for `worker: true` module models. If the runtime, module URL, imports, images, API endpoints, or Pyodide assets come from another origin, add those origins to the matching CSP directive and keep `security.allowNetwork` aligned with that choice.

  | Schema path | Required CSP additions | No `unsafe-eval` | Notes |
  | --- | --- | --- | --- |
  | `type: "module", worker: false` | `script-src` must allow the module URL | yes | Verified with `security.mode: "secure"` and `worker-src 'none'` |
  | `type: "module", worker: true` | `worker-src blob:` and `script-src` must allow the module URL | yes for user model code | Current JSEE worker bootstrap is Blob-backed |
  | Main-thread JavaScript `model.code` string | `script-src 'unsafe-eval'` | no | Blocked by `security.allowEval: false` |
  | Worker JavaScript `model.code` string | `worker-src blob:` plus `script-src blob:` | no | Blocked by `security.allowEval: false`; class lookup also uses `eval` |
  | Hidden bundled JavaScript model/import code | Same as inline code | no | Intentionally blocked when `security.allowEval` is false |
  | Remote API/model/import/Pyodide URLs | Matching `connect-src`, `script-src`, or worker/runtime directives | depends on model type | Blocked by `security.allowNetwork: false` unless explicitly allowed |
- **Streaming outputs (SSE)** — set `model.stream: true` for progressive GET/POST results on the main thread or in a worker. SSE frames join multiline `data:` fields and preserve `null`, `false`, `0`, and empty strings. `[DONE]` completes the invocation and releases its reader without waiting for the server to close; `event: error` rejects the run. Unsuccessful HTTP responses also reject, while ordinary data objects containing an `error` key remain model results. The last data frame is the pipeline result; EOF without a sentinel remains accepted, including legacy unterminated final frames. A presentation callback is optional. Node server-side execution streams sync/async generator results from local JavaScript models, and Python generators are auto-detected:
  ```python
  def stream_count(n: int = 5):
      for i in range(n):
          yield {'count': i}
  jsee.serve(stream_count, stream=True)
  ```
- **Stream cleanup and rendering** — Node and Python servers send generator failures as `event: error` frames followed by `[DONE]` once SSE headers have been sent. They close suspended generators when a response write detects disconnection; Node also releases waits for response backpressure. Producers blocked inside computation still need cooperative cancellation. Rendering copies result records before consuming metadata, so streamed pipeline fields such as `stop` survive. Chat records the user message once per run and does not append the last streamed assistant chunk again at completion; each partial chunk is a message, not an inferred text delta
- **Efficient binary outputs** — large base64 image data URLs (>50KB) in `image` outputs are automatically converted to `URL.createObjectURL()` blob URLs, reducing memory usage by ~33%. Previous blob URLs are revoked on each update
- **Typed array passing** — declare `arrayBuffer: true` on an input to convert JS arrays to typed arrays before passing to workers/WASM. Set `dtype` to control the type (`float32`, `float64`, `uint8`, `int32`, etc., default: `float64`). Typed-array conversions preserve numeric values and subarray boundaries; raw ArrayBuffer/DataView inputs retain byte interpretation. Worker requests use structured cloning so the caller can reuse its buffers on subsequent runs
  ```json
  "inputs": [{ "name": "data", "type": "string", "arrayBuffer": true, "dtype": "float32" }]
  ```
- Runtime cancellation: call `jsee.cancelCurrentRun()` on the JSEE instance to request stop of the active run. Long-running models should check `ctx.isCancelled()` and return early:
  ```javascript
  async function model (inputs, ctx) {
    for (let i = 0; i < inputs.steps; i++) {
      if (ctx.isCancelled()) throw new Error('Cancelled')
      await doStep(i)
      ctx.progress(Math.round(100 * (i + 1) / inputs.steps))
    }
    return { done: true }
  }
  ```
- Schema validation — JSEE validates schema structure during initialization and logs warnings for non-critical issues (e.g. unknown input types, malformed aliases)
- Invocation validation — Browser runs, CLI runs, and Node/Python model endpoints check declared types, option values, numeric bounds/steps, and required input presence before invoking a model. Invalid HTTP inputs return 400. APIs apply explicit defaults; UI/legacy CLI controls also retain their type-based initial values. `required: false` permits omission; `required: true` requires the field even when a default is advertised. UI-only validation expressions and nonempty-field checks remain control behavior
- Run lifecycle — Worker rebuilding reserves the run slot: overlapping automatic runs are dropped and manual runs queue. Stop aborts model-source fetches during rebuilding; stopped or failed rebuilds remain retryable and release partially initialized workers. A cancelled run cannot enter its first or a later pipeline stage. Main-thread initialization that cannot be interrupted keeps the slot until it settles. Invocation contexts guard supported callbacks; direct instance mutation and legacy raw worker `postMessage()` callbacks carry no such guard
- Shared input contracts — Named groups become nested objects; unnamed layout groups flatten into their containing object. Buttons are excluded. Option objects use `value`, then `name`, then `label`; numeric and boolean options retain their types. Positional JS models (`container: 'args'`) receive declared inputs in schema order, without extra caller metadata
- Legacy metadata — Browser `caller` and chat `history` injection never replaces declared computation inputs. Browser and CLI output lookup accept names, sanitized names, and string/array aliases inside output groups. Fields named `caller`, `stop`, `_status`, `_log`, and `_progress` stay hidden from automatic output discovery, but explicit output names/aliases can present them. A truthy `stop` still halts the pipeline, even if displayed as an output
- Legacy worker callbacks — Raw `postMessage()` progress/partial callbacks are accepted while the worker stage is pending and ignored after it settles. They have no invocation identity: a delayed raw message arriving during a later call cannot be attributed safely. Use invocation-bound `ctx.log()`/`ctx.progress()` for asynchronous callbacks; raw messages do not have their lifetime guarantee
- Instance state — JSEE copies descriptor containers before normalization and keeps mutable UI values separate. Reusing the same schema across instances does not share input values. Verbosity and embedded log sinks belong to each instance
- Input inference warnings — when `schema.inputs` is omitted and JSEE infers inputs from JavaScript function parameters, inferred inputs default to `string` for compatibility. JSEE logs warnings for inferred string inputs, numeric defaults, JSDoc numeric hints, and unsupported destructured parameters so authors know when to declare `schema.inputs` explicitly. Set top-level `inferInputTypes: true` to opt into inferred `number` controls from numeric defaults or numeric JSDoc and `checkbox` controls from boolean defaults or JSDoc
- `jsee.download(title)` — Downloads a self-contained HTML file that works offline. All external scripts are inlined and the schema/model/imports are cached in the same safe hidden-asset format used by `--bundle`. `title` defaults to `'output'`
- `page` (CLI only) — Page metadata for generated HTML:
  - `title` (string) — Page title
  - `url` (string) — Page URL
  - `ga` (string) — Google Analytics measurement ID (e.g. `"G-XXXXXXXXXX"`). Invalid IDs are omitted from generated HTML
  - `social` (object) — Social media links: `twitter`, `github`, `facebook`, `linkedin`, `instagram`, `youtube` (values are usernames/handles)
  - `org` (object) — Organization footer: `name`, `url`, `description`

## Smart output auto-detection

When outputs are not explicitly defined in the schema, or when a model returns keys that don't match any named output, JSEE infers the output type from the value:

| Value | Inferred type |
|---|---|
| Array of objects | `table` |
| Array of image URL strings (`.png`, `.jpg`, `.gif`, `.svg`, `.webp`) | `gallery` |
| Other arrays | `object` |
| `data:image/*` string | `image` |
| `data:audio/*` string | `audio` |
| `data:video/*` string | `video` |
| `data:application/pdf` string | `pdf` |
| String ending in `.png`, `.jpg`, `.gif`, `.svg`, `.webp` | `image` |
| String ending in `.mp3`, `.wav`, `.ogg`, `.flac` | `audio` |
| String ending in `.mp4`, `.webm`, `.mov` | `video` |
| String ending in `.pdf` | `pdf` |
| String ending in `.md` | `markdown` |
| String with newlines and > 200 characters | `code` |
| Other strings | `string` |
| Numbers, booleans | `string` |
| Objects | `object` |

## JSEE instance API

After creating an instance with `new JSEE({schema, container})`, these methods are available:

Multiple JSEE instances can run on the same page; progress and overlay DOM nodes are scoped per instance.

| Method | Description |
|---|---|
| `jsee.run(caller)` | Execute the model pipeline. `caller` can be `'run'`, `'autorun'`, `'reactive'`, `'interval'`, or a custom button name |
| `jsee.output(result)` | Process and render results to output cards |
| `jsee.cancelCurrentRun()` | Stop the active run. Rejects the current run promise, sets cancellation state, and signals/terminates workers |
| `jsee.isCancelled()` | Returns `true` if cancellation was requested |
| `jsee.progress(value)` | Set this instance's progress bar: `0`-`100` for determinate, `null` for indeterminate |
| `jsee.download(title)` | Export current app as a self-contained offline HTML file |
| `jsee.destroy()` | Cancel runs and initialization fetches, terminate workers, unmount Vue, and release UI resources. Repeated calls are safe; later runs return `false` and late progress/output calls are ignored |
| `jsee.notify(text)` | Show a success toast notification |
| `jsee.log(...args)` | Log to browser console and optional `#log` DOM element as plain text |

JSEE is part of the [StatSim](https://statsim.com) ecosystem. The schema/runtime contract is the public surface; lower-level packaging and renderer internals may continue to evolve.

## CLI — Node.js

```
jsee [schema.json|package] [data...] [options]
jsee init [template] [--html]
```

### Commands

#### `jsee init [template]`

Scaffold a new project. Templates: `minimal` (default), `chat`.

```bash
jsee init                   # schema.json + model.js + README.md
jsee init chat              # chat template
jsee init --html            # single index.html with CDN script
```

#### `jsee <schema|package> [data...]`

Start a dev server or generate a static HTML file from a local schema or a JSEE app package. Package inputs resolve the package `jsee` field, for example `{ "jsee": "schema.json" }`, and use the package directory as the app root. If the app package is not installed locally, let npm provide both packages with `npx -p @jseeio/jsee -p <package> jsee <package> --serve`.

```bash
jsee schema.json                       # dev server on localhost:3000
jsee schema.json --host 0.0.0.0        # expose dev server on the local network
jsee @statsim/gen --serve              # serve a resolvable JSEE app package
jsee schema.json -o app.html           # generate static HTML
jsee @statsim/gen -o app.html --bundle # bundled HTML from package app
jsee @statsim/gen --run --dataset Moons --nSamples 500
jsee @statsim/gen --run --dataset Moons --file moons.csv
npx -p @jseeio/jsee -p @statsim/gen jsee @statsim/gen --serve
```

JSEE app packages can also expose their own bin with `require('@jseeio/jsee').runPackage(__dirname, process.argv.slice(2))`. The helper reads the package `jsee` field, uses the package root as the app root, and forwards ordinary JSEE CLI options.

Use `--run` for one-shot CLI execution. With no output target, JSEE writes a pipeable stdout stream: a single `file` output writes its file content, a single text/table/object output writes that value, and multiple outputs write a JSON object. In `--run` mode, `--outputs <dir>` writes all outputs into a directory, while an output-name flag such as `--file moons.csv` or `--output-file moons.csv` writes one named output to a specific path.

### Options

| Flag | Description |
|---|---|
| `-i, --inputs <file>` | Input schema JSON file (default: `schema.json`) |
| `-o, --outputs <file>` | Output file path(s), comma-separated (HTML, JSON) |
| `-d, --description <file>` | Markdown file to include as app description |
| `--host <addr>` | Dev server host (default: `127.0.0.1`; use `0.0.0.0` to expose on the local network) |
| `-p, --port <number>` | Dev server port (default: `3000`) |
| `-v, --version <version>` | JSEE runtime version (`latest`, `dev`, or semver) |
| `-b, --bundle[=mode]` | Bundle runtime + all deps into a single offline HTML (`default`, `hybrid`, `pyodide`, `pyodide-single`, or `offline-strict`) |
| `-f, --fetch` | Backward-compatible alias for `--bundle` |
| `-s, --serve` | Serve explicitly (default when no output is provided) |
| `--run` | Execute the model once from the CLI and write pipeable outputs |
| `-e, --execute` | Run models server-side (auto-enabled when serving local .js models) |
| `--client` | Force client-side execution (disable auto server-side) |
| `-c, --cdn <url\|bool>` | Rewrite model URLs for CDN deployment |
| `-r, --runtime <mode>` | Runtime source: `auto\|local\|cdn\|inline` or a custom URL/path |
| `--verbose` | Enable verbose logging |
| `--help, -h` | Show usage info |

#### `--bundle`

Bundles everything into a single offline HTML: the JSEE runtime, model/view/render code, and all imports are stored in hidden base64 `<script data-src="..." data-encoding="base64">` elements. Local files are detected by checking the filesystem (so bare paths like `dist/core.js` work alongside `./relative.js`); anything not found locally is fetched from CDN.

When `security.allowEval` is false, hidden bundled JavaScript model/import code is intentionally blocked at runtime. Use a separate `type: "module"` model URL for the no-eval JavaScript path; set `worker: true` if that module should run in JSEE's Web Worker.

Model dependencies and schema `imports` are separate mechanisms: local model files that use `require()` or static `import`/`export` are bundled with optional `esbuild` during `--bundle`, so npm dependencies can become part of the generated HTML; schema `imports` remain explicit browser assets loaded before the model, such as CDN globals, local helper scripts, CSS files, Plot/Three/Leaflet, or other side-effect libraries.

For browser Python, `--bundle` caches a configured `model.pyodide.url` loader script when `model.pyodide` is explicit. Pyodide's WASM, stdlib zip, and package wheels are still loaded from `model.pyodide.indexURL`, so strict no-network Pyodide bundles require those Pyodide release assets. Use `--bundle=pyodide` to copy a local Pyodide asset directory, or fetch an explicit remote Pyodide `indexURL`, beside the generated HTML and rewrite the generated schema to the copied relative path. Use `--bundle=pyodide-single` to embed Pyodide core assets and declared package wheels into the HTML itself. Declare package wheels to fetch with `model.pyodide.packages` or Python-model `imports`; auto-detected Python imports are not bundled.

Bundle modes:
- `--bundle` or `--bundle=hybrid` keeps the compatibility behavior: JSEE inlines what it can and warns when configured Pyodide assets still point at a remote `indexURL`
- `--bundle=pyodide` requires explicit `model.pyodide` assets, copies a local `indexURL` directory or fetches a remote `indexURL` core asset set beside each generated HTML output, fetches declared package wheels from `pyodide-lock.json`, and caches the copied `pyodide.js` loader in hidden storage
- `--bundle=pyodide-single` requires explicit `model.pyodide` assets, embeds Pyodide core assets (`pyodide.asm.wasm`, stdlib zip, lock file, asm JS/module when present) plus declared package wheels into a hidden manifest, and rewrites generated Pyodide URLs to an in-page `jsee-pyodide://` asset shim
- `--bundle=offline-strict` fails generation if the bundle would still need runtime network for API models, remote model URLs, implicit default Pyodide, remote Pyodide `indexURL`, or a missing local Pyodide asset directory relative to the generated HTML file

#### `--runtime`

Select the runtime source for generated HTML:
- `auto` (default): `inline` when `--bundle`, otherwise `cdn` for file output and `local` for dev server
- `local`: `http://localhost:<port>/dist/...`
- `cdn`: jsdelivr CDN URL
- `inline`: embed runtime code directly in HTML
- Any other value is used as a custom `<script src="...">` path/URL

### Data inputs

Positional arguments after the schema file and named `--key=value` arguments are mapped to schema inputs. Values are auto-detected:

| Value | Detected as |
|---|---|
| `42`, `3.14` | Number |
| `'[1,2,3]'`, `'{"a":1}'` | JSON (array or object) |
| `data.csv` (existing file) | File path |
| `hello` | String |

Inputs set from the CLI are locked (non-editable) in the GUI and used as defaults for server-side execution.

```bash
# Positional — mapped to inputs in schema order
jsee schema.json 42 hello

# Named — matched by input name
jsee schema.json --a=100 --b=200

# File path
jsee schema.json data.csv

# Mixed
jsee schema.json data.csv --format=json
```

### Server-side execution

When serving (no `-o` flag), JSEE automatically enables server-side execution if all models point to local `.js` files. Use `--client` to force browser execution.

```bash
jsee schema.json              # auto server-side (local .js models)
jsee schema.json --client     # force browser execution
jsee schema.json -e -p 3000   # explicit server-side on port 3000
```

### File and folder serving

JSEE can serve individual files or entire folders without a schema or model:

```bash
jsee report.pdf                   # serve PDF with viewer
jsee photo.png                    # serve image
jsee data.csv                     # serve CSV as table
jsee data/                        # serve folder with file browser
```

For single files, JSEE auto-detects the output type from the file extension (image, pdf, audio, video, table, markdown, code). For folders, JSEE creates a file browser with selection checkboxes, stats summary, and a preview of the selected file.

The dev server file endpoints are app-root contained. `/__jsee/file` and `/__jsee/folder` only serve files under the schema/package root, or under the explicit file/folder path passed to identity serving (`jsee data/`, `jsee report.pdf`). Python schema static files are also contained to the schema root. Path traversal, symlinks that resolve outside the allowed root, dotfiles, and `node_modules` paths are denied.

Output type auto-detection also works for model results — if a model returns a string ending in `.png`, it renders as an image automatically.

### Serve bar

When serving, a top bar appears with the server address and, when server-side execution is active, a Browser/Server toggle to switch execution mode. Python-served pages also include a Save HTML button. Bundled generated output files show a Download HTML button instead of the serve bar.

## CLI — Python

```
jsee <target> [function] [data...] [options]
jsee init [template]
```

### Commands

#### `jsee init [template]`

Scaffold a new project. Templates: `minimal` (default), `chat`. Generates `schema.json` + `model.py` + `README.md`.

```bash
jsee init                   # minimal template
jsee init chat              # chat template
```

#### `jsee <file.py> <function> [data...]`

Serve a Python function as a web app with auto-generated GUI and REST API.

```bash
jsee example.py greet                  # serve function
jsee example.py greet --port=8080      # custom port
```

#### `jsee <schema.json>`

Serve from a pre-built schema file.

```bash
jsee schema.json
```

### Options

| Flag | Description |
|---|---|
| `--host <addr>` | Host to bind to (default: `127.0.0.1`; use `0.0.0.0` to expose on the local network) |
| `--port <number>` | Port to listen on (default: `5050`) |
| `--max-body-bytes <number>` | Positive request body limit in bytes (default: `52428800`, 50 MiB) |

### Data inputs

Same as Node.js — positional args after the function name and `--key=value` args are mapped to function parameters. Values are auto-detected (numbers, JSON, file paths, strings). Inputs set from the CLI are locked in the GUI.

```bash
jsee example.py greet Alice 5          # positional data
jsee example.py greet --name=Alice     # named data
jsee schema.json 42 hello              # positional data with schema
```

### API endpoints

Every server (both Node.js with `--execute` and Python) exposes these endpoints:

| Route | Method | Description |
|---|---|---|
| `/` | GET | Interactive GUI |
| `/api` | GET | Schema and endpoint discovery |
| `/api/openapi.json` | GET | Auto-generated OpenAPI 3.1 spec |
| `/{modelName}` | POST | Execute model with JSON or multipart input |

Both servers support `application/json` and `multipart/form-data` POST bodies, CORS (`Access-Control-Allow-Origin: *`), and return JSON errors for invalid requests. The Node dev server accepts JSON and multipart request bodies up to 50 MiB. Python `serve()` and `create_app()` share request decoding and default to the same 50 MiB limit; set a positive `max_body_bytes` or the Python CLI's `--max-body-bytes` to change it. Invalid lengths or input values return 400; declared oversized bodies return 413 before reading the body. This size limit does not provide execution isolation or a request deadline. Python `serve()` runs with a threaded dev server, awaits async model functions, and streams sync or async generator functions as SSE when `stream=True`.

The OpenAPI spec is generated from the same schema contract: request bodies include JSON inputs and multipart file uploads, responses include declared output properties (including outputs nested in groups), streaming models advertise `text/event-stream`, `schema.examples` become request examples, and standard JSON error responses are documented. This is descriptive only; the runtime response payload remains backward-compatible.

```bash
# Run the model via API (JSON)
curl -X POST http://localhost:3000/modelName \
  -H 'Content-Type: application/json' \
  -d '{"x": 3, "y": 4}'

# Run with file upload (multipart)
curl -X POST http://localhost:3000/modelName \
  -F 'text=hello' \
  -F 'file=@image.png'

# Get OpenAPI spec
curl http://localhost:3000/api/openapi.json
```

#### Return value serialization

Both servers normalize model return values consistently:

| Return type | JSON response |
|---|---|
| Object/dict | returned as-is |
| Primitive (number, string, bool) | `{"result": value}` |
| Tuple/list (Python) | `{"result": [a, b]}` |
| Buffer/bytes | MIME-sniffed data URL, e.g. `{"result": "data:application/pdf;base64,..."}` |
| PIL Image (Python) | `{"result": "data:image/png;base64,..."}` |
| list[dict] (Python) | `{"result": {"columns": [...], "rows": [...]}}` |

## Python

JSEE also ships a Python package (`py/`) that turns Python functions into web apps with the same GUI and API. Zero dependencies beyond Python stdlib.

After building the browser assets from the repository root:

```bash
python -m pip install -e ./py
jsee example.py sum
```

Or programmatically:
```python
from typing import Annotated, Literal
import jsee

def calculator(
    num1: float,
    op: Literal['add', 'subtract', 'multiply', 'divide'],
    num2: float,
    precision: Annotated[int, jsee.Slider(0, 10)] = 2
) -> dict:
    """A simple calculator"""
    ops = {'add': num1 + num2, 'subtract': num1 - num2,
           'multiply': num1 * num2, 'divide': num1 / num2 if num2 else 0}
    return {'result': round(ops[op], precision)}

jsee.serve(calculator, port=5050)
```

Python type hints are auto-mapped to GUI widgets: `Literal` → dropdown, `Annotated[float, jsee.Slider()]` → slider, `bool` → checkbox, `Enum` → dropdown. See [`py/README.md`](py/README.md) for full Python documentation.

### WSGI deployment

For production deployment, use `create_app()` to get a standard WSGI application:

```python
# app.py
import jsee

def multiply(x: float = 5) -> dict:
    return {'result': x * 2}

app = jsee.create_app(multiply)
```

Deploy with gunicorn, uWSGI, or any WSGI server:
```bash
gunicorn app:app
```

`create_app()` accepts the same arguments as `serve()` — functions, dicts, or schema.json paths. Async functions are awaited before JSON serialization. Sync and async generators stream SSE using the same framing and error handling as `serve()`. The WSGI host pulls one chunk at a time and must close the response iterable on disconnect so suspended generators can finish cleanup. Async generators retain one task and context through iteration and cleanup.

Python stages from the same source file share one module instance within an application; separate applications load separate instances. Explicit model names must identify callables, and duplicate endpoint names fail before model code is imported. Unnamed models infer a public callable defined in that file and expose it at `/model`.

## Repository verification

`npm run build` builds browser assets, copies them into the maintained Python package, and runs types, unit tests, and the standard Playwright suite. `npm run test:python-native` checks the native runtime and builds/installs packages outside the checkout. After installing `./py[server]`, run `npm run test:mcp` for independent SDK client/server checks. Set `JSEE_MCP_PYTHON` to use a separate Python executable.

The additional app suites exercise real computation:

| Command | Coverage |
|---|---|
| `npm run test:python` | Pinned Pyodide/NumPy, repeated entry calls, addition and CSV summary on the main thread and in workers |
| `python -m pip install -r test/python/requirements.txt` then `npm run test:python-apps-native` | Native pandas summary against the same CSV/result fixtures as Pyodide |
| `npm run test:ml` | GPT-2 text generation and camera → CLIP worker → view, with pinned weights and dependencies |

The app suites verify assets against `test/fixtures/runtime-assets.json`, downloading missing files into ignored `tmp/test-assets/`. Python assets use about 55 MB; ML assets use about 1.12 GB. These are download sizes, not runtime memory requirements. Browser requests use local assets; ML tests redirect the original apps' known external URLs to the pinned copies and block other external requests. GPT-2 is rebuilt from its reviewed source and lockfile with dependency installation scripts disabled. The tests use genuine model inference and a deterministic simulated camera frame.

`test/fixtures/real-apps/manifest.json` records source hashes, origins, and intentional repairs to historical examples. Generated bundles, model weights, and dependency trees are excluded from Git and package contents. The default unit suite requires neither those dependencies nor model downloads. Pyodide remains pinned to 0.24.1 for compatibility; this coverage does not establish support for every newer Pyodide release.

Shared version numbers identify tested contracts, with these runtime differences:

| Contract | Browser | Node | Native Python |
|---|---|---|---|
| Groups, defaults, options, numeric constraints | Shared fixtures | Shared fixtures | Shared fixtures |
| Custom input expressions and nonempty controls | UI validation | Not evaluated | Not evaluated |
| Pipeline execution | Browser orchestrates stages | `invokeSchema`, JSON CLI, canonical HTTP and MCP execute JS pipelines; legacy stages remain | `invoke_schema`, JSON CLI, canonical HTTP/WSGI and MCP execute Python pipelines; legacy stages remain |
| Python callable selection | Pyodide `entry` | Not a native Python runtime | `entry`, with a separate endpoint `name` |
| Interruption | Worker termination; cooperative main-thread and fetch cancellation | No OS containment | Stream cleanup; no forced interruption of arbitrary model code |

### Whole-pipeline invocation

Node exports `invokeSchema(schema, inputs, { schemaPath, cwd, log })` from `@jseeio/jsee/cli`. Python exports async `invoke_schema(schema, inputs, cwd='.')` from `jsee`. Both validate inputs before importing models, apply declared defaults, and execute the complete `model` pipeline. See the [clean sales example](examples/clean-sales/README.md) for JavaScript, Python, and a generated offline form with a CSV download.

The returned envelope is `{ runId, status: 'succeeded', result }` or `{ runId, status: 'failed', error: { code, message } }`. Each call gets a new run ID; model fields named `status` or `runId` remain inside `result`. Error codes are `JSEE_SCHEMA_INVALID`, `JSEE_INPUT_INVALID`, `JSEE_CAPABILITY_UNSUPPORTED`, and `JSEE_EXECUTION_FAILED`. These checks cover invocation prerequisites and existing input-value rules; full descriptor authoring validation remains separate.

Results retain accumulated pipeline data, including intermediate values. Only records merge; arrays, scalars and null replace the previous value. Python `None` corresponds to JS null; JavaScript's undefined retains the previous value. The existing truthy `stop` field stops later stages. JSON input containers are copied before execution. Runtime values are returned directly, without HTTP serialization or file persistence.

This initial interface supports local JS functions/classes/async initializers and native Python sync/async functions in files. Python uses keyword binding by default and schema input order for `container: 'args'`. Python stages retain the loader's unique-name requirement. Schema imports, remote models, and streaming are rejected explicitly; normal imports inside model source remain usable. Calls execute on the caller's thread without forced interruption, worker isolation, or enforcement of browser timeout/security flags.

### JSON commands and canonical HTTP

The Node and Python CLIs accept the same descriptor commands. Use a JS model descriptor with Node and a Python model descriptor with Python:

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 3000
```

`inspect` reports input/output JSON Schemas and runtime capabilities without importing models. `validate` checks computation structure, names, known field types, numeric constraints and defaults. It requires a model; render-only descriptors remain valid for the browser. Neither command tests model availability, executes custom browser validation expressions, or validates every UI extension. The full authoring vocabulary remains available in `schema.json`.

`run` reads UTF-8 JSON from stdin by default (`--input -`), or from the selected file. It writes one JSON envelope to stdout; model diagnostics go to stderr. Successful calls return `{runId, status: "succeeded", outputs, artifacts}`. Failed calls return `{runId, status: "failed", error: {code, message}}`. Exit codes are 0 for success, 2 for descriptor/JSON-request errors, and 1 for invocation or output failures.

`outputs` contains declared, flattened output names, using existing alias lookup. Accumulated inputs and undeclared intermediates are omitted. Missing outputs and non-JSON values fail with `JSEE_OUTPUT_INVALID`. Invalid values report their path and kind, for example `info.a: undefined is not a JSON value`. Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) fail at any depth; they are never silently replaced by null. Canonical CLI/HTTP/MCP results are checked against the generated output schema before files are stored: numeric/string/boolean types, table containers, and declared media fields. This validates the built-in schema shapes, not chart semantics or arbitrary custom JSON Schema. An `object` output accepts any JSON value. Declare binary data as `type: "file"`.

File outputs accept text or bytes, directly or in a descriptor with `content`, `value`, or `data`, plus optional `filename` and `mime`. A file output becomes `{artifact: "<runId>/<index>"}`. The corresponding `artifacts` entry contains `id`, `output`, `name`, `mime`, `size` in bytes, `sha256`, and `uri`. Model-provided paths and URLs are never read or fetched by this adapter. CLI files persist under `.jsee-artifacts/` in the working directory (change with `--artifact-dir`) and use `file:` URIs.

Canonical serving adds these routes to the existing UI and per-stage endpoints:

| Route | Result |
|---|---|
| `GET /schema` | Computation descriptor retaining local model references |
| `GET /openapi.json` | Whole-pipeline request, response and artifact descriptions |
| `POST /run` | Execute the entire pipeline with a JSON input object |
| `POST /__jsee/artifacts?name=data.csv` | Upload raw bytes; Content-Type declares MIME; returns `{artifact, metadata}` |
| `GET /__jsee/artifacts/<runId>/<index>` | Download the referenced file as an attachment |

A stage named `run` conflicts with canonical `/run` and is rejected before loading. Rename that stage or retain the legacy serving command. Existing `jsee schema.json --run`, `--serve`, and `-o index.html -f` forms keep their behavior. Python also accepts `serve(path, canonical=True)` and `create_app(path, canonical=True)`; call the WSGI application's `close()` when retiring it.

Requests default to a 50 MiB limit (`--max-body-bytes`). Artifact storage defaults to 64 MiB and 1,024 files per server or persistent CLI artifact directory (`--max-artifact-bytes` changes the byte limit). A batch exceeding the quota fails without publishing partial artifacts. Artifact downloads verify size/SHA256 and return 409 if stored bytes changed. HTTP files live in a private temporary directory until server shutdown; a killed process can leave temporary files for host cleanup. HTTP URIs are relative to that server and do not survive a restart. Retained input/output artifacts and pending uploads share the quota; a transform retaining both a large input and output may need a larger store. Quotas do not bound model allocations or computation time.

Ordinary `type: "file"` inputs accept inline text or an existing `{ "artifact": "<runId>/<index>" }` handle. References resolve in the current store before model execution: ordinary files become strict UTF-8 text, while `arrayBuffer: true` becomes ArrayBuffer in JS or bytes in native Python. Legacy inline numeric arrays keep their existing meaning. Raw/stream file modes retain their separate semantics and do not accept artifact references.

An output reference can be passed unchanged to the next run. The ID is scoped to the store; SHA256 is integrity metadata, not an access key. Invalid, foreign or unavailable IDs, changed file bytes and MIME mismatches fail as invalid inputs. Strings are never implicitly opened as paths or URLs. In-process `invokeSchema(..., {artifactStore})` and `invoke_schema(..., artifact_store=...)` can use the existing transport module's ArtifactStore; calls without a store reject references.

```sh
# Both Node and Python CLIs; output is {artifact, metadata}.
jsee artifact-import sales.csv --mime text/csv --artifact-dir .jsee-artifacts
# Put {"csv":{"artifact":"<returned ID>"},"missing":"drop"} in input.json.
jsee run schema.json --input input.json --artifact-dir .jsee-artifacts
```

CLI registrations persist alongside bytes, so subsequent invocations can reuse handles. Registrations created before this feature cannot be recovered from old bare files. Writers serialize publication with `.write-lock`; after an interrupted CLI write, verify that no writer remains before removing that lock. HTTP registrations last until host shutdown; MCP registrations last for the session. Moving a file to another host/session requires explicit download/upload. The JSON request and raw HTTP upload limits are both controlled by `--max-body-bytes`; ingestion does not remove store quotas.

Canonical `/run` accepts JSON only, returns 400 for invalid inputs, 413 for excessive bodies, 415 for other content types, 422 for unsupported execution capabilities, 500 for model/output errors, and 507 for artifact quota failures. Canonical serving applies same-origin access to every route by default, including legacy endpoints and static files. Legacy serving commands retain wildcard CORS until host policy is explicitly configured. Servers default to localhost. Authentication and CORS are configured for the whole host as described below. Existing security flags gate JSEE-managed operations and do not provide an OS sandbox. Remote MCP, streaming/cancellation through the canonical operation, and multi-descriptor serving remain future work.

### HTTP authentication and CORS

The same host policy covers the UI, runtime/model files, discovery, canonical and legacy API routes, streams, artifacts, and error responses. Configure it with either CLI:

```sh
# Read an existing shared token from APP_TOKEN; its value stays out of argv.
jsee serve schema.json --auth-token-env APP_TOKEN
jsee serve schema.json --auth-token-env APP_TOKEN --cors-origin https://client.example
```

Alternatively use `--auth-token TOKEN`. The options also work with legacy serving commands. Python `serve()` and `create_app()` accept `auth_token`, `auth_token_env`, and `cors_origins` (a list). Token configuration is validated before importing descriptor models; missing/empty environment values fail startup. Auth/CORS flags are server-only and cannot become schema defaults, model inputs or verbose argv output. They are rejected in MCP stdio and JSON command modes.

Clients send `Authorization: Bearer TOKEN`. Browsers use the built-in HTTP login prompt: username `jsee`, password the same token. Both authenticate every actual request; there are no public UI, asset or discovery bypasses. Tokens are never embedded in generated HTML or schemas. Missing/invalid credentials return JSON 401 with authentication challenges. Authenticated responses use `Cache-Control: no-store`, including streams and downloads. OpenAPI declares Bearer and Basic as alternatives.

| Setting | Origin policy |
|---|---|
| `jsee serve schema.json` | Same-origin browser requests and requests without Origin; external origins return 403 |
| Legacy serving, no policy options | Wildcard CORS retained for compatibility, now applied consistently to all routes |
| Any authentication option | Same-origin by default, including legacy serving |
| `--cors-origin https://client.example` | Also allow that exact origin; repeat for more origins |
| `--cors-origin none` / Python `cors_origins=[]` | Same-origin only |
| `--cors-origin '*'` | Public cross-origin access; incompatible with authentication |

Origins must use their serialized HTTP(S) form, without paths, trailing slashes, user info or explicit default ports. Authenticated/explicit-origin policies reject opaque `null` origins. Requests without Origin still require authentication when configured. CORS controls browser access; it does not authenticate callers.

Allowed preflights return 204 without credentials and permit `Authorization`/`Content-Type` for GET, HEAD, POST and OPTIONS. The actual request still needs credentials. Disallowed origins, requested methods or headers fail before routing/body parsing. CORS headers also cover authorized-origin error responses; `Vary: Origin` prevents mixing origins in caches. File attachment names are exposed through `Content-Disposition`.

Serve credentials over HTTPS through a trusted TLS proxy, or use an SSH tunnel. For a TLS proxy, explicitly allow its public HTTPS origin; JSEE does not trust forwarded headers. Runtime URLs in served Node pages are relative, so they retain the browser's host, scheme and authentication. This is shared-token access control, with no user accounts, OAuth, per-tool permissions or execution sandbox. See the [Bearer](https://www.rfc-editor.org/rfc/rfc6750.html#section-2.1), [Basic](https://www.rfc-editor.org/rfc/rfc7617.html) and [CORS](https://fetch.spec.whatwg.org/#http-cors-protocol) standards.

### MCP over stdio

Start one descriptor as an MCP tool with `jsee serve schema.json --mcp-only`. This mode uses stdin/stdout for MCP and stderr for model diagnostics; it opens no HTTP listener. Node requires Node.js 20+ and uses the official `@modelcontextprotocol/server` SDK (2.0.0). Native Python requires Python 3.10+ and the optional `server` extra (`mcp` 2.2.0); install the checkout with `python -m pip install './py[server]'` after the runtime build. Python's base installation remains stdlib-only.

Configure an MCP client to launch the installed `jsee` executable with arguments `['serve', '/absolute/path/schema.json', '--mcp-only']`. Use the executable belonging to the descriptor's language. For a Node checkout, use command `node` and prepend `/absolute/path/jsee/bin/jsee` to those arguments.

`tools/list` derives a computation tool from the descriptor's stable `id`, title, description and input schema without importing model code. `tools/call` executes the same whole-pipeline invocation as JSON CLI/HTTP. Success returns the complete `{runId, status, outputs, artifacts}` envelope as `structuredContent` and JSON text, with its generated `outputSchema`. Invalid inputs, execution/output failures and artifact quota failures return `isError: true` and the failed envelope as text. Unknown tools or artifact URIs produce protocol errors.

File results include `resource_link` entries with session-scoped `jsee-artifact:` URIs. `resources/list` exposes metadata; `resources/read` returns exact bytes as a base64 blob only when requested. Verify the decoded bytes against `size` and `sha256` in the run envelope. Store limits remain 64 MiB/1,024 files per session (`--max-artifact-bytes` changes bytes); rejected batches expose no files. Files disappear on orderly close or SIGTERM and cannot be retrieved by another session. SIGKILL or a crash can leave temporary files.

`--max-body-bytes` bounds decoded arguments (50 MiB by default); Node also applies that limit to its incoming wire buffer, including protocol overhead. Python's SDK reads a message before JSEE checks its arguments. These limits do not bound model memory. A resource read returns the entire file: base64 adds overhead, and the client's message limit may be lower than the store quota. Large-file chunking is not implemented.

`tools/list` also advertises `upload_artifact` (`jsee_upload_artifact` if that name is already the computation ID). Send `{data: "<base64>", name: "data.csv", mime: "text/csv", offset: 0}` to start; continue with the returned `upload` ID and `offset`. Each chunk is at most 262,144 decoded bytes. Set `final: true` to publish `{artifact, metadata}`, then pass `{artifact: result.artifact}` to a compatible input. Set `{upload: id, cancel: true}` to discard an incomplete upload. Up to 16 incomplete uploads share the store byte quota; incomplete bytes are never listed as resources. The client transfers file chunks, so the model need not include file contents in its computation arguments. Configure client/server message limits to fit the base64 chunk plus protocol overhead.

Independent Node and Python SDK clients test both servers in legacy negotiation and protocol 2026-07-28 mode, including the [clean sales workflow](examples/clean-sales/README.md). MCP calls use the existing programmatic invocation lifecycle; persistent model state across calls is not a portable contract. This adapter supports terminal calls for one descriptor. Remote MCP, streams and forced cancellation remain pending; HTTP authentication is separate from stdio process access. Model source is trusted code; stdio separation is not a sandbox.

## Changelog

See `CHANGELOG.md`.
