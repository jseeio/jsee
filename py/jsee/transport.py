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

from .jsee import (_get_value_schema, _json_shape_errors, _validate_schema_version, _prepare_inputs, _flatten_outputs,
                   _invocation_unsupported_reason, jsee_inputs_to_json_schema,
                   jsee_outputs_to_json_schema, DEFAULT_MAX_BODY_BYTES,
                   invoke_schema, _read_request_body, _read_request_inputs, _RequestError, _resolve_static_file)

BODY_LIMIT = DEFAULT_MAX_BODY_BYTES
ARTIFACT_LIMIT = 64 * 1024 * 1024


def upload_tool(computation_id):
    return {'name': 'jsee_upload_artifact' if computation_id == 'upload_artifact' else 'upload_artifact',
            'description': 'Upload bytes in base64 chunks of at most 262144 decoded bytes. First call omits upload; continue with upload and returned offset. final publishes an artifact; cancel discards pending bytes. Pass {artifact: result.artifact} to file inputs. MIME is declared, not decoded.',
            'inputSchema': {'type': 'object', 'properties': {
                'upload': {'type': 'string'}, 'data': {'type': 'string', 'maxLength': 349528}, 'offset': {'type': 'integer', 'minimum': 0},
                'name': {'type': 'string'}, 'mime': {'type': 'string'}, 'final': {'type': 'boolean'}, 'cancel': {'type': 'boolean'}}, 'additionalProperties': False}}


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
            try:
                _get_value_schema(field)
            except (ValueError, TypeError) as error:
                errors.append(at + ': ' + str(error))
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
                if 'accept' in field and not isinstance(field['accept'], str):
                    errors.append(at + '.accept should be a string')
                if field.get('type') in ('image', 'audio', 'video', 'object', 'table') and any(field.get(key) for key in ('raw', 'stream', 'arrayBuffer')):
                    errors.append(at + ': raw, stream and arrayBuffer are not supported for this input type')
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
        if 'initTimeout' in model and (type(model['initTimeout']) not in (int, float) or not math.isfinite(model['initTimeout']) or model['initTimeout'] <= 0):
            errors.append(at + '.initTimeout should be positive and finite')
        for key in ('name', 'url', 'entry', 'workerUrl'):
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


def canonical_output_schema(outputs):
    output_schema = jsee_outputs_to_json_schema(outputs)
    output_schema['additionalProperties'] = False
    output_schema['required'] = []
    for output in _flatten_outputs(outputs):
        output_schema['required'].append(output['name'])
        if output.get('type') == 'file':
            output_schema['properties'][output['name']] = {'type': 'object', 'properties': {'artifact': {'type': 'string'}},
                                                          'required': ['artifact'], 'additionalProperties': False}
        elif output.get('type') in ('image', 'audio', 'video'):
            output_schema['properties'][output['name']] = {'anyOf': [{'type': 'object', 'properties': {'artifact': {'type': 'string'}}, 'required': ['artifact'], 'additionalProperties': False}, output_schema['properties'][output['name']]]}
    # Match the exact-name encoding used for Ajv-based MCP clients.
    if '__proto__' in output_schema.get('properties', {}):
        output_schema['patternProperties'] = {'^__proto__$': output_schema['properties']['__proto__']}
    return output_schema


def inspect_schema(schema):
    validation = validate_descriptor(schema)
    if not validation['valid']:
        raise ValueError('; '.join(validation['errors']))
    output_schema = canonical_output_schema(schema.get('outputs'))
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


def json_path(at, key):
    if re.fullmatch(r'[A-Za-z_$][\w$]*', key, re.ASCII):
        return (at + '.' if at else '') + key
    return at + '[' + json.dumps(key, ensure_ascii=False) + ']'


