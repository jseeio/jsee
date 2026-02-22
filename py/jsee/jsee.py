#!/usr/bin/env python3

import base64
import datetime
import enum
import io
import json
import os
import typing
import importlib
from inspect import signature, _empty
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

from .types import (
  Slider, Text, Radio, Select, MultiSelect, Range, Color,
  Markdown, Html, Code, Image, Table, Svg, File, OUTPUT_TYPE_MAP,
)


def _find_runtime():
  """Find jsee.runtime.js — check bundled static/ first, then monorepo dist/."""
  pkg_dir = os.path.dirname(os.path.abspath(__file__))
  candidates = [
    os.path.join(pkg_dir, 'static', 'jsee.runtime.js'),
    os.path.join(pkg_dir, '..', '..', 'dist', 'jsee.runtime.js'),
  ]
  for c in candidates:
    if os.path.isfile(c):
      return os.path.abspath(c)
  return None


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{name}</title>
  <style>
    body {{ font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; }}
    .container {{ max-width: 1100px; margin: auto; }}
    h1 {{ font-weight: 300; font-size: 22px; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>{name}</h1>
    <div id="jsee-container"></div>
  </div>
  <script src="/static/jsee.runtime.js"></script>
  <script>
    var env = new JSEE({{
      container: document.getElementById('jsee-container'),
      schema: {schema_json}
    }})
  </script>
</body>
</html>"""


def _type_hint_to_jsee(hint):
  """Map a Python type hint to (jsee_type, extra_props).

  Supports: int, float, bool, str, datetime.date, Literal, Enum,
  Optional, and Annotated with descriptor metadata.
  """
  origin = typing.get_origin(hint)
  args = typing.get_args(hint)

  # Annotated[T, descriptor] — extract metadata
  if origin is typing.Annotated:
    base = args[0]
    base_type, extra = _type_hint_to_jsee(base)
    for meta in args[1:]:
      if isinstance(meta, Slider):
        base_type = 'slider'
        if meta.min is not None: extra['min'] = meta.min
        if meta.max is not None: extra['max'] = meta.max
        if meta.step is not None: extra['step'] = meta.step
      elif isinstance(meta, Text):
        base_type = 'text'
      elif isinstance(meta, Radio):
        base_type = 'radio'
        extra['options'] = meta.options
      elif isinstance(meta, Select):
        base_type = 'select'
        extra['options'] = meta.options
      elif isinstance(meta, MultiSelect):
        base_type = 'multi-select'
        extra['options'] = meta.options
      elif isinstance(meta, Range):
        base_type = 'range'
        if meta.min is not None: extra['min'] = meta.min
        if meta.max is not None: extra['max'] = meta.max
        if meta.step is not None: extra['step'] = meta.step
      elif isinstance(meta, Color):
        base_type = 'color'
    return base_type, extra

  # Optional[X] = Union[X, None] — unwrap
  if origin is typing.Union:
    non_none = [a for a in args if a is not type(None)]
    if len(non_none) == 1:
      return _type_hint_to_jsee(non_none[0])

  # Literal["a", "b"] → select with options
  if origin is typing.Literal:
    return 'select', {'options': list(args)}

  # Enum subclass → select with options from member values
  if isinstance(hint, type) and issubclass(hint, enum.Enum):
    return 'select', {'options': [m.value for m in hint]}

  # Primitive types
  if hint == int:
    return 'int', {}
  if hint == float:
    return 'float', {}
  if hint == bool:
    return 'checkbox', {}
  if hint == datetime.date:
    return 'date', {}
  return 'string', {}


def _return_hint_to_output(hint):
  """Map a return type annotation to a JSEE output descriptor.

  Returns a list of output dicts, or None if no explicit output should be set.
  """
  if hint is None or hint is type(None):
    return None

  origin = typing.get_origin(hint)
  args = typing.get_args(hint)

  # Annotated[T, descriptor] — check for output descriptors
  if origin is typing.Annotated:
    base = args[0]
    for meta in args[1:]:
      meta_type = type(meta)
      if meta_type in OUTPUT_TYPE_MAP:
        out = {'name': 'result', 'type': OUTPUT_TYPE_MAP[meta_type]}
        if isinstance(meta, File) and meta.filename:
          out['filename'] = meta.filename
        return [out]
    # No output descriptor found, fall through to base type
    return _return_hint_to_output(base)

  # tuple[X, Y, ...] — multiple outputs (not supported for naming, skip)
  # dict — auto-detect works fine (runtime creates outputs from keys)
  # list — suggest table
  if origin is list or hint is list:
    return [{'name': 'result', 'type': 'table'}]
  if hint is bytes or hint is bytearray:
    return [{'name': 'result', 'type': 'image'}]

  return None


def _build_outputs(kwargs_outputs):
  """Build outputs list from the outputs kwarg.

  Accepts:
    - dict mapping name → type string or descriptor instance
    - list of output dicts (passed through)
  """
  if isinstance(kwargs_outputs, list):
    return kwargs_outputs
  outputs = []
  for name, spec in kwargs_outputs.items():
    if isinstance(spec, str):
      outputs.append({'name': name, 'type': spec})
    elif type(spec) in OUTPUT_TYPE_MAP:
      out = {'name': name, 'type': OUTPUT_TYPE_MAP[type(spec)]}
      if isinstance(spec, File) and spec.filename:
        out['filename'] = spec.filename
      outputs.append(out)
    else:
      outputs.append({'name': name, 'type': 'object'})
  return outputs


def generate_schema(target, host='0.0.0.0', port=5050, **kwargs):
  """Introspect a Python function and generate a JSEE schema.

  Keyword args:
    title: str — page title (default: function name)
    description: str — page description (default: first line of docstring)
    examples: list[dict] — clickable example inputs
    reactive: bool — auto-run on input change (no submit button)
    outputs: dict or list — output type declarations, e.g.
      {'data': 'table', 'chart': jsee.Image()} or
      [{'name': 'result', 'type': 'markdown'}]
    chat: bool — chat mode (text input + chat output, history injected by runtime)
  """
  hints = typing.get_type_hints(target, include_extras=True)
  sig = signature(target)
  inputs = []
  for name, param in sig.parameters.items():
    jsee_type = 'string'
    extra = {}
    if name in hints:
      jsee_type, extra = _type_hint_to_jsee(hints[name])
    inp = {'name': name, 'type': jsee_type}
    inp.update(extra)
    if param.default is not _empty:
      # Convert Enum defaults to their value
      default = param.default
      if isinstance(default, enum.Enum):
        default = default.value
      inp['default'] = default
    inputs.append(inp)

  title = kwargs.get('title') or target.__name__
  description = kwargs.get('description')
  if not description and target.__doc__:
    description = target.__doc__.strip().split('\n')[0]

  schema = {
    'model': {
      'name': target.__name__,
      'title': title,
      'type': 'post',
      'url': 'http://{}:{}/{}'.format(host, port, target.__name__),
      'worker': False,
      'autorun': False
    },
    'inputs': inputs,
  }

  # Chat mode: text input + chat output, exclude 'history' from inputs
  if kwargs.get('chat'):
    schema['inputs'] = [i for i in inputs if i['name'] != 'history']
    # Set enter-to-send on message input
    for inp in schema['inputs']:
      if inp['name'] == 'message':
        inp['enter'] = True
    schema['outputs'] = [{'name': 'chat', 'type': 'chat'}]
  # Outputs — from kwarg, return type annotation, or omitted (runtime auto-detect)
  elif kwargs.get('outputs'):
    schema['outputs'] = _build_outputs(kwargs['outputs'])
  elif 'return' in hints:
    auto_outputs = _return_hint_to_output(hints['return'])
    if auto_outputs:
      schema['outputs'] = auto_outputs

  if description:
    schema['model']['description'] = description
    schema['page'] = {'description': description}
  if kwargs.get('examples'):
    schema['examples'] = kwargs['examples']
  if kwargs.get('reactive'):
    schema['reactive'] = True
  return schema


def jsee_inputs_to_json_schema(inputs):
  """Convert JSEE inputs to JSON Schema (mirrors JS version)."""
  properties = {}
  required = []
  for inp in (inputs or []):
    prop = {}
    if inp.get('description'):
      prop['description'] = inp['description']
    t = inp.get('type', 'string')
    if t == 'int':
      prop['type'] = 'integer'
    elif t in ('float', 'number'):
      prop['type'] = 'number'
    elif t in ('bool', 'checkbox', 'toggle'):
      prop['type'] = 'boolean'
    elif t in ('select', 'categorical', 'radio'):
      prop['type'] = 'string'
      if inp.get('options'):
        prop['enum'] = inp['options']
    elif t == 'slider':
      prop['type'] = 'number'
      if 'min' in inp:
        prop['minimum'] = inp['min']
      if 'max' in inp:
        prop['maximum'] = inp['max']
      if 'step' in inp:
        prop['multipleOf'] = inp['step']
    elif t == 'range':
      prop['type'] = 'array'
      prop['items'] = {'type': 'number'}
      prop['minItems'] = 2
      prop['maxItems'] = 2
    elif t == 'multi-select':
      prop['type'] = 'array'
      prop['items'] = {'type': 'string'}
      if inp.get('options'):
        prop['items']['enum'] = inp['options']
    else:
      prop['type'] = 'string'
    if 'default' in inp:
      prop['default'] = inp['default']
    properties[inp['name']] = prop
    if 'default' not in inp:
      required.append(inp['name'])
  return {'type': 'object', 'properties': properties, 'required': required}


def generate_openapi_spec(schema):
  """Generate OpenAPI 3.1 spec from JSEE schema."""
  models = schema.get('model', [])
  if isinstance(models, dict):
    models = [models]
  input_schema = jsee_inputs_to_json_schema(schema.get('inputs'))
  paths = {}
  for m in models:
    name = m.get('name', 'model')
    paths['/' + name] = {
      'post': {
        'summary': 'Run ' + name,
        'operationId': name,
        'requestBody': {
          'required': True,
          'content': {'application/json': {'schema': input_schema}}
        },
        'responses': {
          '200': {
            'description': 'Model output',
            'content': {'application/json': {'schema': {'type': 'object'}}}
          }
        }
      }
    }
  title = schema.get('title') \
    or (schema.get('page', {}) or {}).get('title') \
    or (models[0].get('name') if models else None) \
    or 'JSEE API'
  return {
    'openapi': '3.1.0',
    'info': {'title': title, 'version': '1.0.0'},
    'paths': paths
  }


def _load_model_func(schema, cwd='.'):
  """Load Python model function from schema. Returns (func, model_name)."""
  models = schema.get('model', [])
  if isinstance(models, dict):
    models = [models]
  funcs = {}
  for m in models:
    url = m.get('url', '')
    name = m.get('name', 'model')
    # Load from .py file
    if url.endswith('.py'):
      filepath = os.path.join(cwd, url)
      spec = importlib.util.spec_from_file_location(name, filepath)
      mod = importlib.util.module_from_spec(spec)
      spec.loader.exec_module(mod)
      func = getattr(mod, name, None)
      if func is None:
        # Try first callable in module
        for attr_name in dir(mod):
          attr = getattr(mod, attr_name)
          if callable(attr) and not attr_name.startswith('_'):
            func = attr
            break
      if func:
        funcs[name] = func
  return funcs


def _parse_multipart(content_type, body):
  """Parse multipart/form-data using stdlib email parser."""
  from email.parser import BytesParser
  from email.policy import default as default_policy
  header = 'Content-Type: {}\r\n\r\n'.format(content_type).encode()
  msg = BytesParser(policy=default_policy).parsebytes(header + body)
  data = {}
  for part in msg.iter_parts():
    name = part.get_param('name', header='content-disposition')
    if name is None:
      continue
    filename = part.get_filename()
    if filename:
      # File upload — pass raw bytes
      data[name] = part.get_payload(decode=True)
    else:
      # Regular field — decode as string, try to parse as JSON for numbers
      value = part.get_payload(decode=True).decode('utf-8')
      try:
        value = json.loads(value)
      except (json.JSONDecodeError, ValueError):
        pass
      data[name] = value
  return data


def _to_table_format(data):
  """Convert list-of-dicts to {columns, rows} for JSEE table output.

  This format enables save-as-CSV and copy-as-TSV in the runtime.
  """
  if not data or not isinstance(data[0], dict):
    return data
  columns = list(data[0].keys())
  rows = [[row.get(c) for c in columns] for row in data]
  return {'columns': columns, 'rows': rows}


def _serialize_value(value):
  """Serialize a single value (may be nested inside a dict result)."""
  if isinstance(value, (bytes, bytearray)):
    b64 = base64.b64encode(value).decode('ascii')
    return 'data:image/png;base64,' + b64
  if hasattr(value, 'save') and hasattr(value, 'mode'):
    buf = io.BytesIO()
    fmt = 'PNG' if value.mode == 'RGBA' else 'JPEG'
    value.save(buf, format=fmt)
    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
    mime = 'image/png' if fmt == 'PNG' else 'image/jpeg'
    return 'data:{};base64,{}'.format(mime, b64)
  if isinstance(value, list) and value and isinstance(value[0], dict):
    return _to_table_format(value)
  return value


def _serialize_result(result):
  """Serialize a function result for JSON response.

  Handles: dict, tuple, list, bytes, PIL Image, list-of-dicts, primitives.
  """
  # Dict — serialize each value individually
  if isinstance(result, dict):
    return {k: _serialize_value(v) for k, v in result.items()}
  # Tuple — convert to list
  if isinstance(result, tuple):
    return {'result': [_serialize_value(v) for v in result]}
  # Top-level value
  serialized = _serialize_value(result)
  if serialized is not result:
    return {'result': serialized}
  return {'result': result}


def serve(target, host='0.0.0.0', port=5050, **kwargs):
  """Start a server with GUI + JSON API.

  target can be:
    - A Python function (schema auto-generated from type hints)
    - A dict (pre-built JSEE schema)
    - A string path to schema.json

  Keyword args (passed to generate_schema when target is callable):
    title, description, examples, reactive, chat
  """
  funcs = {}
  schema_cwd = '.'

  if isinstance(target, str):
    # Path to schema.json
    schema_cwd = os.path.dirname(os.path.abspath(target))
    with open(target, 'r') as f:
      schema = json.load(f)
    funcs = _load_model_func(schema, schema_cwd)
  elif isinstance(target, dict):
    schema = target
  elif callable(target):
    schema = generate_schema(target, host, port, **kwargs)
    if kwargs.get('chat'):
      # Wrap function to return {chat: result} for string returns
      original_fn = target
      def _chat_wrapper(**data):
        result = original_fn(**data)
        if isinstance(result, str):
          return {'chat': result}
        return result
      funcs[target.__name__] = _chat_wrapper
    else:
      funcs[target.__name__] = target
  else:
    raise ValueError('target must be a function, dict, or path to schema.json')

  # Normalize model to list for internal iteration, keep original for client
  models = schema.get('model', {})
  if isinstance(models, dict):
    models = [models]
  elif not models:
    models = []

  # Update model URLs to point to local server endpoints
  for m in models:
    name = m.get('name', 'model')
    m['type'] = 'post'
    m['url'] = '/{}'.format(name)
    m['worker'] = False

  runtime_path = _find_runtime()
  runtime_code = None
  if runtime_path:
    with open(runtime_path, 'r') as f:
      runtime_code = f.read()

  # Build HTML
  model_name = models[0].get('title') or models[0].get('name', 'JSEE') if models else 'JSEE'
  html = TEMPLATE.format(
    name=model_name,
    schema_json=json.dumps(schema)
  )
  html_bytes = html.encode('utf-8')

  mime_types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }

  class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
      pass

    def _send_json(self, data, status=200):
      body = json.dumps(data).encode('utf-8')
      self.send_response(status)
      self.send_header('Content-Type', 'application/json; charset=utf-8')
      self.send_header('Access-Control-Allow-Origin', '*')
      self.send_header('Content-Length', str(len(body)))
      self.end_headers()
      self.wfile.write(body)

    def _send_error(self, msg, status=400):
      self._send_json({'error': msg}, status)

    def do_OPTIONS(self):
      self.send_response(204)
      self.send_header('Access-Control-Allow-Origin', '*')
      self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      self.send_header('Access-Control-Allow-Headers', 'Content-Type')
      self.end_headers()

    def do_GET(self):
      parsed = urllib.parse.urlparse(self.path)
      pathname = parsed.path.rstrip('/')

      if pathname == '' or pathname == '/':
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(html_bytes)))
        self.end_headers()
        self.wfile.write(html_bytes)
        return

      if pathname == '/api':
        api_models = [{'name': m['name'], 'endpoint': m['url'], 'method': 'POST'} for m in models]
        return self._send_json({'schema': schema, 'models': api_models})

      if pathname == '/api/openapi.json':
        return self._send_json(generate_openapi_spec(schema))

      if pathname == '/static/jsee.runtime.js' and runtime_code:
        body = runtime_code.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return

      # Serve static files from schema directory
      rel = pathname.lstrip('/')
      filepath = os.path.normpath(os.path.join(schema_cwd, rel))
      if filepath.startswith(os.path.normpath(schema_cwd)) and os.path.isfile(filepath):
        ext = os.path.splitext(filepath)[1].lower()
        content_type = mime_types.get(ext, 'application/octet-stream')
        with open(filepath, 'rb') as f:
          body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return

      self.send_error(404)

    def do_POST(self):
      parsed = urllib.parse.urlparse(self.path)
      pathname = parsed.path.rstrip('/')
      model_name = pathname.lstrip('/')

      if model_name not in funcs:
        return self._send_error('Unknown model: ' + model_name, 404)

      content_length = int(self.headers.get('Content-Length', 0))
      body = self.rfile.read(content_length) if content_length else b'{}'
      content_type = self.headers.get('Content-Type', '')

      try:
        if 'multipart/form-data' in content_type:
          data = _parse_multipart(content_type, body)
        else:
          data = json.loads(body)
      except (json.JSONDecodeError, ValueError) as e:
        return self._send_error('Invalid request: ' + str(e), 400)

      try:
        result = funcs[model_name](**data)
        self._send_json(_serialize_result(result))
      except Exception as e:
        self._send_error(str(e), 500)

  server = HTTPServer((host, port), Handler)
  print('JSEE server: http://{}:{}'.format(
    'localhost' if host == '0.0.0.0' else host, port))
  print('  GUI: http://localhost:{}/'.format(port))
  print('  API: http://localhost:{}/api'.format(port))
  print('  OpenAPI: http://localhost:{}/api/openapi.json'.format(port))
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    pass
