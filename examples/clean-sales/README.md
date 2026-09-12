# Clean sales CSV

One three-stage computation: parse CSV, drop rows with missing prices (or reject them), then calculate revenue and produce a table and cleaned CSV. `schema.json` uses JavaScript; `schema-python.json` has the same input/output contract with native Python models. `model.py` uses only the standard library. JavaScript uses the repository's existing `csv-parse` dependency; this directory's `browser` alias selects its browser implementation when bundling.

From the repository root, run the computation without starting a server:

```js
const fs = require('fs')
const path = require('path')
const { invokeSchema } = require('@jseeio/jsee/cli')
const schemaPath = path.resolve('examples/clean-sales/schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath))
invokeSchema(schema, { csv: 'price,quantity\n10,2\n20,1\n,3\n' }, { schemaPath })
  .then(run => console.log(run.status === 'succeeded' ? run.result.summary : run.error))
```

```python
import asyncio
import json
from pathlib import Path
from jsee import invoke_schema

directory = Path('examples/clean-sales').resolve()
schema = json.loads((directory / 'schema-python.json').read_text())
run = asyncio.run(invoke_schema(schema, {'csv': 'price,quantity\n10,2\n20,1\n,3\n'}, cwd=directory))
print(run['result']['summary'] if run['status'] == 'succeeded' else run['error'])
```

Both return `rows_read: 3`, `rows_kept: 2`, `total_revenue: 40`. `result.cleaned_csv` contains `filename`, `mime`, and the exact CSV `content`. These programmatic calls receive decoded CSV text; they do not interpret that text as a file path or URL. The result includes accumulated pipeline intermediates. Remote artifact handles and the CLI/HTTP/MCP invocation adapters are subsequent work.

Build the browser form using the existing CLI:

```sh
node bin/jsee examples/clean-sales/schema.json -o tmp/clean-sales.html -f
```

Open that HTML file, upload a CSV, select the missing-price policy, and click Run. The generated form displays the summary, table, and CSV download. The browser test executes this form with HTTP requests blocked and checks the downloaded bytes.

CSV must have unique column names including `price` and `quantity`; extra columns and quoted fields are preserved. Prices and nonnegative quantities must be finite decimal numbers. Blank prices follow the selected policy; malformed rows and other invalid numbers fail. Revenue uses ordinary floating-point arithmetic in row order. Output records use LF separators, retaining line breaks inside quoted fields.

Shared cases: `test/fixtures/clean-sales.json`. Invocation semantics: `test/fixtures/invocation-contracts.json`.
