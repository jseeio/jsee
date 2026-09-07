"""Tests for jsee Python package — schema generation, API, and server."""

import datetime
import asyncio
import enum
import io
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
    _stream_sse_result,
    generate_schema,
    jsee_inputs_to_json_schema,
    _prepare_inputs,
    generate_openapi_spec,
    _find_runtime,
    _type_hint_to_jsee,
    _return_hint_to_output,
    _serialize_result,
    _to_table_format,
    create_app,
    serve,
)
from jsee.types import (
    Slider, Text, Radio, Select, MultiSelect, Range, Color,
    Markdown, Html, Code, Image, Table, Svg, File,
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
        assert extra == {'nullable': True}

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
    @pytest.mark.parametrize('case', json.load(open(os.path.join(
        os.path.dirname(__file__), '../../test/fixtures/input-validation.json'
    ))), ids=lambda case: case['name'])
    def test_shared_input_validation(self, case):
        original = json.dumps(case['data'])
        if 'error' in case:
            with pytest.raises(ValueError, match=case['error']):
                _prepare_inputs(case['inputs'], case['data'])
        else:
            assert _prepare_inputs(case['inputs'], case['data']) == case['expected']
        assert json.dumps(case['data']) == original

    @pytest.mark.parametrize('case', json.load(open(os.path.join(
        os.path.dirname(__file__), '../../test/fixtures/input-contracts.json'
    ))), ids=lambda case: case['name'])
    def test_shared_input_contracts(self, case):
        assert jsee_inputs_to_json_schema(case['inputs']) == case['expected']

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

    def test_output_multipart_sse_error_and_example_schemas(self):
        schema = {
            'title': 'Analysis API',
            'model': {'name': 'analyze', 'type': 'post', 'stream': True},
            'inputs': [
                {'name': 'x', 'type': 'int'},
                {'name': 'upload', 'type': 'file'},
            ],
            'outputs': [
                {'name': 'summary', 'type': 'markdown'},
                {'name': 'score', 'type': 'number'},
                {'name': 'rows', 'type': 'table'},
                {
                    'name': 'assets',
                    'type': 'group',
                    'elements': [
                        {'name': 'report', 'type': 'pdf'},
                    ],
                },
            ],
            'examples': [{'x': 3}],
        }

        spec = generate_openapi_spec(schema)
        operation = spec['paths']['/analyze']['post']
        request_content = operation['requestBody']['content']
        response_content = operation['responses']['200']['content']
        response_schema = response_content['application/json']['schema']

        assert request_content['application/json']['examples']['example1']['value'] == {'x': 3}
        assert request_content['multipart/form-data']['schema']['properties']['upload'] == {
            'type': 'string',
            'format': 'binary',
        }
        assert response_schema['properties']['summary'] == {'type': 'string'}
        assert response_schema['properties']['score'] == {'type': 'number'}
        assert 'oneOf' in response_schema['properties']['rows']
        assert 'oneOf' in response_schema['properties']['report']
        assert 'text/event-stream' in response_content
        assert operation['responses']['400']['content']['application/json']['schema']['properties']['error'] == {'type': 'string'}
        assert 'error' in operation['responses']['500']['content']['application/json']['schema']['required']


# ---------------------------------------------------------------------------
# Runtime discovery
# ---------------------------------------------------------------------------

class TestFindRuntime:
    def test_finds_runtime(self):
        path = _find_runtime()
        assert path is not None
        assert path.endswith('jsee.core.js')
        assert os.path.isfile(path)

    def test_finds_full_bundle_for_chart_output(self):
        schema = {'outputs': [{'name': 'plot', 'type': 'chart'}]}
        path = _find_runtime(schema)
        if path and 'jsee.full.js' in path:
            assert os.path.isfile(path)

    def test_pdf_uses_core_bundle(self):
        schema = {'outputs': [{'name': 'report', 'type': 'pdf'}]}
        path = _find_runtime(schema)
        assert path is not None
        assert path.endswith('jsee.core.js')


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
        assert '/static/jsee.js' in html
        assert 'add' in html

    def test_runtime_js_served_locally(self):
        resp = urlopen(self.base + '/static/jsee.js')
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

    def test_post_wrong_args_400(self):
        req = Request(
            self.base + '/add',
            data=json.dumps({'wrong': 1}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        try:
            urlopen(req)
            assert False, 'Should have raised'
        except HTTPError as e:
            assert e.code == 400
            assert 'x: required' in json.loads(e.read())['error']

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


class TestWsgiKwargFiltering:
    def _post(self, app, path, payload):
        body = json.dumps(payload).encode()
        environ = {
            'REQUEST_METHOD': 'POST',
            'PATH_INFO': path,
            'CONTENT_LENGTH': str(len(body)),
            'CONTENT_TYPE': 'application/json',
            'wsgi.input': io.BytesIO(body),
        }
        captured = {}

        def start_response(status, headers):
            captured['status'] = status
            captured['headers'] = headers

        response = b''.join(app(environ, start_response)).decode()
        return captured['status'], json.loads(response)

    @pytest.mark.parametrize('with_kwargs', [False, True])
    def test_explicit_metadata_parameter_is_preserved(self, with_kwargs):
        def echo(_jsee: str):
            return {'value': _jsee}

        def echo_extra(_jsee: str, **kwargs):
            return {'value': _jsee}

        func = echo_extra if with_kwargs else echo
        app = create_app(func)
        status, result = self._post(app, '/' + func.__name__, {'_jsee': 'business'})
        assert status.startswith('200 '), result
        assert result == {'value': 'business'}

    def test_undeclared_envelope_metadata_is_not_forwarded_to_kwargs(self):
        def echo(**kwargs):
            return kwargs

        status, result = self._post(create_app(echo), '/echo', {'_jsee': 'run', 'value': 42})
        assert status.startswith('200 '), result
        assert result == {'value': 42}

    def test_drops_runtime_caller_for_functions_without_kwargs(self):
        app = create_app(add)

        status, result = self._post(app, '/add', {
            'x': 2,
            'y': 3,
            'caller': 'run'
        })

        assert status.startswith('200 ')
        assert result == {'result': 5}

    def test_chat_history_is_preserved_when_declared(self):
        def chat(message: str, history: list = []) -> str:
            return '{}:{}'.format(len(history), message)

        app = create_app(chat, chat=True)
        status, result = self._post(app, '/chat', {
            'message': 'hello',
            'history': [{'role': 'user', 'content': 'hi'}],
            'caller': 'run'
        })

        assert status.startswith('200 ')
        assert result == {'chat': '1:hello'}


class TestWsgiStaticAndAsync:
    def test_stages_share_a_module_within_one_app_but_not_across_apps(self, tmp_path):
        model = tmp_path / 'stages.py'
        model.write_text('''state = []
def prepare(x=3):
    state.append(x)
    return {'y': x * 2}
def finish(y=0):
    return {'result': y + len(state)}
''')
        schema = {'model': [{'name': 'prepare', 'url': str(model)},
                            {'name': 'finish', 'url': str(tmp_path) + '/./stages.py'}],
                  'inputs': [{'name': 'x', 'type': 'int', 'default': 3}]}
        app = create_app(schema)
        first_status, first = self._request(app, 'POST', '/prepare', {'x': 3})
        assert first_status == '200 OK'
        # The existing browser pipeline merges each response into the prior input record.
        merged = {'x': 3, **json.loads(first)}
        status, body = self._request(app, 'POST', '/finish', merged)
        assert status == '200 OK'
        assert json.loads(body) == {'result': 7}
        other = create_app(schema)
        _, body = self._request(other, 'POST', '/finish', {'y': 6})
        assert json.loads(body) == {'result': 6}

    def test_missing_explicit_model_name_does_not_run_an_unrelated_callable(self, tmp_path):
        model = tmp_path / 'model.py'
        model.write_text('def another():\n    return 42\n')
        with pytest.raises(ValueError, match='missing'):
            create_app({'model': {'name': 'missing', 'url': str(model)}, 'inputs': []})

    def test_duplicate_endpoint_names_fail_before_importing_models(self, tmp_path):
        model = tmp_path / 'model.py'
        model.write_text('raise RuntimeError("model was imported")\n')
        with pytest.raises(ValueError, match='Duplicate model name'):
            create_app({'model': [{'name': 'same', 'url': str(model)},
                                 {'name': 'same', 'url': str(model)}], 'inputs': []})

    def test_unnamed_model_infers_a_local_callable_and_advertises_its_endpoint(self, tmp_path):
        model = tmp_path / 'model.py'
        model.write_text('from pathlib import Path\ndef compute():\n    return 42\n')
        app = create_app({'model': {'url': str(model)}, 'inputs': []})
        status, body = self._request(app, 'POST', '/model', {})
        assert status == '200 OK'
        assert json.loads(body) == {'result': 42}
        status, body = self._request(app, 'GET', '/api')
        assert status == '200 OK'
        assert json.loads(body)['models'] == [{'name': 'model', 'endpoint': '/model', 'method': 'POST'}]

    @pytest.mark.parametrize('n', [99, 'abc', '2', None, 1.5])
    def test_request_validation_matches_advertised_bounds(self, n, tmp_path):
        model = tmp_path / 'bounded.py'
        model.write_text('def bounded(n):\n    return n * 2\n')
        app = create_app({
            'model': {'name': 'bounded', 'url': str(model)},
            'inputs': [{'name': 'n', 'type': 'int', 'min': 1, 'max': 3}],
        })
        body = json.dumps({'n': n}).encode()
        statuses = []
        environ = {'REQUEST_METHOD': 'POST', 'PATH_INFO': '/bounded',
                   'CONTENT_LENGTH': str(len(body)), 'CONTENT_TYPE': 'application/json',
                   'wsgi.input': io.BytesIO(body)}
        response = b''.join(app(environ, lambda status, headers: statuses.append(status)))
        assert statuses == ['400 Bad Request'], response
        assert 'n' in json.loads(response)['error']

    def test_app_creation_does_not_mutate_the_callers_schema(self, tmp_path):
        model = tmp_path / 'model.py'
        model.write_text('def model(x=3):\n    return x * 2\n')
        schema = {'model': {'name': 'model', 'url': str(model)},
                  'inputs': [{'name': 'x', 'type': 'int', 'default': 3}]}
        original = json.dumps(schema)
        create_app(schema)
        assert json.dumps(schema) == original
        create_app(schema)
        assert json.dumps(schema) == original

    @pytest.mark.parametrize('schema_version', [None, 0, 2, '1', True, {}, 1.5])
    def test_rejects_schema_version_before_import(self, schema_version, tmp_path):
        model_path = tmp_path / 'model.py'
        model_path.write_text('raise RuntimeError("model was imported")\n')
        schema = {
            'schemaVersion': schema_version,
            'model': {'name': 'model', 'url': str(model_path)},
            'inputs': [],
        }
        with pytest.raises(ValueError, match='schemaVersion'):
            create_app(schema)

    def test_optional_python_input_accepts_omitted_or_explicit_null(self):
        def optional_limit(limit: Optional[int] = None):
            return {'limit': limit}
        app = create_app(optional_limit)
        for data in ({}, {'limit': None}, {'limit': 4}):
            status, body = self._request(app, 'POST', '/optional_limit', data)
            assert status.startswith('200'), body
            assert json.loads(body) == {'limit': data.get('limit')}
        assert generate_schema(optional_limit)['inputs'][0]['nullable'] is True

    def test_schema_version_one_and_absent_are_equivalent(self):
        for schema in ({'inputs': []}, {'schemaVersion': 1, 'inputs': []}, {'schemaVersion': 1.0, 'inputs': []}):
            app = create_app(schema)
            assert callable(app)

    def _request(self, app, method, path, payload=None):
        body = json.dumps(payload).encode() if payload is not None else b''
        environ = {
            'REQUEST_METHOD': method,
            'PATH_INFO': path,
            'CONTENT_LENGTH': str(len(body)),
            'CONTENT_TYPE': 'application/json',
            'wsgi.input': io.BytesIO(body),
        }
        captured = {}

        def start_response(status, headers):
            captured['status'] = status
            captured['headers'] = headers

        response = b''.join(app(environ, start_response))
        return captured['status'], response

    def _post(self, app, path, payload):
        status, body = self._request(app, 'POST', path, payload)
        return status, json.loads(body.decode())

    def test_static_files_are_root_contained(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = os.path.join(tmpdir, 'app')
            sibling = os.path.join(tmpdir, 'app_evil')
            os.mkdir(root)
            os.mkdir(sibling)
            with open(os.path.join(root, 'schema.json'), 'w') as f:
                json.dump({'model': [], 'inputs': []}, f)
            with open(os.path.join(root, 'public.txt'), 'w') as f:
                f.write('ok')
            with open(os.path.join(root, '.env'), 'w') as f:
                f.write('secret')
            os.mkdir(os.path.join(root, 'node_modules'))
            with open(os.path.join(root, 'node_modules', 'pkg.js'), 'w') as f:
                f.write('module')
            with open(os.path.join(sibling, 'secret.txt'), 'w') as f:
                f.write('leaked')

            app = create_app(os.path.join(root, 'schema.json'))

            status, body = self._request(app, 'GET', '/public.txt')
            assert status.startswith('200 ')
            assert body == b'ok'

            status, _ = self._request(app, 'GET', '/../app_evil/secret.txt')
            assert status.startswith('403 ')

            status, _ = self._request(app, 'GET', '/.env')
            assert status.startswith('403 ')

            status, _ = self._request(app, 'GET', '/node_modules/pkg.js')
            assert status.startswith('403 ')

    def test_async_functions_are_awaited(self):
        async def add_async(x: int) -> dict:
            return {'result': x + 1}

        app = create_app(add_async)
        status, result = self._post(app, '/add_async', {'x': 4})

        assert status.startswith('200 ')
        assert result == {'result': 5}

    def test_async_chat_strings_are_wrapped(self):
        async def chat(message: str, history: list = []) -> str:
            return '{}:{}'.format(len(history), message.upper())

        app = create_app(chat, chat=True)
        status, result = self._post(app, '/chat', {
            'message': 'hello',
            'history': [{'role': 'user', 'content': 'hi'}],
            'caller': 'run'
        })

        assert status.startswith('200 ')
        assert result == {'chat': '1:HELLO'}


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


# ---------------------------------------------------------------------------
# Return type → outputs
# ---------------------------------------------------------------------------

class TestReturnHintToOutput:
    def test_none(self):
        assert _return_hint_to_output(None) is None

    def test_str_returns_none(self):
        """str return — auto-detect is fine, no explicit output."""
        assert _return_hint_to_output(str) is None

    def test_int_returns_none(self):
        assert _return_hint_to_output(int) is None

    def test_list_returns_table(self):
        out = _return_hint_to_output(list)
        assert out == [{'name': 'result', 'type': 'table'}]

    def test_bytes_returns_none_for_runtime_auto_detection(self):
        assert _return_hint_to_output(bytes) is None

    def test_annotated_markdown(self):
        out = _return_hint_to_output(Annotated[str, Markdown()])
        assert out == [{'name': 'result', 'type': 'markdown'}]

    def test_annotated_html(self):
        out = _return_hint_to_output(Annotated[str, Html()])
        assert out == [{'name': 'result', 'type': 'html'}]

    def test_annotated_code(self):
        out = _return_hint_to_output(Annotated[str, Code()])
        assert out == [{'name': 'result', 'type': 'code'}]

    def test_annotated_image(self):
        out = _return_hint_to_output(Annotated[str, Image()])
        assert out == [{'name': 'result', 'type': 'image'}]

    def test_annotated_table(self):
        out = _return_hint_to_output(Annotated[list, Table()])
        assert out == [{'name': 'result', 'type': 'table'}]

    def test_annotated_svg(self):
        out = _return_hint_to_output(Annotated[str, Svg()])
        assert out == [{'name': 'result', 'type': 'svg'}]

    def test_annotated_file_with_filename(self):
        out = _return_hint_to_output(Annotated[str, File('data.csv')])
        assert out == [{'name': 'result', 'type': 'file', 'filename': 'data.csv'}]


# ---------------------------------------------------------------------------
# Schema with outputs
# ---------------------------------------------------------------------------

class TestSchemaOutputs:
    def test_outputs_from_return_annotation(self):
        def fn(x: int) -> Annotated[str, Markdown()]:
            return '# hello'
        schema = generate_schema(fn)
        assert 'outputs' in schema
        assert schema['outputs'] == [{'name': 'result', 'type': 'markdown'}]

    def test_outputs_from_list_return(self):
        def fn(x: int) -> list:
            return [{'a': 1}]
        schema = generate_schema(fn)
        assert schema['outputs'] == [{'name': 'result', 'type': 'table'}]

    def test_outputs_kwarg_dict(self):
        schema = generate_schema(add, outputs={'data': 'table', 'chart': 'image'})
        assert len(schema['outputs']) == 2
        types = {o['name']: o['type'] for o in schema['outputs']}
        assert types == {'data': 'table', 'chart': 'image'}

    def test_outputs_kwarg_with_descriptors(self):
        schema = generate_schema(add, outputs={'result': Table(), 'plot': Image()})
        types = {o['name']: o['type'] for o in schema['outputs']}
        assert types == {'result': 'table', 'plot': 'image'}

    def test_outputs_kwarg_list(self):
        out_list = [{'name': 'md', 'type': 'markdown'}]
        schema = generate_schema(add, outputs=out_list)
        assert schema['outputs'] == out_list

    def test_outputs_kwarg_overrides_return_hint(self):
        def fn(x: int) -> list:
            return [1, 2]
        schema = generate_schema(fn, outputs={'data': 'table'})
        assert schema['outputs'] == [{'name': 'data', 'type': 'table'}]

    def test_no_outputs_for_dict_return(self):
        """dict return — auto-detect works, no explicit outputs needed."""
        def fn(x: int) -> dict:
            return {'a': 1}
        schema = generate_schema(fn)
        assert 'outputs' not in schema

    def test_no_outputs_when_no_return_hint(self):
        schema = generate_schema(add)
        assert 'outputs' not in schema


# ---------------------------------------------------------------------------
# Table format conversion
# ---------------------------------------------------------------------------

class TestToTableFormat:
    def test_list_of_dicts(self):
        data = [{'name': 'Alice', 'age': 30}, {'name': 'Bob', 'age': 25}]
        result = _to_table_format(data)
        assert result == {'columns': ['name', 'age'], 'rows': [['Alice', 30], ['Bob', 25]]}

    def test_empty_list(self):
        assert _to_table_format([]) == []

    def test_list_of_non_dicts(self):
        assert _to_table_format([1, 2, 3]) == [1, 2, 3]


# ---------------------------------------------------------------------------
# Serialize result with nested values
# ---------------------------------------------------------------------------

class TestSerializeResultNested:
    def test_dict_with_list_of_dicts(self):
        result = {'data': [{'a': 1}, {'a': 2}], 'score': 42}
        serialized = _serialize_result(result)
        assert serialized['data'] == {'columns': ['a'], 'rows': [[1], [2]]}
        assert serialized['score'] == 42

    def test_dict_with_bytes_value(self):
        result = {'image': b'\x89PNG\r\n\x1a\n', 'label': 'cat'}
        serialized = _serialize_result(result)
        assert serialized['image'].startswith('data:image/png;base64,')
        assert serialized['label'] == 'cat'

    def test_bytes_mime_sniffing(self):
        cases = [
            (b'%PDF-1.4\n', 'data:application/pdf;base64,'),
            (bytes([0xff, 0xd8, 0xff, 0xe0]), 'data:image/jpeg;base64,'),
            (b'GIF89a', 'data:image/gif;base64,'),
            (b'RIFF\x24\x00\x00\x00WEBPVP8 ', 'data:image/webp;base64,'),
            (b'RIFF\x24\x00\x00\x00WAVEfmt ', 'data:audio/wav;base64,'),
            (bytes([1, 2, 3]), 'data:application/octet-stream;base64,'),
        ]

        for value, prefix in cases:
            assert _serialize_result(value)['result'].startswith(prefix)

    def test_bare_list_of_dicts(self):
        result = [{'x': 1}, {'x': 2}]
        serialized = _serialize_result(result)
        assert serialized['result'] == {'columns': ['x'], 'rows': [[1], [2]]}


# ---------------------------------------------------------------------------
# Server with table output
# ---------------------------------------------------------------------------

class TestServerWithTableOutput:
    @classmethod
    def setup_class(cls):
        def get_data(n: int = 3) -> list:
            return [{'i': i, 'sq': i * i} for i in range(n)]
        cls.port = 15064
        cls.thread = _start_server(get_data, cls.port)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_schema_has_table_output(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        assert 'outputs' in data['schema']
        assert data['schema']['outputs'][0]['type'] == 'table'

    def test_post_returns_table_format(self):
        req = Request(
            self.base + '/get_data',
            data=json.dumps({'n': 2}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['result'] == {'columns': ['i', 'sq'], 'rows': [[0, 0], [1, 1]]}


class TestServerWithOutputsKwarg:
    @classmethod
    def setup_class(cls):
        def analyze(text: str) -> dict:
            return {
                'summary': '**Bold**: ' + text,
                'stats': [{'metric': 'length', 'value': len(text)}]
            }
        cls.port = 15065
        cls.thread = _start_server(
            analyze, cls.port,
            outputs={'summary': 'markdown', 'stats': 'table'}
        )
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_schema_has_declared_outputs(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        outputs = {o['name']: o['type'] for o in data['schema']['outputs']}
        assert outputs == {'summary': 'markdown', 'stats': 'table'}

    def test_post_serializes_nested(self):
        req = Request(
            self.base + '/analyze',
            data=json.dumps({'text': 'hello'}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result['summary'] == '**Bold**: hello'
        assert result['stats'] == {'columns': ['metric', 'value'], 'rows': [['length', 5]]}


# ---------------------------------------------------------------------------
# Chat mode tests
# ---------------------------------------------------------------------------

class TestChatSchema:
    """Tests for chat=True schema generation."""

    def test_chat_schema_has_chat_output(self):
        def chat(message: str, history: list = []) -> str:
            return 'hello'
        schema = generate_schema(chat, chat=True)
        assert schema['outputs'] == [{'name': 'chat', 'type': 'chat'}]

    def test_chat_schema_excludes_history_input(self):
        def chat(message: str, history: list = []) -> str:
            return 'hello'
        schema = generate_schema(chat, chat=True)
        names = [i['name'] for i in schema['inputs']]
        assert 'history' not in names
        assert 'message' in names

    def test_chat_schema_message_has_enter(self):
        def chat(message: str, history: list = []) -> str:
            return 'hello'
        schema = generate_schema(chat, chat=True)
        msg_input = next(i for i in schema['inputs'] if i['name'] == 'message')
        assert msg_input.get('enter') is True

    def test_chat_schema_with_title(self):
        def chat(message: str, history: list = []) -> str:
            """My chatbot"""
            return 'hello'
        schema = generate_schema(chat, chat=True, title='Test Chat')
        assert schema['model']['title'] == 'Test Chat'

    def test_chat_schema_preserves_other_inputs(self):
        def chat(message: str, temperature: float = 0.7, history: list = []) -> str:
            return 'hello'
        schema = generate_schema(chat, chat=True)
        names = [i['name'] for i in schema['inputs']]
        assert 'message' in names
        assert 'temperature' in names
        assert 'history' not in names


class TestServerWithChat:
    """Tests for chat=True server mode."""

    @classmethod
    def setup_class(cls):
        def chat(message: str, history: list = []) -> str:
            prefix = 'Turn {}: '.format(len(history) // 2 + 1)
            return prefix + message.upper()
        cls.port = 15070
        cls.thread = _start_server(chat, cls.port, chat=True)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_chat_schema_in_api(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        outputs = data['schema']['outputs']
        assert len(outputs) == 1
        assert outputs[0]['type'] == 'chat'

    def test_chat_post_wraps_string(self):
        req = Request(
            self.base + '/chat',
            data=json.dumps({'message': 'hello', 'history': []}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result == {'chat': 'Turn 1: HELLO'}

    def test_chat_post_with_history(self):
        history = [
            {'role': 'user', 'content': 'hi'},
            {'role': 'assistant', 'content': 'Turn 1: HI'}
        ]
        req = Request(
            self.base + '/chat',
            data=json.dumps({'message': 'world', 'history': history}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        result = json.loads(resp.read())
        assert result == {'chat': 'Turn 2: WORLD'}


# ---------------------------------------------------------------------------
# SSE / Generator streaming tests
# ---------------------------------------------------------------------------

class TestSchemaWithStream:
    """Tests for stream=True schema generation."""

    def test_stream_kwarg_sets_model_flag(self):
        schema = generate_schema(add, stream=True)
        assert schema['model']['stream'] is True

    def test_no_stream_by_default(self):
        schema = generate_schema(add)
        assert 'stream' not in schema['model']


class TestServerWithGenerator:
    """Tests for generator functions served as SSE."""

    @classmethod
    def setup_class(cls):
        def count_up(n: int = 3):
            for i in range(n):
                yield {'count': i}
            if n < 0:
                yield {'count': 0}
                raise RuntimeError('generator failed')
        cls.port = 15071
        cls.thread = _start_server(count_up, cls.port, stream=True)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_schema_has_stream_flag(self):
        resp = urlopen(self.base + '/api')
        data = json.loads(resp.read())
        assert data['schema']['model']['stream'] is True

    def test_generator_returns_sse(self):
        req = Request(
            self.base + '/count_up',
            data=json.dumps({'n': 3}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        assert 'text/event-stream' in resp.headers.get('Content-Type', '')
        body = resp.read().decode('utf-8')
        lines = [l for l in body.strip().split('\n') if l.startswith('data:')]
        # Should have 3 data lines + 1 [DONE]
        assert len(lines) == 4
        # Parse first three
        chunks = []
        for line in lines[:3]:
            payload = json.loads(line[5:].strip())
            chunks.append(payload)
        assert chunks[0] == {'count': 0}
        assert chunks[1] == {'count': 1}
        assert chunks[2] == {'count': 2}
        # Last line is [DONE]
        assert lines[3].strip() == 'data: [DONE]'

    def test_generator_failure_keeps_one_http_response(self):
        req = Request(self.base + '/count_up', data=b'{"n":-1}',
                      headers={'Content-Type': 'application/json'})
        resp = urlopen(req)
        body = resp.read().decode('utf-8')
        assert resp.status == 200
        assert body == ('data: {"count": 0}\n\n'
                        'event: error\ndata: {"error": "generator failed"}\n\n'
                        'data: [DONE]\n\n')


class TestServerWithAsyncGenerator:
    """Tests for async generator functions served as SSE."""

    @classmethod
    def setup_class(cls):
        async def count_async(n: int = 3):
            for i in range(n):
                yield {'count': i}
        cls.port = 15072
        cls.thread = _start_server(count_async, cls.port, stream=True)
        cls.base = 'http://localhost:{}'.format(cls.port)

    def test_async_generator_returns_sse(self):
        req = Request(
            self.base + '/count_async',
            data=json.dumps({'n': 3}).encode(),
            headers={'Content-Type': 'application/json'}
        )
        resp = urlopen(req)
        assert 'text/event-stream' in resp.headers.get('Content-Type', '')
        body = resp.read().decode('utf-8')
        lines = [l for l in body.strip().split('\n') if l.startswith('data:')]
        assert len(lines) == 4
        chunks = []
        for line in lines[:3]:
            payload = json.loads(line[5:].strip())
            chunks.append(payload)
        assert chunks == [{'count': 0}, {'count': 1}, {'count': 2}]
        assert lines[3].strip() == 'data: [DONE]'


@pytest.mark.parametrize('asynchronous', [False, True])
def test_stream_generator_is_closed_when_writing_fails(asynchronous):
    finalized = []

    def chunks():
        try:
            yield 1
            pytest.fail('advanced after disconnect')
        finally:
            finalized.append(True)

    async def async_chunks():
        try:
            await asyncio.sleep(0)
            yield 1
            pytest.fail('advanced after disconnect')
        finally:
            finalized.append(True)

    def disconnected(chunk):
        raise BrokenPipeError('client disconnected')

    result = async_chunks() if asynchronous else chunks()
    with pytest.raises(BrokenPipeError, match='client disconnected'):
        _stream_sse_result(result, disconnected)
    assert finalized == [True]
