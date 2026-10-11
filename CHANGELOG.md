# Changelog

## 0.9.0

### Added:
- Add atomic setInputState with nested paths, existing presentation properties and choice options. Separate value reactivity from descriptor metadata; retain values and caches on state-only updates.
- Expose invocation/stage progress events and optional byte/phase metadata, independent of progress-bar presentation. Correlate runtime worker replies/progress; preserve legacy callbacks and forced Stop.
- Add opt-in cooperative Stop with invocation AbortSignal, settlement before reuse and worker grace-timeout fallback. Default Stop remains forced; expose whether workers were retained. Route cancellation to the active worker request and suppress cancelled callbacks/downstream execution.
- Image inputs share scoped upload/drop/paste and optional camera snapshots/live capture with custom layouts via createImageInput. Live capture awaits consumers; Stop/disposal releases tracks. Ordinary browser invoke supports transient input values without storing them.
- Optional capture.transport=bitmap uses transient ImageBitmap inputs for local browser JS. Models borrow independently owned copies, worker copies are transferred, and frames close after settlement/cancellation. Snapshots remain files; stored/remote/Python bitmap inputs fail explicitly.
- Add mono visual theme, instance colorScheme auto/light/dark, and setDesign patches over existing reactive state; preserve views/workers and carry current design into exports.
- Add built-in scores output: ranked label/score rows, explicit display range and number/percent formatting, persistent accessible meters and shared Node/Python output schemas. Offline-capable; no normalization or history.
- Add per-instance `controls: false` and `toasts: false` for hosts that own execution buttons and messages; preserve invoke errors/events.
- Add reusable image views with source/display transforms, boxes/points/RGBA masks, revision checks, asynchronous decode cleanup and borrowed-media overlays.
- Add instance-scoped output renderer registrations with persistent mount/update/dispose, preserving worker data contracts and legacy function disposers. Include a sensor table/chart example; host registrations require host bundling for standalone HTML.
- Support vertical input groups, nested scoped input updates and nested section selection without execution.
- Add a `section` input-group style with a prominent collapsible heading, status chips on named-stage result titles, and a `--jsee-sidebar-max-height` CSS variable for hosts that place the sidebar layout below their own header.
- Expose input-group editor containers for host-mounted editors while retaining the normal JSEE form, group visibility and Run/Stop.
- Extend the existing model pipeline with stage IDs, scoped inputs, explicit bindings, internal chains, incremental execution, transient overrides and retained state. Composers flatten tool schemas before execution; browser, CLI, HTTP and MCP use the same loop. Export pinned code references or standalone HTML with deduplicated assets.
- Place a selected input group beside a host editor through `regions.inputGroups`, without rerunning or remounting stages.
- Add browser instance readiness, input snapshots/patches, result-returning invocation, lifecycle events and optional host-owned input/output regions using the existing Vue root.
- Use dynamic module workers for modern Python, native ES modules and API models, with an external workerUrl option and bounded initialization. Preserve classic JavaScript semantics and old Python loaders through a classic build from the same worker source.
- Upgrade default Pyodide to 314.0.7 with Python 3.14.2; verify NumPy/pandas and offline single-file behavior. Remove worker-loader from the build.
- Add optional object input/output valueSchema with the same bounded JSON Schema validation in browser, Node and Python and matching discovery.
- Accept artifact references at file/media inputs, with scoped lookup, integrity checks, declared MIME constraints and UTF-8/byte materialization in JS/Python. Persist CLI registrations and add raw HTTP, local CLI and chunked MCP ingestion.
- Add table and JSON/object editors plus typed image/audio/video selection and previews. Canonical media bytes become reusable artifacts; canonical served forms use whole-pipeline invocation and artifact transfer.
- Add whole-host Bearer/browser Basic authentication and configurable CORS in Node and Python HTTP/WSGI, including legacy routes, files, errors and streams. Support token environment variables without embedding credentials.
- Expose one computation through official-SDK MCP stdio in Node and optional Python jsee[server], with structured runs, lazy file resources and cross-SDK protocol tests.

