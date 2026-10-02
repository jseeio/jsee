# JSEE for Python

Turn Python functions into web apps with auto-generated GUI and REST API. Zero dependencies beyond Python stdlib.

## Install

This checkout targets **0.9.0**, sharing the JavaScript package's major/minor line. Publication is pending. To use the current code, build and install from the main repository:

```bash
npm install
npm run build
python -m pip install ./py
```

The prepared wheel includes the browser runtime; installing or serving it does not require Node.js. The runtime itself has no third-party Python dependencies; individual models may require their own packages.

## Quick start

### CLI

```bash
# Serve a function from a Python file
jsee example.py sum

# Serve from a JSEE schema
jsee schema.json

# Custom port
jsee example.py sum --port 8080
```

### Programmatic

```python
import jsee

def multiply(a: float, b: float = 2.0) -> float:
    return a * b

jsee.serve(multiply, port=5050)
```

This starts a server at `http://localhost:5050` with:
- Interactive GUI at `/`
- REST API at `POST /multiply`
- Schema discovery at `/api`
- OpenAPI spec at `/api/openapi.json`

### Whole-pipeline invocation

`await jsee.invoke_schema(schema, inputs, cwd=directory)` executes every model stage without starting a server. Use `asyncio.run(...)` from synchronous code. Inputs are validated before model imports; declared defaults apply and JSON input containers are copied. Stage names must be unique, and paths resolve relative to `cwd`.

The result is `{'runId': ..., 'status': 'succeeded', 'result': ...}` or a failed status with `error: {'code': ..., 'message': ...}`. Model fields remain separate from invocation status. Records merge between stages; scalars, lists, and `None` replace prior data. A truthy `stop` prevents later stages. The result retains intermediates and native values; this function does not apply the HTTP serializer or store files.

Local sync/async Python functions are supported, with keyword binding by default and schema input order for `container: 'args'`. Source imports work normally. Schema imports, remote models, and streams fail with `JSEE_CAPABILITY_UNSUPPORTED`. Other codes distinguish invalid schema prerequisites, invalid inputs, and execution failure. Synchronous code runs on the calling thread; browser timeout/security settings do not provide containment here.

The [clean sales example](../examples/clean-sales/README.md) has shared JS/Python cases and a browser form. JSON CLI/HTTP adapters and retrievable file artifacts are available below; MCP stdio is available with the optional server extra.

