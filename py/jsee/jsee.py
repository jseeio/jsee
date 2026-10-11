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
import re
import typing
import types
import importlib.util
import uuid
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


def _assert_value_schema(schema, at='valueSchema'):
  _assert_json_value(schema)
  if not isinstance(schema, dict):
    raise ValueError(at + ': expected schema object')
  keywords = ('type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description')
  for key in schema:
    if key not in keywords:
      raise ValueError(at + ': unsupported keyword ' + key)
  if 'type' in schema:
    types = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
    if not types or any(kind not in ('object', 'array', 'string', 'number', 'integer', 'boolean', 'null') for kind in types) or len(set(types)) != len(types):
      raise ValueError(at + '.type: invalid JSON type')
  if 'properties' in schema:
    if not isinstance(schema['properties'], dict):
      raise ValueError(at + '.properties: expected object')
    for name, child in schema['properties'].items():
      _assert_value_schema(child, at + '.properties.' + name)
  if 'items' in schema:
    _assert_value_schema(schema['items'], at + '.items')
  if 'required' in schema:
    names = schema['required']
    if not isinstance(names, list) or any(not isinstance(name, str) for name in names) or len(set(names)) != len(names):
      raise ValueError(at + '.required: expected unique strings')
  if 'additionalProperties' in schema and type(schema['additionalProperties']) is not bool:
    raise ValueError(at + '.additionalProperties: expected boolean')
  if 'enum' in schema and (not isinstance(schema['enum'], list) or not schema['enum']):
    raise ValueError(at + '.enum: expected nonempty array')
  if 'description' in schema and not isinstance(schema['description'], str):
    raise ValueError(at + '.description: expected string')
  for key in ('minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'):
    if key in schema and (type(schema[key]) not in (int, float) or not math.isfinite(schema[key]) or key not in ('minimum', 'maximum') and (schema[key] < 0 or schema[key] != int(schema[key]))):
      raise ValueError(at + '.' + key + ': invalid bound')


def _get_value_schema(field):
  if 'valueSchema' not in field:
    return None
  if field.get('type') != 'object':
    raise ValueError('valueSchema is only supported for type object')
  _assert_value_schema(field['valueSchema'])
  return copy.deepcopy(field['valueSchema'])


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
    value_schema = _get_value_schema(inp)
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
    elif t == 'table':
      prop.update(_table_output_json_schema())
    elif t == 'object':
      if value_schema is not None:
        prop.update(value_schema)
    elif t in ('image', 'audio', 'video'):
      prop.update({'type': 'object', 'properties': {'artifact': {'type': 'string', 'minLength': 1}}, 'required': ['artifact'], 'additionalProperties': False})
      prop['x-jsee-accept'] = inp.get('accept') or t + '/*'
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
    if t == 'file' and not inp.get('raw') and not inp.get('stream'):
      legacy = dict(prop)
      legacy.pop('description', None)
      prop = {key: value for key, value in prop.items() if key == 'description'}
      prop['oneOf'] = [legacy, {'type': 'object', 'properties': {'artifact': {'type': 'string', 'minLength': 1}}, 'required': ['artifact'], 'additionalProperties': False}]
      if inp.get('accept'):
        prop['x-jsee-accept'] = inp['accept']
    if prop.get('type') in ('integer', 'number'):
      if 'min' in inp:
        prop['minimum'] = inp['min']
      if 'max' in inp:
        prop['maximum'] = inp['max']
      if 'step' in inp:
        prop['multipleOf'] = inp['step']
    if 'default' in inp:
      prop['default'] = inp['default']
    if value_schema is None and (inp.get('nullable') is True or ('default' in inp and inp['default'] is None)):
      if 'oneOf' in prop:
        prop['oneOf'].append({'type': 'null'})
      elif 'type' in prop:
        kinds = prop['type'] if isinstance(prop['type'], list) else [prop['type']]
        prop['type'] = list(dict.fromkeys(kinds + ['null']))
      if 'enum' in prop and None not in prop['enum']:
        prop['enum'].append(None)
    add(inp.get('name'), prop)
    if inp.get('required') is True or (inp.get('required') is not False and 'default' not in inp):
      required.append(inp['name'])
  return {'type': 'object', 'properties': properties, 'required': required}


