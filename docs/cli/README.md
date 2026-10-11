# CLI, HTTP and MCP reference

[Home](../../README.md) · [First computation](../guide/README.md) · [Schema](../schema/README.md) · [Browser API](../browser/README.md) · [CLI, HTTP and MCP](../cli/README.md) · [Python](../../py/README.md)

Both packages provide a command named `jsee`: the npm command executes JavaScript models; the Python command executes Python models. If both are installed, use `npx @jseeio/jsee` for Node and the full path to your Python environment’s `bin/jsee` for Python. Start with the [tutorial](../guide/README.md) to create the files used below. Existing flag-based commands remain supported.

On this page: [JSON commands and HTTP](#json-commands-and-canonical-http) · [Authentication](#http-authentication-and-cors) · [MCP](#mcp-over-stdio) · [Node flags](#cli--nodejs) · [Bundling](#--bundle) · [Programmatic invocation](#whole-pipeline-invocation)

## JSON commands and canonical HTTP

The Node and Python CLIs accept the same descriptor commands. Use a JS model descriptor with Node and a Python model descriptor with Python:

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 3000
```

`inspect` reports input/output JSON Schemas and runtime capabilities without importing models. `validate` checks computation structure, names, known field types, numeric constraints and defaults. It requires a model; render-only descriptors remain valid for the browser. Neither command tests model availability, executes custom browser validation expressions, or validates every UI extension. The full authoring vocabulary remains available in `schema.json`.

`run` reads UTF-8 JSON from stdin by default (`--input -`), or from the selected file. It writes one JSON envelope to stdout; model diagnostics go to stderr. Successful calls return `{runId, status: "succeeded", outputs, artifacts}`. Failed calls return `{runId, status: "failed", error: {code, message}}`. Exit codes are 0 for success, 2 for descriptor/JSON-request errors, and 1 for invocation or output failures.

`outputs` contains declared, flattened output names, using existing alias lookup. Accumulated inputs and undeclared intermediates are omitted. Missing outputs and non-JSON values fail with `JSEE_OUTPUT_INVALID`. Invalid values report their path and kind, for example `info.a: undefined is not a JSON value`. Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) fail at any depth; they are never silently replaced by null. Canonical CLI/HTTP/MCP results are checked against the generated output schema before files are stored: numeric/string/boolean types, table containers, and declared media fields. This validates built-in shapes and optional object `valueSchema` rules; chart semantics and unsupported JSON Schema keywords are outside this validation. An `object` output accepts any JSON value. Declare binary data as `type: "file"`.

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

## HTTP authentication and CORS

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

## MCP over stdio

Start one descriptor as an MCP tool with `jsee serve schema.json --mcp-only`. This mode uses stdin/stdout for MCP and stderr for model diagnostics; it opens no HTTP listener. Node requires Node.js 20+ and uses the official `@modelcontextprotocol/server` SDK (2.0.0). Native Python requires Python 3.10+ and the optional `server` extra (`mcp` 2.2.0); install with `python -m pip install 'jsee[server]==0.9.0'`. Python's base installation remains stdlib-only.

Configure an MCP client to launch the installed `jsee` executable with arguments `['serve', '/absolute/path/schema.json', '--mcp-only']`. Use the executable belonging to the descriptor's language. For a Node checkout, use command `node` and prepend `/absolute/path/jsee/bin/jsee` to those arguments.

`tools/list` derives a computation tool from the descriptor's stable `id`, title, description and input schema without importing model code. `tools/call` executes the same whole-pipeline invocation as JSON CLI/HTTP. Success returns the complete `{runId, status, outputs, artifacts}` envelope as `structuredContent` and JSON text, with its generated `outputSchema`. Invalid inputs, execution/output failures and artifact quota failures return `isError: true` and the failed envelope as text. Unknown tools or artifact URIs produce protocol errors.

File results include `resource_link` entries with session-scoped `jsee-artifact:` URIs. `resources/list` exposes metadata; `resources/read` returns exact bytes as a base64 blob only when requested. Verify the decoded bytes against `size` and `sha256` in the run envelope. Store limits remain 64 MiB/1,024 files per session (`--max-artifact-bytes` changes bytes); rejected batches expose no files. Files disappear on orderly close or SIGTERM and cannot be retrieved by another session. SIGKILL or a crash can leave temporary files.

`--max-body-bytes` bounds decoded arguments (50 MiB by default); Node also applies that limit to its incoming wire buffer, including protocol overhead. Python's SDK reads a message before JSEE checks its arguments. These limits do not bound model memory. A resource read returns the entire file: base64 adds overhead, and the client's message limit may be lower than the store quota. Large-file chunking is not implemented.

`tools/list` also advertises `upload_artifact` (`jsee_upload_artifact` if that name is already the computation ID). Send `{data: "<base64>", name: "data.csv", mime: "text/csv", offset: 0}` to start; continue with the returned `upload` ID and `offset`. Each chunk is at most 262,144 decoded bytes. Set `final: true` to publish `{artifact, metadata}`, then pass `{artifact: result.artifact}` to a compatible input. Set `{upload: id, cancel: true}` to discard an incomplete upload. Up to 16 incomplete uploads share the store byte quota; incomplete bytes are never listed as resources. The client transfers file chunks, so the model need not include file contents in its computation arguments. Configure client/server message limits to fit the base64 chunk plus protocol overhead.

Independent Node and Python SDK clients test both servers in legacy negotiation and protocol 2026-07-28 mode, including the [clean sales workflow](https://github.com/jseeio/jsee/tree/main/examples/clean-sales/README.md). MCP calls use the existing programmatic invocation lifecycle; persistent model state across calls is not a portable contract. This adapter supports terminal calls for one descriptor. Remote MCP, streams and forced cancellation remain pending; HTTP authentication is separate from stdio process access. Model source is trusted code; stdio separation is not a sandbox.

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

## Whole-pipeline invocation


| Contract | Browser | Node | Native Python |
|---|---|---|---|
| Groups, defaults, options, numeric constraints | Shared fixtures | Shared fixtures | Shared fixtures |
| Custom input expressions and nonempty controls | UI validation | Not evaluated | Not evaluated |
| Pipeline execution | Browser orchestrates stages | `invokeSchema`, JSON CLI, canonical HTTP and MCP execute JS pipelines; legacy stages remain | `invoke_schema`, JSON CLI, canonical HTTP/WSGI and MCP execute Python pipelines; legacy stages remain |
| Python callable selection | Pyodide `entry` | Not a native Python runtime | `entry`, with a separate endpoint `name` |
| Interruption | Worker termination; cooperative main-thread and fetch cancellation | No OS containment | Stream cleanup; no forced interruption of arbitrary model code |

Identified stages are supported in browser/Node execution; native Python supports ordinary sequential pipelines.


Node exports `invokeSchema(schema, inputs, { schemaPath, cwd, log })` from `@jseeio/jsee/cli`. Python exports async `invoke_schema(schema, inputs, cwd='.')` from `jsee`. Both validate inputs before importing models, apply declared defaults, and execute the complete `model` pipeline. See the [clean sales example](https://github.com/jseeio/jsee/tree/main/examples/clean-sales/README.md) for JavaScript, Python, and a generated offline form with a CSV download.

The returned envelope is `{ runId, status: 'succeeded', result }` or `{ runId, status: 'failed', error: { code, message } }`. Each call gets a new run ID; model fields named `status` or `runId` remain inside `result`. Error codes are `JSEE_SCHEMA_INVALID`, `JSEE_INPUT_INVALID`, `JSEE_CAPABILITY_UNSUPPORTED`, and `JSEE_EXECUTION_FAILED`. These checks cover invocation prerequisites and existing input-value rules; full descriptor authoring validation remains separate.

Results retain accumulated pipeline data, including intermediate values. Only records merge; arrays, scalars and null replace the previous value. Python `None` corresponds to JS null; JavaScript's undefined retains the previous value. The existing truthy `stop` field stops later stages. JSON input containers are copied before execution. Runtime values are returned directly, without HTTP serialization or file persistence.

This interface supports local JS functions/classes/async initializers and native Python sync/async functions in files. Python uses keyword binding by default and schema input order for `container: 'args'`. Python stages retain the loader's unique-name requirement. Schema imports, remote models, and streaming are rejected explicitly; normal imports inside model source remain usable. Calls execute on the caller's thread without forced interruption, worker isolation, or enforcement of browser timeout/security flags.