### Fixes:
- Preserve declared scores rows in native Python JSON/SSE responses instead of auto-converting them into tables; keep legacy table conversion for other lists.
- Keep live setDesign updates reactive when the original schema omits design.
- Exclude tests from the Python source distribution while retaining bundled runtime assets.
- Position instance overlays outside layout flow, without intercepting host controls.
- Honor readonly in standard controls and use choice labels/values consistently.
- Fix directory examples served at their own HTTP root: builds copy a local runtime and pages load it without reaching above the document root.
- `design.grid` and the table-editor default split now collapse to one column on narrow screens; the split moved from an inline style to `--jsee-grid-columns`, and the sidebar layout honours it.
- Keep Run/Stop visible on long forms with a sticky footer.
- File pickers show the name of a file supplied by defaults, `setInputs`, reset or a restored state, and clear when the value is emptied.
- Preserve portable file names on Node without global File. Store bounded SHA-256 fingerprints in retained state and reuse current stages on default Run; expose explicit Rerun all.
- Dispose function renderers on replacement/unmount, scope repeated module input IDs, preserve inline multiline file defaults, and accept the browser’s header/row tables in Node canonical output validation.
- Preserve nullable file defaults and model-driven input updates; validate updated choices against the live form. Wait for initial model readiness without changing immediate Stop or queued-run ordering.
- Canonical JS/Python output errors identify the offending path and value kind; binary-file advice is reserved for bytes. Non-finite numbers and sparse JS arrays now fail instead of becoming null.
- Forward file accept settings and apply the same MIME/extension matching to picker and drop selection.
- Invoke TypeScript through lib/tsc.js in vocabulary tests and type checks, avoiding extensionless ESM launcher failures on older Node versions.
- Apply canonical same-origin policy before every route/body parser; preserve authenticated streaming cache policy and use relative runtime URLs in served Node pages.
- Validate canonical output values against generated built-in shapes before committing files; retain __proto__ fields in Ajv-based client validation.
- Retain prototype-shaped output names in generated JSON Schema; describe object-viewer scalars/null correctly.
- Reject malformed computation field collections/discovery metadata and conflicting or inferred duplicate canonical endpoints before model loading.
- Import Python's importlib.util explicitly so model-file loading works in a fresh installed interpreter.
- Preserve every requested model entry when multiple bundled stages share a source URL; anchor bundler resolution to the model directory.
- Accept a single-model descriptor in the exported Node runSchemaOnce helper without caller normalization.
- Encode non-finite native Python JSON/SSE result numbers as null at every nesting depth, preserving existing output shapes.
- Repair the pinned detector's interval calls, category text rendering, and inference tensor cleanup; rebuild the GPT-2 reference using its published dependency API.
- Preserve resolved Pyodide URLs when entering a worker; preserve ImageData and other atomic values through pipeline transitions and worker input preparation.
- Select native Python model callables using entry independently of endpoint names, matching Pyodide selection.
- Size prefilled multiline controls through an element ref instead of querying a Vue fragment anchor.
- Preserve declared metadata-shaped outputs and string/array aliases in browser and CLI output routing; keep legacy automatic metadata hiding. Browser caller/chat-history injection respects declared inputs.
- Stop accepting raw worker presentation callbacks after a stage settles; delayed raw callbacks during a later invocation remain unidentifiable.
- Preserve explicitly named Python `_jsee` parameters and omit `**kwargs` from generated required inputs.
- Reserve browser runs during worker rebuilding, abort rebuild fetches on Stop, preserve retry state, and release workers after partial setup failures. Check cancellation before the first pipeline stage.
- Bind main-thread/worker model callbacks and streamed-input progress to their invocation; ignore callbacks after completion/cancellation and preserve browser context access to instance fields/methods.
- Apply browser control validation to nested groups and programmatic runs; enforce required values alongside custom expressions and clear field errors after correction.
- Prevent pending browser initialization from reviving a destroyed instance; abort initialization fetches, settle worker teardown, and ignore late progress/output calls.
- Stream Python sync/async generators through WSGI with shared HTTP framing, lazy reads, and cleanup in the async generator's original task/context.
- Load each Python model source once per application so stages share module state. Reject duplicate endpoint names and missing explicit callables; infer unnamed models without selecting imported helpers.
- Share GET/POST SSE decoding across main-thread and worker API models; preserve falsey/multiline data, finish at `[DONE]`, release readers, and reject HTTP/SSE errors. Keep presentation callbacks optional.
- Abort API requests on Stop and prevent cancelled pipelines from advancing after a later run starts. Keep result records intact during UI routing and avoid repeated user/final assistant messages in streamed chat.
- Release Node response backpressure waits on disconnect; close suspended Python generators after write failures and keep generator errors inside the established SSE response.
- Share Python HTTP/WSGI model setup and bounded request decoding; return JSON 400/413 errors for invalid lengths, input values, and oversized bodies. Preserve schema-relative model paths and the first positional input in Python CLI schema mode.
- Preserve numeric typed-array values and subarray/DataView boundaries; deduplicate transferable backing buffers and exclude SharedArrayBuffer.
- Keep caller-owned worker input buffers reusable, rebuild all worker stages after timeout, and wrap returned values separately from worker control messages.
- Apply the same containment checks to file endpoints, app static files, runtime assets, and directory indexes.
- Export named and unnamed input groups recursively in JS/Python JSON Schema, excluding action buttons.
- Prepare Python runtime assets during production builds and reject wheel/source-distribution builds that omit them.
- Preserve null, scalar, array, and binary values between pipeline stages; distinguish worker invocation data from cancellation commands in both directions.
- Share browser/CLI pipeline transitions and group/default/option helpers; bind positional JS arguments by declared input order.
- Validate declared input types, options, bounds, steps, and required presence before invocation; invalid Node/Python API inputs now return 400. Preserve nullable Python arguments and null defaults.
- Keep caller descriptors separate from mutable instance values and scope verbosity/log sinks per instance.
- Initialize/reset labeled options to their values and resolve bundled assets relative to the descriptor file when invoked from another directory.
- Clear worker execution timeouts after successful runs and rebuild worker-backed pipelines after Stop so later runs use live workers.
- Preserve declared falsy output values (`0`, `false`, `''`, `null`) and route declared outputs before input updates when names overlap.
- Run `autorun + interval` schemas on a non-recursive interval loop, report scheduled repeats with `caller: 'interval'`, and stop the loop cleanly when Stop is clicked.
- Store bundled/generated hidden assets as base64 and escape schema/page metadata so `</script>` in models, imports, or titles cannot corrupt generated HTML.
- Harden Node dev-server file endpoints with app-root containment, symlink escape checks, dotfile denial, and `node_modules` denial.
- Filter undeclared runtime metadata such as `caller` from Python server function calls while preserving declared chat `history`.
- Contain Python server static file serving to the schema root, denying traversal, dotfiles, and `node_modules` paths.
- Await Python async model functions before response serialization and stream async generator functions as SSE from `serve()`.
- Scope runtime progress and overlay DOM nodes per JSEE instance so destroying one embedded app does not remove another app's UI state.
- Replace built-in Vue component `$parent` reach-through with an injected JSEE context so nested group action buttons call the correct root runner.
- Namespace input persistence by app/container/input shape, recurse into groups, skip disabled/file/folder/action inputs, and validate restored values before applying them.
- Stream sync/async generator results from Node server-side execution when `model.stream: true`.
- Sanitize Google Analytics measurement IDs in generated page metadata and make script-safe JSON robust for optional metadata.
- Honor `disabled: true` across built-in string/color/text/checkbox/toggle/select/radio/multi-select/folder/action input controls.
- Serialize raw JS/Python bytes with MIME-sniffed data URLs for PNG, JPEG, GIF, WEBP, PDF, WAV, and unknown binary data instead of assuming PNG.
- Let Python `bytes` return annotations use runtime output auto-detection instead of forcing an image output.
- Generate richer OpenAPI specs from declared outputs, multipart file inputs, streaming models, request examples, and standard JSON error responses without changing runtime response payloads.
- Sanitize `html`, `svg`, `markdown`, and `chat` output rendering when opt-in secure mode disables raw HTML.
- Warn when JavaScript function inputs are auto-inferred as strings, including numeric defaults, JSDoc numeric hints, and unsupported destructured parameters.
- Avoid browser Pyodide input/global collisions by exposing Python `inputs` and `ctx` globals while only preserving legacy JS globals for non-colliding input names.
- Add opt-in browser Pyodide `model.entry` execution that loads Python source once, calls the named function on each run, and converts Python dict/list results back to plain JavaScript values.
- Add opt-in browser Pyodide `model.pyodide` runtime configuration for custom loader URLs/index URLs, including bundled hidden-loader support when `--bundle` is used.
- Add opt-in `--bundle=offline-strict` generation checks that fail when API models, remote model URLs, implicit Pyodide defaults, remote Pyodide `indexURL`, or missing local Pyodide asset directories would keep a bundle network-dependent at runtime.
- Add opt-in `--bundle=pyodide` generation mode that copies an explicit local Pyodide `indexURL` directory, or fetches an explicit remote Pyodide `indexURL` core asset set plus declared package wheels, beside generated HTML outputs and rewrites the generated schema to those copied assets.
- Add opt-in `--bundle=pyodide-single` generation mode that embeds explicit Pyodide core assets plus declared package wheels in the HTML and serves them at runtime through an in-page `jsee-pyodide://` asset shim.
- Enforce opt-in secure-mode `allowNetwork`, `allowNotifications`, and `allowFileViewer` at runtime for API requests, remote model/import/Pyodide loads, browser notifications, file/folder controls, and file/media outputs.
- Enforce opt-in secure-mode `allowEval` at runtime for inline JavaScript/Python model code, cached hidden JavaScript assets, Blob-script worker execution, worker class lookup, and Pyodide source execution; add `type: 'module'` as the no-eval JavaScript model path for main-thread ES module URLs.
- Support explicit `worker: true` for `type: 'module'` JavaScript models by loading ES module exports inside the JSEE worker without inline code evaluation.
- Document and test the current browser CSP matrix for module models, Blob-backed workers, inline JavaScript code, and hidden bundled JavaScript assets.
- Add opt-in `inferInputTypes: true` for JavaScript input inference so numeric defaults/JSDoc infer `number` controls and boolean defaults/JSDoc infer `checkbox` controls while default inference remains string-compatible.
- Do not apply worker execution timeout while initializing URL/module-backed worker models, resolve relative worker script URLs before Blob-worker loading, and surface worker initialization errors instead of hanging.
- Treat optional `#log` DOM output from `jsee.log(...args)` as plain text so logged HTML cannot create DOM nodes or execute event handlers.
- Check secure-mode import network policy against the raw schema URL before resolving loader URLs, so same-origin relative imports still work while network imports remain blocked when `allowNetwork: false`.
- Harden the Node/fallback HTML sanitizer against entity- and whitespace-obfuscated unsafe URLs when no browser DOM parser is available.
- Accept Node API JSON request bodies up to the same 50 MB limit as multipart requests and return JSON body-parser errors instead of Express HTML error pages.
- Refresh README model/API docs so runtime-supported `get`/`post`, function-or-string `model.code`, and output alias arrays are documented.
- Update optional `esbuild` to `^0.28.1` for production bundling.
- Update the development build/audit tree by moving `sass-loader` to v17, removing the `node-sass` chain, raising `@babel/core` to the patched Babel 7 line, and pinning audited transitive `minimatch`/`js-yaml` versions through npm overrides.

