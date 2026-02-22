# JSEE for Python

Turn Python functions into web apps with auto-generated GUI and REST API. Zero dependencies beyond Python stdlib.

## Install

```bash
pip install jsee
```

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

## How it works

JSEE introspects your function's type hints and default values to generate a schema describing inputs and their types. The schema drives both the GUI (rendered by the JSEE runtime in the browser) and the API endpoints.

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
- `-> bytes` → `image` (base64-encoded)
- `-> dict` → runtime auto-detects per key (no explicit outputs needed)

## API

### `jsee.serve(target, host='0.0.0.0', port=5050, **kwargs)`

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
| `bytes` | base64 image: `{"result": "data:image/png;base64,..."}` |
| PIL `Image` | base64 image (auto-detected) |
| `list[dict]` | table format: `{"result": {"columns": [...], "rows": [...]}}` |

Nested serialization: when returning a dict, each value is serialized individually. A dict value that is `bytes` becomes a base64 data URL, a `list[dict]` value becomes `{columns, rows}` table format, etc.

## Gradio comparison

JSEE serves the same purpose as Gradio for simple use cases — zero-setup function-to-GUI — but with zero dependencies and full offline support.

| | JSEE | Gradio |
|---|---|---|
| Dependencies | 0 (stdlib only) | 30+ packages |
| Install size | ~300 KB | ~150 MB |
| Offline | Yes (bundled runtime) | Requires CDN/network |
| GPU/ML serving | Yes (your function, your stack) | Yes (same) |
| Input widgets | text, number, slider, select, radio, checkbox, date, file, color | 30+ component types |
| Output types | text, image, table, JSON, HTML, markdown, SVG, code, file | 20+ component types |
| Layout control | Schema-driven (sidebar, tabs, accordion) | Imperative Python API |
| Streaming | Not yet | Yes (yield) |
| Chat UI | Yes (`chat=True`) | Yes (ChatInterface) |

JSEE is not a Gradio replacement for complex apps. It's a lightweight alternative when you want instant GUI + API from a function with minimal overhead.

## Offline

The JSEE runtime (`jsee.runtime.js`, ~300 KB) is bundled with the package. No CDN or internet access required. The server works fully offline.

## Development

This package lives in the [JSEE monorepo](https://github.com/jseeio/jsee) under `py/`.

```bash
# From the jsee repo root
npm run build-dev && npm run copy-runtime-py
cd py && pip install -e .
python -m pytest test/ -v
```
