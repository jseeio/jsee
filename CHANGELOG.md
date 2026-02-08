# Changelog

## 0.3.8
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

## 0.3.4
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

## 0.3.1
- [x] Add `download` method to jsee object
- [x] Add `bin` folder with `cmd.js` for easier project building

## 0.2.9
- [x] Add examples
- [x] Add imports
- [x] Add `caller` field to the model input (can be: `run`, `autorun` or a button name)
- [x] Add `title` field (for buttons rn)
- [x] If `display` field is `false` the input is not shown
- [x] If `autorun` is true, then actually autorun the model initially

## 0.2.8
- [x] Fix no input case

## 0.2.7
- [x] Show output when result is `0`
- [x] Updated style for buttons and inputs

## 0.2.6
- [x] Tests
- [x] Load schema from query (loader)
- [x] Reset button appears only after data change
- [x] Default input type (`string`)
- [x] Directly load code when running in a window (not code to text)
- [x] Passing code directly
