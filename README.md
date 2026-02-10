# JSEE. Computational Documents for the Web

Turn code into a shareable, offline-capable web app. Describe inputs/outputs once (JSON), run JS/Python in a Worker or via API, and ship as a single HTML file.

Minimal example:
```html
<html>
  <div id="jsee-container">
  <script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.runtime.js"></script>
  <script>
    function mul (a, b) {
      return a * b
    }
    new JSEE(mul, '#jsee-container')
  </script>
</html>
```

↳ [Result](https://jsee.org/test/minimal1.html)

## Installation

**Browser (CDN):**
```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.runtime.js"></script>
```

**npm (for CLI or Node.js projects):**
```bash
npm install @jseeio/jsee
```

**CLI (generate standalone apps):**
```bash
npx @jseeio/jsee schema.json -o app.html
```

Run `jsee --help` for all CLI options.

## Inputs and outputs

JSEE works best with functional tasks and one-way flow from inputs to outputs (i.e., inputs → processing → outputs). You can also extend it to more complex scenarios, like inputs → preprocessing → updated inputs → processing → outputs or inputs → processing → outputs → custom renderer. Even though many computational tasks have a functional form, some problems require more complex interactions between a user interface and code. For such cases, JSEE is probably too constrained. That makes it not as universal as R's [shiny](https://shiny.rstudio.com/) or Python's [streamlit](https://streamlit.io/).

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
3. **Imports** are resolved — JS scripts are loaded in sequence, CSS files are injected as `<link>` tags. In the browser, relative paths resolve against the page URL. In `--fetch` mode, the CLI checks the local filesystem first
4. **Models** initialize — code is loaded from `url`, `code`, or a hidden DOM cache (`data-src` elements used by `--fetch` bundles and `download()`)
5. **GUI** is created — a Vue 3 app with reactive inputs, output cards, run/stop buttons and progress bar
6. **URL params** are applied — query string values (`?name=value`) set matching inputs, including `alias` matches. File URL params auto-load on init

### Execution

- **Run**: user clicks Run (or autorun/reactive triggers it). Inputs are collected and sent to the model
- **Pipeline**: when `model` is an array, models execute sequentially — each receives the merged output of the previous one. Return `{ stop: true }` to halt early
- **Worker context**: worker models receive a runtime context (`ctx`) with `ctx.log()`, `ctx.progress(value)` (0–100 or `null` for indeterminate), and `ctx.isCancelled()` for cooperative cancellation
- **Cancellation**: `jsee.cancelCurrentRun()` or the Stop button sets a flag that workers and stream readers check
- **Output**: results flow to the output cards — JSON trees, HTML, SVG, code blocks, or custom render functions

### Offline & bundling

- **`jsee --fetch`** bundles everything into a single HTML file: the JSEE runtime, model/view/render code, and all imports are stored in hidden `<script data-src="...">` elements. The result works with no network
- **`jsee.download(title)`** does the same at runtime — exports the current app as a self-contained HTML file

## Schema blocks

JSEE takes a schema object that contains three main blocks:

- `model` — describes a model/script/API (its location, is it a function or class, should it be called automatically on every GUI change or not)
- `inputs` — list of inputs and their descriptions
- `outputs` — list of outputs and their descriptions

Extra blocks can be provided for further customization:

- `render` / `view` — visualization part (optional). Defines custom rendering code
- `design` — overall appearance (optional). Defines how the app looks overwriting defaults
- `imports` — a list of scripts and stylesheets to load before the model is initialized. CSS files (`.css` extension) are injected as `<link rel="stylesheet">` in `<head>`, JS files are loaded as scripts. In the browser, relative paths (e.g. `dist/core.js`, `./lib.js`) resolve against the page URL. With `--fetch`, the CLI resolves imports by checking the local filesystem first — if a file exists on disk it is bundled; otherwise it is fetched from CDN

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
  - `worker` (boolean) — If `true`, JSEE initializes a Web Worker to run the script
    - For `container: 'object'`, model functions receive a second runtime context argument (`ctx`)
    - `ctx.log(...args)` — Write runtime logs
    - `ctx.progress(value)` — Report progress (`0..100` or `null` for indeterminate)
    - `ctx.isCancelled()` — Check cooperative cancellation state (useful in long loops/streams)
  - `timeout` (number, default: `30000`) — Worker execution timeout in milliseconds. Only applies when `worker: true`. Does not apply during model initialization (loading can be slow). If exceeded, the worker is terminated with an error
  - `imports` (array) — Per-model imports loaded before this model's code executes. Accepts URLs as strings or objects `{ url: "..." }`. Top-level `imports` are moved to the first model internally
  - `model` can also be an **array of model objects** to create a pipeline. Models execute sequentially — each receives the merged output of the previous one. First model defaults to `worker: true`, others to `worker: false`. Return `{ stop: true }` from any model to halt the pipeline early
- `render` — Custom rendering script. Instead of relying on JSEE for output visualization, you can provide a custom script that visualizes the results. That can be useful if you rely on custom libs for plotting
- `design` — Design parameters
  - `layout` — Layout for the model/input/output blocks. If it's empty and the JSEE container is not, JSEE uses inner HTML as a template. If the container is empty too, it uses the default `blocks` template
  - `framework` — Design framework to use. If a JavaScript object with the same name is present in a global context, JSEE loads it too (using Vue's `use` method)
- `inputs` — Inputs definition
  - `name`* — Name of the input
  - `type`* — Type. Possible types:
    - `int`, `float` or `number` — Number
    - `string` — String
    - `text` — Textarea
    - `checkbox` or `bool` — Checkbox
    - `select` or `categorical` — Select (one of many `options`)
    - `file` — File Input
    - `action` or `button` — Button (its `name` will be passed as a `caller` to the model)
  - `default` — Default value
  - `alias` (string or array of strings) — Alternative names for URL parameter matching. E.g. `"alias": ["f", "file"]` allows `?f=value` or `?file=value` to set this input
  - `display` (string) — Filtrex expression to conditionally show/hide this input. Evaluated against current input values. E.g. `"display": "mode == 'advanced'"` shows the input only when `mode` is `"advanced"`. Supports `len()` for string length
  - `disabled` (boolean) — Disables the input in the UI. When combined with `reactive: true`, triggers an initial model run on page load (useful for server-populated values)
  - `raw` (boolean, file input only) — If `true`, pass the raw source to the model instead of reading text in the UI (`File` object for disk files or `{ kind: 'url', url: '...' }` for URL input)
  - `stream` (boolean, file input only) — If `true`, pass an async iterable `ChunkedReader` to the model instead of raw source handles. Supports `for await (const chunk of reader)`, `await reader.text()`, `await reader.bytes()`, and `for await (const line of reader.lines())`. Works in both main-thread and worker execution. Reader metadata (`reader.name`, `reader.size`, `reader.type`) is preserved and remains available in downstream pipeline models
  - URL params for file inputs (e.g. `?file=https://...`) auto-load on init, so bookmarkable links run without an extra Load click
- `outputs` — Outputs definition. Outputs also support `alias` (string) for matching model result keys by alternative names
  - `name`* — Name of the output
  - `type`* — Type. Possible types:
    - `file` — File output (not displayer, but downloaded)
    - `object` — JavaScript Object
    - `html` or `svg` — SVG element
    - `code` — Code block
    - `function` — Render function. Rather than returning a value, a model returns a function that JSEE will call passing the container element
    - `blank` — Blank block (can be alternative to `function` and useful for custom renderers)
- `examples` — List of examples
- `autorun` (boolean, default: `false`) — Run the model automatically on first load
- `reactive` (boolean, default: `false`) — Re-run the model on any input change (debounced). For per-input reactivity, set `reactive: true` on individual inputs instead
- `interval` (number, default: `0`) — Defines the interval between script evaluations (in milliseconds). If set to `0`, the script is evaluated only once
- Runtime cancellation: call `jsee.cancelCurrentRun()` on the JSEE instance to request stop of the active run. Long-running models should check `ctx.isCancelled()` and return early
- Schema validation — JSEE validates schema structure during initialization and logs warnings for non-critical issues (e.g. unknown input types, malformed aliases)
- `jsee.download(title)` — Downloads a self-contained HTML file that works offline. All external scripts are inlined and the schema/model/imports are cached. `title` defaults to `'output'`
- `page` (CLI only) — Page metadata for generated HTML:
  - `title` (string) — Page title
  - `url` (string) — Page URL
  - `ga` (string) — Google Analytics measurement ID (e.g. `"G-XXXXXXXXXX"`)
  - `social` (object) — Social media links: `twitter`, `github`, `facebook`, `linkedin`, `instagram`, `youtube` (values are usernames/handles)
  - `org` (object) — Organization footer: `name`, `url`, `description`

JSEE is a reactive branch of [StatSim](https://statsim.com)'s [Port](https://github.com/statsim/port). It's still work in progress. Expect API changes.

# CLI

- `--inputs`, `-i` — Input schema JSON file (default: `schema.json`)
- `--outputs`, `-o` — Output file path(s), comma-separated (HTML, JSON, or both)
- `--description`, `-d` — Markdown file to include as app description
- `--port`, `-p` — Dev server port (default: `3000`)
- `--version`, `-v` — JSEE runtime version (`latest`, `dev`, or semver)
- `--fetch`, `-f` — Bundle everything into a single offline HTML: fetches the JSEE runtime, reads `model`/`view`/`render` code from disk, and resolves imports. Local files are detected by checking the filesystem (so bare paths like `dist/core.js` work alongside `./relative.js`); anything not found locally is fetched from CDN. All code is stored in hidden `<script data-src="...">` elements
- `--runtime`, `-r` — Select runtime source for generated HTML:
  - `auto` (default): `inline` when `--fetch` is used, otherwise `cdn` for file output and `local` for dev server mode
  - `local`: use `http://localhost:<port>/dist/...`
  - `cdn`: use jsdelivr runtime URL
  - `inline`: embed runtime code directly in HTML
  - Any other value is used as a custom `<script src="...">` path/URL (e.g. `./node_modules/@jseeio/jsee/dist/jsee.js`)
- `--cdn`, `-c` — Rewrite model URLs for CDN deployment (can be a base URL string or boolean to infer from `package.json`)
- `--execute`, `-e` — Run models server-side (see below)
- `--verbose` — Enable verbose logging
- `--help`, `-h` — Show usage info

# Server-side execution

With `--execute` (`-e`), JSEE loads each model's JS file on the server (via `require()`), rewrites the schema to point at a POST endpoint, and starts an Express server. The browser GUI sends inputs to the server, which runs the model and returns results as JSON. This is useful for models that need Node.js APIs or heavy computation that shouldn't run in the browser.

```bash
jsee schema.json -e -p 3000
```

# Changelog

See `CHANGELOG.md`.