### Updates:
- Update the single README with PyPI installation, complete cross-runtime examples, in-page navigation and corrected offline/runtime guidance.
- Add inspect/validate/run/serve descriptor commands for Node and native Python, preserving legacy CLI forms.
- Expose canonical whole-pipeline JSON HTTP/WSGI routes and OpenAPI with declared outputs and bounded, retrievable file artifacts.
- Add Node invokeSchema and async native Python invoke_schema for validated whole-pipeline calls with separate run IDs, terminal results, and structured errors. Add a shared clean_sales example and offline form/download regression.
- Align maintained Python metadata with JavaScript at 0.9.0; check shared major/minor compatibility in built wheel metadata.
- Add pinned Python/ML app assets and shared native/Pyodide CSV summary fixtures; record reviewed repairs to historical examples. Retire obsolete Puppeteer tests after coverage mapping.
- Add descriptor authoring JSON Schema and TypeScript definitions at `@jseeio/jsee/schema.json` and `@jseeio/jsee/schema`; bundle the same JSON Schema with Python. Validate the existing app corpus and type vocabulary during tests without loading models.
- Add Python `max_body_bytes` / `--max-body-bytes` with a 50 MiB default request-body limit for both server entry points.
- Recognize descriptor `schemaVersion: 1` and reject unsupported explicit versions before model loading.
- Add repository CI for browser/native Python checks, package installation, and existing probes; publication remains manual.
- Add shared JS/Python contract fixtures and provenance-pinned app regression fixtures, including an offline hash app generated with legacy CLI flags.
- Remove unused vuex, @mdi/font, external vue-file-picker, and uglify-es dependency declarations; retain the local file-picker components.