def json_value(value, at, seen=None):
    seen = set() if seen is None else seen
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    binary = isinstance(value, (bytes, bytearray, memoryview))
    kind = None
    if binary:
        kind = 'bytes'
    elif isinstance(value, float):
        kind = 'NaN' if math.isnan(value) else 'Infinity' if value > 0 else '-Infinity'
    elif id(value) in seen:
        kind = 'circular reference'
    elif not isinstance(value, (list, dict)):
        kind = type(value).__name__
    if kind:
        hint = '; declare binary output as type file' if binary else ''
        raise ValueError(at + ': ' + kind + ' is not a JSON value' + hint)
    seen.add(id(value))
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise ValueError(at + ': ' + type(key).__name__ + ' key is not a JSON object key; keys must be strings')
        result = {k: json_value(v, json_path(at, k), seen) for k, v in value.items()}
    else:
        result = [json_value(v, f'{at}[{index}]', seen) for index, v in enumerate(value)]
    seen.remove(id(value))
    return result


def output_shape_error(value, schema, at='outputs'):
    errors = _json_shape_errors(value, schema, at)
    return errors[0] if errors else None


class ArtifactStore:
    def __init__(self, directory=None, max_bytes=ARTIFACT_LIMIT, http=False, uri_prefix=None):
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError('max-artifact-bytes must be a positive integer')
        self.temporary = directory is None
        self.root = Path(directory).resolve() if directory else Path(tempfile.mkdtemp(prefix='jsee-artifacts-'))
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.max_bytes, self.http = max_bytes, http
        self.uri_prefix = uri_prefix
        self.bytes = 0
        self.entries = {}
        self.uploads, self.pending_bytes = {}, 0
        self.lock = threading.RLock()
        if not self.temporary:
            self.load()

    def load(self):
        entries, size = {}, 0
        for directory in self.root.iterdir():
            if not re.fullmatch(r'[0-9a-f-]{36}', directory.name):
                continue
            manifest = directory / 'manifest.json'
            if not manifest.exists():
                continue
            filename = _resolve_static_file(str(self.root), directory.name + '/manifest.json')
            records = json.loads(Path(filename).read_text(encoding='utf-8'))
            if not isinstance(records, list):
                raise ValueError('Invalid artifact manifest')
            for index, record in enumerate(records):
                if (not isinstance(record, dict) or record.get('id') != directory.name + '/' + str(index)
                        or type(record.get('size')) is not int or record['size'] < 0
                        or not isinstance(record.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', record['sha256'])
                        or not isinstance(record.get('name'), str) or not isinstance(record.get('mime'), str)):
                    raise ValueError('Invalid artifact manifest')
                filename = _resolve_static_file(str(self.root), record['id'])
                if filename is None or not Path(filename).is_file():
                    raise ValueError('Invalid artifact file')
                entries[record['id']] = {**record, 'path': Path(filename), 'uri': Path(filename).as_uri()}
                size += record['size']
                if len(entries) > 1024 or size > self.max_bytes:
                    error = ValueError('Artifact store limit exceeded')
                    error.code = 'JSEE_ARTIFACT_LIMIT'
                    raise error
        self.entries, self.bytes = entries, size

    def commit(self, run_id, files):
        with self.lock:
            if self.temporary:
                return self.commit_files(run_id, files)
            # Same directory lock and manifest format as Node; publication is last.
            lock = self.root / '.write-lock'
            lock.mkdir(mode=0o700)
            try:
                self.load()
                return self.commit_files(run_id, files)
            finally:
                lock.rmdir()

    def commit_files(self, run_id, files):
        # Threaded HTTP requests share one quota and publish only complete batches.
        with self.lock:
            size = sum(len(file['bytes']) for file in files)
            if size + self.bytes + self.pending_bytes > self.max_bytes or len(self.entries) + len(files) > 1024:
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
                    result.append({'id': identifier, 'output': file.get('output', ''), 'name': file['name'], 'mime': file['mime'],
                                   'size': len(file['bytes']), 'sha256': hashlib.sha256(file['bytes']).hexdigest(),
                                   'uri': self.uri_prefix + identifier if self.uri_prefix else '/__jsee/artifacts/' + identifier if self.http else filename.as_uri()})
                if not self.temporary:
                    with (directory / 'manifest.pending').open('x', encoding='utf-8') as manifest:
                        os.chmod(directory / 'manifest.pending', 0o600)
                        json.dump(result, manifest)
                    (directory / 'manifest.pending').rename(directory / 'manifest.json')
                for index, artifact in enumerate(result):
                    self.entries[artifact['id']] = {**artifact, 'path': directory / str(index)}
                self.bytes += size
                return result
            except Exception:
                shutil.rmtree(directory)
                raise

    def ingest(self, data, name='file', mime='application/octet-stream'):
        if not isinstance(name, str) or not isinstance(mime, str) or not re.fullmatch(r'[\w.+-]+/[\w.+-]+(?:;[^\r\n]*)?', mime, re.ASCII):
            raise ValueError('Invalid upload name or MIME type')
        name = re.sub(r'[\x00-\x1f\x7f]', '_', name.replace('\\', '/').split('/')[-1])[:255] or 'file'
        artifact = self.commit(str(uuid.uuid4()), [{'output': '', 'name': name, 'mime': mime, 'bytes': data}])[0]
        return {'artifact': artifact['id'], 'metadata': artifact}

    def upload(self, part):
        import base64
        with self.lock:
            if not isinstance(part, dict) or any(key not in ('upload', 'data', 'offset', 'name', 'mime', 'final', 'cancel') for key in part):
                raise ValueError('Invalid upload fields')
            for key in ('upload', 'name', 'mime'):
                if key in part and (not isinstance(part[key], str) or len(part[key]) > 1024):
                    raise ValueError('Invalid upload ' + key)
            for key in ('final', 'cancel'):
                if key in part and not isinstance(part[key], bool):
                    raise ValueError('Invalid upload ' + key)
            identifier = part.get('upload')
            pending = self.uploads.get(identifier) if identifier else None
            if identifier and pending is None:
                raise ValueError('Unknown upload')
            if part.get('cancel'):
                if pending:
                    self.pending_bytes -= pending['size']
                    del self.uploads[identifier]
                return {'cancelled': True}
            data = part.get('data', '')
            if not isinstance(data, str) or len(data) > 349528:
                raise ValueError('Invalid or oversized base64 chunk (maximum 262144 bytes)')
            try:
                chunk = base64.b64decode(data, validate=True)
            except ValueError as error:
                raise ValueError('Invalid base64 chunk') from error
            if len(chunk) > 262144 or base64.b64encode(chunk).decode('ascii') != data:
                raise ValueError('Invalid base64 chunk')
            offset = part.get('offset', 0)
            if type(offset) is not int or offset != (pending['size'] if pending else 0):
                raise ValueError('Upload offset mismatch')
            if self.bytes + self.pending_bytes + len(chunk) > self.max_bytes or (pending is None and len(self.uploads) >= 16):
                error = ValueError('Artifact store limit exceeded')
                error.code = 'JSEE_ARTIFACT_LIMIT'
                raise error
            identifier = identifier or str(uuid.uuid4())
            pending = pending or {'chunks': [], 'size': 0, 'name': part.get('name', 'file'), 'mime': part.get('mime', 'application/octet-stream')}
            pending['chunks'].append(chunk)
            pending['size'] += len(chunk)
            self.pending_bytes += len(chunk)
            self.uploads[identifier] = pending
            if not part.get('final'):
                return {'upload': identifier, 'offset': pending['size']}
            del self.uploads[identifier]
            self.pending_bytes -= pending['size']
            return self.ingest(b''.join(pending['chunks']), pending['name'], pending['mime'])

    def get(self, identifier):
        with self.lock:
            return self.entries.get(identifier)

    def read(self, identifier):
        with self.lock:
            if identifier not in self.entries:
                raise FileNotFoundError('Unknown artifact')
            filename = _resolve_static_file(str(self.root), identifier)
            if filename is None:
                raise FileNotFoundError('Unknown artifact')
            metadata = self.entries[identifier]
            if Path(filename).stat().st_size != metadata['size']:
                raise _RequestError('Artifact integrity check failed', 409)
            data = Path(filename).read_bytes()
            if hashlib.sha256(data).hexdigest() != metadata['sha256']:
                raise _RequestError('Artifact integrity check failed', 409)
            return data

    def close(self):
        with self.lock:
            self.uploads.clear()
            self.pending_bytes = 0
            if self.temporary:
                shutil.rmtree(self.root, ignore_errors=True)


def resolve_artifact_inputs(fields, inputs, store):
    result = dict(inputs)
    for field in fields or []:
        name = field.get('name')
        value = result.get(name)
        if field.get('type') == 'group' and not name:
            result.update(resolve_artifact_inputs(field.get('elements'), result, store))
        elif field.get('type') == 'group' and isinstance(value, dict):
            result[name] = resolve_artifact_inputs(field.get('elements'), value, store)
        elif field.get('type') in ('file', 'image', 'audio', 'video') and isinstance(value, dict) and 'artifact' in value:
            metadata = store.get(value['artifact']) if store else None
            if metadata is None:
                raise ValueError(str(name) + ': unknown or unavailable artifact')
            if field.get('raw') or field.get('stream'):
                raise ValueError(str(name) + ': artifact references do not support raw/stream mode')
            media = metadata['mime'].split(';')[0].strip().lower()
            if field['type'] != 'file' and not media.startswith(field['type'] + '/'):
                raise ValueError(str(name) + ': artifact MIME does not match media type')
            accept = field.get('accept')
            if accept:
                tokens = [token.strip().lower() for token in accept.split(',')]
                if not any(token == '*/*' or (token.startswith('.') and metadata['name'].lower().endswith(token))
                           or (token.endswith('/*') and media.startswith(token[:-1])) or token == media for token in tokens):
                    raise ValueError(str(name) + ': artifact MIME/name does not match accept')
            data = store.read(value['artifact'])
            result[name] = data if field.get('arrayBuffer') is True or field['type'] != 'file' else data.decode('utf-8')
    return result


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
            media = output.get('type') in ('image', 'audio', 'video')
            if output.get('type') == 'file' or media and (isinstance(value, (bytes, bytearray, memoryview)) or isinstance(value, dict) and any(key in value for key in ('content', 'value', 'data'))):
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
                if media and (not isinstance(mime, str) or not mime.lower().startswith(output['type'] + '/')):
                    raise ValueError('Media bytes require a matching declared MIME type')
                if not isinstance(mime, str) or not re.fullmatch(r'[\w.+-]+/[\w.+-]+(?:;[^\r\n]*)?', mime, re.ASCII):
                    raise ValueError('Invalid file MIME type')
                entries[output['name']] = {'artifact': run['runId'] + '/' + str(len(files))}
                files.append({'output': output['name'], 'bytes': data, 'name': name, 'mime': mime})
            else:
                entries[output['name']] = json_value(value, json_path('', output['name']))
        error = output_shape_error(entries, canonical_output_schema(schema.get('outputs')))
        if error:
            raise ValueError(error)
        return {'runId': run['runId'], 'status': 'succeeded', 'outputs': entries, 'artifacts': store.commit(run['runId'], files)}
    except Exception as error:
        return failed_run(getattr(error, 'code', 'JSEE_OUTPUT_INVALID'), str(error), run['runId'])


def run_result_schema(schema):
    return {
        'type': 'object', 'required': ['runId', 'status', 'outputs', 'artifacts'],
        'properties': {
            'runId': {'type': 'string'}, 'status': {'const': 'succeeded'},
            'outputs': canonical_output_schema(schema.get('outputs')),
            'artifacts': {'type': 'array', 'items': {
                'type': 'object', 'required': ['id', 'output', 'name', 'mime', 'size', 'sha256', 'uri'],
                'properties': {
                    **{name: {'type': 'string'} for name in ('id', 'output', 'name', 'mime', 'sha256', 'uri')},
                    'size': {'type': 'integer', 'minimum': 0}
                }
            }}
        }
    }


def canonical_openapi(schema):
    description = inspect_schema(schema)
    return {'openapi': '3.1.0', 'info': {'title': description['title'], 'version': '1.0.0'}, 'paths': {
        '/schema': {'get': {'responses': {'200': {'description': 'Computation descriptor with local model references'}}}},
        '/__jsee/artifacts': {'post': {'description': 'Upload raw bytes; Content-Type declares MIME. Returns artifact ID and metadata.', 'parameters': [{'name': 'name', 'in': 'query', 'schema': {'type': 'string'}}], 'requestBody': {'required': True, 'content': {'*/*': {'schema': {'type': 'string', 'format': 'binary'}}}}, 'responses': {201: {'description': 'Registered artifact ID and metadata'}, 413: {'description': 'Body limit exceeded'}, 507: {'description': 'Artifact limit exceeded'}}}},
        '/__jsee/artifacts/{runId}/{index}': {'get': {
            'parameters': [{'name': name, 'in': 'path', 'required': True, 'schema': {'type': 'string'}} for name in ('runId', 'index')],
            'responses': {'200': {'description': 'Artifact bytes; Content-Type and attachment name come from artifact metadata'},
                          '403': {'description': 'Access denied'}, '404': {'description': 'Unknown artifact'}}}},
        '/run': {'post': {'operationId': description['id'], 'requestBody': {'required': True, 'content': {'application/json': {'schema': description['inputSchema']}}},
            'responses': {'200': {'description': 'Declared outputs and artifact references', 'content': {'application/json': {'schema': run_result_schema(schema)}}},
                '400': {'description': 'Invalid input'}, '413': {'description': 'Body limit exceeded'}, '415': {'description': 'JSON content type required'}, '422': {'description': 'Unsupported capability'},
                '500': {'description': 'Execution or output error'}, '507': {'description': 'Artifact limit exceeded'}}}}
    }}


class ComputationService:
    """Canonical request policy and artifact ownership for the HTTP and WSGI hosts."""
    def __init__(self, schema, funcs, cwd, max_body_bytes=BODY_LIMIT, max_artifact_bytes=ARTIFACT_LIMIT):
        self.schema, self.funcs, self.cwd = schema, funcs, cwd
        self.max_body_bytes = max_body_bytes
        self.openapi = canonical_openapi(schema)
        self.store = ArtifactStore(max_bytes=max_artifact_bytes, http=True)
        self._cleanup = weakref.finalize(self, self.store.close)

    def dispatch(self, method, pathname, content_type='', content_length=None, stream=None):
        parsed = urllib.parse.urlsplit(pathname)
        query = urllib.parse.parse_qs(parsed.query)
        pathname = parsed.path.rstrip('/') or '/'
        def response(value, status=200):
            body = json.dumps(value, allow_nan=False).encode('utf-8')
            return status, [('Content-Type', 'application/json; charset=utf-8'), ('Content-Length', str(len(body))), ('Cache-Control', 'no-store')], body

        if method == 'GET' and pathname == '/schema':
            return response(self.schema)
        if method == 'GET' and pathname == '/openapi.json':
            return response(self.openapi)
        if pathname == '/__jsee/artifacts':
            if method != 'POST':
                return response({'error': 'Use POST for uploads'}, 405)
            try:
                data = _read_request_body(stream or io.BytesIO(), content_length, self.max_body_bytes)
                return response(self.store.ingest(data, name=query.get('name', ['file'])[0], mime=content_type or 'application/octet-stream'), 201)
            except (ValueError, OSError) as error:
                code = getattr(error, 'code', 'JSEE_BODY_TOO_LARGE' if getattr(error, 'status', 400) == 413 else 'JSEE_REQUEST_INVALID')
                run = failed_run(code, str(error))
                return response(run, response_status(run))
        if pathname.startswith('/__jsee/artifacts/'):
            if method != 'GET':
                return response({'error': 'Use GET for artifacts'}, 405)
            identifier = urllib.parse.unquote(pathname[len('/__jsee/artifacts/'):])
            artifact = self.store.get(identifier)
            if artifact is None:
                return response({'error': 'Unknown artifact'}, 404)
            try:
                body = self.store.read(identifier)
            except FileNotFoundError:
                return response({'error': 'Unknown artifact'}, 404)
            except PermissionError:
                return response({'error': 'Artifact access denied'}, 403)
            except _RequestError as error:
                return response({'error': str(error)}, error.status)
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
        run = asyncio.run(invoke_schema(self.schema, data, cwd=self.cwd, _model_funcs=self.funcs, artifact_store=self.store))
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
    from .host_policy import add_cli_options
    add_cli_options(parser)
    parser.add_argument('command', choices=['inspect', 'validate', 'run', 'serve', 'artifact-import'])
    parser.add_argument('schema')
    parser.add_argument('--mcp-only', action='store_true', help='Serve MCP over stdio (requires jsee[server])')
    parser.add_argument('--json', action='store_true', help='JSON output (also the default)')
    parser.add_argument('--mime', default='application/octet-stream')
    parser.add_argument('--name')
    parser.add_argument('--input', default='-', help='JSON input file, or - for stdin')
    parser.add_argument('--artifact-dir', default='.jsee-artifacts', help='Persistent CLI artifact directory')
    parser.add_argument('--max-body-bytes', type=int, default=BODY_LIMIT)
    parser.add_argument('--max-artifact-bytes', type=int, default=ARTIFACT_LIMIT)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5050)
    args = parser.parse_args(arguments)
    if any(value is not None for value in (args.auth_token, args.auth_token_env, args.cors_origins)) and (args.command != 'serve' or args.mcp_only):
        raise ValueError('HTTP host options require serve without --mcp-only')
    if args.command == 'artifact-import':
        try:
            store = ArtifactStore(directory=args.artifact_dir, max_bytes=args.max_artifact_bytes)
            filename = Path(args.schema).resolve()
            with filename.open('rb') as source:
                data = source.read(max(0, store.max_bytes - store.bytes) + 1)
            return store.ingest(data, name=args.name or filename.name, mime=args.mime), 0
        except (ValueError, OSError) as error:
            return failed_run(getattr(error, 'code', 'JSEE_REQUEST_INVALID'), str(error)), 2
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
    if args.command == 'serve' and args.mcp_only:
        from .mcp import serve as serve_mcp
        asyncio.run(serve_mcp(str(schema_path), max_body_bytes=args.max_body_bytes, max_artifact_bytes=args.max_artifact_bytes))
        return None, 0
    if args.command == 'serve':
        serve(str(schema_path), host=args.host, port=args.port, canonical=True,
              max_body_bytes=args.max_body_bytes, max_artifact_bytes=args.max_artifact_bytes,
              auth_token=args.auth_token, auth_token_env=args.auth_token_env, cors_origins=args.cors_origins)
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
    try:
        store = ArtifactStore(directory=args.artifact_dir, max_bytes=args.max_artifact_bytes)
        run = asyncio.run(invoke_schema(schema, data, cwd=str(schema_path.parent), artifact_store=store))
        run = format_run(schema, run, store)
        return run, 0 if run['status'] == 'succeeded' else 1
    except (OSError, ValueError) as error:
        return failed_run('JSEE_OUTPUT_INVALID', str(error)), 1