## JSON commands and canonical HTTP

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 5050
```

Use a descriptor with local Python files, optional stable `id`, declared inputs and outputs. Inspection and validation do not import the models. JSON execution reads stdin by default (`--input -`) and sends model prints to stderr. Success is `{runId, status: "succeeded", outputs, artifacts}`; failures contain `error: {code, message}`. CLI exit codes are 0 for success, 2 for descriptor/request errors, and 1 for invocation/output failures.

File inputs accept inline UTF-8 text or `{artifact: "<runId>/<index>"}` from the current store. Artifact-backed `arrayBuffer: true` files and typed `image`/`audio`/`video` inputs become Python bytes. `object` accepts JSON, optionally constrained by the shared `valueSchema` vocabulary, and `table` accepts the existing output table shapes; their browser editors preserve those values. See the [shared input and artifact behavior](../README.md#structured-and-media-inputs).

Only declared outputs are returned; groups flatten and aliases retain their existing lookup order. Outputs must be JSON-compatible. Missing values and unsupported objects fail. Invalid values report their path and kind; non-finite numbers fail at any depth, for example `info.a: NaN is not a JSON value`. Canonical results must match the generated built-in output schema before files are stored, including numeric/string/boolean types, table containers and declared media fields. Null is rejected for numeric declarations; object `valueSchema` uses the bounded shared vocabulary; chart semantics and unsupported JSON Schema keywords are not validated. For `file` outputs, return text, `bytes`, `bytearray` or `memoryview`, optionally inside `{content, filename, mime}`. `value` and `data` are accepted content aliases. Paths and URLs are never read or fetched as file content.

A file output becomes `{artifact: "<runId>/<index>"}`. Its `artifacts` entry provides `id`, `output`, `name`, `mime`, `size`, `sha256` and `uri`. CLI artifacts persist in `.jsee-artifacts/` or `--artifact-dir`, with `file:` URIs. HTTP artifacts use relative download URIs, remain available until server shutdown, and are removed on orderly close. Abrupt termination can leave temporary files for host cleanup.

`serve` exposes `GET /schema`, `GET /openapi.json`, JSON `POST /run`, raw-byte `POST /__jsee/artifacts?name=data.csv`, and `GET /__jsee/artifacts/<runId>/<index>`, alongside the UI and legacy stage routes. Programmatic equivalents are `jsee.serve(path, canonical=True)` and `jsee.create_app(path, canonical=True)`. Call `app.close()` when retiring a canonical WSGI application. Canonical serving requires a file-backed descriptor; existing callable-based serving remains available. A stage named `run` must be renamed to avoid the reserved endpoint.

Limits are 50 MiB per JSON request (`--max-body-bytes`) and 64 MiB/1,024 artifacts per server or persistent CLI artifact directory (`--max-artifact-bytes` changes bytes). Programmatic options use underscores. Limit failures publish no partial file batch. Invalid inputs return 400; excessive bodies 413; non-JSON content 415; unsupported capabilities 422; model/output errors 500; artifact quotas 507. Canonical serving applies same-origin policy across all routes; legacy commands retain wildcard CORS until configured. Forced interruption and canonical streaming remain pending; these servers do not sandbox model code.

The [main README](../README.md#json-commands-and-canonical-http) describes the common transport contract and validation scope. Existing Python CLI forms and stdlib/WSGI APIs retain their behavior.

## HTTP authentication and CORS

Use `jsee serve schema.json --auth-token-env APP_TOKEN` to read a shared token from an existing environment variable, or `--auth-token TOKEN`. Add repeated `--cors-origin https://client.example` flags for allowed browser origins. These options also work with legacy Python serving commands. Programmatic `serve()` and `create_app()` accept `auth_token`, `auth_token_env` and `cors_origins` (list).

Bearer clients send `Authorization: Bearer TOKEN`; the browser login uses username `jsee` and the token as password. All routes require authentication, including the UI, scripts, static files, API descriptions, streams, artifacts and errors. No token is embedded in HTML/schema or passed to computation inputs. Use HTTPS via a trusted TLS proxy or an SSH tunnel; explicitly allow a TLS proxy's public HTTPS origin. Forwarded headers are not trusted automatically.

