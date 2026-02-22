"""Tests for jsee Python package — schema generation, API, and server."""

import datetime
import enum
import json
import os
import sys
import threading
import time
import tempfile
import subprocess
from typing import Annotated, Literal, Optional
from urllib.request import urlopen, Request
from urllib.error import HTTPError

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from jsee.jsee import (
    generate_schema,
    jsee_inputs_to_json_schema,
    generate_openapi_spec,
    _find_runtime,
    _type_hint_to_jsee,
    serve,
)
from jsee.types import Slider, Text, Radio, Select, MultiSelect, Range, Color


# ---------------------------------------------------------------------------
# Test functions used across tests
# ---------------------------------------------------------------------------

def add(x: int, y: int = 1) -> int:
    return x + y

def multiply(a: float, b: float = 2.0) -> float:
    return a * b

def greet(name: str, loud: bool = False) -> str:
    return name.upper() if loud else name

def no_hints(x, y):
    return str(x) + str(y)

def returns_dict(a: int, b: int) -> dict:
    return {'sum': a + b, 'product': a * b}


# ---------------------------------------------------------------------------
# Schema generation
# ---------------------------------------------------------------------------

class TestGenerateSchema:
    def test_basic_function(self):
        schema = generate_schema(add)
        assert schema['model']['name'] == 'add'
        assert schema['model']['type'] == 'post'
        assert schema['model']['worker'] is False
        assert len(schema['inputs']) == 2
        assert schema['inputs'][0] == {'name': 'x', 'type': 'int'}
        assert schema['inputs'][1] == {'name': 'y', 'type': 'int', 'default': 1}

    def test_float_types(self):
        schema = generate_schema(multiply)
        assert schema['inputs'][0]['type'] == 'float'
        assert schema['inputs'][1]['type'] == 'float'
        assert schema['inputs'][1]['default'] == 2.0

    def test_bool_type(self):
        schema = generate_schema(greet)
        assert schema['inputs'][0]['type'] == 'string'
        assert schema['inputs'][1]['type'] == 'checkbox'
        assert schema['inputs'][1]['default'] is False

    def test_no_type_hints(self):
        schema = generate_schema(no_hints)
        assert schema['inputs'][0]['type'] == 'string'
        assert schema['inputs'][1]['type'] == 'string'

    def test_model_url_includes_host_port(self):
        schema = generate_schema(add, host='127.0.0.1', port=9090)
        assert '127.0.0.1' in schema['model']['url']
        assert '9090' in schema['model']['url']


# ---------------------------------------------------------------------------
# Type hint mapping
# ---------------------------------------------------------------------------

class TestTypeHintToJsee:
    def test_int(self):
        assert _type_hint_to_jsee(int) == ('int', {})

    def test_float(self):
        assert _type_hint_to_jsee(float) == ('float', {})

    def test_bool(self):
        assert _type_hint_to_jsee(bool) == ('checkbox', {})

    def test_str(self):
        assert _type_hint_to_jsee(str) == ('string', {})

    def test_unknown(self):
        assert _type_hint_to_jsee(list) == ('string', {})

    def test_date(self):
        assert _type_hint_to_jsee(datetime.date) == ('date', {})

    def test_literal(self):
        t, extra = _type_hint_to_jsee(Literal['fast', 'slow'])
        assert t == 'select'
        assert extra == {'options': ['fast', 'slow']}

    def test_enum(self):
        class Season(enum.Enum):
            SPRING = 'spring'
            SUMMER = 'summer'
        t, extra = _type_hint_to_jsee(Season)
        assert t == 'select'
        assert extra == {'options': ['spring', 'summer']}

    def test_optional_unwrap(self):
        t, extra = _type_hint_to_jsee(Optional[int])
        assert t == 'int'
        assert extra == {}

    def test_annotated_slider(self):
        t, extra = _type_hint_to_jsee(Annotated[float, Slider(0, 1, 0.01)])
        assert t == 'slider'
        assert extra == {'min': 0, 'max': 1, 'step': 0.01}

    def test_annotated_text(self):
        t, extra = _type_hint_to_jsee(Annotated[str, Text()])
        assert t == 'text'

    def test_annotated_radio(self):
        t, extra = _type_hint_to_jsee(Annotated[str, Radio(['a', 'b'])])
        assert t == 'radio'
        assert extra == {'options': ['a', 'b']}

    def test_annotated_select(self):
        t, extra = _type_hint_to_jsee(Annotated[str, Select(['x', 'y'])])
        assert t == 'select'
        assert extra == {'options': ['x', 'y']}

    def test_annotated_multi_select(self):
        t, extra = _type_hint_to_jsee(Annotated[str, MultiSelect(['a', 'b'])])
        assert t == 'multi-select'
        assert extra == {'options': ['a', 'b']}

    def test_annotated_range(self):
        t, extra = _type_hint_to_jsee(Annotated[float, Range(0, 100, 5)])
        assert t == 'range'
        assert extra == {'min': 0, 'max': 100, 'step': 5}

    def test_annotated_color(self):
        t, extra = _type_hint_to_jsee(Annotated[str, Color()])
        assert t == 'color'