### Changes:
- Node and Python dev servers now bind to `127.0.0.1` by default. Use `--host 0.0.0.0` to expose a dev server on the local network.
- Python `serve()` now uses `ThreadingHTTPServer`, so long model runs or open SSE streams do not block unrelated requests.
- Remove the incomplete `type: 'tf'` model path from the supported schema contract. Load TensorFlow.js through schema `imports` and use a normal JavaScript function/class model instead.
- Add opt-in `schema.security` scaffolding for secure/trusted mode defaults and warnings.

## 0.8.8 - 2026-05-25

- Applied app package `browser` field aliases during CLI dependency bundling so installed JSEE app packages can bundle legacy browser dependencies reliably.

## 0.8.7
### Features:
- Add `jsee --run` for one-shot CLI execution of local JavaScript JSEE apps. Default output is pipeable stdout; `--outputs <dir>` writes all outputs into a directory; named output flags such as `--file out.csv` write individual outputs.
- Allow raw camelCase schema input names on the CLI, so inputs such as `nSamples` work with both `--nSamples` and sanitized `--nsamples`.

### Fixes:
- Keep `runPackage(..., ['--run', ...])` output paths relative to the caller working directory instead of the package root.

## 0.8.1
### Fixes:
- Fix `jsee init` JavaScript templates so generated minimal and chat apps accept the default object payload in both browser and server-side execution modes.
- Build UMD bundles with `globalThis`, and route CommonJS `require()` for browser-bundle subpaths through a clear Node stub instead of failing with browser-global errors.
- Harden the exported CLI generator for `node -e` / programmatic contexts where `require.main` is not defined.

