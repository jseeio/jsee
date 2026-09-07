"""Real optional-dependency apps; run with test/python/requirements.txt installed."""

import io
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'py'))
from jsee import create_app


def test_summary_accepts_the_same_csv_and_returns_the_same_statistics_as_pyodide():
    app = create_app(str(ROOT / 'examples/python-summary/schema.json'))
    for case in json.loads((ROOT / 'test/fixtures/python-apps.json').read_text()):
        data = json.dumps({'csv': case['csv']}).encode()
        statuses = []
        result = b''.join(app({
            'REQUEST_METHOD': 'POST', 'PATH_INFO': '/pysummary',
            'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(data)),
            'wsgi.input': io.BytesIO(data),
        }, lambda status, headers: statuses.append(status)))
        assert statuses == ['200 OK'], result
        assert json.loads(result) == {'res': case['summary']}
