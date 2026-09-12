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
