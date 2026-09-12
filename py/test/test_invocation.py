"""Whole-computation contracts shared with Node; no server or third-party model dependencies."""
import asyncio
import copy
import json
import sys
from pathlib import Path
from uuid import UUID

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jsee import invoke_schema

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = json.loads((ROOT / 'test/fixtures/invocation-contracts.json').read_text())


@pytest.mark.parametrize('fixture', CONTRACTS, ids=lambda f: f['name'])
def test_invocation_contract(fixture, tmp_path):
    models = []
    for index, step in enumerate(fixture['steps']):
        filename = '{}.py'.format(index)
        (tmp_path / filename).write_text(step['py'])
        models.append({'name': 'stage_{}'.format(index), 'entry': 'step', 'type': 'py',
                       'url': filename, 'container': step.get('container', 'object')})
    schema = {'inputs': fixture.get('inputs', []), 'model': models}
    before = copy.deepcopy((schema, fixture['data']))
    result = asyncio.run(invoke_schema(schema, fixture['data'], cwd=str(tmp_path)))
    assert str(UUID(result['runId'])) == result['runId']
    if 'error' in fixture:
        assert result == {'runId': result['runId'], 'status': 'failed', 'error': {
            'code': fixture['error'], 'message': result['error']['message']}}
        if 'message' in fixture:
            assert result['error']['message'] == fixture['message']
    else:
        assert result == {'runId': result['runId'], 'status': 'succeeded', 'result': fixture['result']}
    assert (schema, fixture['data']) == before


@pytest.mark.parametrize('schema', [None, {'model': []}, {'model': None},
    {'schemaVersion': 2, 'model': {}}, {'model': {}, 'inputs': {}}])
def test_invalid_descriptor(schema):
    result = asyncio.run(invoke_schema(schema, {}))
    assert result['error']['code'] == 'JSEE_SCHEMA_INVALID'


def test_preflight_before_loading(tmp_path):
    (tmp_path / 'side_effect.py').write_text("raise RuntimeError('must not initialize')\n")
    schema = {'model': [{'name': 'side_effect', 'url': 'side_effect.py'}, {'url': 'model.js'}]}
    result = asyncio.run(invoke_schema(schema, {}, cwd=str(tmp_path)))
    assert result['error']['code'] == 'JSEE_CAPABILITY_UNSUPPORTED'


def test_concurrent_invocations(tmp_path):
    (tmp_path / 'model.py').write_text('async def model(value):\n    return value\n')
    schema = {'model': {'url': 'model.py'}}

    async def run():
        return await asyncio.gather(*(invoke_schema(schema, {'value': value}, cwd=str(tmp_path)) for value in (1, 2)))

    results = asyncio.run(run())
    assert [r['result'] for r in results] == [1, 2]
    assert results[0]['runId'] != results[1]['runId']


@pytest.mark.parametrize('fixture', json.loads((ROOT / 'test/fixtures/clean-sales.json').read_text()), ids=lambda f: f['name'])
def test_clean_sales(fixture):
    directory = ROOT / 'examples/clean-sales'
    schema = json.loads((directory / 'schema-python.json').read_text())
    result = asyncio.run(invoke_schema(schema, fixture['data'], cwd=str(directory)))
    if 'error' in fixture:
        assert result['error']['code'] == fixture['error']
    else:
        assert result['status'] == 'succeeded'
        assert result['result']['summary'] == fixture['summary']
        assert result['result']['cleaned_csv'] == {
            'filename': 'cleaned-sales.csv', 'mime': 'text/csv', 'content': fixture['csv']}
