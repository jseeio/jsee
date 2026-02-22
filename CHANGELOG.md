# Changelog

## 0.8.0
### Features:
- Full bundle: new build target `jsee.full.js` that includes Observable Plot, Three.js, Leaflet, and pdf.js for rich output types out of the box. The CLI and Python server auto-select `jsee.full.js` vs `jsee.core.js` based on schema output types. Build with `npm run build-full`
- Bundle rename: `jsee.runtime.js` → `jsee.core.js`, new `jsee.full.js` (was `jsee.runtime.extended.js`). `dist/jsee.runtime.js` is still produced as a backward-compatible copy of `jsee.core.js`
- `chart` output type: SVG charts via Observable Plot — supports line, dot, bar, area, and more. Model returns array of objects, column-oriented data `{x: [...], y: [...]}`, or a full Plot config `{marks: [...]}`. Schema props: `mark`, `x`, `y`, `color`, `width`, `height`
- `3d` output type: 3D model viewer via Three.js — renders programmatic geometry `{vertices, faces}` or GLTF/GLB URLs. Auto-creates scene with lighting and camera
- `map` output type: interactive maps via Leaflet — supports markers `[{lat, lng, popup}]`, GeoJSON, and `{center, markers, zoom}` objects. Auto-fits bounds. Schema props: `height`, `zoom`, `center`, `tiles`
- `pdf` output type: PDF viewer via pdf.js — renders from URL, data URL, or Uint8Array. Prev/next page navigation, auto-scales to container width. Schema props: `height`, `page`
- `gallery` output type (zero-cost, core bundle): CSS grid of images with click-to-expand lightbox. Model returns array of URLs. Schema props: `columns`, `gap`
- `highlight` output type (zero-cost, core bundle): colored text spans with label badges. Model returns `[{text, label, color}]` segments
- Graceful degradation: library-dependent output types show a helpful message with link when the library is not loaded, instead of crashing
- `columnsToRows()` utility for converting column-oriented to row-oriented data
- Schema-driven theming: `design.primary`, `design.secondary`, `design.bg`, `design.fg`, `design.font`, `design.radius` — set accent colors, background, text, font family, and border radius directly from the schema without custom CSS

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
