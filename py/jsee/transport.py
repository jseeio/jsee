"""Inspection and terminal output handling shared by CLI, HTTP and WSGI."""
import hashlib
import asyncio
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import uuid
import urllib.parse
import weakref

from .jsee import (_validate_schema_version, _prepare_inputs, _flatten_outputs,
                   _invocation_unsupported_reason, jsee_inputs_to_json_schema,
                   jsee_outputs_to_json_schema, DEFAULT_MAX_BODY_BYTES,
                   invoke_schema, _read_request_inputs, _RequestError, _resolve_static_file)

BODY_LIMIT = DEFAULT_MAX_BODY_BYTES
ARTIFACT_LIMIT = 64 * 1024 * 1024


def validate_descriptor(schema):
    errors, warnings = [], []
    if not isinstance(schema, dict):
        return {'valid': False, 'errors': ['Schema should be an object'], 'warnings': warnings}
    for key in ('title', 'description'):
        if key in schema and not isinstance(schema[key], str):
            errors.append(key + ' should be a string')
    vocabulary = json.loads((Path(__file__).parent / 'static/schema.json').read_text())['definitions']
    try:
        _validate_schema_version(schema)
    except ValueError as error:
        errors.append(str(error))
    if 'id' in schema and (not isinstance(schema['id'], str) or not re.fullmatch(r'[a-zA-Z][\w.-]{0,127}', schema['id'], re.ASCII)):
        errors.append('id should be a stable identifier (letters, digits, _, ., -)')

    def check_fields(fields, kind, prefix, names=None):
        names = set() if names is None else names
        if not isinstance(fields, list):
            errors.append(prefix + ' should be an array')
            return
        for index, field in enumerate(fields):
            at = '{}[{}]'.format(prefix, index)
            if not isinstance(field, dict):
                errors.append(at + ' should be an object')
                continue
            if 'type' in field and field['type'] not in vocabulary[kind + 'Type']['enum']:
                errors.append(at + '.type is not recognized')
            name = field.get('name')
            if 'name' in field and (not isinstance(name, str) or not name):
                errors.append(at + '.name should be a nonempty string')
                name = None
            if field.get('type') == 'group':
                scope = names if kind == 'output' or not name else set()
                check_fields(field.get('elements'), kind, at + '.elements', scope)
                if kind == 'output' or not name:
                    continue
            elif field.get('type') not in ('button', 'action', 'blank', 'function') and not name:
                errors.append(at + '.name is required')
            if name:
                if name in names:
                    errors.append(at + '.name is duplicated')
                names.add(name)
            alias = field.get('alias')
            if 'alias' in field and not (isinstance(alias, str) or isinstance(alias, list) and all(isinstance(v, str) for v in alias)):
                errors.append(at + '.alias should contain strings')
            if kind == 'input':
                for key in ('required', 'nullable', 'raw', 'stream', 'arrayBuffer'):
                    if key in field and not isinstance(field[key], bool):
                        errors.append(at + '.' + key + ' should be boolean')
                for key in ('min', 'max', 'step'):
                    if key in field and (type(field[key]) not in (int, float) or not math.isfinite(field[key])):
                        errors.append(at + '.' + key + ' should be finite')
                if all(type(field.get(key)) in (int, float) for key in ('min', 'max')) and field['min'] > field['max']:
                    errors.append(at + '.min exceeds max')
                if type(field.get('step')) in (int, float) and field['step'] <= 0:
                    errors.append(at + '.step should be positive')
                if 'options' in field and not isinstance(field['options'], list):
                    errors.append(at + '.options should be an array')
                if field.get('validate'):
                    warnings.append(at + '.validate is evaluated only by the browser UI')
                if 'default' in field and name:
                    try:
                        _prepare_inputs([{**field, 'required': False}], {name: field['default']})
                    except (ValueError, TypeError, KeyError, AttributeError) as error:
                        errors.append(at + '.default: ' + str(error))

    check_fields(schema.get('inputs', []), 'input', 'inputs')
    check_fields(schema.get('outputs', []), 'output', 'outputs')
    models = schema.get('model', [])
    if isinstance(models, dict):
        models = [models]
    if not isinstance(models, list):
        models = [models]
    if not models:
        errors.append('Invocation requires one or more model objects')
    names = set()
    for index, model in enumerate(models):
        at = 'model[{}]'.format(index)
        if not isinstance(model, dict):
            errors.append(at + ' should be an object')
            continue
        if 'type' in model and model['type'] not in vocabulary['modelType']['enum']:
            errors.append(at + '.type is not recognized')
        for key in ('name', 'url', 'entry'):
            if key in model and (not isinstance(model[key], str) or not model[key]):
                errors.append(at + '.' + key + ' should be a nonempty string')
        if isinstance(model.get('entry'), str) and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', model['entry']):
            errors.append(at + '.entry is invalid')
        if not model.get('url') and not model.get('code'):
            errors.append(at + ' needs url or code')
        if 'code' in model and not isinstance(model['code'], str):
            errors.append(at + '.code should be a string or function')
        if 'container' in model and model['container'] not in ('object', 'args'):
            errors.append(at + '.container is invalid')
        name = model.get('name')
        if isinstance(name, str):
            if name in names:
                errors.append(at + '.name is duplicated')
            names.add(name)
    return {'valid': not errors, 'errors': errors, 'warnings': warnings}


