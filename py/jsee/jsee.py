#!/usr/bin/env python3

import base64
import asyncio
import copy
from contextlib import closing
import datetime
import enum
import html as html_lib
import inspect
import math
import io
import json
import os
import typing
import types
import importlib
from inspect import signature, _empty
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.parse

from .types import (
  Slider, Text, Radio, Select, MultiSelect, Range, Color,
  Markdown, Html, Code, Image, Table, Svg, File, OUTPUT_TYPE_MAP,
)


FULL_BUNDLE_TYPES = {'chart', '3d', 'map'}
DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024


def _needs_full_bundle(schema):
  """Check if schema outputs require the full bundle."""
  outputs = schema.get('outputs', [])
  for o in outputs:
    if o.get('type') in FULL_BUNDLE_TYPES:
      return True
    if o.get('type') == 'group' and o.get('elements'):
      for el in o['elements']:
        if el.get('type') in FULL_BUNDLE_TYPES:
          return True
  return False


def _find_runtime(schema=None):
  """Find jsee runtime — auto-selects core or full based on schema outputs."""
  pkg_dir = os.path.dirname(os.path.abspath(__file__))
  bundle = 'jsee.full.js' if (schema and _needs_full_bundle(schema)) else 'jsee.core.js'
  candidates = [
    os.path.join(pkg_dir, 'static', bundle),
    os.path.join(pkg_dir, '..', '..', 'dist', bundle),
    # Fallback to core if full not found
    os.path.join(pkg_dir, 'static', 'jsee.core.js'),
    os.path.join(pkg_dir, '..', '..', 'dist', 'jsee.core.js'),
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
    body {{ font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 0; }}
    .container {{ max-width: 1100px; margin: auto; padding: 20px; }}
    h1 {{ font-weight: 300; font-size: 22px; }}
  </style>
</head>
<body>
  <div id="jsee-serve-bar" style="background:#f8f8f8;border-bottom:1px solid #e0e0e0;padding:6px 15px;font-size:13px;color:#828282;display:flex;align-items:center;gap:16px">
    <span style="font-family:monospace">{address}</span>
    <span style="flex:1"></span>
    <label style="color:#aaa;cursor:not-allowed" title="Server execution only"><input type="checkbox" disabled style="margin-right:4px">Browser</label>
    <button id="save-html-btn" style="background:none;border:1px solid #ddd;border-radius:3px;padding:3px 10px;font-size:12px;color:#555;cursor:pointer" title="Save as self-contained HTML file">Save HTML</button>
  </div>
  <div class="container">
    <h1>{name}</h1>
    <div id="jsee-container"></div>
  </div>
  <script src="/static/jsee.js"></script>
  <script>
    var env = new JSEE({{
      container: document.getElementById('jsee-container'),
      schema: {schema_json}
    }})
    var saveBtn = document.getElementById('save-html-btn')
    if (saveBtn) {{
      saveBtn.addEventListener('click', function () {{ env.download({download_name_json}) }})
    }}
  </script>
</body>
</html>"""


def _safe_json_for_script(value):
  return json.dumps(value).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')


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
  if origin in (typing.Union, getattr(types, 'UnionType', typing.Union)):
    non_none = [a for a in args if a is not type(None)]
    if len(non_none) == 1:
      base_type, extra = _type_hint_to_jsee(non_none[0])
      extra['nullable'] = True
      return base_type, extra

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


def _apply_input_defaults(inputs, defaults, positional):
  for i, inp in enumerate(inputs):
    name = inp.get('name', '')
    if name in defaults:
      inp['default'] = defaults[name]
      inp['disabled'] = True
    elif i < len(positional):
      inp['default'] = positional[i]
      inp['disabled'] = True


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
    if param.kind == inspect.Parameter.VAR_KEYWORD:
      continue
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

  # Apply CLI data defaults (--key=value or positional args)
  _apply_input_defaults(inputs, kwargs.get('defaults', {}), kwargs.get('extra_positional', []))

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
  if kwargs.get('stream'):
    schema['model']['stream'] = True
  return schema


def _option_value(option):
  if isinstance(option, dict):
    for key in ('value', 'name', 'label'):
      if key in option:
        return option[key]
  return option


def _option_schema(options):
  values = [_option_value(option) for option in options]
  types = []
  for value in values:
    if value is None:
      kind = 'null'
    elif isinstance(value, bool):
      kind = 'boolean'
    elif isinstance(value, (int, float)):
      kind = 'integer' if value == int(value) else 'number'
    elif isinstance(value, list):
      kind = 'array'
    elif isinstance(value, dict):
      kind = 'object'
    else:
      kind = 'string'
    if kind not in types:
      types.append(kind)
  return {'type': types[0] if len(types) == 1 else types, 'enum': values}


def jsee_inputs_to_json_schema(inputs):
  """Convert JSEE inputs to JSON Schema (mirrors JS version)."""
  if inputs is not None and not isinstance(inputs, list):
    raise ValueError('inputs/elements should be an array')
  properties = {}
  required = []
  def add(name, prop):
    if not isinstance(name, str) or not name:
      raise ValueError('Input name should be a nonempty string')
    if name in properties:
      raise ValueError('Duplicate input name: ' + name)
    properties[name] = prop
  for inp in (inputs or []):
    if not isinstance(inp, dict):
      raise ValueError('Input should be an object')
    if inp.get('type') in ('button', 'action'):
      continue
    if inp.get('type') == 'group' and not inp.get('name'):
      nested = jsee_inputs_to_json_schema(inp.get('elements'))
      for name, prop in nested['properties'].items():
        add(name, prop)
      required.extend(nested['required'])
      continue
    prop = {}
    if inp.get('description'):
      prop['description'] = inp['description']
    t = inp.get('type', 'string')
    if t == 'group':
      prop.update(jsee_inputs_to_json_schema(inp.get('elements')))
    elif t == 'file':
      prop['type'] = 'string'
      if inp.get('raw') or inp.get('stream'):
        prop['type'] = ['string', 'object']
        prop['properties'] = {'kind': {'type': 'string', 'enum': ['url']}, 'url': {'type': 'string'}}
        prop['required'] = ['kind', 'url']
    elif t == 'folder':
      prop['type'] = 'array'
      prop['items'] = {'type': 'object'}
    elif t == 'int':
      prop['type'] = 'integer'
    elif t in ('float', 'number'):
      prop['type'] = 'number'
    elif t in ('bool', 'checkbox', 'toggle'):
      prop['type'] = 'boolean'
    elif t in ('select', 'categorical', 'radio'):
      prop.update(_option_schema(inp['options']) if inp.get('options') else {'type': 'string'})
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
      prop['items'] = _option_schema(inp['options']) if inp.get('options') else {'type': 'string'}
    else:
      prop['type'] = 'string'
    if inp.get('arrayBuffer') is True:
      prop['type'] = 'array'
      prop['items'] = {'type': 'number'}
    if prop.get('type') in ('integer', 'number'):
      if 'min' in inp:
        prop['minimum'] = inp['min']
      if 'max' in inp:
        prop['maximum'] = inp['max']
      if 'step' in inp:
        prop['multipleOf'] = inp['step']
    if 'default' in inp:
      prop['default'] = inp['default']
    if inp.get('nullable') is True or ('default' in inp and inp['default'] is None):
      kinds = prop['type'] if isinstance(prop['type'], list) else [prop['type']]
      prop['type'] = list(dict.fromkeys(kinds + ['null']))
      if 'enum' in prop and None not in prop['enum']:
        prop['enum'].append(None)
    add(inp.get('name'), prop)
    if inp.get('required') is True or (inp.get('required') is not False and 'default' not in inp):
      required.append(inp['name'])
  return {'type': 'object', 'properties': properties, 'required': required}


def _prepare_inputs(inputs, data):
  """Apply declared defaults and validate the contract shared by HTTP and WSGI."""
  errors = []
  def matches(value, kind):
    if kind in ('integer', 'number'):
      numeric = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
      return numeric and (kind != 'integer' or value == int(value))
    if kind == 'boolean':
      return isinstance(value, bool)
    if kind == 'null':
      return value is None
    return isinstance(value, {'string': str, 'array': list, 'object': dict}.get(kind, type(None)))

  def equal(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
      return type(a) is type(b) and a == b
    if isinstance(a, list) and isinstance(b, list):
      return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
      return a.keys() == b.keys() and all(equal(a[key], b[key]) for key in a)
    return a == b

  def check(value, prop, path):
    kind = prop.get('type')
    kinds = kind if isinstance(kind, list) else [kind]
    if kind and not any(matches(value, entry) for entry in kinds):
      errors.append('{}: expected {}'.format(path, ' or '.join(kinds)))
      return
    if 'enum' in prop and not any(equal(value, option) for option in prop['enum']):
      errors.append(path + ': value is not in options')
    if value is None:
      return
    if 'minimum' in prop and value < prop['minimum']:
      errors.append('{}: minimum is {}'.format(path, prop['minimum']))
    if 'maximum' in prop and value > prop['maximum']:
      errors.append('{}: maximum is {}'.format(path, prop['maximum']))
    if prop.get('multipleOf', 0) > 0:
      ratio = value / prop['multipleOf']
      if abs(ratio - round(ratio)) > 1e-9:
        errors.append('{}: expected a multiple of {}'.format(path, prop['multipleOf']))
    if isinstance(value, list):
      if 'minItems' in prop and len(value) < prop['minItems']:
        errors.append(path + ': too few items')
      if 'maxItems' in prop and len(value) > prop['maxItems']:
        errors.append(path + ': too many items')
      if 'items' in prop:
        for index, item in enumerate(value):
          check(item, prop['items'], '{}[{}]'.format(path, index))
    if isinstance(value, dict) and 'properties' in prop:
      for name in prop.get('required', []):
        if name not in value:
          errors.append(path + '.' + name + ': required')
      for name, field in prop['properties'].items():
        if name in value:
          check(value[name], field, path + '.' + name)

  def visit(fields, target, prefix=''):
    for inp in fields or []:
      if inp.get('type') in ('button', 'action'):
        continue
      if inp.get('type') == 'group' and not inp.get('name'):
        visit(inp.get('elements'), target, prefix)
        continue
      name = inp['name']
      path = prefix + name
      if name not in target:
        if inp.get('required') is True:
          errors.append(path + ': required')
        elif 'default' in inp:
          target[name] = copy.deepcopy(inp['default'])
        elif inp.get('required') is not False:
          errors.append(path + ': required')
        if name not in target:
          continue
      value = target[name]
      if value is None and (inp.get('nullable') is True or ('default' in inp and inp['default'] is None)):
        continue
      if inp.get('type') == 'group':
        if not isinstance(value, dict):
          errors.append(path + ': expected object')
        else:
          target[name] = dict(value)
          visit(inp.get('elements'), target[name], path + '.')
      elif inp.get('type') == 'file' and isinstance(value, (bytes, bytearray, memoryview)):
        continue
      else:
        check(value, jsee_inputs_to_json_schema([inp])['properties'][name], path)
  result = dict(data) if isinstance(data, dict) else {}
  if not isinstance(data, dict):
    errors.append('inputs: expected object')
  else:
    visit(inputs, result)
  if errors:
    raise ValueError('; '.join(errors))
  return result


def _flatten_outputs(outputs, flat=None):
  if flat is None:
    flat = []
  if not isinstance(outputs, list):
    return flat
  for output in outputs:
    if not isinstance(output, dict):
      continue
    if output.get('type') == 'group':
      _flatten_outputs(output.get('elements'), flat)
      continue
    if output.get('name'):
      flat.append(output)
  return flat


def _table_output_json_schema():
  return {
    'oneOf': [
      {
        'type': 'object',
        'properties': {
          'columns': {'type': 'array', 'items': {'type': 'string'}},
          'rows': {'type': 'array', 'items': {'type': 'array', 'items': {}}},
        },
        'required': ['columns', 'rows'],
        'additionalProperties': True,
      },
      {
        'type': 'array',
        'items': {'type': 'object', 'additionalProperties': True},
      },
    ]
  }


def _file_like_output_json_schema():
  return {
    'oneOf': [
      {'type': 'string'},
      {
        'type': 'object',
        'properties': {
          'filename': {'type': 'string'},
          'name': {'type': 'string'},
          'mime': {'type': 'string'},
          'contentType': {'type': 'string'},
          'content': {},
          'value': {},
          'data': {},
          'url': {'type': 'string'},
        },
        'additionalProperties': True,
      },
    ]
  }


def jsee_output_to_json_schema(output):
  t = (output or {}).get('type')
  if t == 'number':
    return {'type': 'number'}
  if t == 'gauge':
    return {
      'oneOf': [
        {'type': 'number'},
        {'type': 'object', 'additionalProperties': True},
      ]
    }
  if t == 'table':
    return _table_output_json_schema()
  if t in ('file', 'image', 'audio', 'video', 'pdf', 'viewer'):
    return _file_like_output_json_schema()
  if t in ('markdown', 'html', 'svg', 'code', 'highlight'):
    return {'type': 'string'}
  if t in ('alert', 'chat'):
    return {
      'oneOf': [
        {'type': 'string'},
        {'type': 'object', 'additionalProperties': True},
        {'type': 'array', 'items': {'type': 'object', 'additionalProperties': True}},
      ]
    }
  if t in ('chart', 'map', '3d', 'gallery', 'object'):
    return {
      'oneOf': [
        {'type': 'object', 'additionalProperties': True},
        {'type': 'array', 'items': {}},
      ]
    }
  return {}


def jsee_outputs_to_json_schema(outputs):
  flat_outputs = _flatten_outputs(outputs)
  if not flat_outputs:
    return {'type': 'object', 'additionalProperties': True}
  properties = {}
  for output in flat_outputs:
    properties[output['name']] = jsee_output_to_json_schema(output)
  return {
    'type': 'object',
    'properties': properties,
    'additionalProperties': True,
  }


def jsee_inputs_to_multipart_json_schema(inputs):
  schema = jsee_inputs_to_json_schema(inputs)
  for inp in (inputs or []):
    if not isinstance(inp, dict) or not inp.get('name'):
      continue
    if inp.get('type') == 'file':
      schema['properties'][inp['name']] = {'type': 'string', 'format': 'binary'}
  return schema


def _has_file_input(inputs):
  for inp in (inputs or []):
    if not isinstance(inp, dict):
      continue
    if inp.get('type') == 'group' and _has_file_input(inp.get('elements')):
      return True
    if inp.get('type') == 'file':
      return True
  return False


def _openapi_request_examples(examples):
  if not isinstance(examples, list) or not examples:
    return None
  result = {}
  for index, example in enumerate(examples):
    value = example.get('inputs') if isinstance(example, dict) and isinstance(example.get('inputs'), dict) else example
    result['example{}'.format(index + 1)] = {'value': value}
  return result


def _openapi_error_response(description):
  return {
    'description': description,
    'content': {
      'application/json': {
        'schema': {
          'type': 'object',
          'properties': {
            'error': {'type': 'string'},
          },
          'required': ['error'],
          'additionalProperties': True,
        }
      }
    }
  }


def generate_openapi_spec(schema):
  """Generate OpenAPI 3.1 spec from JSEE schema."""
  models = schema.get('model', [])
  if isinstance(models, dict):
    models = [models]
  input_schema = jsee_inputs_to_json_schema(schema.get('inputs'))
  output_schema = jsee_outputs_to_json_schema(schema.get('outputs'))
  examples = _openapi_request_examples(schema.get('examples'))
  paths = {}
  for m in models:
    name = m.get('name', 'model')
    json_content = {'schema': input_schema}
    if examples:
      json_content['examples'] = examples
    request_content = {'application/json': json_content}
    if _has_file_input(schema.get('inputs')):
      request_content['multipart/form-data'] = {
        'schema': jsee_inputs_to_multipart_json_schema(schema.get('inputs'))
      }
    response_content = {'application/json': {'schema': output_schema}}
    if m.get('stream'):
      response_content['text/event-stream'] = {
        'schema': {'type': 'string'},
        'description': 'Server-Sent Events stream with data frames and a [DONE] sentinel',
      }
    paths['/' + name] = {
      'post': {
        'summary': 'Run ' + name,
        'operationId': name,
        'requestBody': {
          'required': True,
          'content': request_content
        },
        'responses': {
          '200': {
            'description': 'Model output',
            'content': response_content
          },
          '400': _openapi_error_response('Invalid request'),
          '404': _openapi_error_response('Unknown model'),
          '500': _openapi_error_response('Model execution error'),
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


def _validate_schema_version(schema):
  if 'schemaVersion' in schema:
    version = schema['schemaVersion']
    if isinstance(version, bool) or not isinstance(version, (int, float)) or version != 1:
      raise ValueError('Unsupported schemaVersion: expected 1 or an absent version')


def _load_model_func(schema, cwd='.'):
  """Load schema models into a mapping from endpoint names to callables."""
  _validate_schema_version(schema)
  models = schema.get('model', [])
  if isinstance(models, dict):
    models = [models]
  names = set()
  for model in models:
    name = model.get('name', 'model')
    if name in names:
      raise ValueError('Duplicate model name: {}'.format(name))
    names.add(name)
  modules = {}
  funcs = {}
  for m in models:
    url = m.get('url', '')
    name = m.get('name', 'model')
    # Load from .py file
    if url.endswith('.py'):
      filepath = os.path.realpath(os.path.join(cwd, url))
      # Stages from one file share initialization/state within this app, not globally.
      if filepath not in modules:
        spec = importlib.util.spec_from_file_location(name, filepath)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        modules[filepath] = mod
      mod = modules[filepath]
      func = getattr(mod, name, None)
      if func is None and 'name' not in m:
        # Retain unnamed-model inference without selecting imported helper classes/functions.
        for attr_name in dir(mod):
          attr = getattr(mod, attr_name)
          if callable(attr) and not attr_name.startswith('_') and getattr(attr, '__module__', None) == mod.__name__:
            func = attr
            break
      if not callable(func):
        raise ValueError('Model {} is not a callable in {}'.format(name, filepath))
      funcs[name] = func
  return funcs


def _filter_kwargs(func, data):
  """Drop undeclared runtime metadata before calling Python model functions."""
  if not isinstance(data, dict):
    return data
  target = getattr(func, '_jsee_target', func)
  sig = inspect.signature(target)
  params = sig.parameters
  accepts_var_kw = any(
    p.kind == inspect.Parameter.VAR_KEYWORD
    for p in params.values()
  )
  if accepts_var_kw:
    return {k: v for k, v in data.items() if k != '_jsee' or k in params}
  return {
    k: v
    for k, v in data.items()
    if k in params
  }


def _call_model_func(func, data):
  result = func(**_filter_kwargs(func, data))
  if inspect.isawaitable(result):
    result = asyncio.run(result)
  return result


def _wrap_chat_result(result):
  if isinstance(result, str):
    return {'chat': result}
  return result


def _wrap_chat_async_result(result):
  async def _wrapped():
    value = await result
    return _wrap_chat_result(value)
  return _wrapped()


def _resolve_static_file(root, rel):
  """Resolve a static path under root, denying traversal and private paths."""
  root_real = os.path.realpath(root or '.')
  rel = urllib.parse.unquote(rel or '')
  rel = rel.replace('\\', '/')
  if os.path.isabs(rel):
    raise PermissionError('Path outside app root')

  parts = [p for p in rel.split('/') if p]
  if any(p == '..' for p in parts):
    raise PermissionError('Path outside app root')
  if any(p.startswith('.') or p == 'node_modules' for p in parts):
    raise PermissionError('Static path is not allowed')

  candidate = os.path.realpath(os.path.join(root_real, rel))
  try:
    common = os.path.commonpath([root_real, candidate])
  except ValueError:
    raise PermissionError('Path outside app root')
  if common != root_real:
    raise PermissionError('Path outside app root')
  if not os.path.isfile(candidate):
    return None
  return candidate


def _iter_model_result(result):
  if not inspect.isasyncgen(result):
    try:
      yield from result
    finally:
      result.close()
    return

  loop = asyncio.new_event_loop()
  ready = loop.create_future()
  resume = None

  async def produce():
    nonlocal resume
    try:
      async for chunk in result:
        resume = loop.create_future()
        ready.set_result(chunk)
        await resume
    except BaseException as error:
      if not ready.done():
        ready.set_exception(error)
    finally:
      await result.aclose()
      if not ready.done():
        ready.set_exception(StopAsyncIteration())

  # One producer task preserves ContextVar tokens and async cleanup across WSGI reads.
  # The next chunk is requested only when the synchronous consumer resumes iteration.
  task = loop.create_task(produce())
  try:
    while True:
      try:
        chunk = loop.run_until_complete(ready)
      except StopAsyncIteration:
        break
      yield chunk
      ready = loop.create_future()
      resume.set_result(None)
  finally:
    if not task.done():
      task.cancel()
    try:
      loop.run_until_complete(task)
      loop.run_until_complete(loop.shutdown_asyncgens())
    finally:
      loop.close()


def _stream_sse_result(result, write_chunk):
  with closing(_iter_model_result(result)) as chunks:
    for chunk in chunks:
      write_chunk(chunk)


def _sse_frames(result):
  try:
    with closing(_iter_model_result(result)) as chunks:
      for chunk in chunks:
        yield 'data: {}\n\n'.format(json.dumps(_serialize_result(chunk))).encode('utf-8')
  except Exception as error:
    yield 'event: error\ndata: {}\n\n'.format(json.dumps({'error': str(error)})).encode('utf-8')
  yield b'data: [DONE]\n\n'


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


class _RequestError(ValueError):
  def __init__(self, message, status=400):
    super().__init__(message)
    self.status = status


def _check_body_limit(limit):
  if type(limit) is not int or limit <= 0:
    raise ValueError('max_body_bytes must be a positive integer')
  return limit


def _read_request_inputs(inputs, stream, content_type, content_length, limit):
  length_text = str(content_length or '0').strip()
  if not length_text.isascii() or not length_text.isdigit():
    raise _RequestError('Content-Length must be a nonnegative integer')
  # Reject excessive declarations before asking either transport to read the body.
  digits = length_text.lstrip('0') or '0'
  if len(digits) > len(str(limit)):
    raise _RequestError('Body exceeds {} bytes'.format(limit), 413)
  length = int(digits)
  if length > limit:
    raise _RequestError('Body exceeds {} bytes'.format(limit), 413)
  body = stream.read(length) if length else b''
  if len(body) != length:
    raise _RequestError('Body is shorter than Content-Length')
  try:
    data = _parse_multipart(content_type, body) if 'multipart/form-data' in content_type else json.loads(body or b'{}')
    return _prepare_inputs(inputs, data)
  except ValueError as error:
    raise _RequestError(str(error)) from error


def _to_table_format(data):
  """Convert list-of-dicts to {columns, rows} for JSEE table output.

  This format enables save-as-CSV and copy-as-TSV in the runtime.
  """
  if not data or not isinstance(data[0], dict):
    return data
  columns = list(data[0].keys())
  rows = [[row.get(c) for c in columns] for row in data]
  return {'columns': columns, 'rows': rows}


def _binary_startswith(data, prefix, offset=0):
  return len(data) >= offset + len(prefix) and data[offset:offset + len(prefix)] == prefix


def _sniff_binary_mime(data):
  if _binary_startswith(data, b'\x89PNG\r\n\x1a\n'):
    return 'image/png'
  if _binary_startswith(data, b'\xff\xd8\xff'):
    return 'image/jpeg'
  if _binary_startswith(data, b'GIF87a') or _binary_startswith(data, b'GIF89a'):
    return 'image/gif'
  if _binary_startswith(data, b'RIFF') and _binary_startswith(data, b'WEBP', 8):
    return 'image/webp'
  if _binary_startswith(data, b'%PDF'):
    return 'application/pdf'
  if _binary_startswith(data, b'RIFF') and _binary_startswith(data, b'WAVE', 8):
    return 'audio/wav'
  return 'application/octet-stream'


def _binary_data_url(value):
  data = bytes(value)
  b64 = base64.b64encode(data).decode('ascii')
  return 'data:{};base64,{}'.format(_sniff_binary_mime(data), b64)


def _serialize_value(value):
  """Serialize a single value (may be nested inside a dict result)."""
  if isinstance(value, (bytes, bytearray)):
    return _binary_data_url(value)
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


def _prepare_app(target, host, port, options):
  """Own model loading and descriptor normalization for HTTP and WSGI."""
  funcs = {}
  schema_cwd = '.'

  if isinstance(target, str):
    # Path to schema.json
    schema_cwd = os.path.dirname(os.path.abspath(target))
    with open(target, 'r') as f:
      schema = json.load(f)
    funcs = _load_model_func(schema, schema_cwd)
  elif isinstance(target, dict):
    schema = copy.deepcopy(target)
    funcs = _load_model_func(schema, schema_cwd)
  elif callable(target):
    schema = generate_schema(target, host, port, **options)
    if options.get('chat'):
      # Wrap function to return {chat: result} for string returns
      original_fn = target
      def _chat_wrapper(**data):
        result = original_fn(**data)
        if inspect.isawaitable(result):
          return _wrap_chat_async_result(result)
        return _wrap_chat_result(result)
      _chat_wrapper._jsee_target = original_fn
      funcs[target.__name__] = _chat_wrapper
    else:
      funcs[target.__name__] = target
  else:
    raise ValueError('target must be a function, dict, or path to schema.json')

  if not callable(target):
    _apply_input_defaults(schema.get('inputs', []), options.get('defaults', {}),
                         options.get('extra_positional', []))

  # Normalize model to list for internal iteration, keep original for client
  models = schema.get('model', {})
  if isinstance(models, dict):
    models = [models]
  elif not models:
    models = []

  # Update model URLs to point to local server endpoints
  for m in models:
    name = m.get('name', 'model')
    m['name'] = name
    m['type'] = 'post'
    m['url'] = '/{}'.format(name)
    m['worker'] = False

  return schema, funcs, models, schema_cwd


def serve(target, host='127.0.0.1', port=5050, max_body_bytes=DEFAULT_MAX_BODY_BYTES, **kwargs):
  """Start a server with GUI + JSON API.

  target can be:
    - A Python function (schema auto-generated from type hints)
    - A dict (pre-built JSEE schema)
    - A string path to schema.json

  Keyword args (passed to generate_schema when target is callable):
    title, description, examples, reactive, chat

  max_body_bytes limits JSON and multipart request bodies (default: 50 MiB).
  """
  max_body_bytes = _check_body_limit(max_body_bytes)
  schema, funcs, models, schema_cwd = _prepare_app(target, host, port, kwargs)

  runtime_path = _find_runtime(schema)
  runtime_code = None
  if runtime_path:
    with open(runtime_path, 'r') as f:
      runtime_code = f.read()

  # Build HTML
  model_name = models[0].get('title') or models[0].get('name', 'JSEE') if models else 'JSEE'
  display_host = 'localhost' if host == '0.0.0.0' else host
  html = TEMPLATE.format(
    name=html_lib.escape(model_name),
    schema_json=_safe_json_for_script(schema),
    download_name_json=_safe_json_for_script(model_name),
    address='{}:{}'.format(display_host, port)
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

      if pathname == '/static/jsee.js' and runtime_code:
        body = runtime_code.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/javascript; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        return

      # Serve static files from schema directory
      rel = pathname.lstrip('/')
      try:
        filepath = _resolve_static_file(schema_cwd, rel)
      except PermissionError:
        self.send_error(403)
        return
      if filepath:
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

      try:
        data = _read_request_inputs(schema.get('inputs'), self.rfile,
                                    self.headers.get('Content-Type', ''),
                                    self.headers.get('Content-Length'), max_body_bytes)
      except _RequestError as e:
        self.close_connection = True
        return self._send_error('Invalid request: ' + str(e), e.status)

      try:
        result = _call_model_func(funcs[model_name], data)
        # Generator → SSE streaming response
        if inspect.isgenerator(result) or inspect.isasyncgen(result):
          self.send_response(200)
          self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
          self.send_header('Cache-Control', 'no-cache')
          self.send_header('Access-Control-Allow-Origin', '*')
          self.end_headers()
          try:
            def _write_frame(frame):
              self.wfile.write(frame)
              self.wfile.flush()
            _stream_sse_result(_sse_frames(result), _write_frame)
          except (BrokenPipeError, ConnectionResetError):
            pass
        else:
          self._send_json(_serialize_result(result))
      except Exception as e:
        self._send_error(str(e), 500)

  server = ThreadingHTTPServer((host, port), Handler)
  print('JSEE server: http://{}:{}'.format(
    'localhost' if host == '0.0.0.0' else host, port))
  print('  GUI: http://localhost:{}/'.format(port))
  print('  API: http://localhost:{}/api'.format(port))
  print('  OpenAPI: http://localhost:{}/api/openapi.json'.format(port))
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    pass


def create_app(target, **kwargs):
  """Create a WSGI application for deployment with gunicorn, uWSGI, etc.

  target can be:
    - A Python function (schema auto-generated from type hints)
    - A dict (pre-built JSEE schema)
    - A string path to schema.json

  Returns a WSGI callable ``app(environ, start_response)``.

  max_body_bytes limits JSON and multipart request bodies (default: 50 MiB).

  Generator results stream as SSE; the WSGI host must close the iterable on disconnect.

  Example::

      # app.py
      import jsee
      app = jsee.create_app(lambda x=5: {'result': x * 2})
      # gunicorn app:app
  """
  host = kwargs.pop('host', '127.0.0.1')
  port = kwargs.pop('port', 5050)
  max_body_bytes = _check_body_limit(kwargs.pop('max_body_bytes', DEFAULT_MAX_BODY_BYTES))
  schema, funcs, models, schema_cwd = _prepare_app(target, host, port, kwargs)

  runtime_path = _find_runtime(schema)
  runtime_code = None
  if runtime_path:
    with open(runtime_path, 'r') as f:
      runtime_code = f.read()

  model_name = models[0].get('title') or models[0].get('name', 'JSEE') if models else 'JSEE'
  display_host = 'localhost' if host == '0.0.0.0' else host
  html = TEMPLATE.format(
    name=html_lib.escape(model_name),
    schema_json=_safe_json_for_script(schema),
    download_name_json=_safe_json_for_script(model_name),
    address='{}:{}'.format(display_host, port)
  )
  html_bytes = html.encode('utf-8')

  mime_types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  }

  def app(environ, start_response):
    method = environ.get('REQUEST_METHOD', 'GET')
    path_info = environ.get('PATH_INFO', '/').rstrip('/') or '/'

    if method == 'OPTIONS':
      start_response('204 No Content', [
        ('Access-Control-Allow-Origin', '*'),
        ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
        ('Access-Control-Allow-Headers', 'Content-Type'),
      ])
      return [b'']

    if method == 'GET':
      if path_info == '/':
        start_response('200 OK', [
          ('Content-Type', 'text/html; charset=utf-8'),
          ('Content-Length', str(len(html_bytes))),
        ])
        return [html_bytes]

      if path_info == '/api':
        api_models = [{'name': m['name'], 'endpoint': m['url'], 'method': 'POST'} for m in models]
        body = json.dumps({'schema': schema, 'models': api_models}).encode('utf-8')
        start_response('200 OK', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
          ('Access-Control-Allow-Origin', '*'),
        ])
        return [body]

      if path_info == '/api/openapi.json':
        body = json.dumps(generate_openapi_spec(schema)).encode('utf-8')
        start_response('200 OK', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
          ('Access-Control-Allow-Origin', '*'),
        ])
        return [body]

      if path_info == '/static/jsee.js' and runtime_code:
        body = runtime_code.encode('utf-8')
        start_response('200 OK', [
          ('Content-Type', 'application/javascript; charset=utf-8'),
          ('Content-Length', str(len(body))),
        ])
        return [body]

      # Static files from schema directory
      rel = path_info.lstrip('/')
      try:
        filepath = _resolve_static_file(schema_cwd, rel)
      except PermissionError:
        start_response('403 Forbidden', [('Content-Type', 'text/plain')])
        return [b'Forbidden']
      if filepath:
        ext = os.path.splitext(filepath)[1].lower()
        content_type = mime_types.get(ext, 'application/octet-stream')
        with open(filepath, 'rb') as f:
          body = f.read()
        start_response('200 OK', [
          ('Content-Type', content_type),
          ('Content-Length', str(len(body))),
        ])
        return [body]

      start_response('404 Not Found', [('Content-Type', 'text/plain')])
      return [b'Not Found']

    if method == 'POST':
      model_name_req = path_info.lstrip('/')
      if model_name_req not in funcs:
        body = json.dumps({'error': 'Unknown model: ' + model_name_req}).encode('utf-8')
        start_response('404 Not Found', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
          ('Access-Control-Allow-Origin', '*'),
        ])
        return [body]

      try:
        data = _read_request_inputs(schema.get('inputs'), environ['wsgi.input'],
                                    environ.get('CONTENT_TYPE', ''),
                                    environ.get('CONTENT_LENGTH'), max_body_bytes)
      except _RequestError as e:
        body = json.dumps({'error': 'Invalid request: ' + str(e)}).encode('utf-8')
        status = '413 Payload Too Large' if e.status == 413 else '400 Bad Request'
        start_response(status, [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
          ('Access-Control-Allow-Origin', '*'),
        ])
        return [body]

      try:
        result = _call_model_func(funcs[model_name_req], data)
        if inspect.isgenerator(result) or inspect.isasyncgen(result):
          start_response('200 OK', [
            ('Content-Type', 'text/event-stream; charset=utf-8'),
            ('Cache-Control', 'no-cache'),
            ('Access-Control-Allow-Origin', '*'),
          ])
          return _sse_frames(result)
        body = json.dumps(_serialize_result(result)).encode('utf-8')
        start_response('200 OK', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
          ('Access-Control-Allow-Origin', '*'),
        ])
        return [body]
      except Exception as e:
        body = json.dumps({'error': str(e)}).encode('utf-8')
        start_response('500 Internal Server Error', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
          ('Access-Control-Allow-Origin', '*'),
        ])
        return [body]

    start_response('405 Method Not Allowed', [('Content-Type', 'text/plain')])
    return [b'Method Not Allowed']

  return app
