#!/usr/bin/env python3

import json
import os
import typing
import importlib
from inspect import signature, _empty
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse


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
  if hint == int:
    return 'int'
  elif hint == float:
    return 'float'
  elif hint == bool:
    return 'checkbox'
  return 'string'


def generate_schema(target, host='0.0.0.0', port=5050):
  """Introspect a Python function and generate a JSEE schema."""
  hints = typing.get_type_hints(target)
  sig = signature(target)
  inputs = []
  for name, param in sig.parameters.items():
    t = 'string'
    if name in hints:
      t = _type_hint_to_jsee(hints[name])
    inp = {'name': name, 'type': t}
    if param.default is not _empty:
      inp['default'] = param.default
    inputs.append(inp)
  return {
    'model': {
      'name': target.__name__,
      'type': 'post',
      'url': 'http://{}:{}/{}'.format(host, port, target.__name__),
      'worker': False,
      'autorun': False
    },
    'inputs': inputs,
  }


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


def serve(target, host='0.0.0.0', port=5050):
  """Start a server with GUI + JSON API.

  target can be:
    - A Python function (schema auto-generated from type hints)
    - A dict (pre-built JSEE schema)
    - A string path to schema.json
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
    schema = generate_schema(target, host, port)
    funcs[target.__name__] = target
  else:
    raise ValueError('target must be a function, dict, or path to schema.json')

  # Ensure model is array
  if isinstance(schema.get('model'), dict):
    schema['model'] = [schema['model']]
  if not schema.get('model'):
    schema['model'] = []

  # Update model URLs to point to local server endpoints
  for m in schema['model']:
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
  model_name = schema['model'][0]['name'] if schema['model'] else 'JSEE'
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
        models = [{'name': m['name'], 'endpoint': m['url'], 'method': 'POST'} for m in schema['model']]
        return self._send_json({'schema': schema, 'models': models})

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
      try:
        data = json.loads(body)
      except json.JSONDecodeError:
        return self._send_error('Invalid JSON', 400)

      try:
        result = funcs[model_name](**data)
        if not isinstance(result, dict):
          result = {'result': result}
        self._send_json(result)
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
