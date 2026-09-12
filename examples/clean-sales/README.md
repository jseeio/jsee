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

Both return `rows_read: 3`, `rows_kept: 2`, `total_revenue: 40`. `result.cleaned_csv` contains `filename`, `mime`, and the exact CSV `content`. These programmatic calls receive decoded CSV text; they do not interpret that text as a file path or URL. The result includes accumulated pipeline intermediates. The JSON CLI/HTTP adapters below project declared outputs and store the CSV as a retrievable artifact. MCP uses the same output and artifact contract.

Use the JSON adapters from the repository root:

```sh
node bin/jsee inspect examples/clean-sales/schema.json
node bin/jsee validate examples/clean-sales/schema.json
node bin/jsee run examples/clean-sales/schema.json --input - <<'JSON'
{"csv":"price,quantity\n10,2\n20,1\n,3\n","missing":"drop"}
JSON
node bin/jsee serve examples/clean-sales/schema.json --port 3000
```

For installed Python, use `jsee run examples/clean-sales/schema-python.json --input -` or `jsee serve examples/clean-sales/schema-python.json --port 3000`. The same JSON request works in both runtimes:

```sh
curl http://127.0.0.1:3000/run -H 'Content-Type: application/json' --data-binary @- <<'JSON'
{"csv":"price,quantity\n10,2\n20,1\n,3\n","missing":"drop"}
JSON
```

The response has `outputs.summary` with the three counts above, `outputs.table`, and `outputs.cleaned_csv.artifact`. Download the CSV using the matching `artifacts[].uri` (relative to the HTTP server); verify its SHA256 against `artifacts[].sha256`. CLI artifact URIs are local `file:` paths and persist in `.jsee-artifacts/`. An agent can inspect the contract and run it through these CLI/HTTP interfaces today. MCP clients can discover and invoke the same descriptor.

For MCP, configure your client to launch `node` with arguments `['/absolute/path/jsee/bin/jsee', 'serve', '/absolute/path/schema.json', '--mcp-only']`. Use this example's JS descriptor. For Python, install the checkout's `./py[server]` extra, launch that environment's `jsee` with `['serve', '/absolute/path/schema-python.json', '--mcp-only']`.

The client discovers `clean_sales` through `tools/list`, then calls it with `{"csv":"price,quantity\n10,2\n20,1\n,3\n","missing":"drop"}`. `structuredContent.outputs.summary` contains the counts above. The result also includes the table and a `resource_link`; `resources/read` retrieves the cleaned CSV as a base64 blob. Decode it and verify the run's size/SHA256. An invalid policy returns `isError: true` with `JSEE_INPUT_INVALID` before model execution. No separate tool handler or form is needed in the example.

`npm run test:mcp` runs independent Node/Python SDK clients against both servers and all 13 shared CSV cases, including exact file bytes and invalid values. See the [MCP contract and limits](../../README.md#mcp-over-stdio).

Build the browser form using the existing CLI:

```sh
node bin/jsee examples/clean-sales/schema.json -o tmp/clean-sales.html -f
```

Open that HTML file, upload a CSV, select the missing-price policy, and click Run. The generated form displays the summary, table, and CSV download. The browser test executes this form with HTTP requests blocked and checks the downloaded bytes.

CSV must have unique column names including `price` and `quantity`; extra columns and quoted fields are preserved. Prices and nonnegative quantities must be finite decimal numbers. Blank prices follow the selected policy; malformed rows and other invalid numbers fail. Revenue uses ordinary floating-point arithmetic in row order. Output records use LF separators, retaining line breaks inside quoted fields.

Shared cases: `test/fixtures/clean-sales.json`. Invocation semantics: `test/fixtures/invocation-contracts.json`.