Canonical serving defaults to same-origin requests. Legacy serving keeps public wildcard CORS until a token or origin list is configured. `cors_origins=[]` / `--cors-origin none` keeps same-origin access; `['*']` is public and cannot be combined with authentication. Allowed preflights do not require credentials; actual requests do. Invalid credentials return 401; denied origins/preflights return 403 before body reads. OpenAPI describes both authentication schemes, and authenticated responses use `Cache-Control: no-store`, including SSE. See the [common host policy](../README.md#http-authentication-and-cors) for details and limits.

## MCP over stdio

After building the checkout, install `python -m pip install './py[server]'` with Python 3.10+ (base Python support remains 3.9+). The extra pins the official `mcp` SDK to 2.2.0. Launch `jsee serve schema.json --mcp-only` from an MCP client to expose one Python descriptor as a tool without opening an HTTP listener.

Discovery does not import model code. Calls return the same validated output/artifact envelope as JSON CLI/HTTP in `structuredContent` and JSON text. Failures set `isError` and return the failed envelope as text. File outputs include MCP resource links; read them through `resources/read` and verify the decoded blob against the envelope's size and SHA256. Artifact storage defaults to 64 MiB/1,024 files per session and cleans up on orderly close or SIGTERM; a crash can leave files. Reads return entire files, subject to the client's message limits.

The additional `upload_artifact` tool supports bounded chunks, completion and cancellation; handles from completed uploads or computation outputs are reusable within the session. The `jsee artifact-import data.csv --mime text/csv` CLI persists registrations for later CLI runs. See the [common upload protocol](../README.md#mcp-over-stdio).

Model prints go to stderr. Calls follow `invoke_schema`'s loading lifecycle; persistent model state is not a portable contract. The SDK parses messages before JSEE applies the decoded-argument limit. Remote MCP, streams and forced cancellation remain pending; HTTP auth options do not apply to stdio. See the [common MCP contract](../README.md#mcp-over-stdio) for client setup and limits.

## How it works

JSEE introspects your function's type hints and default values to generate a schema describing inputs and their types. The schema drives both the GUI (rendered by the JSEE runtime in the browser) and the API endpoints.

`**kwargs` does not create a required input field. Extra request fields can reach functions accepting `**kwargs`; legacy `_jsee` metadata is removed unless the function explicitly declares an `_jsee` parameter. Explicit parameters, including `caller` and `history`, retain their supplied values.

Legacy model endpoints encode non-finite numbers (`NaN`, positive/negative infinity) as `null` in JSON and SSE results, including nested values, matching JavaScript's JSON encoding. Canonical CLI/HTTP/MCP outputs instead reject these values with `JSEE_OUTPUT_INVALID`. Browser arithmetic can still retain `NaN`, such as the undefined sample deviation of a one-row CSV.

Both the stdlib server and WSGI app validate declared types, options, numeric bounds/steps, and required input presence before invoking a model. Invalid input returns HTTP 400. Explicit defaults are applied without changing the submitted dictionary; `Optional[X]` generates `nullable: true`, and a `None` default remains valid. Named input groups produce nested objects; unnamed layout groups flatten into their parent. Caller-provided schema dictionaries are copied before server normalization.

`serve()` and `create_app()` also share model loading and request decoding. Schema-file model and static paths resolve from the descriptor directory, including CLI calls from another directory. CLI `--name=value` and positional overrides set and lock input defaults.

For a Python model, `entry` selects the callable and `name` identifies its HTTP endpoint. Without `entry`, the loader retains name-based lookup and unnamed callable inference. The [CSV summary example](../examples/python-summary/README.md) uses the same descriptor and function for native Python and Pyodide.

Request bodies default to a 50 MiB limit. Set a positive `max_body_bytes` in either Python entry point, or use `jsee schema.json --max-body-bytes 10485760` for 10 MiB. Malformed lengths and invalid inputs return 400; oversized declarations return 413 before reading the body. This is a body-size policy, not an execution sandbox or request deadline.

```
Python function          JSEE schema             Server
  def sum(               {                       GET  /          → GUI
    x: int,      →         "inputs": [           GET  /api       → schema
    y: int = 1               {"name":"x",         GET  /api/openapi.json
  ) -> int:                   "type":"int"},      POST /sum      → execute
    return x+y               {"name":"y",
                              "type":"int",
                              "default":1}]
                         }
```

### Type mapping

| Python type | JSEE type | GUI widget |
|---|---|---|
| `int` | `int` | Number field |
| `float` | `float` | Number field |
| `bool` | `checkbox` | Checkbox |
| `str` (or no hint) | `string` | Text field |
| `datetime.date` | `date` | Date picker |
| `Literal["a", "b"]` | `select` | Dropdown |
| `Enum` subclass | `select` | Dropdown |
| `Optional[X]` | unwraps to X | Same as X |

### Annotated types

Use `typing.Annotated` with JSEE descriptor classes for richer widgets:

```python
from typing import Annotated
import jsee

def predict(
    text: Annotated[str, jsee.Text()],
    temperature: Annotated[float, jsee.Slider(0, 2, 0.1)] = 0.7,
    mode: Annotated[str, jsee.Radio(['greedy', 'sample'])] = 'sample'
) -> str:
    return text.upper()

jsee.serve(predict)
```

| Annotation | JSEE type | GUI widget |
|---|---|---|
| `jsee.Slider(min, max, step)` | `slider` | Range slider |
| `jsee.Text()` | `text` | Textarea |
| `jsee.Radio(options)` | `radio` | Radio buttons |
| `jsee.Select(options)` | `select` | Dropdown |
| `jsee.MultiSelect(options)` | `multi-select` | Checkbox group |
| `jsee.Range(min, max, step)` | `range` | Dual-handle slider |
| `jsee.Color()` | `color` | Color picker |

### Output types

Use `typing.Annotated` with output descriptors on the return type, or declare outputs via the `outputs` kwarg:

```python
from typing import Annotated
import jsee

# Option 1: return type annotation
def summarize(text: str) -> Annotated[str, jsee.Markdown()]:
    return '## Summary\n\n' + text[:100] + '...'

# Option 2: outputs kwarg (for multi-output dicts)
def report(query: str) -> dict:
    rows = [{'word': w, 'len': len(w)} for w in query.split()]
    return {'summary': '**Found {}**'.format(len(rows)), 'data': rows}

jsee.serve(report, outputs={'summary': jsee.Markdown(), 'data': jsee.Table()})
```

| Annotation | JSEE output type | Renders as |
|---|---|---|
| `jsee.Markdown()` | `markdown` | Formatted Markdown |
| `jsee.Html()` | `html` | Raw HTML |
| `jsee.Code()` | `code` | Code block (`<pre>`) |
| `jsee.Image()` | `image` | `<img>` tag |
| `jsee.Table()` | `table` | Sortable table |
| `jsee.Svg()` | `svg` | Inline SVG |
| `jsee.File(filename)` | `file` | Download button |

Auto-detected output types:
- `-> list` → `table` (list-of-dicts auto-converted to `{columns, rows}` format)
- `-> bytes` → runtime auto-detection from a MIME-sniffed data URL
- `-> dict` → runtime auto-detects per key (no explicit outputs needed)

## API

### `jsee.serve(target, host='127.0.0.1', port=5050, **kwargs)`

Start a server with GUI and JSON API.

`target` can be:
- **A function** — schema auto-generated from type hints
- **A dict** — pre-built JSEE schema object
- **A string** — path to `schema.json` file

Keyword arguments (when target is a function):
- `title` — page title (default: function name)
- `description` — page description (default: first line of docstring)
- `examples` — list of dicts with clickable example inputs
- `reactive` — `True` to auto-run on input change (no submit button)
- `outputs` — dict or list of output type declarations
- `chat` — `True` for chat mode (see below)
- `stream` — `True` to serve sync or async generator results as SSE

```python
from typing import Literal
import jsee

def calculator(num1: float, op: Literal['add', 'sub'], num2: float) -> dict:
    """A simple calculator"""
    if op == 'add': return {'result': num1 + num2}
    return {'result': num1 - num2}

jsee.serve(
    calculator,
    title='Calculator',
    examples=[{'num1': 3, 'op': 'add', 'num2': 4}],
    reactive=True
)
```

### Chat mode

Use `chat=True` to turn a function into a chat interface. The function receives `message` and `history`, returns a string response. The runtime accumulates messages and renders them as a chat conversation.

```python
import jsee

def chat(message: str, history: list = []) -> str:
    """My chatbot"""
    return 'You said: ' + message

jsee.serve(chat, chat=True)
```

How it works:
- The runtime manages conversation state client-side
- Each Run sends `{message, history}` to the server
- `history` is a list of `{role: 'user'|'assistant', content: str}` dicts
- String return is auto-wrapped as `{chat: response}`
- Async chat functions are awaited before the response is wrapped
- The `chat` output type renders messages with Markdown support
- Press Enter in the message field to send

### `jsee.generate_schema(target, host='0.0.0.0', port=5050, **kwargs)`

Generate a JSEE schema dict from a function without starting a server. Useful for inspecting or customizing the schema before serving.

```python
import jsee

def predict(text: str, temperature: float = 0.7) -> str:
    return text.upper()

schema = jsee.generate_schema(predict)
# Customize schema
schema['inputs'][1]['min'] = 0.0
schema['inputs'][1]['max'] = 2.0
schema['inputs'][1]['type'] = 'slider'
# Serve customized schema with function
jsee.serve(predict, port=5050)
```

### Server endpoints

Every JSEE server exposes:

| Route | Method | Description |
|---|---|---|
| `/` | GET | Interactive GUI |
| `/api` | GET | Schema and endpoint discovery |
| `/api/openapi.json` | GET | Auto-generated OpenAPI 3.1 spec |
| `/{model_name}` | POST | Execute model with JSON body |

`serve()` uses a threaded dev server, so long model calls and open SSE streams do not block `/api` or static asset requests. Async functions are awaited before JSON serialization. Sync and async generator functions stream `text/event-stream` responses when `stream=True`.

Once SSE headers have been sent, generator failures are reported as an `event: error` frame with JSON `{"error": "..."}`, followed by `[DONE]`. Both `serve()` and `create_app()` use the same framing. Response write failures, or a WSGI host closing the response iterable, close suspended generators so their `finally` cleanup runs. WSGI pulls one chunk at a time; async generators retain one task and context across reads and cleanup. A producer blocked inside computation still needs cooperative cancellation.

Stages from the same Python file share one module instance within an application. Separate applications load separate instances. Explicit model names must identify callables; duplicate endpoint names are rejected before imports. An unnamed model selects a public callable defined in its source file and exposes it at `/model`. Existing endpoints execute individual stages; the browser orchestrates the pipeline.

The OpenAPI spec is generated from the same schema contract: request bodies include JSON inputs and multipart file uploads, responses include declared output properties (including outputs nested in groups), streaming models advertise `text/event-stream`, `schema.examples` become request examples, and standard JSON error responses are documented. This is descriptive only; the runtime response payload remains backward-compatible.

```bash
# Execute with JSON
curl -X POST http://localhost:5050/sum \
  -H 'Content-Type: application/json' \
  -d '{"x": 3, "y": 4}'
# → {"result": 7}

# Execute with file upload (multipart/form-data)
curl -X POST http://localhost:5050/analyze \
  -F 'data=@myfile.txt'

# Discover endpoints
curl http://localhost:5050/api

# Get OpenAPI spec
curl http://localhost:5050/api/openapi.json
```

### Return values

| Python return | JSON response |
|---|---|
| `dict` | returned as-is (each value serialized individually) |
| `int`, `float`, `str` | wrapped: `{"result": value}` |
| `tuple` | converted to list: `{"result": [a, b]}` |
| `bytes` | MIME-sniffed data URL, e.g. `{"result": "data:application/pdf;base64,..."}` |
| PIL `Image` | base64 image (auto-detected) |
| `list[dict]` | table format: `{"result": {"columns": [...], "rows": [...]}}` |

Nested serialization: when returning a dict, each value is serialized individually. A dict value that is `bytes` becomes a MIME-sniffed base64 data URL, a `list[dict]` value becomes `{columns, rows}` table format, etc.

## Offline

The JSEE runtime (`jsee.core.js` / `jsee.full.js`) is bundled with the package. The server auto-selects the bundle based on output types, so the built-in GUI needs no CDN. Your model, imports, and data may still require network access; provide those assets locally for an offline application.

The package also includes the descriptor authoring JSON Schema (draft-07), accessible without loading model code:

```python
import json
from importlib.resources import files

descriptor_schema = json.loads(files('jsee').joinpath('static/schema.json').read_text())
```

Use it with a JSON Schema validator of your choice. It describes known fields while allowing extension metadata; runtime capability and invocation-value checks remain separate.

## Development

This package lives in the [JSEE monorepo](https://github.com/jseeio/jsee) under `py/`.

```bash
# From the jsee repo root
npm run build-dev && npm run copy-runtime-py
cd py && pip install -e .
python -m pytest test/ -v
```

For distributable packages, run `npm run build:python` from the repository root. The production build prepares both browser bundles and the descriptor schema before building the wheel and source distribution. Python package builds fail when any required asset is missing. Installing a prepared package requires no Node.js.

Run `npm run test:python-native` at the repository root to check native behavior and rebuild/install a wheel from its source distribution outside the checkout. These development checks require `pytest`, `build`, and `wheel`.

Schemas accept an optional numeric `schemaVersion: 1`. An absent version keeps the same behavior; unsupported versions fail before importing model code. Descriptor format versions are separate from package versions.