## 0.8.0
### Features:
- Full bundle: new build target `jsee.full.js` that includes Observable Plot, Three.js, and Leaflet for rich output types out of the box. The CLI and Python server auto-select `jsee.full.js` vs `jsee.core.js` based on schema output types. Build with `npm run build-full`
- Bundle rename: `jsee.runtime.js` → `jsee.core.js`, new `jsee.full.js` (was `jsee.runtime.extended.js`). `dist/jsee.runtime.js` is still produced as a backward-compatible copy of `jsee.core.js`
- `chart` output type: SVG charts via Observable Plot — supports line, dot, bar, area, and more. Model returns array of objects, column-oriented data `{x: [...], y: [...]}`, or a full Plot config `{marks: [...]}`. Schema props: `mark`, `x`, `y`, `color`, `width`, `height`
- `3d` output type: 3D model viewer via Three.js — renders programmatic geometry `{vertices, faces}` or GLTF/GLB URLs. Auto-creates scene with lighting and camera
- `map` output type: interactive maps via Leaflet — supports markers `[{lat, lng, popup}]`, GeoJSON, and `{center, markers, zoom}` objects. Auto-fits bounds. Schema props: `height`, `zoom`, `center`, `tiles`
- `pdf` output type: browser-native PDF viewer — renders from URL, data URL, Blob, ArrayBuffer, or Uint8Array. Included in the core bundle. Schema prop: `height`
- Dependency cleanup: remove PDF.js/canvas and Showdown/KaTeX from runtime dependencies; Markdown rendering now uses `markdown-it`
- `gallery` output type (zero-cost, core bundle): CSS grid of images with click-to-expand lightbox. Model returns array of URLs. Schema props: `columns`, `gap`
- `highlight` output type (zero-cost, core bundle): colored text spans with label badges. Model returns `[{text, label, color}]` segments
- `gauge` output type (zero-cost, core bundle): SVG semicircle gauge. Model returns number or `{value, label}`. Schema props: `min`, `max`, `label`, `color`
- `number` output type (zero-cost, core bundle): large KPI number with optional delta indicator (green up-arrow / red down-arrow). Model returns number or `{value, delta, label}`. Schema props: `label`, `prefix`, `suffix`, `precision`
- `alert` output type (zero-cost, core bundle): colored status banner with 4 variants (info/success/warning/error). Model returns string or `{message, type}`. Schema prop: `alertType`
- Graceful degradation: library-dependent output types show a helpful message with link when the library is not loaded, instead of crashing
- `columnsToRows()` utility for converting column-oriented to row-oriented data
- Schema-driven theming: `design.primary`, `design.secondary`, `design.bg`, `design.fg`, `design.font`, `design.radius` — set accent colors, background, text, font family, and border radius directly from the schema without custom CSS
- `jsee init` command: scaffold new projects with `jsee init` (minimal) or `jsee init chat` templates. Node generates `schema.json` + `model.js` + `README.md` (or `--html` for a single `index.html`). Python generates `schema.json` + `model.py` + `README.md`
- Server-side execution by default: when serving local `.js` models (no `-o` flag), JSEE now auto-enables server-side execution. Use `--client` to force browser execution
- Serve bar: a top bar shown only when serving (not in `-o` output) with server address, Browser/Server execution toggle, and Save HTML button. Consistent across Node and Python servers. Stripped when saving bundled HTML via Save or `download()`
- Python `create_app()`: WSGI factory function for production deployment with gunicorn, uWSGI, etc. Same target resolution as `serve()`. Routes: GET /, GET /api, GET /api/openapi.json, GET /static/jsee.js, static files, POST model endpoints
- CLI data inputs: pass data from the command line as positional args (`jsee schema.json 42 hello`) or named args (`jsee schema.json --a=100`). Values are auto-detected (numbers, JSON, file paths, strings). CLI-set inputs are locked in the GUI. Works in both Node and Python CLIs
- `folder` input type: directory browser with optional file selection checkboxes. In CLI, reads from a path; in browser, uses `<input webkitdirectory>` or drag-drop. Returns array of file objects. Schema props: `select`, `reactive`
- File/folder serving: `jsee report.pdf` or `jsee data/` serves files without a schema or model. Auto-detects output type from extension. Folders get a file browser with stats and preview
- Smart output auto-detection: model results are now type-inferred — image URLs render as `<img>`, PDF URLs as PDF viewer, arrays of objects as tables, etc. Works for both explicit outputs and auto-created outputs
- No-model identity: schemas with inputs but no model use an identity pipeline (pass inputs to outputs). Useful for file viewing and data inspection

