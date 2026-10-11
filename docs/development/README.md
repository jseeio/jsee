# Development and verification

[Home](../../README.md) · [First computation](../guide/README.md) · [Schema](../schema/README.md) · [Browser API](../browser/README.md) · [CLI, HTTP and MCP](../cli/README.md) · [Python](../../py/README.md)

This page is for work on JSEE itself. To install a published package, use the [installation instructions](../../README.md#installation).

## Build from source

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

## Checks

`npm run build` builds browser assets, copies them into the maintained Python package, and runs types, unit tests, and the standard Playwright suite. `npm run test:python-native` checks the native runtime and builds/installs packages outside the checkout. After installing `./py[server]`, run `npm run test:mcp` for independent SDK client/server checks. Set `JSEE_MCP_PYTHON` to use a separate Python executable.

The additional app suites exercise real computation:

| Command | Coverage |
|---|---|
| `npm run test:python` | Pinned Pyodide/NumPy, repeated entry calls, addition and CSV summary on the main thread and in workers |
| `python -m pip install -r test/python/requirements.txt` then `npm run test:python-apps-native` | Native pandas summary against the same CSV/result fixtures as Pyodide |
| `npm run test:ml` | GPT-2 text generation and camera → CLIP worker → view, with pinned weights and dependencies |

The app suites verify assets against `test/fixtures/runtime-assets.json`, downloading missing files into ignored `tmp/test-assets/`. Python assets use about 55 MB; ML assets use about 1.12 GB. These are download sizes, not runtime memory requirements. Browser requests use local assets; ML tests redirect the original apps' known external URLs to the pinned copies and block other external requests. GPT-2 is rebuilt from its reviewed source and lockfile with dependency installation scripts disabled. The tests use genuine model inference and a deterministic simulated camera frame.

`test/fixtures/real-apps/manifest.json` records source hashes, origins, and intentional repairs to historical examples. Generated bundles, model weights, and dependency trees are excluded from Git and package contents. The default unit suite requires neither those dependencies nor model downloads. Browser Python tests pin Pyodide 314.0.7, NumPy 2.4.6 and pandas 3.0.2; a separate 0.24.1 loader regression covers the classic compatibility path. Single-file CLI and browser re-download tests run with network access blocked. For Python, browser download requires an app generated with `--bundle=pyodide-single`; it preserves those embedded assets instead of discovering arbitrary packages used during execution. This does not establish support for every runtime or Python package.


For focused compatibility checks, install the corresponding Playwright browser and dependencies, then set `JSEE_TEST_BROWSER=firefox` or `JSEE_TEST_BROWSER=webkit`. Chromium is the default. Set `JSEE_TEST_NO_GPU=1` to disable GPU use in the Playwright suites; do not run `test:ml` as an interface-only check.

## Documentation

The root README is the landing page on GitHub, npm and jsee.org. Topic references live in `docs/*/README.md`; the Python guide is `py/README.md`. Keep complete copyable examples separate from API fragments. Use relative Markdown links within the documentation; GitHub resolves them in the repository and Jekyll rewrites them for the website. Python’s published package description uses absolute documentation links so they also work on PyPI.

`node test/probes/doc-runtime-surface.js` checks schema vocabulary and documentation links. `node test/probes/npm-pack-hygiene.js` checks the published file list. The site uses the existing Minima theme with Jekyll’s README-index and relative-link plugins. See `_config.yml` for navigation and source exclusions.

With Ruby and Bundler installed, preview the website from the repository root:

```sh
bundle install
bundle exec jekyll serve
```

Open `http://localhost:4000`. Jekyll fetches the configured Minima theme; the source remains the same README files used on GitHub. Check both a wide and narrow viewport and follow links to the reference pages before publishing documentation. Do not publish the local build/test directories.