# ---------------------------------------------------------------------------
# JSON Schema conversion
# ---------------------------------------------------------------------------

class TestJseeInputsToJsonSchema:
    def test_basic(self):
        inputs = [
            {'name': 'x', 'type': 'int'},
            {'name': 'y', 'type': 'float', 'default': 1.5},
        ]
        result = jsee_inputs_to_json_schema(inputs)
        assert result['type'] == 'object'
        assert result['properties']['x']['type'] == 'integer'
        assert result['properties']['y']['type'] == 'number'
        assert result['properties']['y']['default'] == 1.5
        assert 'x' in result['required']
        assert 'y' not in result['required']

    def test_bool_types(self):
        for t in ('bool', 'checkbox', 'toggle'):
            inputs = [{'name': 'flag', 'type': t}]
            result = jsee_inputs_to_json_schema(inputs)
            assert result['properties']['flag']['type'] == 'boolean'

    def test_select_with_options(self):
        inputs = [{'name': 'color', 'type': 'select', 'options': ['red', 'blue']}]
        result = jsee_inputs_to_json_schema(inputs)
        assert result['properties']['color']['type'] == 'string'
        assert result['properties']['color']['enum'] == ['red', 'blue']

    def test_slider(self):
        inputs = [{'name': 'val', 'type': 'slider', 'min': 0, 'max': 100, 'step': 5}]
        result = jsee_inputs_to_json_schema(inputs)
        prop = result['properties']['val']
        assert prop['type'] == 'number'
        assert prop['minimum'] == 0
        assert prop['maximum'] == 100
        assert prop['multipleOf'] == 5

    def test_range(self):
        inputs = [{'name': 'r', 'type': 'range'}]
        result = jsee_inputs_to_json_schema(inputs)
        prop = result['properties']['r']
        assert prop['type'] == 'array'
        assert prop['minItems'] == 2
        assert prop['maxItems'] == 2

    def test_multi_select(self):
        inputs = [{'name': 'tags', 'type': 'multi-select', 'options': ['a', 'b']}]
        result = jsee_inputs_to_json_schema(inputs)
        prop = result['properties']['tags']
        assert prop['type'] == 'array'
        assert prop['items']['enum'] == ['a', 'b']

    def test_description(self):
        inputs = [{'name': 'x', 'type': 'string', 'description': 'A value'}]
        result = jsee_inputs_to_json_schema(inputs)
        assert result['properties']['x']['description'] == 'A value'

    def test_empty_inputs(self):
        result = jsee_inputs_to_json_schema([])
        assert result['properties'] == {}
        assert result['required'] == []

    def test_none_inputs(self):
        result = jsee_inputs_to_json_schema(None)
        assert result['properties'] == {}


# ---------------------------------------------------------------------------
# OpenAPI spec generation
# ---------------------------------------------------------------------------

class TestGenerateOpenAPISpec:
    def test_basic(self):
        schema = generate_schema(add)
        spec = generate_openapi_spec(schema)
        assert spec['openapi'] == '3.1.0'
        assert spec['info']['title'] == 'add'
        assert '/add' in spec['paths']
        path = spec['paths']['/add']
        assert 'post' in path
        assert path['post']['operationId'] == 'add'
        body_schema = path['post']['requestBody']['content']['application/json']['schema']
        assert 'x' in body_schema['properties']
        assert 'y' in body_schema['properties']

    def test_title_from_page(self):
        schema = {'model': {'name': 'test'}, 'page': {'title': 'My App'}, 'inputs': []}
        spec = generate_openapi_spec(schema)
        assert spec['info']['title'] == 'My App'

    def test_title_fallback(self):
        schema = {'model': [], 'inputs': []}
        spec = generate_openapi_spec(schema)
        assert spec['info']['title'] == 'JSEE API'


