# Schema reference

[Home](../../README.md) · [First computation](../guide/README.md) · [Schema](../schema/README.md) · [Browser API](../browser/README.md) · [CLI, HTTP and MCP](../cli/README.md) · [Python](../../py/README.md)

Look up descriptor fields, input/output values, runtime bundles and display options. The schema describes the computation; each runtime supports a documented subset of execution features.

On this page: [Model](#model) · [Design](#design) · [Inputs](#inputs) · [Outputs](#outputs) · [Security/CSP](#security-and-csp) · [Structured/media values](#structured-and-media-inputs) · [Bundles](#runtime-bundles)

## Schema blocks

The package includes a [JSON Schema for descriptor authoring](../../schema.json) (draft-07). Editors can use `"$schema": "./node_modules/@jseeio/jsee/schema.json"`; validators can load it with `require('@jseeio/jsee/schema.json')`. It checks known fields and nested groups without loading model code, and permits extension metadata. Runtime initialization retains its existing advisory checks for unknown options; authoring validation does not prove that a model or dependency can execute.

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

## Schema

### Model

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
  - `pyodide` (string or object) — Browser Python defaults to Pyodide **314.0.7** (Python 3.14.2). Override with an ES-module loader URL, or `{ "url": "/pyodide/pyodide.mjs", "indexURL": "/pyodide/" }`. Declare `imports` or `packages` for wheels included by `--bundle=pyodide` / `--bundle=pyodide-single`. Pyodide 314.x requires module workers; use its `.mjs` loader. Explicit older `.js` loader overrides retain a classic-worker compatibility path; 0.24.1 is covered by a regression. Pyodide 314 bundles sqlite3/lzma, removes pydecimal/test packages and OpenSSL-backed hashlib algorithms, and stubs actual TLS operations in ssl. Browser fetch remains the HTTP path.
  - `method` (string) — If `type` is `class`, `method` defines the name of the class method to call during evaluation
  - `container` (string) — How input values are passed to the function/method:
    - `object` (default) — Pass inputs wrapped in an object, i.e. `{'x': 1, 'y': 2}`
    - `args` — Pass inputs as separate arguments
    - In `object` mode, JavaScript models receive the runtime context as a second argument: `function model(inputs, ctx) { ... }`
  - `worker` (boolean) — If `true`, JSEE initializes a Web Worker to run the script
    - `ctx.log(...args)` — Write runtime logs
    - `ctx.progress(value)` — Report progress (`0..100` or `null` for indeterminate)
    - `ctx.isCancelled()` — Returns true once this invocation completes, is cancelled, or is replaced. Context callbacks belong to the invocation; late `ctx.log()`/`ctx.progress()` calls are ignored. Browser `ctx.output()`/`ctx.outputAsync()` follow the same rule. Browser instance fields and methods remain accessible through the context
  - `timeout` (number, default: `30000`) — Worker execution timeout in milliseconds. Only applies when `worker: true`. If exceeded, the worker is terminated with an error. Initialization has its own deadline
  - `initTimeout` (number, default: `120000`) — Worker initialization deadline in milliseconds, including runtime/import loading and async initialization. Failures and timeouts terminate the worker; increase explicitly for large models.
  - `workerUrl` (string) — Optional external worker entry, e.g. `/dist/jsee.worker.mjs`, for a same-origin `worker-src 'self'` deployment. Default creation remains dynamic: the bundled worker source becomes a Blob URL on HTTP(S), or a data URL for standalone `file://` HTML. The classic entry is `jsee.worker.js`; use it for classic JS models and the compatibility modes below. Both files are built from `src/worker.js` and share execution, cancellation and messaging.

  Python 314, native ES-module models and API models use module workers. Classic JavaScript functions/classes/imports keep classic workers, including `allowEval: false` URL scripts. ES-module models with classic JS imports also select that compatibility build; CSS imports do not. Explicit older Python `.js` loaders use it too. Both builds share one worker implementation: no script concatenation, extra eval adapter or silent main-thread fallback. This preserves independent script strictness, global declarations and the existing CSP requirements.

  - `imports` (array) — Per-model imports loaded before this model's code executes. Accepts URLs as strings or objects `{ url: "..." }`. Top-level `imports` are moved to the first model internally
  - `model` can also be an **array of model objects** to create a pipeline. Models execute sequentially — each receives the merged output of the previous one. First model defaults to `worker: true`, others to `worker: false`. Return `{ stop: true }` from any model to halt the pipeline early
- `render` — Custom rendering script. Instead of relying on JSEE for output visualization, you can provide a custom script that visualizes the results. That can be useful if you rely on custom libs for plotting
### Design

- `design` — Design parameters
  - `layout` — Layout for the model/input/output blocks. If it's empty and the JSEE container is not, JSEE uses inner HTML as a template. If the container is empty too, it uses the default `blocks` template. Set `'sidebar'` for a fixed-width (280px) sticky input panel — inputs stay visible while scrolling outputs. Collapses to single column on mobile. `grid` sets its column split; a host that places the app below its own header can bound the panel with the `--jsee-sidebar-max-height` CSS variable (default `100vh`)
  - `framework` — Design framework to use (`'minimal'` by default). If a JavaScript object with the same name is present in a global context, JSEE loads it too (using Vue's `use` method)
  - `theme` — Visual preset: default minimal, or `'mono'` for monochrome controls, quiet headings and flat cards. Mono uses system colors by default. Existing `'dark'` selects the minimal dark palette; `'auto'` selects minimal with system colors
  - `colorScheme` — `'light'`, `'dark'` or `'auto'`; overrides the preset's default. Auto follows system changes without JavaScript listeners. Applies separately to each app and its host regions
  - `primary` — Accent color (buttons, toggles, gradient). Hex string, e.g. `'#e74c3c'`
  - `secondary` — Second gradient color. Defaults to a darker shade of `primary`
  - `bg` — Background color. Derives card, input, and border colors automatically
  - `fg` — Text color. Derives secondary text color automatically
  - `font` — Font family string, e.g. `'Georgia, serif'`
  - `radius` — Border radius in pixels (number) or CSS value (string)
  - `grid` (array) — 12-column grid split for input/output sections. E.g. `[4, 8]` (default), `[6, 6]` (equal), `[3, 9]`. Values are `fr` units
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
      - `section` — collapsible section with a prominent heading, for module-level groups in long forms
      - `tabs` — tabbed view where each child element becomes a tab (child groups use their `name`/`label` as tab label)
    - `object` — JSON editor for nested objects, lists or other JSON values
    - `table` — Editable table using row objects or `{columns, rows}`. Clipboard CSV/TSV paste expands from the selected cell; choose whether an empty table takes its column names from the first pasted row. Duplicate headers reject without changing data. Unsafe integers and non-finite numeric text stay strings. This bounded editor does not ingest large CSV files or virtualize rows.
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
  - `readonly` (boolean) — Prevent editing while retaining the current value; controls without native readonly support are disabled
  - `accept` (string) — File/media MIME types, wildcards or extensions, separated by commas; checked against file selection and stored artifact metadata
  - `enter` (boolean) — If `true` on a `string` input, pressing Enter triggers a model run (useful for chat or search inputs)
  - `raw` (boolean, file input only) — If `true`, pass the raw source to the model instead of reading text in the UI (`File` object for disk files or `{ kind: 'url', url: '...' }` for URL input)
  - `stream` (boolean, file input only) — If `true`, pass an async iterable `ChunkedReader` to the model instead of raw source handles. Supports `for await (const chunk of reader)`, `await reader.text()`, `await reader.bytes()`, and `for await (const line of reader.lines())`. Works in both main-thread and worker execution. Reader metadata (`reader.name`, `reader.size`, `reader.type`) is preserved and remains available in downstream pipeline models
  - `validate` (string) — Browser control validation using Filtrex. The variable `value` holds the current input value. Expression must return truthy for valid input. E.g. `"validate": "value >= 0 and value <= 150"`. Runs on input changes (debounced) and before browser execution, including programmatic `jsee.run()` calls. Nested groups are traversed; group expressions receive their collected field values. Invalid controls show errors and block execution
  - `required` (boolean) — Ordinary browser controls reject empty strings, null, undefined, and empty arrays, including when a `validate` expression is also present. Table/JSON controls use field-presence semantics and permit empty collections as values. HTTP/CLI contracts use it for required field presence; portable value constraints come from declared types, options, and numeric bounds
  - `error` (string) — Custom error message for `validate` or `required` failures (default: `"Invalid value"` / `"Required"`)
  - `columns` (number, 1-12) — Grid column span for this input. When any input has `columns`, the inputs section switches to a 12-column CSS grid. E.g. `"columns": 6` makes the input take half width
  - URL params for file inputs (e.g. `?file=https://...`) auto-load on init, so bookmarkable links run without an extra Load click
### Outputs

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
    - `scores` — Ranked `{label, score}` rows, with bars on a shared display scale and accessible meters. Accepts an array (including empty), string labels and finite numeric scores. Extra row metadata is preserved. Sorts only the view; model data and CLI/HTTP/MCP values retain their original order and numbers. `min`/`max` set the display range (default 0/1, finite and increasing); values outside it clip only the bar and are identified in accessible text. `format: 'number' | 'percent'` defaults to number; percent changes display only. `precision` sets maximum decimal places (0–20, default 3); `prefix`/`suffix` decorate the displayed value. No normalization, inferred probability semantics or history. Rows update through the existing renderer lifecycle and inherit the app theme. Included in the core/offline runtime; no chart dependency. Example: `examples/scores/` ([build and serving instructions](https://github.com/jseeio/jsee/tree/main/examples/scores/README.md))
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
### Security and CSP

- **Security mode** — set `security.mode: "secure"` or `security.trusted: false` to opt into stricter trust settings. Secure mode defaults `allowEval`, `allowNetwork`, `allowRawHtml`, `allowNotifications`, and `allowFileViewer` to `false`; explicit booleans such as `security.allowNetwork: true` can override individual defaults. `allowEval: false` blocks inline JavaScript/Python model code, cached hidden JavaScript assets, Blob-script worker execution, worker class lookup, and Pyodide source execution; use `type: "module"` with a module URL for the no-eval JavaScript path. Module models default to the main thread and can opt into `worker: true`. `allowNetwork: false` blocks API model requests plus network model/import/Pyodide runtime loads when JSEE can evaluate the schema before the request; same-origin relative model/import URLs are checked as relative schema URLs even when JSEE later resolves them for browser or worker loading. `allowRawHtml: false` sanitizes `html`, `svg`, `markdown`, and `chat` outputs, disables raw HTML inside Markdown, removes event handlers/scripts/unsafe URLs, and preserves ordinary Markdown formatting. `allowNotifications: false` skips browser Notification permission requests and completion notifications. `allowFileViewer: false` disables built-in file/folder input controls and replaces file/media outputs (`image`, `audio`, `video`, `pdf`, `gallery`, `viewer`, `file`) with a blocked placeholder. Loading the schema URL itself happens before schema security can be known
These security flags gate JSEE-managed operations. They do not sandbox arbitrary model code, intercept all network calls, restrict the host filesystem, or enforce CPU/memory limits. Web Workers provide a separate execution thread and message passing; they retain browser worker capabilities such as network access. Deployment isolation must be provided and tested by the host.

- **CSP deployment matrix** — for strict CSP/no-eval deployments, prefer `security.mode: "secure"` plus `type: "module"`. The current browser bundle injects built-in CSS at runtime, so built-in UI styles require `style-src 'unsafe-inline'`. Dynamically embedded workers require `worker-src blob:` over HTTP(S), or `worker-src data:` for file-origin HTML. An external `model.workerUrl` can use `worker-src 'self'`

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
- Shared input contracts —Named groups become nested objects; unnamed layout groups flatten into their containing object. Buttons are excluded. Option objects use `value`, then `name`, then `label`; numeric and boolean options retain their types. Positional JS models (`container: 'args'`) receive declared inputs in schema order, without extra caller metadata
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

## Structured and media inputs

`object` accepts JSON values, including nested objects and variable-length lists. Its editor reports invalid JSON and blocks execution until corrected. `table` accepts the same values as table outputs: an array of row objects or `{ "columns": ["name"], "rows": [["Ada"]] }`. The table editor supports adding/removing rows, adding columns and editing JSON. Cells preserve JSON types: `0`, `false`, `null` and `""` are distinct. Column-specific validation is not inferred. An `object` input or output can declare an optional `valueSchema`, for example:

```json
{"name":"info","type":"object","valueSchema":{"type":"object","properties":{"counts":{"type":"array","items":{"type":"integer","minimum":0}}},"required":["counts"],"additionalProperties":false}}
```

`valueSchema` uses a bounded JSON Schema vocabulary: `type` (including type arrays and `null`), `properties`, `required`, boolean `additionalProperties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, `maxItems`, and `description`. Browser, Node and Python enforce these rules, and HTTP/MCP discovery exposes them. Unsupported keywords fail descriptor validation; references, formats, nested defaults and coercion are not supported. A provided shape owns nullability: include `"null"` in its type if needed; outer `nullable` or `default: null` do not widen it. Without a shape, `object` keeps accepting any finite JSON value.

Named groups remain useful for fixed nested forms.

`image`, `audio` and `video` provide file selection and previews. Declare `accept`, such as `"image/png"` or `"audio/*"`, to restrict selection; the media type also requires its own MIME family. Browser JS models receive an ArrayBuffer; native Python models receive bytes. Pyodide models can use `bytes(value)` on the received buffer. Canonical CLI/HTTP/MCP inputs use `{ "artifact": "<runId>/<index>" }`, rather than encoded media strings. MIME describes supplied metadata; it does not prove that a codec can decode the content. JSEE does not implicitly convert images to PIL/NumPy or audio to sample arrays.

Media outputs may return bytes (with `mime` in the output descriptor), or `{content: bytes, mime: "image/png"}`. Canonical hosts store these as reusable artifacts. Existing media URL strings remain URLs. The canonical served UI uploads selected media, invokes the whole pipeline through `/run`, and displays its artifacts. Standalone browser apps keep local file data on the device. The new editors support `disabled` and `readonly`.

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

These are reference fragments, not standalone programs. Supply the model files named by each descriptor. Start with the [complete computation tutorial](../guide/README.md) for runnable files.

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
