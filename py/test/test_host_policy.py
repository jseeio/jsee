"""Authentication and origin checks precede every HTTP/WSGI route and body read."""
import base64
import importlib
import io
import json
from pathlib import Path
import queue
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
runtime = importlib.import_module('jsee.jsee')
TOKEN = 'host-policy-test-token'
ALLOWED = 'https://client.example'


@pytest.fixture(params=['http', 'wsgi'])
def host_client(request, tmp_path, monkeypatch):
    canonical = request.getfixturevalue('canonical')
    (tmp_path / 'model.py').write_text('n = 0\ndef compute():\n    global n\n    n += 1\n    return {"answer": n, "file": "inside"}\ndef events():\n    yield {"answer": 1}\n')
    filename = tmp_path / 'schema.json'
    filename.write_text(json.dumps({'model': [{'name': 'compute', 'url': 'model.py'}] + ([] if canonical else [{'name': 'events', 'url': 'model.py', 'stream': True}]), 'outputs': [{'name': 'answer', 'type': 'number'}, {'name': 'file', 'type': 'file'}]}))
    options = dict(auth_token=TOKEN, cors_origins=[ALLOWED], canonical=canonical)
    if request.param == 'wsgi':
        app = runtime.create_app(str(filename), **options)
        def call(path, method='GET', headers=None, body=b''):
            captured = {}
            environ = {'REQUEST_METHOD': method, 'PATH_INFO': path, 'HTTP_HOST': '127.0.0.1:12345',
                       'wsgi.url_scheme': 'http', 'CONTENT_TYPE': 'application/json',
                       'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body)}
            environ.update({'HTTP_' + k.upper().replace('-', '_'): v for k, v in (headers or {}).items()})
            data = b''.join(app(environ, lambda status, hs: captured.update(status=int(status.split()[0]), headers=dict(hs))))
            return captured['status'], {k.lower(): v for k, v in captured['headers'].items()}, data
        try:
            yield call, 'http://127.0.0.1:12345'
        finally:
            if hasattr(app, 'close'): app.close()
        return
    servers = queue.Queue()
    def factory(*args, **kwargs):
        server = ThreadingHTTPServer(*args, **kwargs)
        servers.put(server)
        return server
    monkeypatch.setattr(runtime, 'ThreadingHTTPServer', factory)
    thread = threading.Thread(target=lambda: runtime.serve(str(filename), port=0, **options), daemon=True)
    thread.start()
    server = servers.get(timeout=3)
    def call(path, method='GET', headers=None, body=b''):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        try:
            connection.request(method, path, body, {'Content-Type': 'application/json', **(headers or {})})
            response = connection.getresponse()
            return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read()
        finally:
            connection.close()
    try:
        yield call, 'http://127.0.0.1:' + str(server.server_port)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()


@pytest.mark.parametrize('canonical', [True, False])
def test_host_policy_covers_every_route(host_client, canonical):
    call, origin = host_client
    bearer = {'Authorization': 'Bearer ' + TOKEN}
    routes = ['/', '/api', '/api/openapi.json', '/model.py', '/static/jsee.js', '/missing', '/compute', '/schema', '/openapi.json', '/run', '/__jsee/artifacts/unknown/0']
    for route in routes:
        for method in ['GET', 'POST', 'HEAD', 'OPTIONS', 'DELETE']:
            status, headers, body = call(route, method)
            assert status == 401, (route, method, status)
            assert 'Bearer' in headers['www-authenticate']
            assert headers['cache-control'] == 'no-store'
        status, headers, _ = call(route, headers={**bearer, 'Origin': 'https://denied.example'})
        assert status == 403 and 'access-control-allow-origin' not in headers
    basic = {'Authorization': 'Basic ' + base64.b64encode(('jsee:' + TOKEN).encode()).decode()}
    for auth in [bearer, basic]:
        status, headers, body = call('/api', headers={**auth, 'Origin': ALLOWED})
        assert status == 200
        assert headers['access-control-allow-origin'] == ALLOWED
        assert headers['access-control-allow-credentials'] == 'true'
        assert 'Origin' in headers['vary']
        assert TOKEN.encode() not in body
    status, headers, _ = call('/run', 'OPTIONS', {'Origin': ALLOWED, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type'})
    assert status == 204 and 'authorization' in headers['access-control-allow-headers'].lower()
    assert call('/compute', 'POST', {'Origin': ALLOWED}, b'{')[0] == 401
    assert json.loads(call('/compute', 'POST', {**bearer, 'Origin': origin}, b'{}')[2])['answer'] == 1
    if canonical:
        run = json.loads(call('/run', 'POST', bearer, b'{}')[2])
        assert run['outputs']['answer'] == 2
        uri = run['artifacts'][0]['uri']
        assert call(uri)[0] == 401
        status, headers, body = call(uri, headers={**bearer, 'Origin': ALLOWED})
        assert status == 200 and body == b'inside'
        assert headers['access-control-allow-origin'] == ALLOWED

from jsee.host_policy import HostPolicy
DECISIONS = json.loads((Path(__file__).resolve().parents[2] / 'test/fixtures/host-policy.json').read_text())
OPTION_NAMES = {'authToken': 'auth_token', 'authTokenEnv': 'auth_token_env', 'corsOrigins': 'cors_origins'}


@pytest.mark.parametrize('fixture', DECISIONS, ids=lambda f: f['name'])
def test_shared_host_decisions(fixture):
    policy = HostPolicy(**{OPTION_NAMES.get(k, k): v for k, v in fixture['options'].items()})
    status, headers, error = policy.evaluate(fixture['method'], fixture['headers'])
    assert status == fixture['status']
    assert headers.get('Access-Control-Allow-Origin') == fixture['allowOrigin']
    assert TOKEN not in json.dumps([status, headers, error])


def test_invalid_policy_precedes_model_imports(monkeypatch):
    monkeypatch.delenv('JSEE_TEST_MISSING_HOST_TOKEN', raising=False)
    for options in [dict(auth_token=''), dict(auth_token='a b'), dict(auth_token=True),
                    dict(auth_token=TOKEN, cors_origins=['*']), dict(cors_origins=['null']),
                    dict(cors_origins=['https://x/path']), dict(cors_origins=['*', ALLOWED]),
                    dict(auth_token_env='JSEE_TEST_MISSING_HOST_TOKEN')]:
        with pytest.raises(ValueError):
            HostPolicy(**options)
    with pytest.raises(ValueError, match='not set'):
        runtime.create_app('nonexistent.json', auth_token_env='JSEE_TEST_MISSING_HOST_TOKEN')
    monkeypatch.setenv('JSEE_TEST_HOST_TOKEN', TOKEN)
    assert HostPolicy(auth_token_env='JSEE_TEST_HOST_TOKEN').authorize('Bearer ' + TOKEN)


@pytest.mark.parametrize('canonical', [False])
def test_authenticated_streaming_policy(host_client, canonical):
    call, _ = host_client
    status, headers, body = call('/events', 'POST', {'Authorization': 'Bearer ' + TOKEN, 'Origin': ALLOWED}, b'{}')
    assert status == 200 and b'data: [DONE]' in body
    assert headers['cache-control'] == 'no-store'
    assert headers['access-control-allow-origin'] == ALLOWED