# ---------------------------------------------------------------------------
# Runtime discovery
# ---------------------------------------------------------------------------

class TestFindRuntime:
    def test_finds_runtime(self):
        path = _find_runtime()
        assert path is not None
        assert path.endswith('jsee.runtime.js')
        assert os.path.isfile(path)


# ---------------------------------------------------------------------------
# Richer schema generation
# ---------------------------------------------------------------------------

class TestSchemaEnhancements:
    def test_literal_generates_select(self):
        def fn(mode: Literal['fast', 'slow'] = 'fast') -> str:
            return mode
        schema = generate_schema(fn)
        inp = schema['inputs'][0]
        assert inp['type'] == 'select'
        assert inp['options'] == ['fast', 'slow']
        assert inp['default'] == 'fast'

    def test_annotated_slider(self):
        def fn(temp: Annotated[float, Slider(0, 1, 0.1)] = 0.7) -> float:
            return temp
        schema = generate_schema(fn)
        inp = schema['inputs'][0]
        assert inp['type'] == 'slider'
        assert inp['min'] == 0
        assert inp['max'] == 1
        assert inp['step'] == 0.1
        assert inp['default'] == 0.7

    def test_enum_generates_select(self):
        class Color(enum.Enum):
            RED = 'red'
            GREEN = 'green'
        def fn(c: Color = Color.RED) -> str:
            return c.value
        schema = generate_schema(fn)
        inp = schema['inputs'][0]
        assert inp['type'] == 'select'
        assert inp['options'] == ['red', 'green']
        assert inp['default'] == 'red'

    def test_title_kwarg(self):
        schema = generate_schema(add, title='My Calculator')
        assert schema['model']['title'] == 'My Calculator'

    def test_description_from_docstring(self):
        def fn(x: int) -> int:
            """Multiply by two"""
            return x * 2
        schema = generate_schema(fn)
        assert schema['model']['description'] == 'Multiply by two'
        assert schema['page']['description'] == 'Multiply by two'

    def test_description_kwarg_overrides_docstring(self):
        def fn(x: int) -> int:
            """Docstring text"""
            return x * 2
        schema = generate_schema(fn, description='Custom desc')
        assert schema['model']['description'] == 'Custom desc'

    def test_examples_kwarg(self):
        schema = generate_schema(add, examples=[{'x': 1, 'y': 2}])
        assert schema['examples'] == [{'x': 1, 'y': 2}]

    def test_reactive_kwarg(self):
        schema = generate_schema(add, reactive=True)
        assert schema['reactive'] is True

    def test_no_reactive_by_default(self):
        schema = generate_schema(add)
        assert 'reactive' not in schema


# ---------------------------------------------------------------------------
# Server integration tests
# ---------------------------------------------------------------------------

def _start_server(target, port, **kwargs):
    """Start server in background thread, wait for it to be ready."""
    kw = {'port': port}
    kw.update(kwargs)
    t = threading.Thread(target=serve, args=(target,), kwargs=kw, daemon=True)
    t.start()
    # Wait for server to start
    for _ in range(30):
        try:
            urlopen('http://localhost:{}/api'.format(port), timeout=1)
            return t
        except Exception:
            time.sleep(0.1)
    raise RuntimeError('Server did not start')


