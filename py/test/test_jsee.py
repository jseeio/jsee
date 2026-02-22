"""Tests for jsee Python package — schema generation, API, and server."""

import json
import os
import sys
import threading
import time
import tempfile
import subprocess
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
        assert _type_hint_to_jsee(int) == 'int'

    def test_float(self):
        assert _type_hint_to_jsee(float) == 'float'

    def test_bool(self):
        assert _type_hint_to_jsee(bool) == 'checkbox'

    def test_str(self):
        assert _type_hint_to_jsee(str) == 'string'

    def test_unknown(self):
        assert _type_hint_to_jsee(list) == 'string'


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
# Server integration tests
# ---------------------------------------------------------------------------

def _start_server(target, port):
    """Start server in background thread, wait for it to be ready."""
    t = threading.Thread(target=serve, args=(target,), kwargs={'port': port}, daemon=True)
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