def inspect_schema(schema):
    validation = validate_descriptor(schema)
    if not validation['valid']:
        raise ValueError('; '.join(validation['errors']))
    output_schema = jsee_outputs_to_json_schema(schema.get('outputs'))
    output_schema['additionalProperties'] = False
    output_schema['required'] = []
    for output in _flatten_outputs(schema.get('outputs')):
        output_schema['required'].append(output['name'])
        if output.get('type') == 'file':
            output_schema['properties'][output['name']] = {'type': 'object', 'properties': {'artifact': {'type': 'string'}},
                                                          'required': ['artifact'], 'additionalProperties': False}
    reason = _invocation_unsupported_reason(schema)
    return {'id': schema.get('id', 'computation'), 'schemaVersion': schema.get('schemaVersion', 1),
            'title': schema.get('title') or schema.get('id') or 'Computation', 'description': schema.get('description', ''),
            'inputSchema': jsee_inputs_to_json_schema(schema.get('inputs')), 'outputSchema': output_schema,
            'capabilities': {'runtime': 'python', 'invoke': not reason, 'reason': reason, 'streaming': False, 'cancellation': False},
            'warnings': validation['warnings']}


def failed_run(code, message, run_id=None):
    return {'runId': run_id or str(uuid.uuid4()), 'status': 'failed', 'error': {'code': code, 'message': message}}


def response_status(run):
    if run['status'] == 'succeeded':
        return 200
    return {'JSEE_SCHEMA_INVALID': 400, 'JSEE_INPUT_INVALID': 400, 'JSEE_REQUEST_INVALID': 400,
            'JSEE_BODY_TOO_LARGE': 413, 'JSEE_CAPABILITY_UNSUPPORTED': 422, 'JSEE_ARTIFACT_LIMIT': 507}.get(run['error']['code'], 500)


def json_value(value, seen=None):
    seen = set() if seen is None else seen
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if not isinstance(value, (list, dict)) or id(value) in seen:
        raise ValueError('Outputs must be JSON values; declare binary output as type file')
    seen.add(id(value))
    if isinstance(value, dict) and any(not isinstance(key, str) for key in value):
        raise ValueError('JSON object keys must be strings')
    result = [json_value(v, seen) for v in value] if isinstance(value, list) else {k: json_value(v, seen) for k, v in value.items()}
    seen.remove(id(value))
    return result


