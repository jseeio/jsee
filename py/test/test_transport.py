"""CLI/HTTP/WSGI use the same descriptor, invocation and artifact contract."""
import hashlib
import importlib
import io
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse, unquote
import uuid

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'py'))
runtime = importlib.import_module('jsee.jsee')
from jsee.transport import ArtifactStore, format_run, inspect_schema, validate_descriptor

CONTRACTS = json.loads((ROOT / 'test/fixtures/transport-contracts.json').read_text())
SALES = json.loads((ROOT / 'test/fixtures/clean-sales.json').read_text())
SCHEMA_PATH = ROOT / 'examples/clean-sales/schema-python.json'
SCHEMA = json.loads(SCHEMA_PATH.read_text())


@pytest.mark.parametrize('fixture', CONTRACTS, ids=lambda f: f['name'])
def test_output_contract(fixture):
    store = ArtifactStore()
    try:
        run = format_run({'outputs': fixture['outputs']}, {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': fixture['result']}, store)
        if 'error' in fixture:
            assert run['error']['code'] == fixture['error']
        else:
            assert run['status'] == 'succeeded'
            assert run['outputs'] == fixture['expected']
            assert run['artifacts'] == []
        assert list(store.root.iterdir()) == []
    finally:
        store.close()


@pytest.mark.parametrize('value,kind', [
    (float('nan'), 'NaN'), (float('inf'), 'Infinity'), (float('-inf'), '-Infinity'),
    (lambda: None, 'function'), ((1,), 'tuple'), (b'x', 'bytes'),
    (bytearray(b'x'), 'bytes'), (memoryview(b'x'), 'bytes'),
])
def test_output_error_reports_path_and_kind(value, kind):
    store = ArtifactStore()
    try:
        run = format_run({'outputs': [{'name': 'info', 'type': 'object'}]},
                         {'runId': str(uuid.uuid4()), 'status': 'succeeded',
                          'result': {'info': {'rows': [{'a.b': value}]}}}, store)
        hint = '; declare binary output as type file' if kind == 'bytes' else ''
        assert run['status'] == 'failed'
        assert run['error'] == {'code': 'JSEE_OUTPUT_INVALID',
                                'message': 'info.rows[0]["a.b"]: ' + kind + ' is not a JSON value' + hint}
        assert not store.entries
    finally:
        store.close()


def test_output_cycles_and_shared_values():
    store = ArtifactStore()
    def format_info(info):
        return format_run({'outputs': [{'name': 'info', 'type': 'object'}]},
                          {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'info': info}}, store)
    try:
        shared = {'a': None, 'b': 1}
        assert format_info([shared, shared])['outputs']['info'] == [shared, shared]
        cycle = {}
        cycle['self'] = cycle
        assert format_info(cycle)['error']['message'] == 'info.self: circular reference is not a JSON value'
        assert format_info({'row': {1: 'x'}})['error']['message'] == 'info.row: int key is not a JSON object key; keys must be strings'
    finally:
        store.close()


@pytest.mark.parametrize('kind', ['object', 'number', 'int'])
def test_output_validation_preserves_native_integer_range(kind):
    value = 10 ** 400
    store = ArtifactStore()
    try:
        run = format_run({'outputs': [{'name': 'answer', 'type': kind}]},
                         {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': value}, store)
        assert run['status'] == 'succeeded', run
        assert json.loads(json.dumps(run))['outputs']['answer'] == value
    finally:
        store.close()


def test_artifact_bytes_quota_cleanup():
    store = ArtifactStore(max_bytes=3, http=True)
    directory = store.root
    schema = {'outputs': [{'name': 'file', 'type': 'file'}]}
    try:
        source = memoryview(bytes([0, 1, 255, 2]))[1:3]
        run = format_run(schema, {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'file': {'content': source, 'filename': '../unsafe\n.bin'}}}, store)
        assert run['status'] == 'succeeded'
        artifact = run['artifacts'][0]
        assert artifact['name'] == 'unsafe_.bin'
        assert artifact['size'] == 2
        assert store.get(artifact['id'])['path'].read_bytes() == bytes([1, 255])
        run = format_run(schema, {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'file': 'ab'}}, store)
        assert run['error']['code'] == 'JSEE_ARTIFACT_LIMIT'
        assert len(store.entries) == 1
        assert store.get('../outside') is None
    finally:
        store.close()
    assert not directory.exists()


def test_inspection_does_not_import(tmp_path):
    model = tmp_path / 'model.py'
    model.write_text("raise RuntimeError('must not execute')\n")
    schema = {'id': 'fixed', 'title': 'Before', 'model': {'type': 'py', 'url': str(model)},
              'inputs': [{'name': 'x', 'type': 'int', 'default': 2}]}
    assert inspect_schema(schema)['id'] == inspect_schema({**schema, 'title': 'After'})['id']
    assert not validate_descriptor({**schema, 'inputs': [{'name': 'x', 'type': 'int', 'default': 'wrong'}]})['valid']
    assert not validate_descriptor({**schema, 'outputs': [{'name': 'x'}, {'name': 'x'}]})['valid']
    assert not inspect_schema({**schema, 'model': {'url': 'missing.js'}})['capabilities']['invoke']
    for field in ('inputs', 'outputs'):
        for value in (None, False, 0, ''):
            assert not validate_descriptor({**schema, field: value})['valid']
    report = inspect_schema({**schema, 'outputs': [{'name': '__proto__', 'type': 'file'}, {'name': 'json', 'type': 'object'}]})
    assert report['outputSchema']['properties']['__proto__']['required'] == ['artifact']
    assert report['outputSchema']['properties']['json'] == {}


def test_inspection_rejects_malformed_metadata():
    for key in ('title', 'description'):
        assert not validate_descriptor({'model': {'url': 'model.py'}, key: {'invalid': True}})['valid']


def test_cli_inputs_artifacts_and_diagnostics(tmp_path):
    import os
    def execute(args, data=''):
        return subprocess.run([sys.executable, str(ROOT / 'py/bin/jsee'), *args], input=data, text=True,
                              capture_output=True, cwd=tmp_path, env={**os.environ, 'PYTHONPATH': str(ROOT / 'py')})
    for fixture in SALES:
        child = execute(['run', str(SCHEMA_PATH), '--input', '-', '--json'], json.dumps(fixture['data']))
        run = json.loads(child.stdout)
        if 'error' in fixture:
            assert child.returncode != 0
            assert run['error']['code'] == fixture['error']
        else:
            assert child.returncode == 0, child.stderr
            assert list(run['outputs']) == ['summary', 'table', 'cleaned_csv']
            assert run['outputs']['summary'] == fixture['summary']
            artifact = Path(unquote(urlparse(run['artifacts'][0]['uri']).path))
            assert artifact.read_bytes() == fixture['csv'].encode()
    (tmp_path / 'sales.csv').write_text('price,quantity\n10,2\n')
    uploaded = json.loads(execute(['artifact-import', 'sales.csv', '--mime', 'text/csv']).stdout)
    first = json.loads(execute(['run', str(SCHEMA_PATH)], json.dumps({'csv': {'artifact': uploaded['artifact']}, 'missing': 'drop'})).stdout)
    assert first['outputs']['summary']['total_revenue'] == 20
    second = json.loads(execute(['run', str(SCHEMA_PATH)], json.dumps({'csv': first['outputs']['cleaned_csv'], 'missing': 'drop'})).stdout)
    assert second['outputs']['summary'] == first['outputs']['summary']
    (tmp_path / 'loud.py').write_text("print('import diagnostic')\ndef loud(x):\n    print('run diagnostic')\n    return {'answer': x}\n")
    (tmp_path / 'schema.json').write_text(json.dumps({'model': {'url': 'loud.py'}, 'inputs': [{'name': 'x', 'type': 'int'}], 'outputs': [{'name': 'answer', 'type': 'number'}]}))
    (tmp_path / 'input.json').write_text('{"x":42}')
    child = execute(['run', 'schema.json', '--input', 'input.json'])
    assert json.loads(child.stdout)['outputs'] == {'answer': 42}
    assert 'import diagnostic' in child.stderr and 'run diagnostic' in child.stderr
    child = execute(['inspect', 'schema.json'])
    assert json.loads(child.stdout)['capabilities']['invoke']
    assert child.stderr == ''
    assert execute(['validate', 'schema.json']).returncode == 0
    assert execute(['run', 'schema.json'], '{').returncode == 2
    assert json.loads(execute(['run', 'schema.json', '--max-body-bytes', '1'], '{}').stdout)['error']['code'] == 'JSEE_BODY_TOO_LARGE'


@pytest.fixture
def computation_path(request, tmp_path):
    if getattr(request, 'param', None) != 'stateful':
        return SCHEMA_PATH
    root = tmp_path / 'app'
    root.mkdir()
    (root / 'counter.py').write_text("count = 0\ndef counter():\n    global count\n    count += 1\n    return {'answer': count, 'file': 'inside'}\n")
    filename = root / 'schema.json'
    filename.write_text(json.dumps({'model': {'name': 'counter', 'url': 'counter.py'},
        'outputs': [{'name': 'answer', 'type': 'number'}, {'name': 'file', 'type': 'file'}]}))
    return filename


@pytest.fixture(params=['http', 'wsgi'])
def client(request, monkeypatch, computation_path):
    if request.param == 'wsgi':
        app = runtime.create_app(str(computation_path), canonical=True, max_body_bytes=2048)
        def call(path, method='GET', body=b'', content_type='application/json'):
            captured = {}
            response = b''.join(app({'REQUEST_METHOD': method, 'PATH_INFO': path, 'CONTENT_TYPE': content_type,
                'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body)},
                lambda status, headers: captured.update(status=int(status.split()[0]), headers=dict(headers))))
            return captured['status'], captured['headers'], response
        try:
            yield call
        finally:
            app.close()
        return
    servers = queue.Queue()
    errors = []
    def factory(*args, **kwargs):
        server = ThreadingHTTPServer(*args, **kwargs)
        servers.put(server)
        return server
    def start():
        try:
            runtime.serve(str(computation_path), host='127.0.0.1', port=0, canonical=True, max_body_bytes=2048)
        except BaseException as error:
            errors.append(error)
    monkeypatch.setattr(runtime, 'ThreadingHTTPServer', factory)
    thread = threading.Thread(target=start, daemon=True)
    thread.start()
    server = servers.get(timeout=3)
    def call(path, method='GET', body=b'', content_type='application/json'):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        try:
            connection.request(method, path, body, {'Content-Type': content_type, 'Content-Length': str(len(body))})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()
    try:
        yield call
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()
        assert not errors


def test_canonical_http_and_wsgi(client):
    status, headers, body = client('/schema')
    assert status == 200
    assert [m['url'] for m in json.loads(body)['model']] == ['model.py'] * 3
    upload_status, _, upload_body = client('/__jsee/artifacts?name=sales.csv', 'POST', b'price,quantity\n10,2\n', 'text/csv')
    assert upload_status == 201
    uploaded = json.loads(upload_body)
    assert uploaded['metadata']['name'] == 'sales.csv'
    def run_file(value):
        status, _, body = client('/run', 'POST', json.dumps({'csv': value, 'missing': 'drop'}).encode())
        assert status == 200
        return json.loads(body)
    first = run_file({'artifact': uploaded['artifact']})
    assert first['outputs']['summary']['total_revenue'] == 20
    assert run_file(first['outputs']['cleaned_csv'])['outputs']['summary'] == first['outputs']['summary']
    spec = json.loads(client('/openapi.json')[2])
    assert spec['paths']['/run']['post']['requestBody']['content']['application/json']['schema'] == inspect_schema(SCHEMA)['inputSchema']
    for fixture in SALES:
        status, headers, body = client('/run', 'POST', json.dumps(fixture['data']).encode())
        assert 'Access-Control-Allow-Origin' not in headers
        run = json.loads(body)
        if 'error' in fixture:
            assert run['error']['code'] == fixture['error']
        else:
            assert status == 200
            assert run['outputs']['summary'] == fixture['summary']
            assert 'result' not in run
            artifact = run['artifacts'][0]
            status, headers, content = client(artifact['uri'])
            assert status == 200
            assert 'attachment' in headers['Content-Disposition']
            assert headers['X-Content-Type-Options'] == 'nosniff'
            assert content == fixture['csv'].encode()
            assert artifact['sha256'] == hashlib.sha256(content).hexdigest()
    assert client('/')[0] == 200
    assert json.loads(client('/parse_sales', 'POST', json.dumps(SALES[0]['data']).encode())[2])['rows_read'] == 3
    for body, kind, status in [(b'{', 'application/json', 400), (b'x', 'text/plain', 415), (b' ' * 2049, 'application/json', 413)]:
        assert client('/run', 'POST', body, kind)[0] == status
    assert client('/__jsee/artifacts/unknown/0')[0] == 404


@pytest.mark.parametrize('computation_path', ['stateful'], indirect=True)
def test_canonical_state_and_file_containment(client, computation_path, monkeypatch):
    stores = []
    commit = ArtifactStore.commit
    def capture(store, *args):
        stores.append(store)
        return commit(store, *args)
    monkeypatch.setattr(ArtifactStore, 'commit', capture)
    for answer in (1, 2):
        status, _, body = client('/run', 'POST', b'{}')
        assert status == 200
        run = json.loads(body)
        assert run['outputs']['answer'] == answer
    assert json.loads(client('/counter', 'POST', b'{}')[2])['answer'] == 3
    artifact = run['artifacts'][0]
    outside = computation_path.parent.parent / 'outside.txt'
    outside.write_text('outside-canary')
    stored = stores[-1].get(artifact['id'])['path']
    stored.write_text('broken')
    assert client(artifact['uri'])[0] == 409
    stored.unlink()
    stored.symlink_to(outside)
    (computation_path.parent / 'escape.txt').symlink_to(outside)
    for route in (artifact['uri'], '/escape.txt'):
        status, _, body = client(route)
        assert status == 403
        assert b'outside-canary' not in body


def test_canonical_endpoint_conflict_precedes_import(tmp_path):
    (tmp_path / 'run.py').write_text("raise RuntimeError('must not load')\n")
    with pytest.raises(ValueError, match='conflicts'):
        runtime.create_app({'model': {'name': 'run', 'url': str(tmp_path / 'run.py')}}, canonical=True)


def test_artifact_inputs(tmp_path):
    import asyncio
    model = tmp_path / 'model.py'
    model.write_text('def model(group):\n    value = group["file"]\n    return {"value": list(value) if isinstance(value, bytes) else value}\n')
    store = ArtifactStore()
    try:
        produced = format_run({'outputs': [{'name': 'file', 'type': 'file', 'mime': 'text/csv'}]},
                              {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'file': 'a,b\n'}}, store)
        field = {'name': 'file', 'type': 'file', 'accept': 'text/*', 'default': produced['outputs']['file']}
        schema = {'model': {'url': str(model), 'name': 'model'}, 'inputs': [{'name': 'group', 'type': 'group', 'elements': [field]}]}
        assert asyncio.run(runtime.invoke_schema(schema, {'group': {}}, artifact_store=store))['result']['value'] == 'a,b\n'
        field['arrayBuffer'] = True
        assert asyncio.run(runtime.invoke_schema(schema, {'group': {}}, artifact_store=store))['result']['value'] == [97, 44, 98, 10]
        field['accept'] = 'image/*'
        assert asyncio.run(runtime.invoke_schema(schema, {'group': {}}, artifact_store=store))['error']['code'] == 'JSEE_INPUT_INVALID'
        schema['model']['url'] = 'must-not-import.py'
        assert asyncio.run(runtime.invoke_schema(schema, {'group': {'file': {'artifact': 'unknown'}}}, artifact_store=store))['error']['code'] == 'JSEE_INPUT_INVALID'
    finally:
        store.close()


def test_persistent_artifact_registrations(tmp_path):
    first = ArtifactStore(directory=tmp_path)
    artifact = first.commit(str(uuid.uuid4()), [{'bytes': bytes([0, 255, 128]), 'name': 'test.bin', 'mime': 'application/octet-stream', 'output': 'file'}])[0]
    first.close()
    second = ArtifactStore(directory=tmp_path)
    assert second.read(artifact['id']) == bytes([0, 255, 128])
    (tmp_path / artifact['id']).write_bytes(bytes([0, 0, 0]))
    with pytest.raises(ValueError, match='integrity'):
        second.read(artifact['id'])
    second.close()


def test_bounded_chunk_ingestion():
    store = ArtifactStore(max_bytes=5)
    try:
        part = store.upload({'data': 'AP8=', 'offset': 0, 'name': 'test.bin', 'mime': 'application/octet-stream'})
        assert not store.entries
        with pytest.raises(ValueError, match='offset'):
            store.upload({'upload': part['upload'], 'offset': 0, 'data': 'gA=='})
        complete = store.upload({'upload': part['upload'], 'offset': 2, 'data': 'gA==', 'final': True})
        assert store.read(complete['artifact']) == bytes([0, 255, 128])
        with pytest.raises(ValueError, match='limit'):
            store.upload({'data': 'AAAA', 'final': True})
        with pytest.raises(ValueError, match='base64'):
            store.upload({'data': '!!!!', 'final': True})
        assert len(store.entries) == 1
    finally:
        store.close()


@pytest.mark.parametrize('fixture', json.loads((ROOT / 'test/fixtures/structured-inputs.json').read_text()), ids=lambda f: f['name'])
def test_structured_inputs(fixture):
    inputs = [{'name': 'value', 'type': fixture['type']}]
    assert validate_descriptor({'model': {'url': 'model.py'}, 'inputs': inputs})['valid']
    if fixture['valid']:
        assert runtime._prepare_inputs(inputs, {'value': fixture['value']})['value'] == fixture['value']
    else:
        with pytest.raises(ValueError):
            runtime._prepare_inputs(inputs, {'value': fixture['value']})


@pytest.mark.parametrize('kind', ['image', 'audio', 'video'])
def test_media_artifacts(kind, tmp_path):
    import asyncio
    model = tmp_path / 'model.py'
    model.write_text('def model(value):\n    return list(value)\n')
    store = ArtifactStore()
    try:
        schema = {'outputs': [{'name': 'value', 'type': kind, 'mime': kind + '/example'}]}
        result = format_run(schema, {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'value': bytes([0, 255, 128])}}, store)
        assert result['status'] == 'succeeded'
        descriptor = {'inputs': [{'name': 'value', 'type': kind}], 'model': {'name': 'model', 'url': str(model)}}
        assert asyncio.run(runtime.invoke_schema(descriptor, result['outputs'], artifact_store=store))['result'] == [0, 255, 128]
        url = format_run(schema, {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'value': 'https://example.test/file'}}, store)
        assert url['outputs']['value'] == 'https://example.test/file'
        assert not url['artifacts']
    finally:
        store.close()


