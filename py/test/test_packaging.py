"""Exercise artifacts outside the checkout, including a wheel rebuilt from an sdist."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import zipfile

import pytest


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ('jsee.core.js', 'jsee.full.js')
PACKAGE_ASSETS = ASSETS + ('schema.json',)


def asset_source(name):
    return ROOT / name if name == 'schema.json' else ROOT / 'dist' / name


def copy_package(destination, with_assets):
    shutil.copytree(ROOT / 'py', destination, ignore=shutil.ignore_patterns(
        'static', 'build', 'dist', '*.egg-info', '__pycache__', '.pytest_cache',
    ))
    if with_assets:
        static = destination / 'jsee' / 'static'
        static.mkdir()
        for name in PACKAGE_ASSETS:
            shutil.copy2(asset_source(name), static / name)


def build(source, output, kind):
    return subprocess.run(
        [sys.executable, '-m', 'build', '--no-isolation', kind,
         '--outdir', str(output), str(source)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )


@pytest.mark.parametrize('missing', [None, *PACKAGE_ASSETS])
def test_package_build_rejects_missing_runtime_assets(tmp_path, missing):
    source = tmp_path / 'source'
    copy_package(source, with_assets=missing is not None)
    if missing:
        (source / 'jsee' / 'static' / missing).unlink()
    result = build(source, tmp_path / 'wheels', '--wheel')
    assert result.returncode != 0, result.stdout
    assert 'Missing browser runtime assets' in result.stdout
    if missing:
        assert missing in result.stdout


def test_sdist_rebuild_and_installed_gui_api(tmp_path):
    source = tmp_path / 'source'
    copy_package(source, with_assets=True)
    sdists = tmp_path / 'sdists'
    result = build(source, sdists, '--sdist')
    assert result.returncode == 0, result.stdout
    with tarfile.open(next(sdists.glob('*.tar.gz'))) as archive:
        members = archive.getnames()
        for name in PACKAGE_ASSETS:
            assert any(member.endswith('/jsee/static/' + name) for member in members)
        assert not any(Path(member).name in ('AGENTS.md', 'CLAUDE.md', 'PLAN.md') for member in members)
        # This archive was just built from the controlled fixture source above.
        archive.extractall(tmp_path / 'rebuilt')
    rebuilt = next((tmp_path / 'rebuilt').iterdir())
    wheels = tmp_path / 'wheels'
    result = build(rebuilt, wheels, '--wheel')
    assert result.returncode == 0, result.stdout
    wheel = next(wheels.glob('*.whl'))
    expected = {}
    with zipfile.ZipFile(wheel) as archive:
        for name in PACKAGE_ASSETS:
            expected[name] = hashlib.sha256(asset_source(name).read_bytes()).hexdigest()
            assert hashlib.sha256(archive.read('jsee/static/' + name)).hexdigest() == expected[name]
        assert not any('/test/' in name or name.endswith('AGENTS.md') for name in archive.namelist())
    installed = tmp_path / 'installed'
    result = subprocess.run(
        [sys.executable, '-m', 'pip', 'install', '--no-deps', '--no-index',
         '--target', str(installed), str(wheel)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    assert result.returncode == 0, result.stdout
    smoke = '''
import hashlib, io, json, os
from pathlib import Path
from importlib.resources import files
from jsee.jsee import _find_runtime, create_app
expected = json.loads(os.environ['JSEE_EXPECTED_ASSETS'])
descriptor = files('jsee').joinpath('static/schema.json').read_bytes()
assert hashlib.sha256(descriptor).hexdigest() == expected['schema.json']
for name, outputs in [('jsee.core.js', []), ('jsee.full.js', [{'type': 'chart'}])]:
    runtime = Path(_find_runtime({'outputs': outputs}))
    assert runtime.parent == Path(os.environ['PYTHONPATH']) / 'jsee' / 'static'
    assert hashlib.sha256(runtime.read_bytes()).hexdigest() == expected[name]
def add(x: int, y: int = 1):
    return x + y
app = create_app(add)
for path, method, body in [('/', 'GET', b''), ('/static/jsee.js', 'GET', b''), ('/add', 'POST', b'{"x": 2, "y": 3}')]:
    status = []
    environ = {'PATH_INFO': path, 'REQUEST_METHOD': method, 'CONTENT_LENGTH': str(len(body)),
               'CONTENT_TYPE': 'application/json', 'wsgi.input': io.BytesIO(body)}
    response = b''.join(app(environ, lambda code, headers: status.append(code)))
    assert status[0].startswith('200'), (path, status, response)
    if method == 'POST': assert json.loads(response)['result'] == 5
    elif path == '/': assert b'/static/jsee.js' in response
    else: assert hashlib.sha256(response).hexdigest() == expected['jsee.core.js']
'''
    result = subprocess.run(
        [sys.executable, '-c', smoke], cwd=tmp_path,
        env={**os.environ, 'PATH': '', 'PYTHONPATH': str(installed),
             'JSEE_EXPECTED_ASSETS': json.dumps(expected)},
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    assert result.returncode == 0, result.stdout