class ArtifactStore:
    def __init__(self, directory=None, max_bytes=ARTIFACT_LIMIT, http=False):
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError('max-artifact-bytes must be a positive integer')
        self.temporary = directory is None
        self.root = Path(directory).resolve() if directory else Path(tempfile.mkdtemp(prefix='jsee-artifacts-'))
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.max_bytes, self.http = max_bytes, http
        self.bytes = 0
        self.entries = {}
        self.lock = threading.RLock()

    def commit(self, run_id, files):
        # Threaded HTTP requests share one quota and publish only complete batches.
        with self.lock:
            size = sum(len(file['bytes']) for file in files)
            if size + self.bytes > self.max_bytes or len(self.entries) + len(files) > 1024:
                error = ValueError('Artifact store limit exceeded')
                error.code = 'JSEE_ARTIFACT_LIMIT'
                raise error
            if not files:
                return []
            if not re.fullmatch(r'[0-9a-f-]{36}', run_id):
                raise ValueError('Invalid run ID')
            directory = self.root / run_id
            directory.mkdir(mode=0o700)
            try:
                result = []
                for index, file in enumerate(files):
                    identifier = run_id + '/' + str(index)
                    filename = directory / str(index)
                    with filename.open('xb') as output:
                        os.chmod(filename, 0o600)
                        output.write(file['bytes'])
                    result.append({'id': identifier, 'output': file['output'], 'name': file['name'], 'mime': file['mime'],
                                   'size': len(file['bytes']), 'sha256': hashlib.sha256(file['bytes']).hexdigest(),
                                   'uri': '/__jsee/artifacts/' + identifier if self.http else filename.as_uri()})
                for index, artifact in enumerate(result):
                    self.entries[artifact['id']] = {**artifact, 'path': directory / str(index)}
                self.bytes += size
                return result
            except Exception:
                shutil.rmtree(directory)
                raise

    def get(self, identifier):
        with self.lock:
            return self.entries.get(identifier)

    def close(self):
        with self.lock:
            if self.temporary:
                shutil.rmtree(self.root, ignore_errors=True)


def format_run(schema, run, store):
    if run['status'] != 'succeeded':
        return run
    try:
        entries, files = {}, []
        outputs = _flatten_outputs(schema.get('outputs'))
        for output in outputs:
            value = run['result']
            if isinstance(value, dict):
                names = [output['name'], re.sub(r'[^a-z0-9_]', '_', output['name'].lower())]
                aliases = output.get('alias', [])
                names.extend([aliases] if isinstance(aliases, str) else aliases)
                key = next((name for name in names if name in value), None)
                if key is None and 'value' not in output:
                    raise ValueError('Missing declared output: ' + output['name'])
                value = output.get('value') if key is None else value[key]
            elif len(outputs) != 1:
                raise ValueError('Multiple outputs require a result object')
            if output.get('type') == 'file':
                descriptor = value if isinstance(value, dict) else {}
                if isinstance(value, dict):
                    key = next((key for key in ('content', 'value', 'data') if key in value), None)
                    if key is None:
                        raise ValueError('File outputs need content, value, or data; URLs are not fetched')
                    value = value[key]
                if isinstance(value, str):
                    data = value.encode('utf-8')
                elif isinstance(value, (bytes, bytearray, memoryview)):
                    data = bytes(value)
                else:
                    raise ValueError('File content must be text or bytes')
                name = str(descriptor.get('filename') or descriptor.get('name') or output.get('filename') or output['name'])
                name = re.sub(r'[\x00-\x1f\x7f]', '_', name.replace('\\', '/').split('/')[-1])[:255] or 'file'
                mime = descriptor.get('mime') or descriptor.get('contentType') or output.get('mime') or output.get('contentType') or 'application/octet-stream'
                if not isinstance(mime, str) or not re.fullmatch(r'[\w.+-]+/[\w.+-]+(?:;[^\r\n]*)?', mime, re.ASCII):
                    raise ValueError('Invalid file MIME type')
                entries[output['name']] = {'artifact': run['runId'] + '/' + str(len(files))}
                files.append({'output': output['name'], 'bytes': data, 'name': name, 'mime': mime})
            else:
                entries[output['name']] = json_value(value)
        return {'runId': run['runId'], 'status': 'succeeded', 'outputs': entries, 'artifacts': store.commit(run['runId'], files)}
    except Exception as error:
        return failed_run(getattr(error, 'code', 'JSEE_OUTPUT_INVALID'), str(error), run['runId'])