### Breaking changes:
- Drop `jsee.js` build (Vue template compiler). Only two bundles now: `jsee.core.js` and `jsee.full.js`. The `design.template` schema option is no longer supported — use the default render function instead
- All HTML files should update `<script src="/dist/jsee.js">` to `<script src="/dist/jsee.core.js">`

## 0.7.1
### Features:
- Per-input validation: `validate` (filtrex expression) and `required: true` with `error` message display; invalid inputs show red border + error text and block model execution
- Textarea autosize: `text` inputs auto-grow to fit content (up to 400px max-height), with manual resize still available
- `audio` output type: HTML5 `<audio>` player from URL or data URL
- `video` output type: HTML5 `<video>` player from URL or data URL

## 0.7.0
### Features:
- Input persistence: save/restore input values to `localStorage` across page refreshes (priority: URL params > localStorage > defaults; opt-out with `persist: false`; Reset clears storage)
- Notifications: `schema.notify: true` fires browser `Notification` when a run completes while the tab is hidden (permission requested on init)
- Streaming outputs (SSE): `model.stream: true` enables Server-Sent Events; POST handler reads `text/event-stream` responses with incremental `output()` calls per `data:` line
- Python SSE support: generator functions are auto-detected and served as `text/event-stream` with `data: {json}\n\n` framing; `stream=True` kwarg in `generate_schema()`/`serve()`
- Efficient binary outputs: large base64 image data URLs (>50KB) in `image` outputs are auto-converted to `URL.createObjectURL()` blob URLs (33% memory saving); previous blob URLs are revoked on update
- Typed array passing for WASM: `arrayBuffer: true` on inputs converts JS arrays to typed arrays (`dtype`: `float32`, `float64`, `uint8`, etc.) before worker/WASM dispatch; uses `postMessage` transferables for zero-copy transfer
- `collectTransferables()` utility for extracting `ArrayBuffer` references from nested payloads

## 0.6.0
### Features:
- Python: richer type introspection — `Literal` → select, `Enum` → select, `Annotated[T, jsee.Slider()]` → slider, `Optional` unwrapping, `datetime.date` → date picker, plus `Text`, `Radio`, `Select`, `MultiSelect`, `Range`, `Color` annotation descriptors
- Python: `serve()` keyword args — `title`, `description`, `examples`, `reactive`; auto-parses docstring for description
- Python: result serialization — tuple → list, bytes/PIL Image → base64 data URL, list-of-dicts → `{columns, rows}` table format, per-value serialization in dict results
- Python: output type declarations — `Annotated[str, jsee.Markdown()]` return types, `outputs` kwarg for `serve()`/`generate_schema()`, auto-detect `list` → table and `bytes` → image; output descriptors: `Markdown`, `Html`, `Code`, `Image`, `Table`, `Svg`, `File`
- Python: multipart/form-data file upload support in POST handler
- Node.js: result serialization parity — `serializeResult()` wraps primitives, converts Buffer/Uint8Array to base64 image
- Node.js: multipart/form-data POST support via `parseMultipart()` (zero new dependencies)
- Node.js: JSON 404 error for unknown model POST (was falling through to Express HTML 404)
- Chat interface: new `chat` output type with message accumulation, history injection, Markdown-rendered bubbles, auto-scroll, Enter-to-send; Python `serve(fn, chat=True)` shorthand for `fn(message, history) → str` pattern