def test_large_uploaded_file_through_wsgi(tmp_path):
    (tmp_path / 'model.py').write_text('import hashlib\ndef measure(file):\n    return {"size":len(file), "hash":hashlib.sha256(file).hexdigest()}\n')
    schema = {'model': {'name': 'measure', 'url': 'model.py'}, 'inputs': [{'name': 'file', 'type': 'file', 'arrayBuffer': True}], 'outputs': [{'name': 'size', 'type': 'int'}, {'name': 'hash', 'type': 'string'}]}
    filename = tmp_path / 'schema.json'
    filename.write_text(json.dumps(schema))
    app = runtime.create_app(str(filename), canonical=True)
    def post(path, body, mime):
        captured = {}
        result = b''.join(app({'REQUEST_METHOD': 'POST', 'PATH_INFO': path, 'CONTENT_TYPE': mime, 'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body)}, lambda status, headers: captured.update(status=int(status.split()[0]))))
        assert captured['status'] in (200, 201), result
        return json.loads(result)
    try:
        data = bytes([255]) * (40 * 1024 * 1024)
        uploaded = post('/__jsee/artifacts', data, 'application/octet-stream')
        body = json.dumps({'file': {'artifact': uploaded['artifact']}}).encode()
        assert len(body) < 100
        assert post('/run', body, 'application/json')['outputs'] == {'size': len(data), 'hash': hashlib.sha256(data).hexdigest()}
    finally:
        app.close()


@pytest.mark.parametrize('value', [(1, 2), {1: 'non-string key'}, [float('nan')], [object()]])
def test_non_json_structured_values(value):
    with pytest.raises(ValueError):
        runtime._prepare_inputs([{'name': 'value', 'type': 'object'}], {'value': value})


@pytest.mark.parametrize('fixture', json.loads((ROOT / 'test/fixtures/value-schema.json').read_text()), ids=lambda f: f['name'])
def test_value_schema(fixture):
    field = {'name': 'info', 'type': 'object', 'valueSchema': fixture['schema']}
    schema = {'model': {'code': 'def model(info): return info', 'type': 'py'}, 'inputs': [field], 'outputs': [field]}
    store = ArtifactStore()
    try:
        assert validate_descriptor(schema)['valid']
        description = inspect_schema(schema)
        assert description['inputSchema']['properties']['info'] == fixture['schema']
        assert description['outputSchema']['properties']['info'] == fixture['schema']
        for values, valid in ((fixture['valid'], True), (fixture['invalid'], False)):
            for info in values:
                if valid:
                    assert runtime._prepare_inputs([field], {'info': info}) == {'info': info}
                else:
                    with pytest.raises(ValueError):
                        runtime._prepare_inputs([field], {'info': info})
                run = format_run(schema, {'runId': str(uuid.uuid4()), 'status': 'succeeded', 'result': {'info': info}}, store)
                assert run['status'] == ('succeeded' if valid else 'failed')
    finally:
        store.close()


@pytest.mark.parametrize('shape', [{'$ref': 'https://example.com/schema'}, {'type': 'wat'}, {'items': []}, {'required': 'x'}, {'extra': True}, {'properties': {'x': {'pattern': 'x'}}}, {'minimum': '0'}])
def test_reject_unsupported_value_schema(shape):
    field = {'name': 'x', 'type': 'object', 'valueSchema': shape}
    assert not validate_descriptor({'model': {'code': 'def model(): pass', 'type': 'py'}, 'inputs': [field], 'outputs': [field]})['valid']


def test_scores_discovery():
    schema = {'model': {'type': 'py', 'code': 'def model(): pass'}, 'outputs': [
        {'name': 'predictions', 'type': 'scores', 'min': -1, 'max': 1, 'format': 'percent', 'precision': 1}]}
    assert inspect_schema(schema)['outputSchema']['properties']['predictions'] == {
        'type': 'array', 'items': {'type': 'object', 'properties': {
            'label': {'type': 'string'}, 'score': {'type': 'number'}},
            'required': ['label', 'score'], 'additionalProperties': True}}


@pytest.mark.parametrize('fixture', json.loads((ROOT / 'test/fixtures/scores-options.json').read_text()))
def test_scores_display_options(fixture):
    schema = {'model': {'type': 'py', 'code': 'def model(): pass'},
              'outputs': [{'name': 'scores', 'type': 'scores', **fixture['options']}]}
    assert validate_descriptor(schema)['valid'] == fixture['valid']