def canonical_openapi(schema):
    description = inspect_schema(schema)
    return {'openapi': '3.1.0', 'info': {'title': description['title'], 'version': '1.0.0'}, 'paths': {
        '/schema': {'get': {'responses': {'200': {'description': 'Computation descriptor with local model references'}}}},
        '/__jsee/artifacts/{runId}/{index}': {'get': {
            'parameters': [{'name': name, 'in': 'path', 'required': True, 'schema': {'type': 'string'}} for name in ('runId', 'index')],
            'responses': {'200': {'description': 'Artifact bytes; Content-Type and attachment name come from artifact metadata'},
                          '403': {'description': 'Access denied'}, '404': {'description': 'Unknown artifact'}}}},
        '/run': {'post': {'operationId': description['id'], 'requestBody': {'required': True, 'content': {'application/json': {'schema': description['inputSchema']}}},
            'responses': {'200': {'description': 'Declared outputs and artifact references', 'content': {'application/json': {'schema': {
                'type': 'object', 'required': ['runId', 'status', 'outputs', 'artifacts'], 'properties': {
                    'runId': {'type': 'string'}, 'status': {'const': 'succeeded'}, 'outputs': description['outputSchema'], 'artifacts': {'type': 'array', 'items': {
                        'type': 'object', 'required': ['id', 'output', 'name', 'mime', 'size', 'sha256', 'uri'], 'properties': {
                            **{name: {'type': 'string'} for name in ('id', 'output', 'name', 'mime', 'sha256', 'uri')},
                            'size': {'type': 'integer', 'minimum': 0}}}}}}}}},
                '400': {'description': 'Invalid input'}, '413': {'description': 'Body limit exceeded'}, '415': {'description': 'JSON content type required'}, '422': {'description': 'Unsupported capability'},
                '500': {'description': 'Execution or output error'}, '507': {'description': 'Artifact limit exceeded'}}}}
    }}


class ComputationService:
    """Canonical request policy and artifact ownership for the HTTP and WSGI hosts."""
    def __init__(self, schema, funcs, cwd, max_body_bytes=BODY_LIMIT, max_artifact_bytes=ARTIFACT_LIMIT):
        self.schema, self.funcs, self.cwd = schema, funcs, cwd
        self.max_body_bytes = max_body_bytes
        self.store = ArtifactStore(max_bytes=max_artifact_bytes, http=True)
        self._cleanup = weakref.finalize(self, self.store.close)

    def dispatch(self, method, pathname, content_type='', content_length=None, stream=None):
        pathname = pathname.rstrip('/') or '/'
        def response(value, status=200):
            body = json.dumps(value, allow_nan=False).encode('utf-8')
            return status, [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(body))), ('Cache-Control', 'no-store')], body

        if method == 'GET' and pathname == '/schema':
            return response(self.schema)
        if method == 'GET' and pathname == '/openapi.json':
            return response(canonical_openapi(self.schema))
        if pathname.startswith('/__jsee/artifacts/'):
            if method != 'GET':
                return response({'error': 'Use GET for artifacts'}, 405)
            identifier = urllib.parse.unquote(pathname[len('/__jsee/artifacts/'):])
            artifact = self.store.get(identifier)
            if artifact is None:
                return response({'error': 'Unknown artifact'}, 404)
            try:
                filename = _resolve_static_file(str(self.store.root), identifier)
                if filename is None:
                    return response({'error': 'Unknown artifact'}, 404)
                body = Path(filename).read_bytes()
            except PermissionError:
                return response({'error': 'Artifact access denied'}, 403)
            headers = [('Content-Type', artifact['mime']), ('Content-Length', str(len(body))),
                       ('Content-Disposition', "attachment; filename*=UTF-8''" + urllib.parse.quote(artifact['name'], safe='')),
                       ('X-Content-Type-Options', 'nosniff'), ('Cache-Control', 'no-store')]
            return 200, headers, body
        if pathname != '/run':
            return None
        if method != 'POST':
            return response({'error': 'Use POST /run'}, 405)
        try:
            data = _read_request_inputs([], stream or io.BytesIO(), content_type, content_length,
                                        self.max_body_bytes, json_only=True, validate_inputs=False)
        except _RequestError as error:
            code = {413: 'JSEE_BODY_TOO_LARGE', 415: 'JSEE_UNSUPPORTED_MEDIA'}.get(error.status, 'JSEE_REQUEST_INVALID')
            return response(failed_run(code, str(error)), error.status)
        run = asyncio.run(invoke_schema(self.schema, data, cwd=self.cwd, _model_funcs=self.funcs))
        run = format_run(self.schema, run, self.store)
        return response(run, response_status(run))

    def close(self):
        self._cleanup()