## 0.5.2
### Features:
- Add `design.layout: 'sidebar'` option — fixed-width (280px) sticky input panel that stays visible while scrolling outputs, collapses to single column on mobile
- Add server API endpoints: `GET /api` (schema discovery), `GET /api/openapi.json` (auto-generated OpenAPI 3.1 spec), CORS support
- Fix async model execution in server-side mode (`--execute`)
- Move Python package into monorepo (`py/`): zero-dependency stdlib server with offline runtime, unified API surface matching Node.js

## 0.5.1
### Features:
- Add `style` property to `group` input type: `blocks` (default flat list), `accordion` (collapsible), `tabs` (tabbed view)
- Add `group` output type with `tabs` and `blocks` display styles for organizing outputs
- Unnamed top-level input groups now flatten child values into the top-level input object
### Bug fixes:
- Fix crash when a top-level input has no `name` (e.g. layout-only group) — `getUrlParam` now guards against undefined names

## 0.5.0
### Breaking:
- Remove Bulma dependency — the minimal (framework-free) theme is now the default. `design.framework: 'bulma'` still works as a backward-compatible alias for `'minimal'`. Bundle size reduced by ~50% (224 KB removed)
### Features:
- Add new input types: `slider`, `radio`, `toggle`, `date`, `multi-select`, `range` (dual-handle)
- Add `group` input type with collapsible accordion support (`collapsed: true`)
- Add `markdown` output type (renders Markdown via showdown, including tables)
- Add `image` output type (renders `<img>` from data URL or URL)
- Add `table` output type with virtualized scrolling
- Add CSS variable theming — all components use `--jsee-*` custom properties, overridable via `design.theme: 'dark'` or custom CSS
- Add progress bar to loading overlay (determinate and indeterminate modes)
### Testing:
- Switch E2E tests from Puppeteer/Jest to Playwright
- Add E2E tests for all new input/output types, accordion groups, and dark theme

## 0.4.1
### Bug fixes:
- Fix relative import URLs (e.g. `dist/core.js`) resolving against CDN instead of page URL — now resolves against `window.location.href` so blob workers can load them correctly
- Gate worker initialization with an `initialized` flag: only the first `{url|code}` payload initializes the worker, all later payloads are treated as execution input
- Fix model type inference for URL-loaded JS: when `code` is present, infer `function` instead of treating `url` as API `post`
- Improve worker payload fallback diagnostics: if `postMessage` fails with File/Blob/binary payloads, throw a descriptive error instead of silently dropping data via JSON fallback
- Move `showdown-katex` and `katex` to runtime `dependencies` so `npx jsee` works without dev installs
- Fix `--fetch` bundling to include `schema.view` and `schema.render` blocks in addition to `schema.model`
- Fix `--fetch` import resolution for local relative JS imports and support object import entries (`{ url, ... }`)
- Fix `--fetch` bundling for bare-relative imports (e.g. `dist/core.js`, `css/app.css`) — use filesystem existence check instead of prefix heuristics, and fix `data-src` key mismatch by keeping raw import paths so `loadFromDOM` finds bundled code at runtime
- Fix CLI output path handling for absolute/relative `--outputs` values and remove duplicate final HTML write
- Fix `download()` method referencing undeclared `env` variable — now correctly uses `this`
- Fix `outputAsync()` referencing undeclared `delay` — now correctly uses `utils.delay`
- Fix CLI social links default case referencing undeclared `s` variable
- Remove dead `title` assignment in CLI `gen` function (already handled in `genHead`)
### Features:
- Allow `progress(null)` to render an indeterminate top progress bar for stream-like tasks where total size is unknown
- Add `cancelCurrentRun()` runtime entrypoint and wire overlay Stop button with proper `click` handling for any active run
- Add worker cooperative cancel signal: `_cmd: 'cancel'` updates worker state and JS model context now exposes `ctx.isCancelled()`
- Add end-to-end `raw` file input mode: schema `inputs[].raw` now passes `File` objects / URL handles instead of loading full text into memory
- Add file input stream mode (`inputs[].stream: true`) that wraps raw file/URL sources into async iterable `ChunkedReader` objects (zero-dep, supports `for await`, `.text()`, `.bytes()`, `.lines()`) in both worker and main-thread execution
- Preserve stream reader metadata (`name`, `size`, `type`) for file/URL sources and keep it available across downstream pipeline stages
- Auto-load file input URL query params on init (no extra Load click required)
- Add CSS-aware imports: `.css` entries in `imports` arrays are injected as `<link rel="stylesheet">` on the main thread and skipped in workers
- Add CLI `--runtime` to control runtime source: supports `auto|local|cdn|inline` modes plus custom URL/path values (e.g. `./node_modules/@jseeio/jsee/dist/jsee.js`)
- Add CLI `--help` flag with usage information and examples
- Add ESLint config matching project style (no semicolons, single quotes, 2-space indent)