class TestServerWithFunction:
    @classmethod
    def setup_class(cls):
        cls.port = 15051
        cls.thread = _start_server(add, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_gui_serves_html(self):
        resp = urlopen(self.base + '/')
        html = resp.read().decode()
        assert '<!DOCTYPE html>' in html
        assert '/static/jsee.runtime.js' in html
        assert 'add' in html

    def test_runtime_js_served_locally(self):
        resp = urlopen(self.base + '/static/jsee.runtime.js')
        js = resp.read()
        assert len(js) > 10000  # runtime is ~300KB

    def test_api_discovery(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        assert 'schema' in data
        assert 'models' in data
        assert len(data['models']) == 1
        assert data['models'][0]['name'] == 'add'
        assert data['models'][0]['endpoint'] == '/add'
        assert data['models'][0]['method'] == 'POST'

    def test_openapi_spec(self):
        resp = urlopen(self.base + '/api/openapi.json')
        spec = json.loads(resp.read())
        assert spec['openapi'] == '3.1.0'
        assert '/add' in spec['paths']
        props = spec['paths']['/add']['post']['requestBody']['content']['application/json']['schema']['properties']
        assert 'x' in props
        assert props['x']['type'] == 'integer'

    def test_post_model(self):
        req = Request(
            self.base + '/add',
            data=json.dumps({'x': 3, 'y': 4}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'] == 7

    def test_post_model_with_default(self):
        req = Request(
            self.base + '/add',
            data=json.dumps({'x': 10}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'] == 11

    def test_post_returns_dict(self):
        """When function returns a dict, it's returned directly (not wrapped)."""
        pass  # Tested in TestServerWithDictReturn

    def test_post_unknown_model_404(self):
        req = Request(
            self.base + '/nonexistent',
            data=b'{}',
            headers={'Content-Type': 'application/json'}
        )
        try:
            urlopen(req)
            assert False, 'Should have raised'
        except HTTPError as e:
            assert e.code == 404

    def test_post_invalid_json_400(self):
        req = Request(
            self.base + '/add',
            data=b'not json',
            headers={'Content-Type': 'application/json'}
        )
        try:
            urlopen(req)
            assert False, 'Should have raised'
        except HTTPError as e:
            assert e.code == 400

    def test_post_wrong_args_500(self):
        req = Request(
            self.base + '/add',
            data=json.dumps({'wrong': 1}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        try:
            urlopen(req)
            assert False, 'Should have raised'
        except HTTPError as e:
            assert e.code == 500

    def test_cors_headers(self):
        resp = urlopen(self.base + '/api')
        assert resp.headers.get('Access-Control-Allow-Origin') == '*'

    def test_404_for_unknown_path(self):
        try:
            urlopen(self.base + '/nonexistent/path')
            assert False, 'Should have raised'
        except HTTPError as e:
            assert e.code == 404


class TestServerWithDictReturn:
    @classmethod
    def setup_class(cls):
        cls.port = 15052
        cls.thread = _start_server(returns_dict, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_dict_returned_directly(self):
        req = Request(
            self.base + '/returns_dict',
            data=json.dumps({'a': 3, 'b': 4}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['sum'] == 7
        assert result['product'] == 12


class TestServerWithSchema:
    @classmethod
    def setup_class(cls):
        cls.port = 15053
        cls.tmpdir = tempfile.mkdtemp()
        # Write a model file
        model_path = os.path.join(cls.tmpdir, 'mymodel.py')
        with open(model_path, 'w') as f:
            f.write('def mymodel(a: int, b: int = 1) -> int:\n    return a * b\n')
        # Write schema.json
        schema = {
            'model': {
                'name': 'mymodel',
                'url': 'mymodel.py',
                'type': 'function'
            },
            'inputs': [
                {'name': 'a', 'type': 'int'},
                {'name': 'b', 'type': 'int', 'default': 1}
            ]
        }
        schema_path = os.path.join(cls.tmpdir, 'schema.json')
        with open(schema_path, 'w') as f:
            json.dump(schema, f)
        cls.thread = _start_server(schema_path, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_api_discovery(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        assert data['models'][0]['name'] == 'mymodel'

    def test_post_model(self):
        req = Request(
            self.base + '/mymodel',
            data=json.dumps({'a': 5, 'b': 3}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'] == 15

    def test_openapi_spec(self):
        resp = urlopen(self.base + '/api/openapi.json')
        spec = json.loads(resp.read())
        assert '/mymodel' in spec['paths']


# ---------------------------------------------------------------------------
# CLI tests
# ---------------------------------------------------------------------------

PY_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

def _cli_env():
    env = os.environ.copy()
    env['PYTHONPATH'] = PY_ROOT + os.pathsep + env.get('PYTHONPATH', '')
    return env


class TestCLI:
    def test_cli_function_mode(self):
        """CLI starts server from function, responds to API call."""
        port = 15054
        example_path = os.path.join(os.path.dirname(__file__), '..', 'example.py')
        cli_path = os.path.join(os.path.dirname(__file__), '..', 'bin', 'jsee')
        proc = subprocess.Popen(
            [sys.executable, cli_path, example_path, 'sum', '--port', str(port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=os.path.dirname(example_path),
            env=_cli_env(),
        )
        try:
            # Wait for server to start
            for _ in range(30):
                try:
                    urlopen('http://localhost:{}/api'.format(port), timeout=1)
                    break
                except Exception:
                    time.sleep(0.1)
            # Test API call
            req = Request(
                'http://localhost:{}/sum'.format(port),
                data=json.dumps({'x': 10, 'y': 20}).encode(),
                headers={'Content-Type': 'application/json'}
            )
            resp = urlopen(req)
            result = json.loads(resp.read())
            assert result['result'] == 30
        finally:
            proc.terminate()
            proc.wait()

    def test_cli_schema_mode(self):
        """CLI starts server from schema.json."""
        port = 15055
        tmpdir = tempfile.mkdtemp()
        model_path = os.path.join(tmpdir, 'calc.py')
        with open(model_path, 'w') as f:
            f.write('def calc(a: int, b: int = 1) -> int:\n    return a + b\n')
        schema = {
            'model': {'name': 'calc', 'url': 'calc.py', 'type': 'function'},
            'inputs': [
                {'name': 'a', 'type': 'int'},
                {'name': 'b', 'type': 'int', 'default': 1}
            ]
        }
        schema_path = os.path.join(tmpdir, 'schema.json')
        with open(schema_path, 'w') as f:
            json.dump(schema, f)
        cli_path = os.path.join(os.path.dirname(__file__), '..', 'bin', 'jsee')
        proc = subprocess.Popen(
            [sys.executable, cli_path, schema_path, '--port', str(port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=tmpdir,
            env=_cli_env(),
        )
        try:
            for _ in range(30):
                try:
                    urlopen('http://localhost:{}/api'.format(port), timeout=1)
                    break
                except Exception:
                    time.sleep(0.1)
            req = Request(
                'http://localhost:{}/calc'.format(port),
                data=json.dumps({'a': 7, 'b': 3}).encode(),
                headers={'Content-Type': 'application/json'}
            )
            resp = urlopen(req)
            result = json.loads(resp.read())
            assert result['result'] == 10
        finally:
            proc.terminate()
            proc.wait()

    def test_cli_missing_function_name(self):
        """CLI exits with error when .py file given without function name."""
        cli_path = os.path.join(os.path.dirname(__file__), '..', 'bin', 'jsee')
        example_path = os.path.join(os.path.dirname(__file__), '..', 'example.py')
        proc = subprocess.run(
            [sys.executable, cli_path, example_path],
            capture_output=True,
            text=True,
            env=_cli_env(),
        )
        assert proc.returncode != 0
        assert 'function name required' in proc.stderr


# ---------------------------------------------------------------------------
# Tuple return handling
# ---------------------------------------------------------------------------

class TestServerWithTupleReturn:
    @classmethod
    def setup_class(cls):
        def multi(x: int) -> tuple:
            return (x, x * 2)
        cls.port = 15060
        cls.thread = _start_server(multi, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_tuple_returned_as_list(self):
        req = Request(
            self.base + '/multi',
            data=json.dumps({'x': 5}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'] == [5, 10]


# ---------------------------------------------------------------------------
# Image output serialization
# ---------------------------------------------------------------------------

class TestServerWithBytesReturn:
    @classmethod
    def setup_class(cls):
        def make_image(width: int = 1) -> bytes:
            return b'\x89PNG\r\n\x1a\n' + b'\x00' * width
        cls.port = 15061
        cls.thread = _start_server(make_image, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_bytes_returned_as_base64(self):
        req = Request(
            self.base + '/make_image',
            data=json.dumps({'width': 4}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'].startswith('data:image/png;base64,')


# ---------------------------------------------------------------------------
# Serve with kwargs
# ---------------------------------------------------------------------------

class TestServerWithKwargs:
    @classmethod
    def setup_class(cls):
        def calc(a: float, b: float = 1) -> float:
            """A calculator"""
            return a + b
        cls.port = 15062
        cls.thread = _start_server(
            calc, cls.port,
        )
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_schema_has_description(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        assert data['schema']['model']['description'] == 'A calculator'


class TestServerWithLiteralInput:
    @classmethod
    def setup_class(cls):
        def choose(mode: Literal['add', 'sub'], x: int = 1) -> int:
            return x if mode == 'add' else -x
        cls.port = 15063
        cls.thread = _start_server(choose, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_literal_input_in_schema(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        inp = data['schema']['inputs'][0]
        assert inp['type'] == 'select'
        assert inp['options'] == ['add', 'sub']

    def test_literal_input_post(self):
        req = Request(
            self.base + '/choose',
            data=json.dumps({'mode': 'sub', 'x': 5}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'] == -5
