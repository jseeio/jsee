# JSEE

Portable, schema-driven web apps for local computation.

JSEE turns a model function plus a small JSON schema into a reactive browser app, CLI-served tool, offline HTML bundle and API surface. It is meant for computations that should be easy to share, inspect, rerun and keep on the user's machine.

Use JSEE when you want:

- a self-contained UI around a JavaScript, Python, API, or WASM computation
- typed inputs, output rendering, file/folder handling, progress, and cancellation without writing app plumbing
- browser-first execution with optional Worker isolation and offline bundling
- the same computation exposed to humans through a UI and to tools through HTTP/API routes

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

**Browser CDN:**

```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.core.js"></script>
```

Pin a version for production, for example `@jseeio/jsee@0.8.8`.

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
 USER  ◄-►   │   GUI   │ ◄--►  │  Pipeline   │ ◄~ tf.js
              │  Vue 3  │       │  Model(s)   │ ◄~ wasm
              └─────────┘       └─────────────┘
                                  WebWorker*

 * - optional
```

### Initialization

1. **Schema** is loaded from a URL, DOM element, function, or JS object
2. **Validation** checks schema structure and logs warnings for issues
3. **Imports** are resolved — JS scripts are loaded in sequence, CSS files are injected as `<link>` tags. In the browser, relative paths resolve against the page URL. In `--bundle` mode, the CLI checks the local filesystem first
4. **Models** initialize — code is loaded from `url`, `code`, or a hidden DOM cache (`data-src` elements used by `--bundle` output and `download()`)
5. **GUI** is created — a Vue 3 app with reactive inputs, output cards, run/stop buttons and progress bar
6. **URL params** are applied — query string values (`?name=value`) set matching inputs, including `alias` matches. File URL params auto-load on init

### Execution

- **Run**: user clicks Run (or autorun/reactive triggers it). Inputs are collected and sent to the model
- **Pipeline**: when `model` is an array, models execute sequentially — each receives the merged output of the previous one. Return `{ stop: true }` to halt early
- **Runtime context**: object-container models receive a second argument (`ctx`) with `ctx.log()`, `ctx.progress(value)` (0–100 or `null` for indeterminate), and `ctx.isCancelled()` for cooperative cancellation
- **Cancellation**: `jsee.cancelCurrentRun()` or the Stop button rejects the active run, signals workers, and marks stale results so they are ignored. Worker-backed models can be terminated. Main-thread models should check `ctx.isCancelled()` inside long async loops because JavaScript cannot preempt synchronous CPU-bound code on the main thread
- **Output**: results flow to the output cards — JSON trees, HTML, SVG, code blocks, or custom render functions

### Offline & bundling

- **`jsee --bundle`** bundles everything into a single HTML file: the JSEE runtime, model/view/render code, and all imports are stored in hidden `<script data-src="...">` elements. The result works with no network
- **`jsee.download(title)`** does the same at runtime — exports the current app as a self-contained HTML file

## Schema blocks

JSEE takes a schema object that contains three main blocks:

- `model` — describes a model/script/API (its location, is it a function or class, should it be called automatically on every GUI change or not)
- `inputs` — list of inputs and their descriptions
- `outputs` — list of outputs and their descriptions

Extra blocks can be provided for further customization:

- `render` / `view` — visualization part (optional). Defines custom rendering code
- `design` — overall appearance (optional). Defines how the app looks overwriting defaults
- `imports` — a list of scripts and stylesheets to load before the model is initialized. CSS files (`.css` extension) are injected as `<link rel="stylesheet">` in `<head>`, JS files are loaded as scripts. In the browser, relative paths (e.g. `dist/core.js`, `./lib.js`) resolve against the page URL. With `--bundle`, the CLI resolves imports by checking the local filesystem first — if a file exists on disk it is bundled; otherwise it is fetched from CDN

  ```json
  "imports": [
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs",
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
  - `code` (function) — It's possible to pass code directly to JSEE instead of using an URL
  - `name` (string) — Name of the executed object. Default value is taken from `url` or `code`
  - `type` (string, default — `function`) — What kind of script is loaded. Influences how the code is initialized. Possible values:
    - `function`
    - `class`
    - `async-function`
    - `async-init`
    - `py`
    - `tf`
    - Inference note: when `code` is present (including code loaded from a `.js` URL), JSEE treats the model as `function` unless `type` is explicitly set
  - `method` (string) — If `type` is `class`, `method` defines the name of the class method to call during evaluation
  - `container` (string) — How input values are passed to the function/method:
    - `object` (default) — Pass inputs wrapped in an object, i.e. `{'x': 1, 'y': 2}`
    - `args` — Pass inputs as separate arguments
    - In `object` mode, JavaScript models receive the runtime context as a second argument: `function model(inputs, ctx) { ... }`
  - `worker` (boolean) — If `true`, JSEE initializes a Web Worker to run the script
    - `ctx.log(...args)` — Write runtime logs
    - `ctx.progress(value)` — Report progress (`0..100` or `null` for indeterminate)
    - `ctx.isCancelled()` — Check cooperative cancellation state (useful in long loops/streams)
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
    - `file` — File Input
    - `folder` — Directory input. Shows a file listing with optional selection. In the browser, uses `<input webkitdirectory>` or drag-drop. On the server, reads from a directory path. Returns array of `{name, path, size, type, selected}` objects. Props:
      - `select` (boolean) — Show checkboxes for file selection (default: all files passed)
      - `reactive` (boolean) — Trigger model run on selection change
    - `action` or `button` — Button (its `name` will be passed as a `caller` to the model)
  - `default` — Default value
  - `alias` (string or array of strings) — Alternative names for URL parameter matching. E.g. `"alias": ["f", "file"]` allows `?f=value` or `?file=value` to set this input
  - `display` (string) — Filtrex expression to conditionally show/hide this input. Evaluated against current input values. E.g. `"display": "mode == 'advanced'"` shows the input only when `mode` is `"advanced"`. Supports `len()` for string length
  - `reactive` (boolean) — Trigger a model run when this input changes (see **Execution triggers** below)
  - `disabled` (boolean) — Disables the input in the UI. When combined with `reactive: true`, triggers an initial model run on page load (useful for server-populated values)
  - `enter` (boolean) — If `true` on a `string` input, pressing Enter triggers a model run (useful for chat or search inputs)
  - `raw` (boolean, file input only) — If `true`, pass the raw source to the model instead of reading text in the UI (`File` object for disk files or `{ kind: 'url', url: '...' }` for URL input)
  - `stream` (boolean, file input only) — If `true`, pass an async iterable `ChunkedReader` to the model instead of raw source handles. Supports `for await (const chunk of reader)`, `await reader.text()`, `await reader.bytes()`, and `for await (const line of reader.lines())`. Works in both main-thread and worker execution. Reader metadata (`reader.name`, `reader.size`, `reader.type`) is preserved and remains available in downstream pipeline models
  - `validate` (string) — Filtrex expression for input validation. The variable `value` holds the current input value. Expression must return truthy for valid input. E.g. `"validate": "value >= 0 and value <= 150"`. Runs on every input change (debounced). Invalid inputs show an error message and block model execution
  - `required` (boolean) — Shorthand validation: rejects empty strings, null, undefined, and empty arrays
  - `error` (string) — Custom error message for `validate` or `required` failures (default: `"Invalid value"` / `"Required"`)
  - `columns` (number, 1-12) — Grid column span for this input. When any input has `columns`, the inputs section switches to a 12-column CSS grid. E.g. `"columns": 6` makes the input take half width
  - URL params for file inputs (e.g. `?file=https://...`) auto-load on init, so bookmarkable links run without an extra Load click
- `outputs` — Outputs definition. Outputs also support `alias` (string) for matching model result keys by alternative names. Per-output `columns` (number, 1-12) sets grid column span, same as inputs
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
  - `interval` (number, default: `0`) — repeat execution every N milliseconds. `0` means no repetition
  - Per-input `reactive` — set `reactive: true` on an **individual input** to trigger a model run only when that specific input changes (fires immediately, not debounced). Other inputs still require a manual Run click. Useful when one input is interactive (e.g. a slider) but others are expensive to recompute

  | Option | Scope | When it runs | Debounced |
  |--------|-------|-------------|-----------|
  | `autorun: true` | schema | once on load | no |
  | `reactive: true` | schema | every input change | yes (300ms) |
  | `reactive: true` | input | that input changes | no |
  | `interval: N` | schema | every N ms | no |
- **Chat mode** — declare an output with `"type": "chat"` to enable conversational UI. The runtime manages state:
  1. User types a message in a text input and presses Run (or Enter if the input has `"enter": true`)
  2. The runtime injects `history` (array of `{role, content}` dicts) into the model payload alongside the user's `message`
  3. The model returns `{chat: "response string"}` (or `{chat: {role, content}}`)
  4. The runtime appends both the user message and assistant response to the chat output's internal `_messages` array, clears the input, and auto-scrolls
  5. Messages render with Markdown support (code blocks, bold, links, tables)

  Works with both Workers (postMessage) and server POST — no special execution mode needed. Python shorthand: `jsee.serve(fn, chat=True)` auto-generates the schema from `fn(message, history) -> str`

- **Input persistence** — by default, JSEE saves input values to `localStorage` and restores them on page refresh. Priority: URL params > localStorage > schema defaults. Set `persist: false` in the schema to disable. Clicking Reset clears saved values
- **Notifications** — set `notify: true` in the schema to show a browser notification when a run completes while the tab is hidden. JSEE requests permission on first load and fires `new Notification()` after successful runs only
- **Streaming outputs (SSE)** — set `model.stream: true` to enable Server-Sent Events streaming. The POST handler reads `text/event-stream` responses and calls `output()` on each `data:` line for progressive results. Python generators are auto-detected:
  ```python
  def stream_count(n: int = 5):
      for i in range(n):
          yield {'count': i}
  jsee.serve(stream_count, stream=True)
  ```
- **Efficient binary outputs** — large base64 image data URLs (>50KB) in `image` outputs are automatically converted to `URL.createObjectURL()` blob URLs, reducing memory usage by ~33%. Previous blob URLs are revoked on each update
- **Typed array passing** — declare `arrayBuffer: true` on an input to convert JS arrays to typed arrays before passing to workers/WASM. Set `dtype` to control the type (`float32`, `float64`, `uint8`, `int32`, etc., default: `float64`). Typed arrays are transferred with zero-copy semantics via `postMessage` transferables
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
- `jsee.download(title)` — Downloads a self-contained HTML file that works offline. All external scripts are inlined and the schema/model/imports are cached. `title` defaults to `'output'`
- `page` (CLI only) — Page metadata for generated HTML:
  - `title` (string) — Page title
  - `url` (string) — Page URL
  - `ga` (string) — Google Analytics measurement ID (e.g. `"G-XXXXXXXXXX"`)
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

| Method | Description |
|---|---|
| `jsee.run(caller)` | Execute the model pipeline. `caller` can be `'run'`, `'autorun'`, `'reactive'`, or a custom button name |
| `jsee.output(result)` | Process and render results to output cards |
| `jsee.cancelCurrentRun()` | Stop the active run. Rejects the current run promise, sets cancellation state, and signals/terminates workers |
| `jsee.isCancelled()` | Returns `true` if cancellation was requested |
| `jsee.progress(value)` | Set progress bar: `0`-`100` for determinate, `null` for indeterminate |
| `jsee.download(title)` | Export current app as a self-contained offline HTML file |
| `jsee.destroy()` | Cleanup: cancel runs, terminate workers, unmount Vue app, revoke blob URLs |
| `jsee.notify(text)` | Show a success toast notification |
| `jsee.log(...args)` | Log to browser console and optional `#log` DOM element |

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
jsee schema.json                       # dev server on port 3000
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
| `-p, --port <number>` | Dev server port (default: `3000`) |
| `-v, --version <version>` | JSEE runtime version (`latest`, `dev`, or semver) |
| `-b, --bundle` | Bundle runtime + all deps into a single offline HTML |
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

Bundles everything into a single offline HTML: the JSEE runtime, model/view/render code, and all imports are stored in hidden `<script data-src="...">` elements. Local files are detected by checking the filesystem (so bare paths like `dist/core.js` work alongside `./relative.js`); anything not found locally is fetched from CDN.

Model dependencies and schema `imports` are separate mechanisms: local model files that use `require()` or static `import`/`export` are bundled with optional `esbuild` during `--bundle`, so npm dependencies can become part of the generated HTML; schema `imports` remain explicit browser assets loaded before the model, such as CDN globals, local helper scripts, CSS files, Plot/Three/Leaflet, or other side-effect libraries.

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

Output type auto-detection also works for model results — if a model returns a string ending in `.png`, it renders as an image automatically.

### Serve bar

When serving, a top bar appears with the server address, a Save HTML button, and (when server-side execution is active) a Browser/Server toggle to switch execution mode. Input values are preserved across the switch via localStorage. The serve bar is not included in generated output files or saved bundles.

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
| `--host <addr>` | Host to bind to (default: `0.0.0.0`) |
| `--port <number>` | Port to listen on (default: `5050`) |

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

Both servers support `application/json` and `multipart/form-data` POST bodies, CORS (`Access-Control-Allow-Origin: *`), and return consistent JSON errors for 404/400/500.

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
| Buffer/bytes | `{"result": "data:image/png;base64,..."}` |
| PIL Image (Python) | `{"result": "data:image/png;base64,..."}` |
| list[dict] (Python) | `{"result": {"columns": [...], "rows": [...]}}` |

## Python

JSEE also ships a Python package (`py/`) that turns Python functions into web apps with the same GUI and API. Zero dependencies beyond Python stdlib.

```bash
cd py && pip install -e .
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

`create_app()` accepts the same arguments as `serve()` — functions, dicts, or schema.json paths. Note: SSE streaming is not supported in basic WSGI.

## Changelog

See `CHANGELOG.md`.