## 0.3.8 (2026-02-08)
### Bug fixes:
- Fix `run()` error handling: wrap in try/catch/finally so overlay and running state always reset on failure
- Add `.catch()` to fire-and-forget `run()` callers to prevent unhandled rejections
- Add worker execution timeout (default 30s, configurable via `model.timeout`) to prevent permanently frozen UI
- Fix `indexOf('json')` bug in `initSchema` — condition was inverted, `.json` was never appended
- Fix array type detection in auto-created outputs (`typeof` returns `'object'` for arrays)
- Fix `getName` for `async function` strings and guard against arrow functions crashing
- Fix broken string interpolation and remove leftover `console.log('1')` in utils.js
### Features:
- Add `schema.reactive` option: re-run model on any input change (debounced 300ms). Distinct from `autorun` (first load only) and per-input `reactive` (individual input change)
- Add run-concurrency guard: overlapping reactive/autorun calls are dropped, manual clicks are queued
- Move `getName` to utils.js for testability and reuse
- Add runtime `validateSchema()` checks and fail-fast on critical schema issues (`model`/`view` presence, input shape)
- Replace deprecated `node-sass` with `sass`, update `express`, `csv-parse`, and remove unused `element-plus`
### Testing:
- Add separate Jest config for unit tests (`jest.unit.config.js`, no browser needed)
- Add unit tests for utils.js: `isObject`, `sanitizeName`, `getUrl`, `delay`, `debounce`, `getName`, `getModelFuncJS`, `getModelFuncAPI`, `validateSchema`
- Add `npm run test:unit` script

## 0.3.4 (2024-11-19)
### JSEE:
- [x] Add `columns` parameter to the `inputs`, `outputs` blocks (making it possible to create multi-column layouts, like simple dashboards)
- [x] Add `function` output type (for custom renderers which take a container element as an argument)
- [x] Add `dom-to-image` library for exporting dynamic output blocks to PNG
- [x] Support for inputs to be set with url parameters (e.g. `?input1=1&input2=2`)
### HTML Generator:
- [x] Add `latex` and table output in the markdown renderer
- [x] Cache `import` scripts to avoid multiple loads when `--fetch` is used
- [x] Infer `description` from the markdown and update html `<head>` with it
- [x] Update `social`, `org`, `ga` blocks
- [x] Small layout fixes

## 0.3.1 (2024-04-10)
- [x] Add `download` method to jsee object
- [x] Add `bin` folder with `cmd.js` for easier project building

## 0.2.9 (2023-12-11)
- [x] Add examples
- [x] Add imports
- [x] Add `caller` field to the model input (can be: `run`, `autorun` or a button name)
- [x] Add `title` field (for buttons rn)
- [x] If `display` field is `false` the input is not shown
- [x] If `autorun` is true, then actually autorun the model initially

## 0.2.8 (2021-12-29)
- [x] Fix no input case

## 0.2.7 (2021-12-29)
- [x] Show output when result is `0`
- [x] Updated style for buttons and inputs

## 0.2.6 (2021-12-27)
- [x] Tests
- [x] Load schema from query (loader)
- [x] Reset button appears only after data change
- [x] Default input type (`string`)
- [x] Directly load code when running in a window (not code to text)
- [x] Passing code directly
