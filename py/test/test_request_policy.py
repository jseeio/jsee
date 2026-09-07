"""The stdlib HTTP server and WSGI entry point must share request policy."""

import importlib
import io
import json
import queue
import runpy
import sys
import threading
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
runtime = importlib.import_module('jsee.jsee')


def echo(value: str = 'default'):
    return {'value': value}


@pytest.fixture(params=['wsgi', 'http'])
def client(request, monkeypatch):
    if request.param == 'wsgi':
        app = runtime.create_app(echo, max_body_bytes=64)

        def invoke(body, length=None, content_type='application/json'):
            captured = {}
            environ = {'REQUEST_METHOD': 'POST', 'PATH_INFO': '/echo',
                       'CONTENT_TYPE': content_type,
                       'CONTENT_LENGTH': str(len(body)) if length is None else length,
                       'wsgi.input': io.BytesIO(body)}
            result = b''.join(app(environ, lambda status, headers: captured.update(status=status)))
            return int(captured['status'].split()[0]), json.loads(result)
        yield invoke
        return

    servers = queue.Queue()
    errors = []

    def server_factory(*args, **kwargs):
        server = ThreadingHTTPServer(*args, **kwargs)
        servers.put(server)
        return server

    def start():
        try:
            runtime.serve(echo, host='127.0.0.1', port=0, max_body_bytes=64)
        except BaseException as error:
            errors.append(error)

    monkeypatch.setattr(runtime, 'ThreadingHTTPServer', server_factory)
    thread = threading.Thread(target=start, daemon=True)
    thread.start()
    server = servers.get(timeout=3)

    def invoke(body, length=None, content_type='application/json'):
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=2)
        try:
            connection.request('POST', '/echo', body, headers={
                'Content-Type': content_type,
                'Content-Length': str(len(body)) if length is None else length,
            })
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    try:
        yield invoke
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()
        assert not errors


def test_valid_values_defaults_and_falsey_strings(client):
    for body, expected in [(b'{}', 'default'), (b'{"value":""}', ''), (b'{"value":"ok"}', 'ok')]:
        assert client(body) == (200, {'value': expected})


@pytest.mark.parametrize('body', [b'[]', b'null', b'{', b'{"value":2}', b'\xff'])
def test_invalid_json_or_contract_is_a_client_error(client, body):
    status, result = client(body)
    assert status == 400
    assert 'Invalid request:' in result['error']


@pytest.mark.parametrize('length', ['bad', '-1', '1.5'])
def test_invalid_content_length_is_a_client_error(client, length):
    status, result = client(b'', length=length)
    assert status == 400
    assert 'Content-Length' in result['error']


def test_declared_oversized_body_is_rejected_before_reading(client):
    status, result = client(b'', length='65')
    assert status == 413
    assert '64 bytes' in result['error']


def test_body_at_limit_is_accepted(client):
    body = b'{"value":"' + b'x' * 52 + b'"}'
    assert len(body) == 64
    assert client(body) == (200, {'value': 'x' * 52})


def test_multipart_uses_the_same_contract_and_size_policy(client):
    content_type = 'multipart/form-data; boundary=a'
    body = b'--a\r\nContent-Disposition: form-data; name="value"\r\n\r\nx\r\n--a--\r\n'
    assert client(body, content_type=content_type) == (200, {'value': 'x'})
    assert client(b'', length='65', content_type=content_type)[0] == 413


def test_wsgi_rejects_truncated_body():
    app = runtime.create_app(echo)
    statuses = []
    body = b''.join(app({'REQUEST_METHOD': 'POST', 'PATH_INFO': '/echo',
                        'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': '4',
                        'wsgi.input': io.BytesIO(b'{}')},
                       lambda status, headers: statuses.append(status)))
    assert statuses == ['400 Bad Request']
    assert 'Content-Length' in json.loads(body)['error']


@pytest.mark.parametrize('limit', [0, -1, True, '64'])
def test_invalid_limit_fails_during_app_creation(limit):
    with pytest.raises(ValueError, match='max_body_bytes'):
        runtime.create_app(echo, max_body_bytes=limit)


@pytest.mark.parametrize('arguments', [['--value=override'], ['override']])
def test_schema_cli_keeps_the_descriptor_directory_and_applies_overrides(tmp_path, monkeypatch, arguments):
    app_dir = tmp_path / 'app'
    app_dir.mkdir()
    (app_dir / 'model.py').write_text("def echo(value='base'):\n    return {'value': value}\n")
    schema = app_dir / 'schema.json'
    schema.write_text(json.dumps({'model': {'name': 'echo', 'url': 'model.py'},
                                 'inputs': [{'name': 'value', 'default': 'base'}]}))
    apps = []
    package = importlib.import_module('jsee')
    monkeypatch.setattr(package, 'serve', lambda target, host, port, **kwargs:
                        apps.append(runtime.create_app(target, host=host, port=port, **kwargs)))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, 'path', sys.path[:])
    monkeypatch.setattr(sys, 'argv', ['jsee', str(schema), *arguments, '--max-body-bytes', '64'])
    runpy.run_path(str(Path(__file__).resolve().parents[1] / 'bin/jsee'), run_name='__main__')
    statuses = []
    body = b''.join(apps[0]({'REQUEST_METHOD': 'POST', 'PATH_INFO': '/echo',
                           'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': '2',
                           'wsgi.input': io.BytesIO(b'{}')},
                          lambda status, headers: statuses.append(status)))
    assert statuses == ['200 OK']
    assert json.loads(body) == {'value': 'override'}
    body = b''.join(apps[0]({'REQUEST_METHOD': 'POST', 'PATH_INFO': '/echo',
                           'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': '65',
                           'wsgi.input': io.BytesIO()},
                          lambda status, headers: statuses.append(status)))
    assert statuses[-1] == '413 Payload Too Large'
    assert '64 bytes' in json.loads(body)['error']


def test_leading_zero_content_length_is_bounded_before_integer_conversion(client):
    assert client(b'{}', length='0' * 5000 + '2') == (200, {'value': 'default'})