def _assert_json_value(value, seen=None):
  if value is None or isinstance(value, (str, bool)) or type(value) is int or type(value) is float and math.isfinite(value):
    return
  seen = set() if seen is None else seen
  if not isinstance(value, (list, dict)) or id(value) in seen:
    raise ValueError('Expected a finite JSON value')
  if isinstance(value, dict) and any(not isinstance(key, str) for key in value):
    raise ValueError('JSON object keys must be strings')
  seen.add(id(value))
  for item in value.values() if isinstance(value, dict) else value:
    _assert_json_value(item, seen)
  seen.remove(id(value))


def _json_shape_errors(value, schema, path):
  errors = []
  def matches(value, kind):
    if kind in ('integer', 'number'):
      numeric = type(value) is int or type(value) is float and math.isfinite(value)
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
    supported = ('type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'description', 'default', 'oneOf', 'anyOf', 'patternProperties', 'x-jsee-accept')
    for key in prop:
      if key not in supported:
        errors.append(path + ': unsupported schema keyword ' + key)
        return
    if 'anyOf' in prop and not any(not _json_shape_errors(value, option, path) for option in prop['anyOf']):
      errors.append(path + ': does not match the declared shape')
    if isinstance(value, dict):
      for pattern, rule in prop.get('patternProperties', {}).items():
        for key in value:
          if re.search(pattern, key):
            check(value[key], rule, path + '.' + key)
    if 'maxLength' in prop and isinstance(value, str) and len(value) > prop['maxLength']:
      errors.append(path + ': string is too long')
    if 'oneOf' in prop:
      count = 0
      for option in prop['oneOf']:
        start = len(errors)
        check(value, option, path)
        count += len(errors) == start
        del errors[start:]
      if count != 1:
        errors.append(path + ': does not match the declared input shape')
    if 'minLength' in prop and isinstance(value, str) and len(value) < prop['minLength']:
      errors.append(path + ': string is too short')
    if isinstance(value, dict) and prop.get('additionalProperties') is False and any(key not in prop.get('properties', {}) for key in value):
      errors.append(path + ': undeclared property')
    kind = prop.get('type')
    kinds = kind if isinstance(kind, list) else [kind]
    if kind and not any(matches(value, entry) for entry in kinds):
      errors.append('{}: expected {}'.format(path, ' or '.join(kinds)))
      return
    if 'enum' in prop and not any(equal(value, option) for option in prop['enum']):
      errors.append(path + ': value is not in options')
    if value is None:
      return
    if type(value) in (int, float) and 'minimum' in prop and value < prop['minimum']:
      errors.append('{}: minimum is {}'.format(path, prop['minimum']))
    if type(value) in (int, float) and 'maximum' in prop and value > prop['maximum']:
      errors.append('{}: maximum is {}'.format(path, prop['maximum']))
    if type(value) in (int, float) and prop.get('multipleOf', 0) > 0:
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
    if isinstance(value, dict):
      for name in prop.get('required', []):
        if name not in value:
          errors.append(path + '.' + name + ': required')
      for name, field in prop.get('properties', {}).items():
        if name in value:
          check(value[name], field, path + '.' + name)

  check(value, schema, path)
  return errors


def _prepare_inputs(inputs, data):
  """Apply declared defaults and validate the contract shared by HTTP and WSGI."""
  errors = []
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
      if 'valueSchema' not in inp and value is None and (inp.get('nullable') is True or ('default' in inp and inp['default'] is None)):
        continue
      if inp.get('type') == 'group':
        if not isinstance(value, dict):
          errors.append(path + ': expected object')
        else:
          target[name] = dict(value)
          visit(inp.get('elements'), target[name], path + '.')
      elif inp.get('type') in ('file', 'image', 'audio', 'video') and isinstance(value, (bytes, bytearray, memoryview)):
        continue
      else:
        if inp.get('type') in ('object', 'table'):
          try:
            _assert_json_value(value)
          except (ValueError, TypeError, OverflowError):
            errors.append(path + ': expected a finite JSON value')
            continue
        errors.extend(_json_shape_errors(value, jsee_inputs_to_json_schema([inp])['properties'][name], path))
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


def _scores_options(output):
  low, high = output.get('min', 0), output.get('max', 1)
  if any(type(v) not in (int, float) or not math.isfinite(v) for v in (low, high)) or not high > low or not math.isfinite(high - low):
    raise ValueError('scores min/max must define a finite increasing display range')
  precision = output.get('precision', 3)
  if type(precision) not in (int, float) or not 0 <= precision <= 20 or precision != int(precision):
    raise ValueError('scores precision must be an integer from 0 to 20')
  if output.get('format', 'number') not in ('number', 'percent'):
    raise ValueError('scores format must be number or percent')
  if any(not isinstance(output.get(k, ''), str) for k in ('prefix', 'suffix')):
    raise ValueError('scores prefix/suffix must be strings')


def jsee_output_to_json_schema(output):
  shape = _get_value_schema(output)
  if shape is not None:
    return shape
  t = (output or {}).get('type')
  if t == 'int':
    return {'type': 'integer'}
  if t in ('number', 'float'):
    return {'type': 'number'}
  if t == 'bool':
    return {'type': 'boolean'}
  if t == 'scores':
    return {'type': 'array', 'items': {'type': 'object', 'properties': {
      'label': {'type': 'string'}, 'score': {'type': 'number'}},
      'required': ['label', 'score'], 'additionalProperties': True}}
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
  if t in ('text', 'string', 'markdown', 'html', 'svg', 'code', 'highlight'):
    return {'type': 'string'}
  if t in ('alert', 'chat'):
    return {
      'oneOf': [
        {'type': 'string'},
        {'type': 'object', 'additionalProperties': True},
        {'type': 'array', 'items': {'type': 'object', 'additionalProperties': True}},
      ]
    }
  if t in ('chart', 'map', '3d', 'gallery'):
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
    entry = m.get('entry')
    if entry is not None and entry != '':
      if not isinstance(entry, str) or not entry.strip().isascii() or not entry.strip().isidentifier():
        raise ValueError('model.entry should be a valid Python function name')
      entry = entry.strip()
    else:
      entry = None
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
      # Endpoint identity and callable identity are independent, as in Pyodide.
      callable_name = entry or name
      func = getattr(mod, callable_name, None)
      if func is None and not entry and 'name' not in m:
        # Retain unnamed-model inference without selecting imported helper classes/functions.
        for attr_name in dir(mod):
          attr = getattr(mod, attr_name)
          if callable(attr) and not attr_name.startswith('_') and getattr(attr, '__module__', None) == mod.__name__:
            func = attr
            break
      if not callable(func):
        raise ValueError('Model {} is not a callable in {}'.format(callable_name, filepath))
      funcs[name] = func
  return funcs


def _filter_kwargs(func, data, *, legacy_metadata=True):
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
    return {k: v for k, v in data.items() if not legacy_metadata or k != '_jsee' or k in params}
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


def _invocation_unsupported_reason(schema):
  models = schema.get('model', [])
  if isinstance(models, dict):
    models = [models]
  if not models:
    return 'Invocation requires a model'
  for model in models:
    url = model.get('url')
    if (model.get('type') not in (None, 'py') or not isinstance(url, str)
        or not url.endswith('.py') or urllib.parse.urlparse(url).scheme
        or model.get('code') or model.get('stream') or model.get('imports') or schema.get('imports')):
      return 'invoke_schema supports local Python files without schema imports or streaming'
  return None


async def invoke_schema(schema, data, *, cwd='.', _model_funcs=None, artifact_store=None):
  """Execute a local Python pipeline; keep terminal status separate from model data.

  Accepts decoded inputs, not file paths/URLs to fetch. Synchronous model code runs
  on the calling thread. This function does not enforce a timeout or OS isolation.
  """
  run_id = str(uuid.uuid4())
  code = 'JSEE_SCHEMA_INVALID'
  try:
    if not isinstance(schema, dict):
      raise ValueError('Schema should be an object')
    _validate_schema_version(schema)
    models = schema.get('model')
    if isinstance(models, dict):
      models = [models]
    if not isinstance(models, list) or not models or any(not isinstance(m, dict) for m in models):
      raise ValueError('Schema should define one or more model objects')
    if 'inputs' in schema and not isinstance(schema['inputs'], list):
      raise ValueError('inputs should be an array')
    code = 'JSEE_INPUT_INVALID'
    # Validation precedes module initialization. JSON input containers belong to this invocation.
    result = _prepare_inputs(schema.get('inputs'), copy.deepcopy(data))
    from .transport import resolve_artifact_inputs
    result = resolve_artifact_inputs(schema.get('inputs'), result, artifact_store)
    code = 'JSEE_CAPABILITY_UNSUPPORTED'
    unsupported = _invocation_unsupported_reason(schema)
    if unsupported:
      raise ValueError(unsupported)
    code = 'JSEE_EXECUTION_FAILED'
    funcs = _load_model_func(schema, cwd) if _model_funcs is None else _model_funcs
    input_names = list(jsee_inputs_to_json_schema(schema.get('inputs', []))['properties'])
    for model in models:
      # Match JS truthiness for the legacy stop field, including empty arrays/objects.
      stop = result.get('stop') if isinstance(result, dict) else None
      if isinstance(stop, (dict, list)) or bool(stop):
        break
      func = funcs[model.get('name', 'model')]
      if model.get('container') == 'args':
        args = [result.get(name) for name in input_names] if isinstance(result, dict) else (
          result if isinstance(result, list) and result else [result])
        value = func(*args)
      elif isinstance(result, dict):
        # Invocation context lives outside data; only legacy endpoints filter undeclared _jsee.
        value = func(**_filter_kwargs(func, result, legacy_metadata=False))
      else:
        value = func(result)
      if inspect.isawaitable(value):
        value = await value
      if inspect.isgenerator(value) or inspect.isasyncgen(value):
        if inspect.isasyncgen(value):
          await value.aclose()
        else:
          value.close()
        code = 'JSEE_CAPABILITY_UNSUPPORTED'
        raise ValueError('Streaming results require a streaming invocation interface')
      # None corresponds to JS null, not undefined; records alone merge across stages.
      result = {**result, **value} if isinstance(result, dict) and isinstance(value, dict) else value
    return {'runId': run_id, 'status': 'succeeded', 'result': result}
  except Exception as error:
    return {'runId': run_id, 'status': 'failed', 'error': {'code': code, 'message': str(error)}}


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


def _sse_frames(result, outputs=None):
  try:
    with closing(_iter_model_result(result)) as chunks:
      for chunk in chunks:
        yield 'data: {}\n\n'.format(json.dumps(_serialize_result(chunk, outputs))).encode('utf-8')
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


def _read_request_body(stream, content_length, limit):
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
  return body


def _read_request_inputs(inputs, stream, content_type, content_length, limit, *, json_only=False, validate_inputs=True):
  if json_only and content_type.split(';')[0].strip().lower() != 'application/json':
    raise _RequestError('Canonical /run accepts application/json', 415)
  body = _read_request_body(stream, content_length, limit)
  try:
    if json_only:
      def reject_constant(value):
        raise ValueError('Non-finite JSON number: ' + value)
      data = json.loads(body.decode('utf-8') or '{}', parse_constant=reject_constant)
    else:
      data = _parse_multipart(content_type, body) if 'multipart/form-data' in content_type else json.loads(body or b'{}')
    return _prepare_inputs(inputs, data) if validate_inputs else data
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


def _serialize_value(value, output_type=None):
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
  if output_type != 'scores' and isinstance(value, list) and value and isinstance(value[0], dict):
    return _to_table_format(value)
  return value


def _finite_json_numbers(value):
  # Match JSON.stringify without changing the existing table/output shape conversions.
  if isinstance(value, float) and not math.isfinite(value):
    return None
  if isinstance(value, dict):
    return {key: _finite_json_numbers(item) for key, item in value.items()}
  if isinstance(value, (list, tuple)):
    return [_finite_json_numbers(item) for item in value]
  return value


def _serialize_result(result, outputs=None):
  """Serialize a function result for JSON response.

  Handles: dict, tuple, list, bytes, PIL Image, list-of-dicts, primitives.
  """
  declared = _flatten_outputs(outputs)
  types = {}
  for output in declared:
    names = [output['name'], re.sub(r'[^a-z0-9_]', '_', output['name'].lower())]
    aliases = output.get('alias', [])
    names.extend([aliases] if isinstance(aliases, str) else aliases)
    for name in names:
      types[name] = output.get('type')
  # Declared scores keep their row contract; undeclared lists retain legacy table conversion.
  if isinstance(result, dict):
    return _finite_json_numbers({k: _serialize_value(v, types.get(k)) for k, v in result.items()})
  # Tuple — convert to list
  if isinstance(result, tuple):
    return {'result': _finite_json_numbers([_serialize_value(v) for v in result])}
  # Top-level value
  serialized = _serialize_value(result, declared[0].get('type') if len(declared) == 1 else None)
  if serialized is not result:
    return {'result': _finite_json_numbers(serialized)}
  return {'result': _finite_json_numbers(result)}


def _prepare_app(target, host, port, options):
  """Own model loading and descriptor normalization for HTTP and WSGI."""
  funcs = {}
  schema_cwd = '.'

  if isinstance(target, str):
    # Path to schema.json
    schema_cwd = os.path.dirname(os.path.abspath(target))
    with open(target, 'r') as f:
      schema = json.load(f)
  elif isinstance(target, dict):
    schema = copy.deepcopy(target)
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
    if options.get('canonical'):
      from .transport import inspect_schema
      description = inspect_schema(schema)
      if not description['capabilities']['invoke']:
        raise ValueError(description['capabilities']['reason'])
      stage_models = schema.get('model', [])
      stage_models = [stage_models] if isinstance(stage_models, dict) else stage_models
      if any(model.get('name', 'model') == 'run' for model in stage_models):
        raise ValueError('Model endpoint /run conflicts with canonical /run; rename the model or use legacy serving')
    funcs = _load_model_func(schema, schema_cwd)
  elif options.get('canonical'):
    raise ValueError('Canonical serving requires a descriptor with local model files')

  # The callable contract retains source URLs; the GUI copy points to per-stage HTTP endpoints.
  source_schema = copy.deepcopy(schema)

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

  if options.get('canonical'):
    schema['model'] = [{'name': 'computation', 'type': 'post', 'url': '/run', 'worker': False, 'autorun': False, '_jseeCanonical': True}]

  return schema, funcs, models, schema_cwd, source_schema


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
  from .host_policy import from_options
  policy = from_options(kwargs)
  max_body_bytes = _check_body_limit(max_body_bytes)
  schema, funcs, models, schema_cwd, source_schema = _prepare_app(target, host, port, kwargs)
  computation = None
  if kwargs.get('canonical'):
    from .transport import ComputationService, ARTIFACT_LIMIT
    computation = ComputationService(source_schema, funcs, schema_cwd, max_body_bytes,
                                     kwargs.get('max_artifact_bytes', ARTIFACT_LIMIT))
    computation.openapi = policy.openapi(computation.openapi)

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
    def parse_request(self):
      if not super().parse_request():
        return False
      status, self.policy_headers, error = policy.evaluate(self.command, {k.lower(): v for k, v in self.headers.items()})
      if status is None:
        return True
      self.close_connection = True  # Rejected bodies remain unread; never reuse this connection.
      if status == 204:
        self.send_response(status)
        self.end_headers()
      else:
        self._send_json({'error': error}, status)
      return False

    def send_header(self, name, value):
      if name.lower() not in {k.lower() for k in getattr(self, 'policy_headers', {})}:
        super().send_header(name, value)

    def end_headers(self):
      for name, value in getattr(self, 'policy_headers', {}).items():
        super().send_header(name, value)
      super().end_headers()

    def log_message(self, format, *args):
      pass

    def _send_json(self, data, status=200):
      body = json.dumps(data).encode('utf-8')
      self.send_response(status)
      self.send_header('Content-Type', 'application/json; charset=utf-8')
      self.send_header('Content-Length', str(len(body)))
      self.end_headers()
      if self.command != 'HEAD':
        self.wfile.write(body)

    def _send_error(self, msg, status=400):
      self._send_json({'error': msg}, status)

    def _canonical(self):
      if computation is None:
        return False
      response = computation.dispatch(self.command, self.path,
          self.headers.get('Content-Type', ''), self.headers.get('Content-Length'), self.rfile)
      if response is None:
        return False
      status, headers, body = response
      if status >= 400:
        self.close_connection = True
      self.send_response(status)
      for key, value in headers:
        self.send_header(key, value)
      self.end_headers()
      self.wfile.write(body)
      return True

    def do_GET(self):
      if self._canonical():
        return
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
        return self._send_json(policy.openapi(generate_openapi_spec(schema)))

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
      if self._canonical():
        return
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
          self.end_headers()
          try:
            def _write_frame(frame):
              self.wfile.write(frame)
              self.wfile.flush()
            _stream_sse_result(_sse_frames(result, schema.get('outputs')), _write_frame)
          except (BrokenPipeError, ConnectionResetError):
            pass
        else:
          self._send_json(_serialize_result(result, schema.get('outputs')))
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
  finally:
    server.server_close()
    if computation:
      computation.close()


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
  from .host_policy import from_options
  policy = from_options(kwargs)
  host = kwargs.pop('host', '127.0.0.1')
  port = kwargs.pop('port', 5050)
  max_body_bytes = _check_body_limit(kwargs.pop('max_body_bytes', DEFAULT_MAX_BODY_BYTES))
  schema, funcs, models, schema_cwd, source_schema = _prepare_app(target, host, port, kwargs)
  computation = None
  if kwargs.get('canonical'):
    from .transport import ComputationService, ARTIFACT_LIMIT
    computation = ComputationService(source_schema, funcs, schema_cwd, max_body_bytes,
                                     kwargs.get('max_artifact_bytes', ARTIFACT_LIMIT))
    computation.openapi = policy.openapi(computation.openapi)

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
    incoming = {k[5:].lower().replace('_', '-'): v for k, v in environ.items() if k.startswith('HTTP_')}
    status, policy_headers, error = policy.evaluate(environ.get('REQUEST_METHOD', 'GET'), incoming,
                                                    environ.get('wsgi.url_scheme', 'http'))
    original_start = start_response
    def start_response(code, headers, exc_info=None):
      # One owner overrides route/cache headers without wrapping the response iterable.
      owned = {k.lower() for k in policy_headers}
      combined = [(k, v) for k, v in headers if k.lower() not in owned] + list(policy_headers.items())
      return original_start(code, combined, exc_info) if exc_info is not None else original_start(code, combined)
    if status is not None:
      from http import HTTPStatus
      body = b'' if status == 204 else json.dumps({'error': error}).encode('utf-8')
      start_response('{} {}'.format(status, HTTPStatus(status).phrase),
                     [('Content-Type', 'application/json'), ('Content-Length', str(len(body)))])
      return [b'' if environ.get('REQUEST_METHOD') == 'HEAD' else body]
    method = environ.get('REQUEST_METHOD', 'GET')
    path_info = environ.get('PATH_INFO', '/').rstrip('/') or '/'
    if computation:
      response = computation.dispatch(method, path_info + ('?' + environ['QUERY_STRING'] if environ.get('QUERY_STRING') else ''), environ.get('CONTENT_TYPE', ''),
                                      environ.get('CONTENT_LENGTH'), environ.get('wsgi.input'))
      if response is not None:
        from http import HTTPStatus
        status, headers, body = response
        start_response('{} {}'.format(status, HTTPStatus(status).phrase), headers)
        return [body]

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
        ])
        return [body]

      if path_info == '/api/openapi.json':
        body = json.dumps(policy.openapi(generate_openapi_spec(schema))).encode('utf-8')
        start_response('200 OK', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
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
        ])
        return [body]

      try:
        result = _call_model_func(funcs[model_name_req], data)
        if inspect.isgenerator(result) or inspect.isasyncgen(result):
          start_response('200 OK', [
            ('Content-Type', 'text/event-stream; charset=utf-8'),
            ('Cache-Control', 'no-cache'),
          ])
          return _sse_frames(result, schema.get('outputs'))
        body = json.dumps(_serialize_result(result, schema.get('outputs'))).encode('utf-8')
        start_response('200 OK', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
        ])
        return [body]
      except Exception as e:
        body = json.dumps({'error': str(e)}).encode('utf-8')
        start_response('500 Internal Server Error', [
          ('Content-Type', 'application/json; charset=utf-8'),
          ('Content-Length', str(len(body))),
        ])
        return [body]

    start_response('405 Method Not Allowed', [('Content-Type', 'text/plain')])
    return [b'Method Not Allowed']

  if computation:
    app.close = computation.close
  return app
