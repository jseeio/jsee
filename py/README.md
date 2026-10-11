# JSEE for Python

Serve a Python function as a browser form and HTTP API. JSEE generates the form
from type hints and runs the function in Python. The base server uses only the
standard library; MCP support and model libraries are optional dependencies.

This guide covers Python installation, function annotations and server setup.
The [main README](../README.md) defines the shared schema, HTTP response formats
and MCP protocol; the sections here show how to use them from Python.

[Main JSEE documentation](../README.md) | [Quick start](#quick-start) | [Type mapping](#type-mapping) | [Python API](#api) | [CLI](#cli--python) | [MCP](#mcp-over-stdio)

## Install

```bash
python -m pip install jsee==0.9.0
```

Requires Python 3.9+; MCP requires Python 3.10+ and `jsee[server]`.

The wheel includes the browser runtime, so installing or serving it requires no
Node.js. Individual models may need additional Python packages.

## Quick start

Save this complete program as `app.py`:

```python
import jsee


def multiply(a: float, b: float = 2.0) -> float:
    return a * b


if __name__ == '__main__':
    jsee.serve(multiply, port=5050)
```

Run `python app.py` and open `http://localhost:5050`. Enter `3` and `4`, then click **Run** to get `12`. Or call the same function from another terminal:

```sh
curl http://localhost:5050/multiply -H 'Content-Type: application/json' -d '{"a":3,"b":4}'
```

The response is `{"result":12.0}`. Stop with Ctrl+C. You can also serve the function with `jsee app.py multiply --port 5050`; the main guard keeps importing the file from starting a second server.

This callable-based server provides the UI at `/`, the function at `POST /multiply`, discovery at `/api` and OpenAPI at `/api/openapi.json`. For a schema-backed app with the shared `/run` route and MCP, see [Use a schema file](#use-a-schema-file).

## How it works

`jsee.serve(multiply)` reads the function's parameters, type hints and defaults to
create a JSEE schema. The browser uses that schema to display controls and sends
their values to `POST /multiply`. Python calls the function; the browser displays
the result. The function runs on the server, not in the browser.

You can also write the schema yourself to specify file inputs, nested JSON,
tables, multiple outputs or a pipeline. The two serving modes differ:

| Start with | Execution and response |
|---|---|
| `jsee.serve(function)` or `jsee app.py multiply` | One function at `/multiply`; simple results such as `{"result": 12}` |
| `jsee serve schema.json` | Whole pipeline at `/run`; declared outputs and stored file references |

Both serve a browser UI at `/`. Use a schema for JSON CLI runs and MCP tools.
The [main README](../README.md) describes the shared schema and browser API.

### Type mapping

These are **input** hints understood by `generate_schema()` and callable-based
serving. They select controls and validation rules; they do not convert JSON
values into arbitrary Python objects.

| Python type | JSEE type | Control |
|---|---|---|
| `int` | `int` | Number field |
| `float` | `float` | Number field |
| `bool` | `checkbox` | Checkbox |
| `str` (or no hint) | `string` | Text field |
| `datetime.date` | `date` | Date picker |
| `Literal["a", "b"]` | `select` | Dropdown |
| `Enum` subclass | `select` | Dropdown |
| `Optional[X]` | Type for X | Same as X |

`Optional[X]` adds `nullable: true`; Python 3.10+ also supports `X | None`.
Dates arrive as strings such as `"2026-10-11"`; Enum choices arrive as member
values, not Enum instances. Convert them inside
your function if needed. A `None` default is allowed; other defaults must match
the declared input type.

Plain `list`, `dict`, `bytes` and unrecognized input hints currently fall back to
`string`. To accept structured data or files, write explicit `object`, `table`,
`file` or media inputs in a [schema](#use-a-schema-file). JSEE does not infer their
structure from Python collection hints.

### Annotated types

Use `typing.Annotated` to choose a control and its options:

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
| `jsee.Range(min, max, step)` | `range` | Dual-handle slider; returns a two-number list |
| `jsee.Color()` | `color` | Color picker |

Use a list hint with `MultiSelect` and `Range`: both controls return lists.

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
| `jsee.Html()` | `html` | HTML; sanitization follows `security.allowRawHtml` |
| `jsee.Code()` | `code` | Code block (`<pre>`) |
| `jsee.Image()` | `image` | `<img>` tag |
| `jsee.Table()` | `table` | Sortable table |
| `jsee.Svg()` | `svg` | Inline SVG |
| `jsee.File(filename)` | `file` | Download button |

Output dictionaries/lists also accept the shared schema types without annotation helpers. For ranked scores, use `outputs=[{'name': 'predictions', 'type': 'scores', 'format': 'percent'}]` and return `{'predictions': [{'label': 'cat', 'score': 0.72}]}`. Canonical CLI/HTTP/MCP preserve row order and numeric values; the browser sorts the display. Scores must be finite. See the [shared output reference](https://jsee.org/#schema).

A `list` return hint generates a `table` output. Other plain return hints leave
output selection to browser auto-detection: dictionaries produce outputs by key,
and returned bytes become MIME-sniffed data URLs. See [return values](#return-values)
for serialization. The JSON CLI, `/run` and MCP require declared outputs.

<a id="use-python-instead"></a>

## Use a schema file

The [browser, CLI, HTTP and MCP tutorial](../README.md#your-first-computation) supplies a complete descriptor and input file. Keep its `schema.json` and `input.json`, and save this as `model.py` alongside them:

```python
def multiply(a: float, b: float) -> dict:
    product = a * b
    return {'product': product, 'report': f'{a:g} × {b:g} = {product:g}\n'}
```

In `schema.json`, replace only `model` with:

```json
{"url":"model.py","type":"py","entry":"multiply"}
```

Keep the same inputs, outputs and `input.json`. Use the Python environment's `jsee` executable:

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 3000
```

The product and report match the JavaScript version. These commands and the
served form need no Node.js. To call the same descriptor from an agent, follow
the [MCP setup](#mcp-over-stdio).

This step uses native Python on the server. Browser-only Python uses Pyodide and needs a browser-compatible package set; it is a separate deployment choice.

### Model loading

For schema-backed apps, `model.url` points to a local `.py` file. Paths resolve
from the descriptor's directory, or the current directory for a schema dict.

- `entry` selects the callable; `name` separately names its HTTP endpoint.
- Without `entry`, JSEE looks up `name`. If both are omitted, it selects a public callable defined in that file and serves it at `/model`.
- Endpoint names must be unique. Stages in one application share a module instance when they use the same file; separate applications load separate instances.
- Native Python supports ordinary sequential pipelines. Named-stage bindings, schema imports, remote models and canonical streaming are unsupported. Imports inside Python source work normally.

The [CSV summary example](https://github.com/jseeio/jsee/tree/main/examples/python-summary)
uses one descriptor and function for native Python and browser Pyodide.

### Descriptor validation

The package also includes the descriptor authoring JSON Schema (draft-07), accessible without loading model code:

```python
import json
from importlib.resources import files

descriptor_schema = json.loads(files('jsee').joinpath('static/schema.json').read_text())
```

Use it with a JSON Schema validator of your choice. It describes known fields while allowing extension metadata; runtime capability and invocation-value checks remain separate.

## JSON commands and canonical HTTP

Use these commands with a descriptor declaring local Python models, inputs and
outputs. "Canonical HTTP" refers to the whole-pipeline `/run` endpoint.

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 5050
```

`inspect` and `validate` do not import models. `run` reads JSON from stdin when
`--input` is omitted or `-`; model prints go to stderr.

| Result | JSON response | CLI exit code |
|---|---|---|
| Success | `{runId, status: "succeeded", outputs, artifacts}` | 0 |
| Invalid descriptor or request | Failed status with `error: {code, message}` | 2 |
| Invocation or output failure | Failed status with `error: {code, message}` | 1 |

Programmatically, use `jsee.serve(schema, canonical=True)` or
`jsee.create_app(schema, canonical=True)`. Here `schema` is a file path or a
schema dict referencing local model files, not a function. A stage named `run`
conflicts with `/run`; give it another name. Omitting `canonical=True` keeps the
per-model routes and does not create `/run` or `/schema`. The CLI subcommand
`jsee serve schema.json` enables canonical serving automatically.

### Input and output validation

Inputs are checked before execution: types, options, numeric bounds/steps and
required fields. Defaults apply without mutating the submitted dict. Named
groups become nested objects; unnamed groups flatten into their parent.

`object` accepts JSON, optionally restricted by `valueSchema`; `table` accepts
row dictionaries or `{columns, rows}`. See the [shared input reference](../README.md#structured-and-media-inputs)
for shapes and media restrictions.

Canonical results contain only declared outputs, resolving aliases and flattening
output groups. Before storing files, JSEE checks their declared types and shapes.
Missing required outputs, unsupported objects and non-finite numbers fail with
`JSEE_OUTPUT_INVALID`; errors identify the path, such as
`info.a: NaN is not a JSON value`. Numeric outputs reject `None`.

Object `valueSchema` supports a [bounded vocabulary](../README.md#json-objects-and-editable-tables).
Chart semantics are not validated. These checks differ from the older
[per-model response serializer](#return-values).

### File inputs and results

An **artifact** is a stored file with a reusable handle.

#### Passing a file

Pass a previous output's handle to another run using the same store:

```json
{"csv": {"artifact": "<runId>/<index>"}}
```

| Declared input | Value received by Python |
|---|---|
| `file` | Inline text, or stored file decoded as strict UTF-8 |
| `file` with `arrayBuffer: true` | Stored file bytes |
| `image`, `audio`, `video` | Stored file bytes; MIME must match the declared media type and `accept` |

Import a local file before a CLI run; use the returned handle in `input.json`:

```sh
jsee artifact-import data.csv --mime text/csv
jsee run schema.json --input input.json --json
```

#### Returning a file

For a declared `file` output, return text, `bytes`, `bytearray` or `memoryview`.
To choose its name and MIME dynamically, return a dict under the output name:

```python
def report():
    return {'report': {'content': b'a,b\n1,2\n',
                       'filename': 'report.csv', 'mime': 'text/csv'}}
```

Declare that output as `{"name": "report", "type": "file"}`. `value` and `data`
also work as content keys. Paths and URLs are not opened as file content.

The response replaces the file with `{artifact: "<runId>/<index>"}`. Its entry in
`artifacts` supplies `id`, `output`, `name`, `mime`, `size`, `sha256` and `uri`.

#### File lifetime

| Where it runs | Storage and lifetime |
|---|---|
| CLI | `.jsee-artifacts/`, or `--artifact-dir`; persistent files with `file:` URIs |
| HTTP | Relative download URIs; files last until server shutdown |
| MCP | Resource URIs; files last for the session |

HTTP/MCP stores clean up on orderly close; a crash can leave temporary files.
Handles cannot cross stores: download and upload the bytes when moving between
servers or sessions. See [file transfer rules](../README.md#passing-files-between-runs)
for integrity checks, raw/stream exceptions and in-process artifact stores.

### Routes and limits

Canonical serving adds these routes alongside the UI and per-model endpoints:

| Route | Purpose |
|---|---|
| `GET /schema` | Inspect the computation descriptor |
| `GET /openapi.json` | Read the whole-pipeline API description |
| `POST /run` | Execute with a JSON input object |
| `POST /__jsee/artifacts?name=data.csv` | Upload raw bytes; set MIME with Content-Type |
| `GET /__jsee/artifacts/<runId>/<index>` | Download a stored file |

| Limit | Default | CLI / Python option |
|---|---|---|
| Request body | 50 MiB | `--max-body-bytes` / `max_body_bytes` |
| Artifact storage | 64 MiB | `--max-artifact-bytes` / `max_artifact_bytes` |
| Stored file count | 1,024 | Fixed |

Input and output files share the quota; failed batches publish no partial files.
Request limits also apply to per-model routes. Invalid inputs return 400,
excessive bodies 413, unsupported content types 415, unsupported capabilities 422,
model/output errors 500 and artifact quotas 507.

Canonical serving defaults to same-origin browser access. Configure
[authentication and CORS](#http-authentication-and-cors) before sharing a server.
These limits do not sandbox code or forcibly interrupt a running model.

## MCP over stdio

MCP (Model Context Protocol) lets an agent discover and call your computation.
Install the optional server dependencies with Python 3.10+:

```sh
python -m pip install 'jsee[server]==0.9.0'
```

Configure the MCP client to launch your Python environment's absolute `bin/jsee`
path with arguments `["serve", "/absolute/path/schema.json", "--mcp-only"]`.
The process uses stdin/stdout for MCP, stderr for model prints, and opens no
HTTP port. Discovery reads the descriptor without importing model code.

- **Call:** successful results contain the same output/artifact envelope as JSON CLI/HTTP, in `structuredContent` and JSON text. Failures set `isError` and return the failed envelope as text.
- **Read a file:** use the returned resource link with `resources/read`. Check the decoded bytes against `size` and `sha256`.
- **Upload a file:** use `upload_artifact` to send chunks, then pass the completed handle as an input. The [shared MCP reference](../README.md#mcp-over-stdio) documents the chunk protocol and client setup.

Files use the [same quotas](#routes-and-limits) for the session. Resource reads
return entire files, so the client's message limit may be lower than the storage
quota. Python's MCP SDK parses messages before JSEE checks decoded argument size.

The extra pins `mcp` 2.2.0. Remote MCP, streaming and forced cancellation are not
supported; persistent model state across calls is not guaranteed. HTTP auth
options do not apply to stdio process access.

## API

### `jsee.serve(target, host='127.0.0.1', port=5050, **kwargs)`

Start a server with a browser UI and HTTP API. `canonical` defaults to `False`,
even when `target` is a schema file or dict:

| Call | HTTP surface |
|---|---|
| `jsee.serve(target)` | Per-model routes, `/api` and `/api/openapi.json`; no canonical `/run` or `/schema` |
| `jsee.serve(schema, canonical=True)` | Also exposes `/run`, `/schema`, `/openapi.json` and artifact routes |
| CLI `jsee serve schema.json` | Enables canonical serving automatically |

To embed the same server as the CLI, use:

```python
import jsee

jsee.serve('schema.json', canonical=True, port=5050)
```

Use a local Python descriptor as in [Use a schema file](#use-a-schema-file).
`canonical=True` accepts a descriptor path or dict, but not a function.
See [routes and limits](#routes-and-limits) for request and response behavior.

`target` can be:

- **A function**: schema auto-generated from type hints
- **A dict**: pre-built JSEE schema object
- **A string**: path to `schema.json` file

Function-to-schema options:

- `title`: page title (default: function name)
- `description`: page description (default: first line of docstring)
- `examples`: list of dicts with clickable example inputs
- `reactive`: `True` to auto-run on input change
- `outputs`: dict or list of output type declarations
- `chat`: `True` for chat mode (see below)
- `stream`: `True` to serve sync or async generator results as SSE

Server options also include `max_body_bytes`, `canonical`, `max_artifact_bytes`,
`auth_token`, `auth_token_env` and `cors_origins`; see [limits](#routes-and-limits)
and [access settings](#http-authentication-and-cors).

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

`**kwargs` does not create a form field. Extra request keys reach functions that
accept it; other functions receive only declared parameters. Per-model routes
remove legacy `_jsee` metadata unless the function explicitly declares it.
Explicit `caller` and `history` parameters keep supplied values. Caller-provided
schema dicts are copied before normalization.

### Chat mode

Use `chat=True` to turn a function into a chat interface. The function receives `message` and `history`, returns a string response. The runtime accumulates messages and renders them as a chat conversation.

```python
import jsee

def chat(message: str, history: list) -> str:
    """My chatbot"""
    return 'You said: ' + message

jsee.serve(chat, chat=True)
```

The browser keeps the conversation and sends `{message, history}` on each Run
or Enter. `history` contains `{role: 'user'|'assistant', content: str}` records.
JSEE awaits async functions, wraps string replies as `{chat: response}` and
renders them as Markdown.

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
# Save the browser descriptor for a separately served function
import json
schema['model']['url'] = 'http://localhost:5050/predict'
print(json.dumps(schema, indent=2))
```

Serve `predict` separately with `jsee.serve(predict, port=5050)`. The generated descriptor calls that endpoint; editing it does not change a later `serve(predict)` call. For a customized native server descriptor, declare a local Python model file and pass that descriptor to `serve()`.

### Whole-pipeline invocation

Use `await jsee.invoke_schema(schema, inputs, cwd=directory)` to run a pipeline
from Python without a server. `schema` is a dict; paths resolve relative to `cwd`.
Use `asyncio.run(...)` from synchronous code.

| Outcome | Return value |
|---|---|
| Success | `{'runId': ..., 'status': 'succeeded', 'result': ...}` |
| Failure | `{'runId': ..., 'status': 'failed', 'error': {'code': ..., 'message': ...}}` |

The result retains native values and intermediate data. Dict results merge between
stages; scalars, lists and `None` replace prior data. A truthy `stop` skips later
stages. This API does not serialize outputs or store returned files.

Inputs are validated and copied before importing models; defaults apply. Functions
receive keyword arguments, or inputs in schema order with `container: 'args'`.
Sync and async functions work. Capability limits follow [model loading](#model-loading);
errors distinguish invalid schema, invalid input, unsupported capability and
execution failure. Synchronous code runs on the calling thread without a forced
timeout or sandbox. See the [clean sales example](https://github.com/jseeio/jsee/tree/main/examples/clean-sales).

### Server endpoints

These per-model routes are available for callable-based serving and schema-based
apps. [Canonical serving](#json-commands-and-canonical-http) also provides `/run`
and artifact routes:

| Route | Method | Description |
|---|---|---|
| `/` | GET | Interactive GUI |
| `/api` | GET | Schema and endpoint discovery |
| `/api/openapi.json` | GET | Auto-generated OpenAPI 3.1 spec |
| `/{model_name}` | POST | Execute model with JSON body |

`serve()` uses a threaded dev server, so long model calls and open SSE streams do not block `/api` or static asset requests. Async functions are awaited before JSON serialization. Sync and async generator functions stream `text/event-stream` responses when `stream=True`.

### Streaming results

Use a generator to send results while the function is still running. With
`stream=True`, JSEE sends Server-Sent Events (SSE) and updates the browser as each
value arrives:

```python
import jsee


def stream_count(n: int = 5):
    for i in range(n):
        yield {'count': i}


if __name__ == '__main__':
    jsee.serve(stream_count, stream=True)
```

Save as `stream.py` and run `python stream.py`. Open `http://localhost:5050`, or use
`curl -N http://localhost:5050/stream_count -H 'Content-Type: application/json' -d '{"n":3}'`
to receive three data events followed by `[DONE]`. This uses the per-model route;
JSON `/run` and MCP calls do not stream.

Generator failures after headers are sent produce an `event: error` frame with
`{"error": "..."}`, followed by `[DONE]`. Put resource cleanup in `finally`:
response write failures close suspended generators. A WSGI host must close the
response iterable on disconnect. Code blocked inside computation still needs
cooperative cancellation; disconnecting cannot forcibly stop it.

### API discovery

`/api` lists the schema and endpoints. `/api/openapi.json` describes their inputs,
declared outputs, examples and JSON errors. File inputs advertise multipart
uploads; streaming models advertise `text/event-stream`.

```bash
# Call the quick-start function
curl -X POST http://localhost:5050/multiply \
  -H 'Content-Type: application/json' \
  -d '{"a": 3, "b": 4}'
# → {"result": 12.0}

# For your own analyze(data) function: upload a file (multipart/form-data)
curl -X POST http://localhost:5050/analyze \
  -F 'data=@myfile.txt'

# Discover endpoints
curl http://localhost:5050/api

# Get OpenAPI spec
curl http://localhost:5050/api/openapi.json
```

### Return values

The per-model HTTP routes serialize results as follows. Canonical CLI/HTTP/MCP
use the [declared-output and artifact rules](#file-inputs-and-results) instead.

| Python return | JSON response |
|---|---|
| `dict` | returned as-is (each value serialized individually) |
| `int`, `float`, `str` | wrapped: `{"result": value}` |
| `tuple` | converted to list: `{"result": [a, b]}` |
| `bytes` | MIME-sniffed data URL, e.g. `{"result": "data:application/pdf;base64,..."}` |
| PIL `Image` | base64 image (auto-detected) |
| `list[dict]` | table format: `{"result": {"columns": [...], "rows": [...]}}` |

The conversions apply to each top-level value in a returned dict. Declared
`scores` outputs keep their row arrays, including aliases and grouped outputs.
Non-finite numbers at any depth become JSON `null` on these per-model routes;
canonical `/run`, CLI and MCP instead reject them.

### WSGI deployment

For production deployment, use `create_app()` to get a standard WSGI application:

```python
# app.py
import jsee

def multiply(x: float = 5) -> dict:
    return {'result': x * 2}

app = jsee.create_app(multiply)
```

Deploy with gunicorn, uWSGI, or any WSGI server:

```bash
python -m pip install gunicorn
gunicorn app:app
```

`create_app()` also defaults to per-model routes. Use
`jsee.create_app('schema.json', canonical=True)` for the CLI's `/run` and artifact
API. It accepts the same targets and options as `serve()`, with the same
model loading, validation and serialization. It awaits async functions and supports
sync/async generators; see [stream cleanup](#streaming-results). Call `app.close()`
when retiring a canonical application to release its artifact store.

## HTTP authentication and CORS

Read a shared token from an existing environment variable:

```sh
jsee serve schema.json --auth-token-env APP_TOKEN
```

| CLI option | Python `serve()` / `create_app()` option |
|---|---|
| `--auth-token-env APP_TOKEN` | `auth_token_env='APP_TOKEN'` |
| `--auth-token TOKEN` | `auth_token='TOKEN'` |
| `--cors-origin https://client.example` (repeatable) | `cors_origins=['https://client.example']` |

Clients send `Authorization: Bearer TOKEN`. For the browser login, use username
`jsee` and the token as password. Configured authentication covers every route,
including static files and discovery; tokens stay out of HTML and model inputs.
Authenticated responses use `Cache-Control: no-store`.

Canonical serving allows same-origin requests by default. Legacy serving allows
wildcard CORS until authentication or an origin list is configured.
`cors_origins=[]` / `--cors-origin none` allows same-origin only; wildcard `'*'`
cannot be combined with authentication. Allowed preflights need no credentials,
but actual requests do. Invalid credentials return 401; denied origins return 403.

Use HTTPS through a trusted proxy or an SSH tunnel. Explicitly allow the proxy's
public HTTPS origin; forwarded headers are not trusted automatically. See the
[shared host policy](../README.md#http-authentication-and-cors) for exact origin
syntax, preflight handling and OpenAPI security. These options also apply to
legacy Python commands; they do not sandbox model code.

## Offline

The package includes the browser runtime and selects core or full according to
the output types. The built-in UI needs no CDN, but still needs the Python server
running. For offline use, also provide your model dependencies, imports and data
locally. This is not a standalone HTML export.

<a id="cli--python"></a>

## CLI: Python

```
jsee <target> [function] [data...] [options]
jsee init [template]
```

For `inspect`, `validate`, `run`, `serve` and file import, see [JSON commands](#json-commands-and-canonical-http). The shorter serving forms below remain available.

### Commands

#### `jsee init [template]`

Scaffold a new project. Templates: `minimal` (default), `chat`. Generates `schema.json` + `model.py` + `README.md`.

```bash
jsee init                   # minimal template
jsee init chat              # chat template
```

#### `jsee <file.py> <function> [data...]`

Serve a Python function as a web app with auto-generated GUI and REST API.

```bash
jsee app.py multiply                  # serve the quick-start function
jsee app.py multiply --port=8080      # custom port
```

#### `jsee <schema.json>`

Serve from a pre-built schema file.

```bash
jsee schema.json
```

### Options

| Flag | Description |
|---|---|
| `--host <addr>` | Host to bind to (default: `127.0.0.1`; use `0.0.0.0` to expose on the local network) |
| `--port <number>` | Port to listen on (default: `5050`) |
| `--max-body-bytes <number>` | Positive request body limit in bytes (default: `52428800`, 50 MiB) |

### Data inputs

Positional args after the function name and `--key=value` args are mapped to function parameters. Values are auto-detected (numbers, JSON, file paths, strings). Inputs set from the CLI are locked in the GUI.

```bash
jsee app.py multiply 3 4               # positional data
jsee app.py multiply --a=3 --b=4       # named data
jsee schema.json 42 hello              # positional data with schema
```

## Development

This package lives in the [JSEE monorepo](https://github.com/jseeio/jsee) under `py/`.

```bash
# From the jsee repo root
npm install
npm run build
python -m pip install -e './py' pytest build wheel
python -m pytest py/test/ -v
```

For distributable packages, run `npm run build:python` from the repository root. The production build prepares both browser bundles and the descriptor schema before building the wheel and source distribution. Python package builds fail when any required asset is missing. Installing a prepared package requires no Node.js.

Run `npm run test:python-native` at the repository root to check native behavior and rebuild/install a wheel from its source distribution outside the checkout. These development checks require `pytest`, `build`, and `wheel`.

### Versioning

Python and JavaScript share the 0.9 major/minor line; compatible fixes may have
different patch versions.

Schemas accept an optional numeric `schemaVersion: 1`. An absent version keeps the same behavior; unsupported versions fail before importing model code. Descriptor format versions are separate from package versions.
