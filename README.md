# JSEE

Portable, schema-driven web apps for local computation.

JSEE turns a model function plus a small JSON schema into a reactive browser app, CLI-served tool, offline HTML bundle and API surface. It is meant for computations that should be easy to share, inspect, rerun and keep on the user's machine.

[Python documentation](py/README.md)

## Contents

- [Installation](#installation) and [quick start](#quick-start)
- [Complete example: browser, CLI, HTTP and MCP](#your-first-computation)
- [Schema](#schema), [inputs](#inputs), [outputs](#outputs) and [styling](#design)
- [Browser API](#jsee-instance-api), [renderers](#persistent-output-renderers) and [embedding](#host-owned-regions)
- [CLI and HTTP](#json-commands-and-canonical-http), [authentication](#http-authentication-and-cors), [MCP](#mcp-over-stdio) and [offline bundles](#--bundle)
- [Python guide](py/README.md) and [Python CLI](py/README.md#cli--python)
- [Status and limitations](#status-and-limitations), [development](#development) and [changelog](#changelog)

## Try it in the browser

Save this complete example as `index.html` and open it. Enter two numbers and click **Run**; `3` and `4` produce `12`. This example loads JSEE from the CDN, then computes locally.

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Multiply with JSEE</title>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@0.9.0/dist/jsee.core.js"></script>
<script>
  function multiply(a, b) {
    return a * b
  }
  new JSEE(multiply, '#app')
</script>
</html>
```

JSEE infers a simple form from this function. Use an explicit schema when you need types, defaults, descriptions, files or named outputs.

## When JSEE fits

Use JSEE for calculators, data transformations, simulations and model interfaces. It supplies forms, file inputs, workers, progress, cancellation and output rendering. Browser apps can keep data on the device; [bundling](#--bundle) can make a computation portable as an HTML file.

It also [embeds in an existing application](#host-owned-regions), with host-owned controls and persistent renderers. The host still owns routing, accounts and collaboration. JSEE is not an application framework or a sandbox for untrusted code.

## Installation

**Browser**: no build step:

```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@0.9.0/dist/jsee.core.js"></script>
```

**JavaScript**: CLI and Node.js execution:

```sh
npm install @jseeio/jsee
```

Use `npx @jseeio/jsee` to run the installed CLI. It requires Node.js 20+.

These docs describe **0.9.0**. Pin package versions when reproducing a deployment. See [runtime bundles](#runtime-bundles) for core versus full and [development](#development) for installation from a checkout.

## Quick start

### JavaScript: create an app

In an empty directory:

```sh
npx @jseeio/jsee init
npx @jseeio/jsee schema.json --client
```

The first command creates `schema.json`, `model.js` and a README. Open `http://localhost:3000` to use the generated form; `--client` runs its model in the browser. Stop the development server with Ctrl+C.

For a complete example you can call from the UI, CLI, HTTP and an MCP client, follow [Your first computation](#your-first-computation). It includes every file and the expected results.

## How it works

A **model** is the function, class or API that performs the work. A **schema**
(also called a descriptor in this reference) declares the model, its inputs and
its outputs. Browser JSEE creates editable controls, loads the model and routes returned values to matching output names. Models can run in workers and report progress; an array of models forms a pipeline. The browser API lets a host update controls, invoke a run, stop it and dispose of resources.

CLI, HTTP and MCP derive their input/output descriptions from the same schema. They validate values and return declared outputs. File and media results use **artifacts**: stored files returned as references with
download metadata. A reference can be passed to another run using the same store. Models stay ordinary source files. A runtime must support the model's language and execution features; moving a descriptor does not translate its code.


## Your first computation

Build a calculator that multiplies two numbers and offers a text report. Use the same files as a browser app, a command-line computation, an HTTP API and an MCP tool. You need Node.js 20+ for the JavaScript version; the [Python variation](py/README.md#use-python-instead) needs Python 3.9+.

### Create the files

Create an empty directory and run `npm install @jseeio/jsee`. Save these two files there.

`schema.json`:

```json
{
  "schemaVersion": 1,
  "id": "multiply",
  "title": "Multiply two numbers",
  "description": "Multiply a and b and produce a downloadable text report.",
  "model": { "url": "model.js", "name": "multiply", "worker": true },
  "inputs": [
    { "name": "a", "type": "float", "default": 3 },
    { "name": "b", "type": "float", "default": 4 }
  ],
  "outputs": [
    { "name": "product", "type": "number" },
    { "name": "report", "type": "file", "filename": "result.txt", "mime": "text/plain" }
  ]
}
```

`model.js`:

```js
function multiply({ a, b }) {
  const product = a * b
  return { product, report: `${a} × ${b} = ${product}\n` }
}
```

JSEE loads the function named by `model.name` in both the browser and Node. The model receives one object with input names and returns an object matching the declared output names. It does not need to know about forms, HTTP or MCP.

### Open the browser app

```sh
npx @jseeio/jsee schema.json --client
```

Open `http://localhost:3000` and click **Run**. The default inputs produce `12` and a report containing `3 × 4 = 12`. Here `--client` selects browser execution, and the schema asks for a worker. Stop the server with Ctrl+C before the HTTP step below uses the same port.

### Call it from the terminal

Save `input.json`:

```json
{"a":3,"b":4}
```

Inspect the interface, validate the descriptor, then execute:

```sh
npx @jseeio/jsee inspect schema.json --json
npx @jseeio/jsee validate schema.json
npx @jseeio/jsee run schema.json --input input.json --json
```

Inspection shows the input/output JSON Schemas without loading the model. Validation checks the descriptor, not whether the computation is correct. Execution returns a JSON envelope like this (IDs, hashes and paths vary):

```json
{
  "runId": "...",
  "status": "succeeded",
  "outputs": { "product": 12, "report": { "artifact": ".../0" } },
  "artifacts": [
    {
      "id": ".../0", "output": "report", "name": "result.txt",
      "mime": "text/plain", "size": 12, "sha256": "...", "uri": "file:///..."
    }
  ]
}
```

Read the file at the returned `file:` URI. Artifacts persist under `.jsee-artifacts/` in your working directory. `jsee run` returns declared outputs only, omitting intermediate pipeline values. Models execute in Node for this step, not in browser workers.

### Serve the computation

```sh
npx @jseeio/jsee serve schema.json --port 3000
```

Open `http://localhost:3000` for the form, or use another terminal:

```sh
curl http://localhost:3000/run \
  -H 'Content-Type: application/json' \
  --data-binary @input.json
```

You get the same output/artifact envelope. In this mode the model runs on the server; the form and HTTP call share `/run`. The report URI is a relative HTTP download path. Fetch it from `http://localhost:3000` while that server is running. Discovery is available at `/schema` and `/openapi.json`.

The server binds to localhost by default. For authenticated hosting, see [HTTP authentication and CORS](#http-authentication-and-cors). Auth does not sandbox the model. Stop with Ctrl+C when finished; HTTP artifacts belong to that server lifetime.

### Connect an agent through MCP

MCP (Model Context Protocol) lets an agent discover and call tools. In a client
that supports local stdio servers, add a server entry like the following. Replace `/absolute/path/multiply/schema.json` with the actual absolute path to your descriptor. Client configuration file locations differ.

```json
{
  "mcpServers": {
    "multiply": {
      "command": "npx",
      "args": [
        "--yes", "--package", "@jseeio/jsee@0.9.0", "jsee",
        "serve", "/absolute/path/multiply/schema.json", "--mcp-only"
      ]
    }
  }
}
```

Restart or reconnect the client. Ask it to call `multiply` with `a: 3` and `b: 4`. The tool returns `product: 12`, the report handle and artifact metadata. An MCP resource read retrieves the report bytes. JSEE uses stdin/stdout for the protocol and opens no HTTP port in this mode; do not send ordinary terminal input to that process.

The agent calls the computation described by your schema. JSEE does not need an LLM SDK or API key. Tool access and approval settings belong to your MCP client. See [MCP over stdio](#mcp-over-stdio) for upload chunks, quotas and session lifetime.

### Make an offline browser app

For the JavaScript version above:

```sh
npx @jseeio/jsee schema.json -o multiply.html --bundle=offline-strict
```

Open `multiply.html` with networking disabled and click **Run**. This example has no external model dependencies, so the generated file contains what it needs. The generated browser app runs locally; it does not include the Node HTTP or MCP server.

For models using API calls, external weights, dynamic imports or Python packages, check the [bundle requirements](#--bundle). Native ES-module and Python HTML export have additional constraints. Host-owned renderers and editor closures are not serialized automatically.

### Next steps

- Add a slider, choice, table, JSON or media input using the [schema reference](#inputs).
- Reuse this computation inside a larger page with the [browser API](#jsee-instance-api).
- Build a file transformation with the [CSV cleaning example](https://github.com/jseeio/jsee/tree/main/examples/clean-sales).
- If initialization fails, check the browser console or server stderr. A failed canonical run has an `error.code` and `error.message`; see [error behavior](#json-commands-and-canonical-http).

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

- `model`: code location, language and execution options
- `inputs`: values the model receives, with types, defaults, validation rules and editing controls
- `outputs`: named results, their data types and how the browser displays them

Extra blocks can be provided for further customization:

- `id`: optional stable computation identifier for discovery and OpenAPI, independent of the display title. Use 1-128 ASCII letters, digits, `_`, `.`, or `-`, starting with a letter. Defaults to `computation`
- `schemaVersion`: optional descriptor format version. Use the number `1`; omitting it retains the same behavior. Unsupported explicit versions are rejected before model loading. This is independent of JS/Python package versions
- `render` / `view`: visualization part (optional). Defines custom rendering code
- `design`: optional layout, theme and color overrides
- `imports`: a list of scripts and stylesheets to load before the model is initialized. CSS files (`.css` extension) are injected as `<link rel="stylesheet">` in `<head>`, JS files are loaded as scripts. In the browser, relative paths (e.g. `dist/core.js`, `./lib.js`) resolve against the page URL. With `--bundle`, the CLI resolves imports by checking the local filesystem first: if a file exists on disk it is bundled; otherwise it is fetched from CDN

  ```json
  "imports": [
    "https://cdn.jsdelivr.net/npm/lodash@4/lodash.min.js",
    "dist/my-lib.js",
    "styles/app.css"
  ]
  ```

- `examples`: optional sets of input values that users can select to fill the form

  ```json
  "examples": [
    { "input": "My name is Anton and I am" }
  ]
  ```

## Schema

### Model

Declare the code JSEE should run and how it receives inputs. A `model` object runs
one step; an array of model objects defines a sequential pipeline.

- `model`: Contains main parameters of the model/script
  - `url` (string): URL of a JS/Python script or POST/GET API
  - `code` (function or string): It's possible to pass code directly to JSEE instead of using an URL
  - `name` (string): Name of the executed object. Default value is taken from `url` or `code`
  - `type` (string, default: `function`): What kind of script is loaded. Influences how the code is initialized. Possible values:
    - `function`: Call a JavaScript function with the current inputs
    - `class`: Create a JavaScript instance, then call `method` (default: `predict`) on each run
    - `module`: Load an ES module URL with native dynamic import and call `model.export`, `model.name`, `default`, or `model`. Module models default to `worker: false`; set `worker: true` to run the module in JSEE's Web Worker. This is the JavaScript path intended for `security.allowEval: false`
    - `async-function`: Await an asynchronous JavaScript function
    - `async-init`: Await a setup function once; it must return the function to call on each run
    - `py`: Run browser Python through Pyodide. Browser Pyodide models receive Python globals `inputs` and `ctx`. Use `inputs['name']` for input values and `ctx.get('caller')` for runtime metadata. Legacy `from js import name` still works for non-colliding names, but JSEE no longer overwrites existing JavaScript globals such as `location`, `history`, `name`, `top`, or `parent`
    - `get` / `post`: Call an HTTP API model instead of local JavaScript/Python code. Use `model.stream: true` for SSE responses
    - Inference note: when `code` is present (including code loaded from a `.js` URL), JSEE treats the model as `function` unless `type` is explicitly set
    - TensorFlow.js is not a dedicated model type. Load it through `imports` and call it from a normal JavaScript `function` or `class` model
  - `entry` (string): For Python models, selects the callable independently of the endpoint `name`. Modules load once per application. Pyodide functions can declare individual input parameters, `inputs`, and/or `ctx`; native Python passes the declared request arguments.
  - `export` (string): For `type: "module"` models, names the ES module export to call. JSEE tries `export` or `name` first, then falls back to `default` or `model`
  - `pyodide` (string or object): Browser Python defaults to Pyodide **314.0.7** (Python 3.14.2). Override with an ES-module loader URL, or `{ "url": "/pyodide/pyodide.mjs", "indexURL": "/pyodide/" }`. Declare `imports` or `packages` for wheels included by `--bundle=pyodide` / `--bundle=pyodide-single`. Pyodide 314.x requires module workers; use its `.mjs` loader. Explicit older `.js` loader overrides retain a classic-worker compatibility path; 0.24.1 is covered by a regression. Pyodide 314 bundles sqlite3/lzma, removes pydecimal/test packages and OpenSSL-backed hashlib algorithms, and stubs actual TLS operations in ssl. Browser fetch remains the HTTP path.
  - `method` (string): If `type` is `class`, `method` defines the name of the class method to call during evaluation
  - `container` (string): How input values are passed to the function/method:
    - `object` (default): Pass inputs wrapped in an object, i.e. `{'x': 1, 'y': 2}`
    - `args`: Pass inputs as separate arguments
    - In `object` mode, JavaScript models receive the runtime context as a second argument: `function model(inputs, ctx) { ... }`
  - `worker` (boolean): If `true`, JSEE initializes a Web Worker to run the script
    - `ctx.log(...args)`: Write runtime logs
    - `ctx.progress(value)`: Report progress (`0..100` or `null` for indeterminate)
    - `ctx.isCancelled()`: Returns true once this invocation completes, is cancelled, or is replaced. Context callbacks belong to the invocation; late `ctx.log()`/`ctx.progress()` calls are ignored. Browser `ctx.output()`/`ctx.outputAsync()` follow the same rule. Browser instance fields and methods remain accessible through the context
  - `timeout` (number, default: `30000`): Worker execution timeout in milliseconds. Only applies when `worker: true`. If exceeded, the worker is terminated with an error. Initialization has its own deadline
  - `initTimeout` (number, default: `120000`): Worker initialization deadline in milliseconds, including runtime/import loading and async initialization. Failures and timeouts terminate the worker; increase explicitly for large models.
  - `workerUrl` (string): Optional external worker entry, e.g. `/dist/jsee.worker.mjs`, for a same-origin `worker-src 'self'` deployment. Default creation remains dynamic: the bundled worker source becomes a Blob URL on HTTP(S), or a data URL for standalone `file://` HTML. The classic entry is `jsee.worker.js`; use it for classic JS models and the compatibility modes below. Both files are built from `src/worker.js` and share execution, cancellation and messaging.

  Python 314, native ES-module models and API models use module workers. Classic JavaScript functions/classes/imports keep classic workers, including `allowEval: false` URL scripts. ES-module models with classic JS imports also select that compatibility build; CSS imports do not. Explicit older Python `.js` loaders use it too. Both builds share one worker implementation: no script concatenation, extra eval adapter or silent main-thread fallback. This preserves independent script strictness, global declarations and the existing CSP requirements.

  - `imports` (array): Per-model imports loaded before this model's code executes. Accepts URLs as strings or objects `{ url: "..." }`. Top-level `imports` are moved to the first model internally
  - `model` can also be an **array of model objects** to create a pipeline. Models execute sequentially: each receives the merged output of the previous one. First model defaults to `worker: true`, others to `worker: false`. Return `{ stop: true }` from any model to halt the pipeline early
- `render`: Custom rendering script, for example to draw results with a plotting library. For a view that keeps selection or zoom between updates, see [persistent output renderers](#persistent-output-renderers)

### Design

Use `design` to set the app layout and appearance. Use `setDesign` to change them
after the app has loaded.

- `design`: Design parameters
  - `layout`: Layout for the model/input/output blocks. If it's empty and the JSEE container is not, JSEE uses inner HTML as a template. If the container is empty too, it uses the default `blocks` template. Set `'sidebar'` for a fixed-width (280px) sticky input panel: inputs stay visible while scrolling outputs. Collapses to single column on mobile. `grid` sets its column split; a host that places the app below its own header can bound the panel with the `--jsee-sidebar-max-height` CSS variable (default `100vh`)
  - `framework`: Design framework to use (`'minimal'` by default). If a JavaScript object with the same name is present in a global context, JSEE loads it too (using Vue's `use` method)
  - `theme`: Visual preset: default minimal, or `'mono'` for monochrome controls, quiet headings and flat cards. Mono uses system colors by default. Existing `'dark'` selects the minimal dark palette; `'auto'` selects minimal with system colors
  - `colorScheme`: `'light'`, `'dark'` or `'auto'`; overrides the preset's default. Auto follows system changes without JavaScript listeners. Applies separately to each app and its host regions
  - `primary`: Accent color (buttons, toggles, gradient). Hex string, e.g. `'#e74c3c'`
  - `secondary`: Second gradient color. Defaults to a darker shade of `primary`
  - `bg`: Background color. Derives card, input, and border colors automatically
  - `fg`: Text color. Derives secondary text color automatically
  - `font`: Font family string, e.g. `'Georgia, serif'`
  - `radius`: Border radius in pixels (number) or CSS value (string)
  - `grid` (array): 12-column grid split for input/output sections. E.g. `[4, 8]` (default), `[6, 6]` (equal), `[3, 9]`. Values are `fr` units
  - All components use CSS custom properties that can be overridden via CSS: `--jsee-primary`, `--jsee-bg`, `--jsee-text`, `--jsee-text-secondary`, `--jsee-border`, `--jsee-input-bg`, `--jsee-input-border`, `--jsee-focus-border`, `--jsee-focus-ring`, `--jsee-card-bg`, `--jsee-bg-secondary`, `--jsee-label-bg`, `--jsee-error`, `--jsee-radius`

Update appearance on an existing browser instance:

```js
await app.setDesign({ theme: 'mono', colorScheme: 'auto' })
await app.setDesign({ colorScheme: 'dark' })
```

`setDesign(patch)` merges the existing reactive `design` state, waits for the DOM
update, and preserves inputs, workers and renderer instances. It accepts `theme`,
`colorScheme`, `primary`, `secondary`, `bg`, `fg`, `font`, `radius`, `grid` and
`layout`; `null` removes an override. It cannot replace `framework`. Invalid
patches apply nothing. `getSchema()` and exports include the current design.
Explicit design colors override preset colors. Changes affect only this instance,
not the host page or other apps; hosts own their theme switch and saved preference.
See `examples/mono-theme.html` for a standalone switch. No external fonts or CSS
are required.

### Inputs

Each input declares a value the model receives and the control used to edit it.
Use `name` to match the model argument and `type` to choose the control.

- `inputs`: Inputs definition
  - `name`: Key passed to the model
  - `type`: Input control type:
    - `int`, `float` or `number`: Number
    - `string`: String (text input)
    - `color`: Color picker (HTML5 `<input type="color">`)
    - `text`: Textarea (auto-resizes to fit content, up to 400px)
    - `checkbox` or `bool`: Checkbox
    - `select` or `categorical`: Select (one of many `options`)
    - `slider`: Range slider (`min`, `max`, `step`)
    - `range`: Dual-handle range slider, returns `[min, max]` array
    - `radio`: Radio button group (one of many `options`)
    - `toggle`: Toggle switch (boolean)
    - `date`: Date picker
    - `multi-select`: Checkbox group, returns array of selected `options`
    - `group`: Group of inputs. Use `elements` array for child inputs. Supports four display styles via `style` property:
      - `blocks` (default): flat list of child inputs
      - `accordion`: collapsible section (also triggered by `collapsed` or `label` props)
      - `section`: collapsible section with a prominent heading, for module-level groups in long forms
      - `tabs`: tabbed view where each child element becomes a tab (child groups use their `name`/`label` as tab label)
    - `object`: JSON editor for nested objects, lists or other JSON values
    - `table`: Editable table using row objects or `{columns, rows}`. Clipboard CSV/TSV paste expands from the selected cell; choose whether an empty table takes its column names from the first pasted row. Duplicate headers reject without changing data. Unsafe integers and non-finite numeric text stay strings. This bounded editor does not ingest large CSV files or virtualize rows.
    - `image`, `audio`, `video`: Typed media selection and preview; models receive bytes
    - `file`: File Input
    - `folder`: Directory input. Shows a file listing with optional selection. In the browser, uses `<input webkitdirectory>` or drag-drop. On the server, reads from a directory path. Returns array of `{name, path, size, type, selected}` objects. Props:
      - `select` (boolean): Show checkboxes for file selection (default: all files passed)
      - `reactive` (boolean): Trigger model run on selection change
    - `action` or `button`: Button (its `name` will be passed as a `caller` to the model unless a computation input already declares `caller`). Works as a top-level input or inside input groups
  - `label` (string): Text displayed beside the control; defaults to `name`
  - `options` (array): Choices for select/radio/multi-select inputs; values can be strings, numbers, booleans or objects such as `{value: 'price', label: 'Price'}`
  - `min`, `max`, `step` (numbers): Numeric limits and step size; `step` must be positive
  - `default`: Initial value when none is supplied
  - `nullable` (boolean): Allow JSON `null` as an input value. A `null` default also permits `null`, preserving optional Python argument defaults
  - `alias` (string or array of strings): Alternative names for URL parameter matching. E.g. `"alias": ["f", "file"]` allows `?f=value` or `?file=value` to set this input
  - `display` (boolean or string): Show/hide the input directly, or use a Filtrex expression for a condition. Evaluated against current input values. E.g. `"display": "mode == 'advanced'"` shows the input only when `mode` is `"advanced"`. Supports `len()` for string length
  - `reactive` (boolean): Trigger a model run when this input changes (see [when models run](#when-models-run))
  - `disabled` (boolean): Disables the input in the UI. Built-in input controls, selectors, folder selection checkboxes, and action buttons honor this flag. When combined with `reactive: true`, triggers an initial model run on page load (useful for server-populated values)
  - `readonly` (boolean): Prevent editing while retaining the current value; controls without native readonly support are disabled
  - `accept` (string): File/media MIME types, wildcards or extensions, separated by commas; checked against file selection and stored artifact metadata
  - `enter` (boolean): If `true` on a `string` input, pressing Enter triggers a model run (useful for chat or search inputs)
  - `raw` (boolean, file input only): If `true`, pass the raw source to the model instead of reading text in the UI (`File` object for disk files or `{ kind: 'url', url: '...' }` for URL input)
  - `stream` (boolean, file input only): If `true`, pass an async iterable `ChunkedReader` to the model instead of raw source handles. Supports `for await (const chunk of reader)`, `await reader.text()`, `await reader.bytes()`, and `for await (const line of reader.lines())`. Works in both main-thread and worker execution. Reader metadata (`reader.name`, `reader.size`, `reader.type`) is preserved and remains available in downstream pipeline models
  - `validate` (string): Browser control validation using Filtrex. The variable `value` holds the current input value. Expression must return truthy for valid input. E.g. `"validate": "value >= 0 and value <= 150"`. Runs on input changes (debounced) and before browser execution, including programmatic `jsee.run()` calls. Nested groups are traversed; group expressions receive their collected field values. Invalid controls show errors and block execution
  - `required` (boolean): Ordinary browser controls reject empty strings, null, undefined, and empty arrays, including when a `validate` expression is also present. Table/JSON controls use field-presence semantics and permit empty collections as values. HTTP/CLI contracts use it for required field presence; portable value constraints come from declared types, options, and numeric bounds
  - `error` (string): Custom error message for `validate` or `required` failures (default: `"Invalid value"` / `"Required"`)
  - `columns` (number, 1-12): Grid column span for this input. When any input has `columns`, the inputs section switches to a 12-column CSS grid. E.g. `"columns": 6` makes the input take half width
  - URL params for file inputs (e.g. `?file=https://...`) auto-load on init, so bookmarkable links run without an extra Load click

### Outputs

Return values under the names declared in `outputs`. Each output type chooses a
browser presentation, such as a download button, table or chart. The
[CLI/HTTP result rules](#output-validation-and-files) describe serialization outside
the browser.

- `outputs`: Outputs definition. Outputs also support `alias` (string or array of strings) for matching model result keys by alternative names. Per-output `columns` (number, 1-12) sets grid column span, same as inputs
  - `name`: Key in the model result
  - `type`: Output presentation type:
    - `file`: Download-only file output. With a static schema filename, return the file body under the output name:

      ```json
      { "name": "report", "type": "file", "filename": "report.csv" }
      ```

      ```javascript
      return { report: "col1,col2\n1,2\n" }
      ```
      For dynamic filenames, formats, or MIME types, return a descriptor object matching the output name:

      ```javascript
      return {
        report: {
          filename: "dataset.csv",
          content: csvText,
          mime: "text/csv"
        }
      }
      ```
      Browser descriptor fields: `filename` or `name`; `content`, `value`, `data`, or `url`; optional `mime` or `contentType`. CLI/HTTP/MCP file results require content; they do not fetch a `url`.
    - `object`: JSON tree for objects, lists and other JSON values
    - `html`: HTML markup; sanitization follows `security.allowRawHtml`
    - `svg`: Inline SVG markup; sanitization follows `security.allowRawHtml`
    - `code`: Code block
    - `markdown`: Rendered Markdown (supports tables, headings, lists, etc.)
    - `image`: Image (`<img>` tag from data URL or URL)
    - `audio`: Audio player (`<audio>` from URL or data URL)
    - `video`: Video player (`<video>` from URL or data URL)
    - `table`: Virtualized table with scrolling
    - `chat`: Chat message list. Accumulates `{role, content}` messages across runs instead of replacing. Renders user/assistant bubbles with Markdown support, auto-scrolls to latest message. See **Chat mode** below
    - `group`: Group of outputs. Use `elements` array for child outputs. Supports `style: 'tabs'` for tabbed display or default blocks (stacked). Child outputs are matched by name against model results
    - `chart`: SVG chart via [Observable Plot](https://observablehq.com/plot/). Model returns array of objects, column-oriented data, or a full Plot config. Schema props: `mark` (line/dot/bar/area/etc.), `x`, `y`, `color`, `width`, `height`. Included in full bundle or load Plot via `imports`
    - `3d`: 3D model viewer via [Three.js](https://threejs.org/). Model returns a URL (GLTF/GLB), data URL, or geometry object `{vertices, faces}`. Schema props: `width`, `height`. Included in full bundle or load Three.js via `imports`
    - `map`: Interactive map via [Leaflet](https://leafletjs.com/). Model returns markers `[{lat, lng, popup}]`, `{center, markers, zoom}`, or GeoJSON. Schema props: `height`, `zoom`, `center`, `tiles`. Included in full bundle or load Leaflet via `imports`
    - `pdf`: Browser-native PDF viewer. Model returns a URL, data URL, Blob, ArrayBuffer, or Uint8Array. Schema prop: `height`. Included in the core bundle
    - `gallery`: CSS grid of images. Model returns array of URLs/data URLs. Click to expand lightbox. Schema props: `columns` (default 3), `gap` (default 8px). Included in the core bundle
    - `highlight`: Highlighted text with labels. Model returns `[{text, label, color}]` segments. Unlabeled segments render as plain text. Included in the core bundle
    - `scores`: Ranked labels with numeric scores and bars, for example classifier predictions. See [ranked scores](#ranked-scores) for data and display options.
    - `gauge`: Semicircle gauge. Model returns a number or `{value, label}`. Schema props: `min` (default 0), `max` (default 100), `label`, `color`. Included in the core bundle
    - `number`: Large KPI number display. Model returns a number or `{value, delta, label}`. Delta shown with colored up/down arrow. Schema props: `label`, `prefix` (e.g. `"$"`), `suffix` (e.g. `"%"`), `precision`
    - `alert`: Colored status banner with left accent border. Model returns a string or `{message, type}`. Four variants: `info` (blue, default), `success` (green), `warning` (amber), `error` (red). Schema prop: `alertType` (default type when value is a string)
    - `viewer`: Preview a media URL. Model returns a URL string. Auto-detects content type from extension: images (png, jpg, gif, svg, webp), audio (mp3, wav, ogg, flac), video (mp4, webm, mov), or iframe (fallback). Useful with `folder` input for file preview
    - `function`: Render function. Rather than returning a value, a model returns a function that JSEE will call passing the container element
    - `blank`: Empty container for custom rendering via `function` output or external code

#### Ranked scores

Use `type: "scores"` to compare labeled values, such as classifier predictions.
Return an array like `[{label: 'cat', score: 0.72}, {label: 'dog', score: 0.28}]`.
The view sorts rows and displays bars; CLI/HTTP/MCP retain the original order,
numbers and extra row metadata. Empty arrays are valid; labels must be strings
and scores finite numbers.

| Option | Display behavior |
|---|---|
| `min`, `max` | Bar scale, default 0-1; both must be finite and increasing |
| `format` | `number` (default) or `percent`; does not change the stored value |
| `precision` | Maximum decimal places, 0-20; default 3 |
| `prefix`, `suffix` | Text around the displayed value |

Out-of-range scores clip the bar and are identified in accessible text. The view
does not normalize scores, interpret them as probabilities or record history.
It updates in place, inherits the app theme and is included in the core/offline
runtime without a chart library. See the [scores example](https://github.com/jseeio/jsee/tree/main/examples/scores/README.md).

### When models run

By default, the model runs when the user clicks Run. Three schema-level options change this:
- `autorun` (boolean, default: `false`): run the model once on first load, then wait for manual Run clicks
- `reactive` (boolean, default: `false`): re-run the model on **any** input change (debounced 300ms). Useful for lightweight models where instant feedback is desired
- `interval` (number, default: `0`): after an autorun or manual Run, repeat execution every N milliseconds until Stop is clicked. `0` means no repetition. The first run keeps its original `caller` value (`autorun` or `run`); scheduled repeats use `caller: "interval"`
- Per-input `reactive`: set `reactive: true` on an **individual input** to trigger a model run only when that specific input changes (fires immediately, not debounced). Other inputs still require a manual Run click. Useful when one input is interactive (e.g. a slider) but others are expensive to recompute

| Option | Scope | When it runs | Debounced |
|--------|-------|-------------|-----------|
| `autorun: true` | schema | once on load | no |
| `reactive: true` | schema | every input change | yes (300ms) |
| `reactive: true` | input | that input changes | no |
| `interval: N` | schema | after autorun or Run, then every N ms | no |

### Chat mode

Declare an output with `"type": "chat"` to enable conversational UI. The runtime manages state:
1. User types a message in a text input and presses Run (or Enter if the input has `"enter": true`)
2. The runtime injects `history` (array of `{role, content}` dicts) into the model payload alongside the user's `message`, unless a computation input already declares `history`
3. The model returns `{chat: "response string"}` (or `{chat: {role, content}}`)
4. The runtime appends both the user message and assistant response to the chat conversation, clears the input, and auto-scrolls
5. Messages render with Markdown support (code blocks, bold, links, tables)

Works with browser workers and server POST models. For Python, see [chat mode](py/README.md#chat-mode).

### Saving input values

By default, JSEE saves input values to `localStorage` and restores them on page refresh. Values are namespaced by app/container/input shape, include grouped inputs, skip file/folder/action/button/disabled inputs, and are validated against type/options/min/max before restore. Priority: URL params > localStorage > schema defaults. Set `persist: false` in the schema to disable. Clicking Reset clears saved values

### Notifications

Set `notify: true` in the schema to show a browser notification when a run completes while the tab is hidden. JSEE requests permission on first load and fires `new Notification()` after successful runs only

### Security and CSP

`security.mode: "secure"` or `security.trusted: false` defaults the flags below to
`false`. Explicit booleans, such as `security.allowNetwork: true`, override those
defaults.

| Flag set to `false` | Blocks or changes |
|---|---|
| `allowEval` | Inline JS/Python code, cached hidden JS assets, Blob-script execution, worker class lookup and Pyodide source execution |
| `allowNetwork` | JSEE-managed API requests and network model/import/Pyodide loads |
| `allowRawHtml` | Sanitize HTML, SVG, Markdown and chat; remove raw Markdown HTML, event handlers, scripts and unsafe URLs |
| `allowNotifications` | Skip notification permission requests and completion notifications |
| `allowFileViewer` | Disable file/folder controls; replace file/media outputs with a blocked placeholder |

For JavaScript without eval, use `type: "module"` with a module URL. It runs on the
main thread by default; set `worker: true` for worker execution. Relative
model/import URLs are checked before resolution, so a same-origin relative URL is
not treated as an external network URL. Loading a schema URL happens before its
security settings can be known.

These flags control JSEE-managed operations. They do not restrict arbitrary model
code, all network calls, the host filesystem, CPU or memory. Workers run on a
separate thread but retain capabilities such as network access. The host must
provide any required execution sandbox.

#### Content Security Policy (CSP)

For deployments that prohibit eval, prefer `security.mode: "secure"` plus `type: "module"`. The current browser bundle injects built-in CSS at runtime, so built-in UI styles require `style-src 'unsafe-inline'`. Dynamically embedded workers require `worker-src blob:` over HTTP(S), or `worker-src data:` for file-origin HTML. An external `model.workerUrl` can use `worker-src 'self'`

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
| `type: "module", worker: true` | `worker-src blob:` (or `self` with `workerUrl`) and `script-src` must allow the module URL | yes | Embedded and external entry points are tested |
| Main-thread JavaScript `model.code` string | `script-src 'unsafe-eval'` | no | Blocked by `security.allowEval: false` |
| Worker classic JavaScript `model.code` string | `worker-src blob:` plus `script-src blob:` | no | Blocked by `security.allowEval: false`; class lookup also uses `eval` |
| Hidden bundled JavaScript model/import code | Same as inline code | no | Intentionally blocked when `security.allowEval` is false |
| Remote API/model/import/Pyodide URLs | Matching `connect-src`, `script-src`, or worker/runtime directives | depends on model type | Blocked by `security.allowNetwork: false` unless explicitly allowed |

### Streaming results

Use Server-Sent Events (SSE) to display results as they arrive, such as generated
text or successive measurements. Set `model.stream: true` for progressive GET/POST results on the main thread or in a worker. SSE frames join multiline `data:` fields and preserve `null`, `false`, `0`, and empty strings. `[DONE]` completes the invocation and releases its reader without waiting for the server to close; `event: error` rejects the run. Unsuccessful HTTP responses also reject, while ordinary data objects containing an `error` key remain model results. The last data frame is the pipeline result; EOF without a sentinel remains accepted, including legacy unterminated final frames. A presentation callback is optional. Node serving can stream sync/async JavaScript generators; see the [Python streaming example](py/README.md#streaming-results) for native Python. Streaming uses browser/API models and legacy stage endpoints, not the JSON `/run` operation.

Node and Python servers send generator failures as `event: error` frames followed by `[DONE]` once SSE headers have been sent. They close suspended generators when a response write detects disconnection; Node also releases waits for response backpressure. Producers blocked inside computation still need cooperative cancellation. Rendering copies result records before consuming metadata, so streamed pipeline fields such as `stop` survive. Chat records the user message once per run and does not append the last streamed assistant chunk again at completion; each partial chunk is a message, not an inferred text delta

### Binary data and typed arrays

Browser `image` outputs convert data URL strings longer than 50,000 characters
to Blob URLs and revoke previous Blob URLs on updates.

In browser execution, declare `arrayBuffer: true` on an input to convert numeric
arrays to typed arrays before passing them to JavaScript models or WebAssembly code. The example below uses a
JSON editor to collect an array such as `[1, 2, 3]`. Set `dtype` to control the type (`float32`, `float64`, `uint8`, `int32`, etc., default: `float64`). Typed-array conversions preserve numeric values and subarray boundaries; raw ArrayBuffer/DataView inputs retain byte interpretation. Worker requests use structured cloning so the caller can reuse its buffers on subsequent runs. Node invocation leaves numeric arrays as arrays; convert them in model code if needed. This differs from reading file artifacts as binary bytes.

```json
"inputs": [{ "name": "data", "type": "object", "default": [1, 2, 3], "arrayBuffer": true, "dtype": "float32" }]
```

### Cancellation and validation

Call `jsee.cancelCurrentRun()` on the JSEE instance to request stop of the active run. Long-running models should check `ctx.isCancelled()` and return early:

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

- Schema validation: JSEE validates schema structure during initialization and logs warnings for non-critical issues (e.g. unknown input types, malformed aliases)
- Invocation validation: Browser runs, CLI runs, and Node/Python model endpoints check declared types, option values, numeric bounds/steps, and required input presence before invoking a model. Invalid HTTP inputs return 400. APIs apply explicit defaults; UI/legacy CLI controls also retain their type-based initial values. `required: false` permits omission; `required: true` requires the field even when a default is advertised. UI-only validation expressions and nonempty-field checks remain control behavior

#### Concurrent runs

Worker rebuilding reserves the run slot: overlapping automatic runs are dropped and manual runs queue. Stop aborts model-source fetches during rebuilding; stopped or failed rebuilds remain retryable and release partially initialized workers. A cancelled run cannot enter its first or a later pipeline stage. Main-thread initialization that cannot be interrupted keeps the slot until it settles. Invocation contexts guard supported callbacks; direct instance mutation and legacy raw worker `postMessage()` callbacks carry no such guard

#### Input groups and reserved metadata

Named groups become nested objects; unnamed layout groups flatten into their containing object. Buttons are excluded. Option objects use `value`, then `name`, then `label`; numeric and boolean options retain their types. Positional JS models (`container: 'args'`) receive declared inputs in schema order, without extra caller metadata

Browser `caller` and chat `history` injection never replaces declared computation inputs. Browser and CLI output lookup accept names, sanitized names, and string/array aliases inside output groups. Fields named `caller`, `stop`, `_status`, `_log`, and `_progress` stay hidden from automatic output discovery, but explicit output names/aliases can present them. A truthy `stop` still halts the pipeline, even if displayed as an output

Raw `postMessage()` progress/partial callbacks are accepted while the worker stage is pending and ignored after it settles. They have no invocation identity: a delayed raw message arriving during a later call cannot be attributed safely. Use invocation-bound `ctx.log()`/`ctx.progress()` for asynchronous callbacks; raw messages do not have their lifetime guarantee

#### Instance state and inferred inputs

JSEE copies descriptor containers before normalization and keeps mutable UI values separate. Reusing the same schema across instances does not share input values. Verbosity and embedded log sinks belong to each instance

When `schema.inputs` is omitted and JSEE infers inputs from JavaScript function parameters, inferred inputs default to `string` for compatibility. JSEE logs warnings for inferred string inputs, numeric defaults, JSDoc numeric hints, and unsupported destructured parameters so authors know when to declare `schema.inputs` explicitly. Set top-level `inferInputTypes: true` to opt into inferred `number` controls from numeric defaults or numeric JSDoc and `checkbox` controls from boolean defaults or JSDoc

### Exporting browser apps

`jsee.download(title)` exports an HTML app, with `title` defaulting to `'output'`.
Offline use depends on the declared models and dependencies; see
[bundle requirements](#--bundle) and [renderer export restrictions](#registration-and-export).

### Generated page metadata

The CLI uses `page` to set metadata on generated HTML:
- `title` (string): Page title
- `url` (string): Page URL
- `ga` (string): Google Analytics measurement ID (e.g. `"G-XXXXXXXXXX"`). Invalid IDs are omitted from generated HTML
- `social` (object): Social media links: `twitter`, `github`, `facebook`, `linkedin`, `instagram`, `youtube` (values are usernames/handles)
- `org` (object): Organization footer: `name`, `url`, `description`

## Smart output auto-detection

In the browser, JSEE can choose a view from a returned value. Declare output types
explicitly when you need stable CLI, HTTP or MCP result schemas.

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

## Structured and media inputs

Use these inputs for data that does not fit a single text or number field.

### JSON objects and editable tables

`object` accepts JSON values, including nested objects and variable-length lists. Its editor reports invalid JSON and blocks execution until corrected. `table` accepts the same values as table outputs: an array of row objects or `{ "columns": ["name"], "rows": [["Ada"]] }`. The table editor supports adding/removing rows, adding columns and editing JSON. Cells preserve JSON types: `0`, `false`, `null` and `""` are distinct. Column-specific validation is not inferred. Use an optional `valueSchema` to validate the structure of an `object` input or
output. For example, require a `counts` array of nonnegative integers:

```json
{
  "name": "info",
  "type": "object",
  "valueSchema": {
    "type": "object",
    "properties": {
      "counts": {
        "type": "array",
        "items": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "required": [
      "counts"
    ],
    "additionalProperties": false
  }
}
```

`valueSchema` uses a bounded JSON Schema vocabulary: `type` (including type arrays and `null`), `properties`, `required`, boolean `additionalProperties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, and `description`. Browser, Node and Python enforce these rules, and HTTP/MCP discovery exposes them. Unsupported keywords fail descriptor validation; references, formats, nested defaults and coercion are not supported. When `valueSchema` is present, it determines whether null is allowed: include `"null"` in its type if needed; outer `nullable` or `default: null` do not widen it. Without a shape, `object` keeps accepting any finite JSON value.

Use named input groups when each field should have its own control; use `object`
when users need to edit JSON directly.

### Image, audio and video files

`image`, `audio` and `video` provide file selection and previews. Declare `accept`, such as `"image/png"` or `"audio/*"`, to restrict selection; the media type also requires its own MIME family. Browser JS models receive an ArrayBuffer; native Python models receive bytes. Pyodide models can use `bytes(value)` on the received buffer. Canonical CLI/HTTP/MCP inputs use `{ "artifact": "<runId>/<index>" }`, rather than encoded media strings. MIME describes supplied metadata; it does not prove that a codec can decode the content. JSEE does not implicitly convert images to PIL/NumPy or audio to sample arrays.

Media outputs may return bytes (with `mime` in the output descriptor), or `{content: bytes, mime: "image/png"}`. Canonical hosts store these as reusable artifacts. Existing media URL strings remain URLs. The canonical served UI uploads selected media, invokes the whole pipeline through `/run`, and displays its artifacts. Standalone browser apps keep local file data on the device. These editors support `disabled` and `readonly`.

## Runtime Bundles

| Bundle | Use when | Includes |
|---|---|---|
| `dist/jsee.core.js` | Most apps, direct `<script>` tags, generated HTML | runtime, inputs, core outputs, native PDF viewer |
| `dist/jsee.full.js` | Apps that need `chart`, `3d`, or `map` without extra imports | core + Observable Plot + Three.js + Leaflet |
| `@jseeio/jsee` package entry | CLI/server-side tooling | Node CLI module |

Full bundle CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@0.9.0/dist/jsee.full.js"></script>
```

The core bundle can still render `chart`, `3d`, and `map` if the app loads the required library through schema `imports`. The `pdf` output uses the browser's native PDF viewer and is available in the core bundle. The CLI and Python server choose the required runtime bundle from the schema output types.

## Examples

### Full schema

These are reference fragments, not standalone programs. Supply the model files named by each descriptor. Start with the [complete computation tutorial](#your-first-computation) for runnable files.

This descriptor combines multiple inputs, outputs, theming, and a worker model:

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

First model returns `{ cleaned: [...] }`, second receives `{ ...originalInputs, cleaned: [...] }`. Return `{ stop: true }` from any model to halt early.

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

## JSEE instance API

Use the instance API to read inputs, run a model or embed JSEE in another page.
Create an instance with `new JSEE({schema, container})` and await `ready` before
interacting with it. Multiple instances can share a page; each owns its inputs,
progress display and overlays.

| Method | Description |
|---|---|
| `await jsee.ready` | Wait for schema, model, UI and pipeline initialization; rejects on failure or destruction |
| `await jsee.setDesign(patch)` | Change theme, color scheme and layout without recreating the app; see [design](#design) |
| `jsee.getInputs()` | Read a snapshot of input values after readiness; named groups remain nested |
| `await jsee.setInputs(values)` | Patch input values by schema name, including nested groups; unknown names reject atomically. Does not run unless schema reactivity is enabled |
| `await jsee.setInputState(path, patch)` | Update `disabled`, `readonly`, boolean `display` or choice `options` without changing values or triggering a run |
| `await jsee.invoke(values?)` | Run once and return declared output values (or the pipeline result when no outputs are declared). Rejects on validation, execution failure, overlap, or cancellation (`AbortError`) |
| `jsee.on(event, listener)` | Subscribe to `inputs`, `start`, `result`, `error`, `cancel`, `destroy`, `stage`, or `progress`; returns an unsubscribe function. Listener exceptions do not affect execution |
| `await jsee.stop(options?)` | Stop and wait for invocation settlement; forced by default. Opt into cooperative cancellation with `{ mode: 'cooperative', graceMs: 1000 }`; returns `{ retained }` |
| `jsee.run(caller)` | Execute the model pipeline. `caller` can be `'run'`, `'autorun'`, `'reactive'`, `'interval'`, or a custom button name |
| `jsee.output(result)` | Process and render results to output cards |
| `jsee.cancelCurrentRun()` | Stop the active run. Rejects the current run promise, sets cancellation state, and signals/terminates workers |
| `jsee.isCancelled()` | Returns `true` if cancellation was requested |
| `jsee.progress(value, details?)` | Report progress: `0`-`100` for determinate, `null` for indeterminate; optional `loaded`, `total` and `phase` metadata |
| `jsee.download(title)` | Export the current app; see [offline requirements](#--bundle) |
| `jsee.destroy()` | Cancel runs and initialization fetches, terminate workers, unmount Vue, and release UI resources. Repeated calls are safe; later runs return `false` and late progress/output calls are ignored |
| `jsee.notify(text)` | Show a success toast notification |
| `jsee.log(...args)` | Log to browser console and optional `#log` DOM element as plain text |

### Cooperative cancellation

`stop()` still terminates workers by default. To retain a loaded model when its
operation can finish cleanup, use:

```js
const { retained } = await tool.stop({ mode: 'cooperative', graceMs: 1000 })
// The cancelled invoke() rejects with AbortError. After stop() resolves,
// another invocation can reuse the model when retained is true.
```

Browser JavaScript model contexts expose `ctx.signal`, an AbortSignal for the
current invocation, alongside `ctx.isCancelled()`. Pass it to abortable work:

```js
async function model(data, ctx) {
  const response = await fetch(data.url, { signal: ctx.signal })
  return { text: await response.text() }
}
```

For batched computation, yield to the event loop and check cancellation between
batches. A worker cannot receive cancellation while synchronous code blocks its
message loop. Cooperative Stop suppresses subsequent outputs/progress, prevents
downstream stages from running, and keeps the run slot occupied until the model
settles. Cleanup belongs in the model's `finally`; completed mutations are not
rolled back automatically. `retained` reports runtime retention; the adapter
owns recovery and whether its model state remains usable.

The grace period defaults to 1000 ms. If an active worker has not settled, JSEE
falls back to forced Stop, discards its workers and returns `retained: false`.
Main-thread JavaScript cannot be preempted: cooperative Stop waits for it to
settle even beyond the grace period. Run potentially blocking models in workers.
Call cooperative Stop after `ready`; before readiness it rejects without claiming
retention. Use `destroy()` to dispose initial setup. Reinitialization has no
cancellable invocation context and uses forced teardown. Explicit `stop()` or `destroy()` can escalate a pending
cooperative stop; destroy always releases the instance's resources. Native
runtimes need not supply `ctx.signal`.

### Host control state and progress

Use `setInputState` to change controls without changing their values. Subscribe to
`progress` when the host supplies its own progress display.

```js
const tool = new JSEE({ schema, container: '#app', progress: false })
await tool.ready
await tool.setInputState('model', { disabled: true })
await tool.setInputState(['settings', 'target'], {
  options: [{ value: 'price', label: 'Price' }]
})
const unsubscribe = tool.on('progress', event => {
  // { runId, stageId, mode, value, loaded?, total?, phase? }
  showProgress(event)
})
// In a model: ctx.progress(50, { loaded: 1024, total: 2048, phase: 'load' })
```

#### Updating controls

| Patch property | Effect |
|---|---|
| `disabled` | Disable a field |
| `readonly` | Use native readonly behavior where available; disable selectors, sliders and other controls without it |
| `display` | Show or hide a field or group |
| `options` | Replace the options of a choice input; retain its current value |

A string path is a literal field name, including dots. Use an array such as
`['settings', 'target']` to traverse named groups. Unnamed groups share their
parent's namespace; named pipeline scopes are input groups.

- Groups accept only `display`; update their individual fields for `disabled` or `readonly`.
- Invalid paths or patches reject before any state changes.
- Patches preserve values, emit no `inputs` event, and do not run reactive models or invalidate stage caches.
- If new options exclude the current selection, validation fails until the user or host changes the value with `setInputs`.

Control state does not bypass validation or grant permission to execute.

#### Reading progress

The constructor option `progress: false` hides JSEE's progress bars but keeps
emitting events. It is independent of `controls` and `toasts`.

| Event field | Meaning |
|---|---|
| `runId` | Per-instance invocation ID; `null` outside an invocation |
| `stageId` | Named stage ID, or `null` for an unnamed stage |
| `mode` | `determinate` or `indeterminate` |
| `value` | Clamped percentage, or `null` for indeterminate progress |
| `loaded`, `total`, `phase` | Optional metadata supplied by the model |

Use the invocation's result, error or cancellation to detect completion; progress
100 does not establish readiness. The runtime may emit zero when resetting after
a worker call.

Report through `ctx.progress` inside models: JSEE associates it with the current
invocation and ignores reports from retired contexts. Legacy manually posted
worker messages without request IDs remain supported, but late reports cannot be
reliably attributed. For stopping a run while retaining its model, see
[cooperative cancellation](#cooperative-cancellation).

### Image acquisition in browser apps

An `image` input accepts upload, drop and paste into its focused control. Paste
inside a text field stays text. Enable camera snapshots in the same descriptor:

```json
{"name":"photo","type":"image","accept":"image/*","capture":{"camera":true,"live":true,"maxFps":5}}
```

The generated control offers Camera, Use snapshot and, for ordinary pipelines,
Live. Camera access requires browser permission on a secure origin. `facingMode`
is optionally `"user"` or `"environment"` (default). `maxFps` defaults to 5 and
must be greater than zero and at most 60. Actual throughput depends on capture
and execution time. Snapshots use PNG, JPEG or WebP according to `accept`.

#### Capture in a custom layout

Custom layouts use the same acquisition implementation:

```js
await app.ready
const image = app.createImageInput('photo', {
  target: document.querySelector('#image-stage'), // scoped paste/drop target
  picker: document.querySelector('#image-file'), // optional native file input
  video: document.querySelector('#camera'),     // required for camera capture
  onImage: file => showPreview(file),           // selection is already stored
  onState: ({ active, pending, live }) => updateCameraButton(active, pending, live),
  onError: error => showError(error.message)
})
await image.start({ live: true })
await image.stop({ snapshot: true }) // release camera; keep its last image
image.dispose()                     // remove listeners and release tracks
```

Use an array path such as `['settings', 'photo']` for an input in a named group.

| Method | Behavior |
|---|---|
| `select(files)` | Validate and store a selection, as upload/paste does |
| `start()` | Open a camera preview for snapshots |
| `start({live: true})` | Start live capture; requires `capture.live` |
| `stop()` | Release camera tracks immediately, then wait for an in-flight frame consumer |
| `stop({snapshot: true})` | Also keep the last image |
| `dispose()` | Remove listeners and release tracks |

Disabling the input, making it readonly, stopping the runtime, hiding the page or
disposing the control stops capture. App destruction disposes its acquisition
instances. Stopping capture alone does not cancel a model run; use `app.stop()`
for execution.

#### Processing live frames

Live capture waits for the previous frame consumer before sending another frame;
it does not accumulate a queue. The default consumer calls an ordinary pipeline
with `app.invoke(values, {transient: true})`: values are validated for this run
without changing stored form inputs.

Supply `onFrame: async file => ...` to handle frames yourself. Named pipelines
require this callback to choose a target; their generated controls offer snapshots
only. Do not await `stop()` or `select()` inside `onFrame`, because those methods
wait for the callback to settle.

#### Bitmap transport and ownership

Frames are encoded files by default. Set
`capture: {camera: true, live: true, transport: 'bitmap'}` to receive decoded
`ImageBitmap` live frames. Snapshots and uploads remain files, so the model must
handle both types. Bitmap execution supports local browser JavaScript; Python,
HTTP, CLI and MCP use files or artifact references.

| Bitmap source | Owner and lifetime |
|---|---|
| Passed to `app.invoke({photo: bitmap}, {transient: true})` | Caller owns the original; each model call borrows a separate copy |
| Received by a model | JSEE closes the copy after settlement, including failures; worker delivery transfers only this copy |
| Received by `onFrame` | Valid until the callback's returned promise settles; JSEE also closes late frames after Stop/disposal |

A model may close its copy early. To retain it, make another copy; return files
or pixel data rather than the borrowed bitmap. Forced worker termination disposes
the worker. Ordinary buffers retain their existing cloning behavior.

For named stages, use
`invoke(undefined, {target, transient: true, overrides: {photo: bitmap}})`.
Frames do not enter retained stage results. Bitmaps cannot be stored with
`setInputs` or sent over JSON; there is no automatic fallback to another input
type. Bitmap transport avoids PNG encoding/decoding on the live path but does not
guarantee zero-copy execution or a particular speed. Models still own
preprocessing and inference.

### Persistent output renderers

Pass a `renderers` map when constructing an embedded app, and select a name with
`output.renderer`. The output keeps its computation data type: workers return
ordinary data, and CLI/HTTP/MCP keep the same declared output schema.

```js
function countView(container, initial) {
  const label = document.createElement('span')
  container.append(label)
  const update = data => { label.textContent = String(data.count) }
  update(initial)
  return {
    update,
    dispose() { /* release listeners, observers or graphics resources here */ }
  }
}

const app = new JSEE({
  container: '#app',
  renderers: { count: countView },
  schema: {
    inputs: [{ name: 'n', type: 'int', default: 1 }],
    model: { worker: true, code: ({ n }) => ({ result: { count: n * 2 } }) },
    outputs: [{ name: 'result', type: 'object', renderer: 'count' }]
  }
})
```

#### Renderer lifecycle

The factory is called as `renderer(container, initialData)` and returns
`{ update(data), dispose?() }`.

| Action | What JSEE calls or preserves |
|---|---|
| First value | Create the view |
| Later value | Call `update(data)`; keep DOM, selection, scroll and zoom |
| `null` value | Passed to the view as data |
| In-place mutation | No update; send a new value |
| Values in one UI tick | May coalesce into the latest update |
| CSS hide or tab switch | Keep the view, including hidden host regions |
| `output.display: false` | Unmount and dispose the view |

JSEE also disposes a view when its renderer or descriptor is replaced, its output
is removed or cleared to `undefined`, a media output is blocked, or the app is
destroyed. `dispose()` runs once to release listeners, observers, timers and
graphics resources; JSEE clears the container. An update error retires the view
and displays an error in its card. A subsequent value can mount it again.

Hooks run synchronously on the UI thread. Renderers that start asynchronous work
must cancel it or ignore late results when the source changes.

#### Registration and export

Registrations are copied at construction and belong to that instance. Different
apps can register different views under the same name. The registry handles leaf
outputs; groups keep their layout. Unknown names and invalid controllers show
errors. Existing function outputs that return a cleanup function still work.

Save/Copy use the output's declared type. Schema export retains renderer names,
but `exportHTML()` and `download()` reject host renderer registrations because
they cannot serialize host closures and dependencies. Bundle the host app and its
renderer imports, or remove `output.renderer` to use the built-in view.

Renderers are trusted host code; JSEE's security options do not constrain arbitrary
renderer code. Registration is independent of the `minimal`/`bulma` Vue theme.

[Persistent views example](https://github.com/jseeio/jsee/tree/main/examples/persistent-renderers/index.html):
a selectable sensor table and chart retain selection and scale across worker runs.
TypeScript helpers `OutputRenderer<T>`, `RendererView<T>` and `RendererRegistry`
are exported from `@jseeio/jsee/schema`.

<a id="image-annotations-and-source-coordinates"></a>

### Display images with annotations

Use `JSEE.imageView` to display an image with boxes, points or colored masks over
it, for example, detection boxes or a segmentation mask supplied by your model.
Clicks report positions in the original image, so your app can use them as model
inputs. You can also zoom and pan the display without changing the image data.
The viewer draws annotations; it does not perform detection or segmentation.

Create a view with `JSEE.imageView(container, initial, options)`.
Bundled hosts can import `{ imageView }` from `@jseeio/jsee/image-view`. Register
it under an application name, or mount it directly in a host-owned region and
call `dispose()` when that region is removed. The same update/dispose lifecycle
works in both cases. [The annotation example](https://github.com/jseeio/jsee/tree/main/examples/image-annotations/index.html)
uses worker results, a mask, a box and a point without ML dependencies.

```js
const view = JSEE.imageView(container, {
  source: imageFile, revision: 1,
  boxes: [{ x: 10, y: 20, width: 100, height: 80, color: '#fff' }],
  points: [{ x: 60, y: 60 }],
  masks: [{ width: 1, height: 1, data: [255, 0, 0, 255],
    extent: { x: 10, y: 20, width: 100, height: 80 }, opacity: 0.4 }]
}, { onSelect: ({ x, y, revision }) => console.log(x, y, revision) })
await view.ready
view.setViewport({ zoom: 2, panX: 10, panY: 0 })
view.update({ revision: 1, points: [{ x: 70, y: 60 }] })
```

#### Coordinates and selection

Annotation positions use pixels in the decoded/oriented source image. A box at
`{x: 100, y: 50}` starts 100 pixels from its left edge and 50 from its top edge,
regardless of the image's displayed size or device pixel ratio.

Masks contain row-major RGBA bytes, grid width/height and an explicit `extent` in source pixels. They paint without
interpolation. JSEE does not infer scaling, decode tensors or normalize scores.

| Setting or method | Behavior |
|---|---|
| `fit` | Show the whole image (`contain`, default), crop to fill the viewer (`cover`), or stretch it (`fill`) |
| `mirror: true` | Flip the image horizontally, including annotations and click coordinates |
| `setViewport(patch)` | Zoom or pan the display using `zoom`, `panX` and `panY`; pan is in CSS pixels |
| `sourceToClient(point)` | Map source pixels to viewport CSS coordinates |
| `clientToSource(point)` | Map back; includes `inside`, without clamping letterbox clicks to image edges |
| `onSelect` | Report source coordinates and revision; does not run a model |
| `setSelection(pointOrNull)` | Change the marker without emitting another click |
| `getState()` | Read viewport and selection |

Mapping methods take a point `{x, y}` and return `null` until source pixels are
available. Mapping cannot recover precision lost to pointer-event rounding on a
scaled-down image. A host can pass a selection to `setInputs` and invoke the model
explicitly.

#### Source revisions and loading

| Update | Result |
|---|---|
| New source | Requires an increasing nonnegative integer `revision`; clears layers, selection, zoom and pan |
| Current revision | Replace supplied boxes, points or masks; omitted fields and viewport state remain unchanged |
| Empty layer array | Clear that layer |
| Older revision | Return `false` |
| Changed source at the same revision | Throw an error |

Sources can be URLs, Blobs/Files, bitmaps, canvases or image/video elements.
URL/Blob decoding is asynchronous: `ready` resolves `true` for an accepted load or
`false` for failure/supersession; `onError` receives load failures.

JSEE closes bitmaps it decodes on replacement/disposal, including late loads.
Caller-supplied bitmaps and media elements remain caller-owned. `dispose()` releases
observers, listeners and view references. This renderer does not change model
input/output types or the bitmap execution ownership rules above.

#### Overlaying an existing image or video

Set `{overlay: true}` and use the media element as `source`. JSEE paints annotations
and follows the element's object-fit box and pixel/percentage object-position on
resize/load. The host owns playback, positioning and viewport transforms;
`setViewport` is unavailable. Match `mirror` to the host's horizontal mirroring.
Arbitrary CSS rotations and `calc()` object-position are unsupported.

Pass `{canvas}` to reuse a host canvas. Disposal clears it and restores its style
instead of removing it. Give the container a height when a fixed display area is
needed.

Use overlay mode for playing video; owned-image mode does not continuously repaint
video frames. Inference, heatmaps, annotation editing and a pan/zoom gesture UI are
outside this API. The [host renderer export restrictions](#registration-and-export)
also apply.

### Named stages in the existing pipeline

Give stages IDs to connect model outputs to later inputs and rerun only affected
stages. JSEE expects a flat `model` array, input groups and namespaced outputs; a
host combining tool schemas must flatten them first. Unnamed pipelines keep their
existing merge/stop behavior.

```js
const schema = {
  inputs: [
    { type: 'group', name: 'gen1', elements: [{ name: 'n', type: 'int', default: 4 }] },
    { type: 'group', name: 'fit1', elements: [{ name: 'x', type: 'int', required: false }] }
  ],
  model: [
    { id: 'gen1', scope: 'gen1', type: 'function', code: 'input => ({ count: input.n })' },
    { id: 'fit1', scope: 'fit1', type: 'function', code: 'input => ({ result: input.x * 2 })',
      bindings: { x: { stage: 'gen1', path: ['count'] } } }
  ],
  outputs: [{ name: 'fit1.result', type: 'number' }]
}
const app = new JSEE({ schema, container: '#app', runtimeURL: '/jsee.core.js' })
await app.ready
await app.invoke({ gen1: { n: 5 } }, { target: 'fit1' }) // { 'fit1.result': 10 }
```

#### Stage definitions

| Field | Meaning |
|---|---|
| `id` | Unique stage ID; required on every stage when using named stages |
| `scope` | Root input group supplying the stage's values |
| `bindings` | Replace scoped values using `{stage, path: ['output', 'nestedField']}`, `{input: ['publicInput']}` or `{value: literal}` |
| `from` | Continue another stage's internal model stack; records merge and `stop` propagates along that chain, not independent branches |
| `enabled: false` | Exclude the stage from full runs; dependents require it enabled |
| `render: true` | Run a browser view after its upstream models; mark public outputs `required: false` for headless use |

Cycles and missing stages fail before execution. Dynamic input updates stay within
the stage's declared input group. File bindings use the receiver's text/raw/stream
mode; saved projects need replayable stream sources, not live iterators.

#### Running and inspecting stages

| Call | Behavior |
|---|---|
| Default **Run** or `invoke()` | Reuse current stage results |
| `invoke(values, {target})` | Execute the target's required upstream stages and associated views |
| `invoke(values, {force: true})` | Rerun all stages, or the selected target when supplied; the form also offers **Rerun all** |
| `getStages()` | Read stage status, revisions and results |
| `planPipeline(target)` | Read execution order |
| `getStageInputs(id)` | Read mapped values before input preparation |
| `stop()` | Cancel execution |

Input or upstream revision changes invalidate dependent stages.
`invoke(undefined, {target, transient: true, overrides: {inspect: true}})` can run
an app-defined inspection operation without replacing retained trained results.
JSEE does not interpret the meaning of `inspect`.

#### Saving state and exporting an app

| Method | Contents |
|---|---|
| `getSchema()` | Descriptor with live defaults |
| `getPipelineState()` | Stage results with SHA-256 definition fingerprints, separate from source code |
| `restorePipelineState(state)` | Restore those saved results |
| `exportSchema()` | Resolved code URLs, loaded bytes pinned with `sha256`, and JSON-safe file data |
| `exportHTML({runtime})` | JavaScript assets deduplicated by content hash in the offline DOM cache, plus the supplied runtime |
| Named-pipeline `download()` | HTML export using `runtimeURL` |

Restore compares file bytes once; subsequent edits use immutable file identity.
Render functions are recreated rather than persisted, and function outputs may
return cleanup functions. Hosts own storage and authoring metadata.

HTML export supports JavaScript function models and declared assets. Python,
ES-module models and undeclared network dependencies are unsupported. An exported
app reruns the computation; it is not a saved result snapshot. Random sources need
seeds for repeatable results.

#### Running named stages outside the browser

Node CLI, HTTP `/run` and MCP execute the same flat schema, skipping render stages.
Remote JavaScript references require SHA-256 pins: model/import bytes are verified
before execution, and `security.allowNetwork: false` blocks fetching. Native Python
does not implement named stages. See `test/fixtures/composition.json` and
`test/mcp/composition.test.js`.

### Host-owned regions

Choose which UI the host supplies:

| Constructor option | Effect |
|---|---|
| `controls: false` | Omit JSEE's Run/Stop/Reset footer |
| `toasts: false` | Suppress this instance's toast messages, including loading/errors |
| `regions: {inputs, outputs}` | Mount those sections in host elements |
| `regions: {inputGroups: '#inspector'}` | Place selected input groups in a shared inspector |

`controls` and `toasts` default to `true`. Errors still reject the invocation and
emit `error`; the host must display them. These settings do not affect browser
notifications (`schema.notify`) or execution permissions.

#### Mounting a host editor in an input group

To keep JSEE's normal form and Run/Stop, mount an optional host editor inside an
input group instead of moving the form out of the app:

```js
await tool.ready
const target = tool.getInputGroupContainer('fit1')
// Mount or Teleport your editor into target; publish values with tool.setInputs().
// Unmount the host editor before tool.destroy().
```

Input groups accept `direction: 'column'` to stack fields vertically; the default
remains a row. Scoped model input updates recurse through declared groups, for
example `{diff1: {column: {options: ['', 'price'], value: 'price'}}}`.
Updates cannot create undeclared fields or modify another stage's scope.

In the normal form, `selectInputGroup(name)` finds nested groups and expands
the selected section and its ancestors/children, collapsing unrelated sections.
Selection changes presentation without executing or remounting models.

`getInputGroupContainer(name)` returns the group's editor element, or `null` when
it is not rendered. The target lives until the group or app is removed and follows
accordion visibility. The host retains its own framework context; JSEE does not
load the editor's framework. Editors are authoring UI and are not serialized into
schema/HTML exports; their settings remain ordinary input values.

#### Placing controls and outputs in host elements

For a shared inspector use `regions: {inputGroups: '#inspector'}` and call
`selectInputGroup('fit1')` after `ready`. It changes field visibility without
rerunning or disposing stages. Use `controls: false` when the host owns Run/Stop.

```js
const tool = new JSEE({
  schema,
  container: '#tool-root',
  regions: { inputs: '#tool-controls', outputs: '#tool-results' }
})
await tool.ready
const unsubscribe = tool.on('result', outputs => console.log(outputs))
const outputs = await tool.invoke({ x: 4 })
// Later: unsubscribe(); tool.destroy()
```

Create connected, instance-specific region elements outside `container` before
construction, and retain them until `destroy()`. Either region is optional.
JSEE uses its own Vue root and Teleport; host Vue/Vuetify providers are not inherited.
Each region carries JSEE's theme variables from `schema.design`. Hide the host's
region elements to switch views without rerunning or disposing the tool. Destroy
removes teleported content and listeners. Run/Stop controls remain with inputs.

#### Host events and invocation

| Event | Payload |
|---|---|
| `inputs` | Current values after Vue applies a UI edit, programmatic patch, reset or model-driven input update |
| `start` | Input snapshot for the run |
| `result` | Values returned by `invoke` |
| `error`, `cancel` | Error object |

Reactive schemas retain their automatic-run behavior;
use `reactive: false` and no reactive input flags for manual workspace tools.
Plain objects/arrays are copied; opaque runtime values retain their identities.
`invoke()` never queues behind another run. Existing `run()` queue/interval
behavior remains available to standalone applications.

JSEE is part of the [StatSim](https://statsim.com) ecosystem.

## JSON commands and canonical HTTP

These commands run the whole pipeline and return declared outputs in a consistent
JSON response. Here, **canonical HTTP** means the shared `/run` endpoint; the
older per-model endpoints are documented under [legacy HTTP](#legacy-http-endpoints).

Both packages provide a command named `jsee`: the npm command executes JavaScript models; the Python command executes Python models. If both are installed, use `npx @jseeio/jsee` for Node and the full path to your Python environment's `bin/jsee` for Python. Existing flag-based commands remain supported.

The Node and Python CLIs accept the same descriptor commands. Use a JS model descriptor with Node and a Python model descriptor with Python:

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 3000
```

### Inspection and execution

`inspect` reports input/output JSON Schemas and runtime capabilities without importing models. `validate` checks computation structure, names, known field types, numeric constraints and defaults. It requires a model; render-only descriptors remain valid for the browser. Neither command tests model availability, executes custom browser validation expressions, or validates every UI extension. The full authoring vocabulary remains available in `schema.json`.

`run` reads UTF-8 JSON from stdin by default (`--input -`), or from the selected file. It writes one JSON envelope to stdout; model diagnostics go to stderr. Successful calls return `{runId, status: "succeeded", outputs, artifacts}`. Failed calls return `{runId, status: "failed", error: {code, message}}`. Exit codes are 0 for success, 2 for descriptor/JSON-request errors, and 1 for invocation or output failures.

### Output validation and files

Results include only declared outputs, with group names flattened and aliases
resolved. Accumulated inputs and undeclared intermediate values are omitted.

- Missing outputs or non-JSON values fail with `JSEE_OUTPUT_INVALID`. Errors identify the path and value kind, such as `info.a: undefined is not a JSON value`.
- `NaN`, `Infinity` and `-Infinity` fail at any depth; they are never silently replaced by `null`.
- Before storing files, CLI/HTTP/MCP validate numeric, string and boolean outputs, table containers, media fields and optional object `valueSchema` rules. Chart semantics and unsupported JSON Schema keywords are not checked.
- Without `valueSchema`, `object` accepts any JSON value. Declare bytes as `type: "file"`.

| File result | Representation |
|---|---|
| Model return value | Text or bytes, directly or under `content`, `value` or `data`; optional `filename` and `mime` |
| Value in `outputs` | `{artifact: "<runId>/<index>"}` |
| Entry in `artifacts` | `id`, `output`, `name`, `mime`, `size` in bytes, `sha256`, `uri` |
| CLI storage | `.jsee-artifacts/` in the working directory, or `--artifact-dir`; files have `file:` URIs |

Model-provided paths and URLs are never opened or fetched as file content.

### HTTP routes and limits

Canonical serving adds these routes to the existing UI and per-stage endpoints:

| Route | Result |
|---|---|
| `GET /schema` | Computation descriptor retaining local model references |
| `GET /openapi.json` | Whole-pipeline request, response and artifact descriptions |
| `POST /run` | Execute the entire pipeline with a JSON input object |
| `POST /__jsee/artifacts?name=data.csv` | Upload raw bytes; Content-Type declares MIME; returns `{artifact, metadata}` |
| `GET /__jsee/artifacts/<runId>/<index>` | Download the referenced file as an attachment |

A stage named `run` conflicts with canonical `/run` and is rejected before loading. Rename that stage or retain the legacy serving command. Existing `jsee schema.json --run`, `--serve`, and `-o index.html -f` forms keep their behavior. Python also accepts `serve(schema, canonical=True)` and `create_app(schema, canonical=True)` with a descriptor path or dict referencing local model files; call the WSGI application's `close()` when retiring it.

| Limit | Default | Option |
|---|---|---|
| JSON request or raw HTTP upload | 50 MiB | `--max-body-bytes` |
| Stored artifacts, including pending uploads | 64 MiB | `--max-artifact-bytes` |
| Stored file count | 1,024 | Fixed |

A batch that exceeds the quota publishes no partial artifacts. Input and output
files share the store: a transform retaining both may need a larger quota. These
limits do not bound model memory or execution time.

HTTP artifacts live in a private temporary directory until shutdown. Their URIs
are relative to the server and do not survive a restart; a killed process may
leave temporary files for host cleanup. Downloads verify size/SHA256 and return
409 if stored bytes changed.

### Passing files between runs

Ordinary `type: "file"` inputs accept inline text or an existing `{ "artifact": "<runId>/<index>" }` handle. References resolve in the current store before model execution: ordinary files become strict UTF-8 text, while `arrayBuffer: true` becomes ArrayBuffer in JS or bytes in native Python. Legacy inline numeric arrays keep their existing meaning. Raw/stream file modes retain their separate semantics and do not accept artifact references.

An output reference can be passed unchanged to the next run. The ID is scoped to the store; SHA256 is integrity metadata, not an access key. Invalid, foreign or unavailable IDs, changed file bytes and MIME mismatches fail as invalid inputs. Strings are never implicitly opened as paths or URLs. In-process `invokeSchema(..., {artifactStore})` and `invoke_schema(..., artifact_store=...)` can use the existing transport module's ArtifactStore; calls without a store reject references.

```sh
# Both Node and Python CLIs; output is {artifact, metadata}.
jsee artifact-import sales.csv --mime text/csv --artifact-dir .jsee-artifacts
# Put {"csv":{"artifact":"<returned ID>"},"missing":"drop"} in input.json.
jsee run schema.json --input input.json --artifact-dir .jsee-artifacts
```

CLI registrations persist alongside bytes, so subsequent invocations can reuse handles. Registrations created before this feature cannot be recovered from old bare files. Writers serialize publication with `.write-lock`; after an interrupted CLI write, verify that no writer remains before removing that lock. HTTP registrations last until host shutdown; MCP registrations last for the session. Moving a file to another host/session requires explicit download/upload. The JSON request and raw HTTP upload limits are both controlled by `--max-body-bytes`; ingestion does not remove store quotas.

### HTTP errors and access

`/run` accepts JSON only.

| Status | Cause |
|---|---|
| 400 | Invalid inputs |
| 413 | Request body too large |
| 415 | Unsupported content type |
| 422 | Unsupported execution capability |
| 500 | Model or output error |
| 507 | Artifact quota exceeded |

Servers bind to localhost by default. Canonical serving applies same-origin
access to every route, including legacy endpoints and static files. Legacy serving
retains wildcard CORS until a host policy is configured. See
[authentication and CORS](#http-authentication-and-cors) for host-wide settings.

Security flags gate JSEE-managed operations; they do not provide an OS sandbox.
Remote MCP, streaming/cancellation through `/run`, and multi-descriptor serving
remain unsupported.

## HTTP authentication and CORS

The same host policy covers the UI, runtime/model files, discovery, canonical and legacy API routes, streams, artifacts, and error responses. Configure it with either CLI:

```sh
# Read an existing shared token from APP_TOKEN; its value stays out of argv.
jsee serve schema.json --auth-token-env APP_TOKEN
jsee serve schema.json --auth-token-env APP_TOKEN --cors-origin https://client.example
```

Alternatively use `--auth-token TOKEN`. The options also work with legacy serving commands. Python `serve()` and `create_app()` accept `auth_token`, `auth_token_env`, and `cors_origins` (a list). Token configuration is validated before importing descriptor models; missing/empty environment values fail startup. Auth/CORS flags are server-only and cannot become schema defaults, model inputs or verbose argv output. They are rejected in MCP stdio and JSON command modes.

### Client authentication

Clients send `Authorization: Bearer TOKEN`. Browsers use the built-in HTTP login prompt: username `jsee`, password the same token. Both authenticate every actual request; there are no public UI, asset or discovery bypasses. Tokens are never embedded in generated HTML or schemas. Missing/invalid credentials return JSON 401 with authentication challenges. Authenticated responses use `Cache-Control: no-store`, including streams and downloads. OpenAPI declares Bearer and Basic as alternatives.

### Allowed origins

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

### Proxies and deployment

Serve credentials over HTTPS through a trusted TLS proxy, or use an SSH tunnel. For a TLS proxy, explicitly allow its public HTTPS origin; JSEE does not trust forwarded headers. Runtime URLs in served Node pages are relative, so they retain the browser's host, scheme and authentication. This is shared-token access control, with no user accounts, OAuth, per-tool permissions or execution sandbox. See the [Bearer](https://www.rfc-editor.org/rfc/rfc6750.html#section-2.1), [Basic](https://www.rfc-editor.org/rfc/rfc7617.html) and [CORS](https://fetch.spec.whatwg.org/#http-cors-protocol) standards.

## MCP over stdio

Start one descriptor as an MCP tool with `jsee serve schema.json --mcp-only`. This mode uses stdin/stdout for MCP and stderr for model diagnostics; it opens no HTTP listener. Node requires Node.js 20+ and uses the official `@modelcontextprotocol/server` SDK (2.0.0). Native Python requires Python 3.10+ and the optional `server` extra (`mcp` 2.2.0); install with `python -m pip install 'jsee[server]==0.9.0'`. Python's base installation remains stdlib-only.

Configure an MCP client to launch the installed `jsee` executable with arguments `['serve', '/absolute/path/schema.json', '--mcp-only']`. Use the executable belonging to the descriptor's language. For a Node checkout, use command `node` and prepend `/absolute/path/jsee/bin/jsee` to those arguments.

### Tool discovery and results

`tools/list` derives a computation tool from the descriptor's stable `id`, title, description and input schema without importing model code. `tools/call` executes the same whole-pipeline invocation as JSON CLI/HTTP. Success returns the complete `{runId, status, outputs, artifacts}` envelope as `structuredContent` and JSON text, with its generated `outputSchema`. Invalid inputs, execution/output failures and artifact quota failures return `isError: true` and the failed envelope as text. Unknown tools or artifact URIs produce protocol errors.

### Reading MCP artifacts

File results include `resource_link` entries with session-scoped `jsee-artifact:` URIs. `resources/list` exposes metadata; `resources/read` returns exact bytes as a base64 blob only when requested. Verify the decoded bytes against `size` and `sha256` in the run envelope. Store limits remain 64 MiB/1,024 files per session (`--max-artifact-bytes` changes bytes); rejected batches expose no files. Files disappear on orderly close or SIGTERM and cannot be retrieved by another session. SIGKILL or a crash can leave temporary files.

`--max-body-bytes` bounds decoded arguments (50 MiB by default); Node also applies that limit to its incoming wire buffer, including protocol overhead. Python's SDK reads a message before JSEE checks its arguments. These limits do not bound model memory. A resource read returns the entire file: base64 adds overhead, and the client's message limit may be lower than the store quota. Large-file chunking is not implemented.

### Uploading MCP artifacts

Discovery also lists `upload_artifact`, renamed `jsee_upload_artifact` if the
computation already uses that ID.

1. Start with `{data: "<base64>", name: "data.csv", mime: "text/csv", offset: 0}`.
2. Continue with the returned `upload` ID and `offset`. Each chunk can contain at most 262,144 decoded bytes.
3. Set `final: true` to publish `{artifact, metadata}`. Pass `{artifact: result.artifact}` to a compatible model input.
4. To abandon an incomplete upload, send `{upload: id, cancel: true}`.

Up to 16 incomplete uploads share the store byte quota and remain absent from
resource listings. The client transfers the chunks; model arguments contain only
the artifact reference. Client/server message limits must accommodate base64
encoding and protocol overhead.

### MCP support and limits

Independent Node and Python SDK clients test both servers in legacy negotiation and protocol 2026-07-28 mode, including the [clean sales workflow](https://github.com/jseeio/jsee/tree/main/examples/clean-sales/README.md). MCP calls use the existing programmatic invocation lifecycle; persistent model state across calls is not a portable contract. This adapter supports terminal calls for one descriptor. Remote MCP, streams and forced cancellation remain pending; HTTP authentication is separate from stdio process access. Model source is trusted code; stdio separation is not a sandbox.

<a id="cli--nodejs"></a>

## CLI: Node.js

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
| `-b, --bundle[=mode]` | Embed runtime and declared dependencies into HTML (`default`, `hybrid`, `pyodide`, `pyodide-single`, or `offline-strict`) |
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

Embeds declared browser assets into HTML: the JSEE runtime, model/view/render code, and all imports are stored in hidden base64 `<script data-src="..." data-encoding="base64">` elements. Local files are detected by checking the filesystem (so bare paths like `dist/core.js` work alongside `./relative.js`); anything not found locally is fetched from CDN.

When `security.allowEval` is false, hidden bundled JavaScript model/import code is intentionally blocked at runtime. Use a separate `type: "module"` model URL for the no-eval JavaScript path; set `worker: true` if that module should run in JSEE's Web Worker.

Model dependencies and schema `imports` are separate mechanisms: local model files that use `require()` or static `import`/`export` are bundled with optional `esbuild` during `--bundle`, so npm dependencies can become part of the generated HTML; schema `imports` remain explicit browser assets loaded before the model, such as CDN globals, local helper scripts, CSS files, Plot/Three/Leaflet, or other side-effect libraries.

For browser Python, `--bundle` caches a configured `model.pyodide.url` loader script when `model.pyodide` is explicit. Pyodide's WASM, stdlib zip, and package wheels are still loaded from `model.pyodide.indexURL`, so strict no-network Pyodide bundles require those Pyodide release assets. Use `--bundle=pyodide` to copy a local Pyodide asset directory, or fetch an explicit remote Pyodide `indexURL`, beside the generated HTML and rewrite the generated schema to the copied relative path. Use `--bundle=pyodide-single` to embed Pyodide core assets and declared package wheels into the HTML itself. Declare package wheels to fetch with `model.pyodide.packages` or Python-model `imports`; auto-detected Python imports are not bundled.

This does not discover arbitrary fetches, model weights, host closures or dynamically loaded dependencies. API models still need their server. Verify the generated app with networking disabled before distributing it as offline.

Bundle modes:
- `--bundle` or `--bundle=hybrid` keeps the compatibility behavior: JSEE inlines what it can and warns when configured Pyodide assets still point at a remote `indexURL`
- `--bundle=pyodide` requires explicit `model.pyodide` assets, copies a local `indexURL` directory or fetches a remote `indexURL` core asset set beside each generated HTML output, fetches declared package wheels from `pyodide-lock.json`, and caches the copied `pyodide.js` loader in hidden storage
- `--bundle=pyodide-single` requires explicit `model.pyodide` assets, embeds Pyodide core assets (`pyodide.asm.wasm`, stdlib zip, lock file, asm JS/module when present) plus declared package wheels into a hidden manifest, and rewrites generated Pyodide URLs to an in-page `jsee-pyodide://` asset shim
- `--bundle=offline-strict` fails generation if the bundle would still need runtime network for API models, remote model URLs, implicit default Pyodide, remote Pyodide `indexURL`, or a missing local Pyodide asset directory relative to the generated HTML file

#### `--runtime`

Select the runtime source for generated HTML:
- `auto` (default): `inline` when `--bundle`, otherwise `cdn` for file output and `local` for dev server
- `local`: `/dist/...` for served pages; generated files use the configured server host and port
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

Inputs explicitly set from the CLI are locked (non-editable) in the GUI and used as defaults for server-side execution. CLI options and their aliases are reserved: `--port`/`-p` configure the server even if the schema has an input named `port` or `p`. To override a colliding input such as `b`, pass positional values (`jsee schema.json 3 4` for inputs `a`, `b`), declare a non-conflicting input alias, or use JSON with `jsee run`. CLI option defaults never change model defaults. Unnamed groups use their child fields in positional order.

```bash
# Positional — mapped to inputs in schema order
jsee schema.json 42 hello

# Named — matched by input name
jsee schema.json --x=100 --y=200

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

Output type auto-detection also works for model results: if a model returns a string ending in `.png`, it renders as an image automatically.

### Serve bar

When serving, a top bar appears with the server address and, when server-side execution is active, a Browser/Server toggle to switch execution mode. Python-served pages also include a Save HTML button. Bundled generated output files show a Download HTML button instead of the serve bar.

## Whole-pipeline invocation

Call a pipeline directly from Node or Python without starting a server. This API
returns native values and intermediate results. Use the JSON CLI or HTTP API when
you need declared-output filtering, serialization and stored file artifacts.

| Contract | Browser | Node | Native Python |
|---|---|---|---|
| Groups, defaults, options, numeric constraints | Validated | Validated | Validated |
| Custom input expressions and nonempty controls | UI validation | Not evaluated | Not evaluated |
| Pipeline execution | Browser orchestrates stages | `invokeSchema`, JSON CLI, canonical HTTP and MCP execute JS pipelines; legacy stages remain | `invoke_schema`, JSON CLI, canonical HTTP/WSGI and MCP execute Python pipelines; legacy stages remain |
| Python callable selection | Pyodide `entry` | Not a native Python runtime | `entry`, with a separate endpoint `name` |
| Interruption | Worker termination; cooperative main-thread and fetch cancellation | No OS containment | Stream cleanup; no forced interruption of arbitrary model code |

Identified stages are supported in browser/Node execution; native Python supports ordinary sequential pipelines.


Node exports `invokeSchema(schema, inputs, { schemaPath, cwd, log })` from `@jseeio/jsee/cli`. Python exports async `invoke_schema(schema, inputs, cwd='.')` from `jsee`. Both validate inputs before importing models, apply declared defaults, and execute the complete `model` pipeline. See the [clean sales example](https://github.com/jseeio/jsee/tree/main/examples/clean-sales/README.md) for JavaScript, Python, and a generated offline form with a CSV download.

The returned envelope is `{ runId, status: 'succeeded', result }` or `{ runId, status: 'failed', error: { code, message } }`. Each call gets a new run ID; model fields named `status` or `runId` remain inside `result`. Error codes are `JSEE_SCHEMA_INVALID`, `JSEE_INPUT_INVALID`, `JSEE_CAPABILITY_UNSUPPORTED`, and `JSEE_EXECUTION_FAILED`. These checks cover invocation prerequisites and existing input-value rules; full descriptor authoring validation remains separate.

Results retain accumulated pipeline data, including intermediate values. Only records merge; arrays, scalars and null replace the previous value. Python `None` corresponds to JS null; JavaScript's undefined retains the previous value. The existing truthy `stop` field stops later stages. JSON input containers are copied before execution. Runtime values are returned directly, without HTTP serialization or file persistence.

This interface supports local JS functions/classes/async initializers and native Python sync/async functions in files. Python uses keyword binding by default and schema input order for `container: 'args'`. Python stages retain the loader's unique-name requirement. Ordinary schema imports, unpinned remote models and streaming are rejected;
normal imports inside model source remain usable. Node also supports remote JS
model URLs and per-model imports with SHA-256 pins, verifying bytes before execution.
Native Python requires local model files. Calls execute on the caller's thread without forced interruption, worker isolation, or enforcement of browser timeout/security flags.

### Legacy HTTP endpoints

Every server (both Node.js with `--execute` and Python) exposes these endpoints:

| Route | Method | Description |
|---|---|---|
| `/` | GET | Interactive GUI |
| `/api` | GET | Schema and endpoint discovery |
| `/api/openapi.json` | GET | Auto-generated OpenAPI 3.1 spec |
| `/{modelName}` | POST | Execute model with JSON or multipart input |

Both servers accept `application/json` and `multipart/form-data` POST bodies and
return JSON errors for invalid requests. Legacy serving defaults to wildcard CORS;
canonical serving and explicit authentication/origin settings use the
[host access policy](#http-authentication-and-cors). The Node dev server accepts JSON and multipart request bodies up to 50 MiB. Python `serve()` and `create_app()` share request decoding and default to the same 50 MiB limit; set a positive `max_body_bytes` or the Python CLI's `--max-body-bytes` to change it. Invalid lengths or input values return 400; declared oversized bodies return 413 before reading the body. This size limit does not provide execution isolation or a request deadline. Python `serve()` runs with a threaded dev server, awaits async model functions, and streams sync or async generator functions as SSE when `stream=True`.

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


<a id="cli--python"></a>

## Python

<a id="python-serve-a-function"></a>
<a id="use-python-instead"></a>

**Python**: includes the browser runtime; no Node.js required:

```sh
python -m pip install jsee
```

Requires Python 3.9+. For Python MCP support, use Python 3.10+ and `python -m pip install 'jsee[server]'`. Models may need additional packages.

See the [Python quick start](py/README.md#quick-start) for a complete example and the [Python README](py/README.md) for type annotations, schema generation, CLI commands, streaming and WSGI deployment.

## Status and limitations

- Browser regression tests run in Chromium. Firefox and WebKit have not been verified. Strict Python/WASM CSP deployments need separate verification; see the [worker/CSP reference](#security-and-csp).
- Node and Python JSON CLI, HTTP `/run` and MCP calls execute local models and return a completed result. Streaming is unsupported on that path. Node accepts SHA-256-pinned remote
  JavaScript models and per-model imports; native Python requires local model files. Browser execution and legacy streaming routes have different capabilities; see [whole-pipeline invocation](#whole-pipeline-invocation).
- Identified pipeline stages are supported in browser/Node execution, not native Python. [Named stages](#named-stages-in-the-existing-pipeline) are optional; ordinary sequential pipelines remain available.
- MCP supports one descriptor over **stdio**. Remote MCP, canonical streaming and forced server-side cancellation are pending.
- Worker isolation keeps computation off the UI thread. Browser security flags gate JSEE operations; server execution runs trusted code with the process's permissions. Neither is an OS sandbox.
- Offline use depends on the model's assets and dependencies. API models need their server; Python bundles need Pyodide assets and declared packages. See [bundle modes](#--bundle).

### Versioning

JavaScript and Python share a major/minor compatibility line; compatible fixes can have different patch versions. `schemaVersion: 1` versions the descriptor format separately. Omitting it retains version-1 behavior. Package version agreement does not remove runtime-specific limits.


## Development

### Build from source

From a checkout of `https://github.com/jseeio/jsee`:

```sh
npm install
npx playwright install --with-deps chromium
npm run build
python -m pip install './py[server]'
python -m pip install pytest build wheel
```

Use Node.js 20+ and Python 3.10+ for the complete suite (the base Python package supports 3.9+). The Playwright install step may require permission to install system packages. `npm run build-dev` is a faster development build; it does not qualify production CSP behavior or run the tests.

The maintained Python source is `py/`. Production builds copy the browser runtime and schema into its package data; installing a prepared wheel requires no Node.js.

### Repository verification

`npm run build` builds browser assets, copies them into the maintained Python package, and runs types, unit tests, and the standard Playwright suite. `npm run test:python-native` checks the native runtime and builds/installs packages outside the checkout. After installing `./py[server]`, run `npm run test:mcp` for independent SDK client/server checks. Set `JSEE_MCP_PYTHON` to use a separate Python executable.

The additional app suites exercise real computation:

| Command | Coverage |
|---|---|
| `npm run test:python` | Pinned Pyodide/NumPy, repeated entry calls, addition and CSV summary on the main thread and in workers |
| `python -m pip install -r test/python/requirements.txt` then `npm run test:python-apps-native` | Native pandas summary against the same CSV/result fixtures as Pyodide |
| `npm run test:ml` | GPT-2 text generation and camera -> CLIP worker -> view, with pinned weights and dependencies |

The app suites verify assets against `test/fixtures/runtime-assets.json`, downloading missing files into ignored `tmp/test-assets/`. Python assets use about 55 MB; ML assets use about 1.12 GB. These are download sizes, not runtime memory requirements. Browser requests use local assets; ML tests redirect the original apps' known external URLs to the pinned copies and block other external requests. GPT-2 is rebuilt from its reviewed source and lockfile with dependency installation scripts disabled. The tests use genuine model inference and a deterministic simulated camera frame.

`test/fixtures/real-apps/manifest.json` records source hashes, origins, and intentional repairs to historical examples. Generated bundles, model weights, and dependency trees are excluded from Git and package contents. The default unit suite requires neither those dependencies nor model downloads. Browser Python tests pin Pyodide 314.0.7, NumPy 2.4.6 and pandas 3.0.2; a separate 0.24.1 loader regression covers the classic compatibility path. Single-file CLI and browser re-download tests run with network access blocked. For Python, browser download requires an app generated with `--bundle=pyodide-single`; it preserves those embedded assets instead of discovering arbitrary packages used during execution. This does not establish support for every runtime or Python package.


For focused compatibility checks, install the corresponding Playwright browser and dependencies, then set `JSEE_TEST_BROWSER=firefox` or `JSEE_TEST_BROWSER=webkit`. Chromium is the default. Set `JSEE_TEST_NO_GPU=1` to disable GPU use in the Playwright suites; do not run `test:ml` as an interface-only check.


## Help

Report problems with the descriptor, runtime version and reproducer in [GitHub issues](https://github.com/jseeio/jsee/issues). JSEE is [MIT licensed](LICENSE).

## Changelog

See the [changelog](CHANGELOG.md) for release changes.