def command(arguments):
    import argparse
    import contextlib
    import sys
    from .jsee import serve
    parser = argparse.ArgumentParser(description='Inspect or invoke a JSEE computation descriptor')
    parser.add_argument('command', choices=['inspect', 'validate', 'run', 'serve'])
    parser.add_argument('schema')
    parser.add_argument('--json', action='store_true', help='JSON output (also the default)')
    parser.add_argument('--input', default='-', help='JSON input file, or - for stdin')
    parser.add_argument('--artifact-dir', default='.jsee-artifacts', help='Persistent CLI artifact directory')
    parser.add_argument('--max-body-bytes', type=int, default=BODY_LIMIT)
    parser.add_argument('--max-artifact-bytes', type=int, default=ARTIFACT_LIMIT)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5050)
    args = parser.parse_args(arguments)
    try:
        schema_path = Path(args.schema).resolve()
        schema = json.loads(schema_path.read_text(encoding='utf-8'))
        if args.command == 'validate':
            body = validate_descriptor(schema)
            return body, 0 if body['valid'] else 2
        description = inspect_schema(schema)
        if args.command == 'inspect':
            return description, 0
    except (OSError, ValueError) as error:
        return failed_run('JSEE_SCHEMA_INVALID', str(error)), 2
    if args.command == 'serve':
        serve(str(schema_path), host=args.host, port=args.port, canonical=True,
              max_body_bytes=args.max_body_bytes, max_artifact_bytes=args.max_artifact_bytes)
        return None, 0
    try:
        if args.max_body_bytes <= 0:
            raise ValueError('max-body-bytes must be a positive integer')
        with contextlib.nullcontext(sys.stdin.buffer) if args.input == '-' else open(args.input, 'rb') as source:
            body = source.read(args.max_body_bytes + 1)
        if len(body) > args.max_body_bytes:
            return failed_run('JSEE_BODY_TOO_LARGE', 'Input exceeds {} bytes'.format(args.max_body_bytes)), 2
        data = _read_request_inputs([], io.BytesIO(body), 'application/json', str(len(body)), args.max_body_bytes,
                                    json_only=True, validate_inputs=False)
    except (OSError, ValueError) as error:
        return failed_run('JSEE_REQUEST_INVALID', str(error)), 2
    run = asyncio.run(invoke_schema(schema, data, cwd=str(schema_path.parent)))
    if run['status'] != 'succeeded':
        return run, 1
    try:
        store = ArtifactStore(directory=args.artifact_dir, max_bytes=args.max_artifact_bytes)
        run = format_run(schema, run, store)
        return run, 0 if run['status'] == 'succeeded' else 1
    except (OSError, ValueError) as error:
        return failed_run('JSEE_OUTPUT_INVALID', str(error), run['runId']), 1
