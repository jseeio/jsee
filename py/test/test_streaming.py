"""Generator results must keep the same wire and cleanup contracts in both servers."""

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import importlib
import io
import json
from pathlib import Path
import queue
import sys
import threading
from types import SimpleNamespace
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
runtime = importlib.import_module('jsee.jsee')


@pytest.fixture(params=['http', 'wsgi'])
def open_response(request, monkeypatch):
    @contextmanager
    def open_app(target, data=None, **options):
        body = json.dumps(data or {}).encode()
        if request.param == 'wsgi':
            captured = {}
            app = runtime.create_app(target, stream=True, **options)
            response = app({'REQUEST_METHOD': 'POST', 'PATH_INFO': '/' + target.__name__,
                            'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(body)),
                            'wsgi.input': io.BytesIO(body)},
                           lambda status, headers: captured.update(status=int(status.split()[0]), headers=dict(headers)))
            try:
                yield SimpleNamespace(status=captured['status'], headers=captured['headers'],
                                      read=lambda: b''.join(response))
            finally:
                if hasattr(response, 'close'):
                    response.close()
            return

        servers = queue.Queue()
        errors = []

        def factory(*args, **kwargs):
            server = ThreadingHTTPServer(*args, **kwargs)
            servers.put(server)
            return server

        def start():
            try:
                runtime.serve(target, port=0, stream=True, **options)
            except BaseException as error:
                errors.append(error)

        monkeypatch.setattr(runtime, 'ThreadingHTTPServer', factory)
        thread = threading.Thread(target=start, daemon=True)
        thread.start()
        server = servers.get(timeout=3)
        connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        try:
            connection.request('POST', '/' + target.__name__, body, {'Content-Type': 'application/json'})
            response = connection.getresponse()
            yield SimpleNamespace(status=response.status, headers=dict(response.getheaders()), read=response.read)
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)
            assert not thread.is_alive()
            assert not errors
    return open_app


@pytest.mark.parametrize('streaming', [False, True])
@pytest.mark.parametrize('named', [False, True])
def test_declared_scores_keep_rows_in_json_and_sse(open_response, streaming, named):
    rows = [{'label': 'low', 'score': 0.2}, {'label': 'high', 'score': 0.8}]
    result = {'ranked': rows, 'table': [{'x': 1}]} if named else rows
    outputs = ([{'type': 'group', 'elements': [
        {'name': 'predictions', 'type': 'scores', 'alias': ['ranked']},
        {'name': 'table', 'type': 'table'},
    ]}] if named else [{'name': 'result', 'type': 'scores'}])

    def compute():
        return result

    def stream():
        yield result

    with open_response(stream if streaming else compute, outputs=outputs) as response:
        assert response.status == 200
        body = response.read().decode()
    payload = json.loads(body.split('\n')[0][6:] if streaming else body)
    assert payload == ({'ranked': rows, 'table': {'columns': ['x'], 'rows': [[1]]}}
                       if named else {'result': rows})


@pytest.mark.parametrize('asynchronous', [False, True])
@pytest.mark.parametrize('fail', [False, True])
def test_generator_frames_and_failures_match(open_response, asynchronous, fail):
    def stream(fail: bool = False):
        yield False
        yield None
        yield {'error': 'business value'}
        if fail:
            raise RuntimeError('generator failed')

    async def async_stream(fail: bool = False):
        for value in stream(fail):
            await asyncio.sleep(0)
            yield value

    with open_response(async_stream if asynchronous else stream, {'fail': fail}) as response:
        assert response.status == 200
        assert response.headers['Content-Type'].startswith('text/event-stream')
        body = response.read().decode()
    expected = ('data: {"result": false}\n\ndata: {"result": null}\n\n'
                'data: {"error": "business value"}\n\n')
    if fail:
        expected += 'event: error\ndata: {"error": "generator failed"}\n\n'
    assert body == expected + 'data: [DONE]\n\n'


def invoke_wsgi(target):
    statuses = []
    response = runtime.create_app(target, stream=True)(
        {'REQUEST_METHOD': 'POST', 'PATH_INFO': '/' + target.__name__,
         'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': '2', 'wsgi.input': io.BytesIO(b'{}')},
        lambda status, headers: statuses.append(status))
    assert statuses == ['200 OK']
    return response


def test_wsgi_stream_satisfies_wsgi_protocol():
    async def stream():
        yield 1

    environ = {}
    setup_testing_defaults(environ)
    environ.update(REQUEST_METHOD='POST', PATH_INFO='/stream', QUERY_STRING='',
                   CONTENT_TYPE='application/json', CONTENT_LENGTH='2')
    environ['wsgi.input'] = io.BytesIO(b'{}')
    response = validator(runtime.create_app(stream, stream=True))(environ, lambda status, headers: None)
    try:
        assert list(response) == [b'data: {"result": 1}\n\n', b'data: [DONE]\n\n']
    finally:
        response.close()


def test_wsgi_pulls_one_chunk_at_a_time_and_closes_suspended_generator():
    events = []

    def stream():
        try:
            events.append('first')
            yield 1
            events.append('second')
            yield 2
        finally:
            events.append('closed')

    response = invoke_wsgi(stream)
    assert events == []
    assert next(response) == b'data: {"result": 1}\n\n'
    assert events == ['first']
    response.close()
    assert events == ['first', 'closed']


@pytest.mark.parametrize('consume_all', [False, True])
def test_wsgi_keeps_async_context_and_finalizers_in_one_task(consume_all):
    context = ContextVar('stream_context', default='outside')
    events = []

    async def stream():
        token = context.set('inside')
        task = asyncio.current_task()
        try:
            yield context.get()
            assert asyncio.current_task() is task
            yield context.get()
        finally:
            await asyncio.sleep(0)
            assert asyncio.current_task() is task
            context.reset(token)
            events.append('closed')

    response = invoke_wsgi(stream)
    assert next(response) == b'data: {"result": "inside"}\n\n'
    if consume_all:
        assert list(response) == [b'data: {"result": "inside"}\n\n', b'data: [DONE]\n\n']
    else:
        response.close()
    assert events == ['closed']
    assert context.get() == 'outside'
