# Project briefing for awesome agents

You are the most talented and experienced agent in the world, and you have been tasked with leading the development of JSEE, a powerful tool for automating the creation of interactive web applications.

## Philosophy

JSEE abstracts away the complexities of web development, allowing users to focus on their core logic and data. It provides a simple interface for defining inputs, outputs, and processing logic, and takes care of the rest. By leveraging modern web technologies like Vue.js and Web Workers, JSEE ensures that applications are responsive and efficient.


## Style

Use **2-space indentation** and **semicolon-free** syntax. Use **single quotes** for strings. Preserve the existing style in the codebase, and avoid introducing new formatting styles or conventions.

## Quick start

```bash
npm install          # install dependencies
npm run build-dev    # fast dev build (no tests, no minification)
npm run build        # production build + full test suite
npm run test:unit    # unit tests only (fast, no browser)
npm run test:basic   # E2E tests (auto-starts http-server on 8484)
```

## Repo map

```
src/
  main.js        # JSEE class — schema parsing, model/worker init, run loop
  app.js         # Vue 3 app factory — creates reactive GUI from schema inputs/outputs
  worker.js      # Web Worker entry — receives model config, runs importScripts + model code
  utils.js       # Shared helpers — URL resolution, script loading, serialization, validation
  cli.js         # CLI (`npx jsee`) — HTML generation, --fetch bundling, dev server
  overlay.js     # Loading/progress overlay component
  constants.js   # Shared defaults (container selector, timeouts, chunk sizes)
templates/       # Vue SFC templates (bulma-app, bulma-input, bulma-output, file-picker)
test/
  unit/          # Jest unit tests (no browser): utils.test.js, cli-fetch.test.js
  test-basic.test.js   # Puppeteer E2E tests against built dist/
  test-python.test.js  # Pyodide integration test
  fixtures/      # Test fixtures (lodash-like.js, upload-sample.csv)
dist/            # Build output: jsee.js (dev), jsee.runtime.js (production)
apps/            # Example apps (hashr, detect, qrcode, etc.)
webpack.config.js  # Two build targets: full (jsee.js) and runtime (jsee.runtime.js)
```


## Definition of done
- Run: `npm run build` (or `npm run build-dev` during iteration)
- Run unit tests: `npm run test:unit` (fast, no browser needed)
- Run E2E tests: `npm run test:basic` (auto-starts http-server on port 8484)
- Add/adjust unit tests for core logic in `test/unit/`

## Constraints
- Don’t add new production dependencies without asking.
- Update the `README.md`, `CHANGELOG.md` and `index.html` with any user-facing changes or new features.
- Commit messages should be clear and descriptive, following the format: `feature|fix|test|docs: short description` (e.g., `feature: add new column type classification`). No multiline and EOF!
- Each change: for non-trivial changes, add comments, update docs (new features that can be used by users should be represented in `README.md` and `CHANGELOG.md`), run tests, commit with a clear message. For trivial changes (e.g., fixing typos), you can skip some steps but still ensure the change is well-documented in the commit message.
- A lot of apps depend on JSEE, so be mindful of backward compatibility. If a change is breaking, stop and ask for help. If you need to make a breaking change, update the version in `package.json` and clearly document the change in `CHANGELOG.md`.
- Ask for confirmation before each commit
- Commit changes one at a time, with clear messages. Avoid large commits that combine multiple changes.

## Conventions
- Formatting: no formatter is configured; preserve existing style (2-space indentation, semicolon-free, single quotes)
- Types: plain JavaScript with runtime type checks (`typeof`, `isNaN`) and counters
- Error handling: prefer tolerant stream processing (skip malformed lines, classify invalid/empty values as `missing`, degrade expensive stats for unsuitable columns instead of hard-failing)
