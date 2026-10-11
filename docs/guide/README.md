# Your first computation

[Home](../../README.md) · [Schema](../schema/README.md) · [Browser API](../browser/README.md) · [CLI, HTTP and MCP](../cli/README.md) · [Python](../../py/README.md)

Build a calculator that multiplies two numbers and offers a text report. Use the same files as a browser app, a command-line computation, an HTTP API and an MCP tool. You need Node.js 20+ for the JavaScript version; the [Python variation](#use-python-instead) needs Python 3.9+.

## Create the files

Create an empty directory and run `npm install @jseeio/jsee`. Save these two files there.

`schema.json`:

```json
{
  "schemaVersion": 1,
  "id": "multiply",
  "title": "Multiply two numbers",
  "description": "Multiply left and right and produce a downloadable text report.",
  "model": { "url": "model.js", "name": "multiply", "worker": true },
  "inputs": [
    { "name": "left", "type": "float", "default": 3 },
    { "name": "right", "type": "float", "default": 4 }
  ],
  "outputs": [
    { "name": "product", "type": "number" },
    { "name": "report", "type": "file", "filename": "result.txt", "mime": "text/plain" }
  ]
}
```

`model.js`:

```js
function multiply({ left, right }) {
  const product = left * right
  return { product, report: `${left} × ${right} = ${product}\n` }
}

if (typeof module !== 'undefined') module.exports = multiply
```

The named function works in the browser; the guarded export also makes it available to Node. The model receives one object with input names and returns an object matching the declared output names. It does not need to know about forms, HTTP or MCP.

## Open the browser app

```sh
npx @jseeio/jsee schema.json --client
```

Open `http://localhost:3000` and click **Run**. The default inputs produce `12` and a report containing `3 × 4 = 12`. Here `--client` selects browser execution, and the schema asks for a worker. Stop the server with Ctrl+C before the HTTP step below uses the same port.

## Call it from the terminal

Save `input.json`:

```json
{"left":3,"right":4}
```

Inspect the interface, validate the descriptor, then execute:

```sh
npx @jseeio/jsee inspect schema.json --json
npx @jseeio/jsee validate schema.json
npx @jseeio/jsee run schema.json --input input.json --json
```

Inspection shows the input/output JSON Schemas without loading the model. Validation checks the descriptor, not whether the computation is correct. Execution returns a JSON envelope like this (IDs, hashes and paths vary):

```json
{
  "runId": "...",
  "status": "succeeded",
  "outputs": { "product": 12, "report": { "artifact": ".../0" } },
  "artifacts": [
    {
      "id": ".../0", "output": "report", "name": "result.txt",
      "mime": "text/plain", "size": 12, "sha256": "...", "uri": "file:///..."
    }
  ]
}
```

Read the file at the returned `file:` URI. Artifacts persist under `.jsee-artifacts/` in your working directory. The canonical command returns declared outputs only; it does not leak intermediate pipeline values. Models execute in Node for this step, not in browser workers.

## Serve the computation

```sh
npx @jseeio/jsee serve schema.json --port 3000
```

Open `http://localhost:3000` for the form, or use another terminal:

```sh
curl http://localhost:3000/run \
  -H 'Content-Type: application/json' \
  --data-binary @input.json
```

You get the same output/artifact envelope. In this mode the model runs on the server; the form and HTTP call share `/run`. The report URI is a relative HTTP download path. Fetch it from `http://localhost:3000` while that server is running. Discovery is available at `/schema` and `/openapi.json`.

The server binds to localhost by default. For authenticated hosting, see [HTTP authentication and CORS](../cli/README.md#http-authentication-and-cors). Auth does not sandbox the model. Stop with Ctrl+C when finished; HTTP artifacts belong to that server lifetime.

## Connect an agent through MCP

In an MCP client that supports local stdio servers, add a server entry like the following. Replace `/absolute/path/multiply/schema.json` with the actual absolute path to your descriptor. Client configuration file locations differ.

```json
{
  "mcpServers": {
    "multiply": {
      "command": "npx",
      "args": [
        "--yes", "--package", "@jseeio/jsee@0.9.0", "jsee",
        "serve", "/absolute/path/multiply/schema.json", "--mcp-only"
      ]
    }
  }
}
```

Restart or reconnect the client. Ask it to call `multiply` with `left: 3` and `right: 4`. The tool returns `product: 12`, the report handle and artifact metadata. An MCP resource read retrieves the report bytes. JSEE uses stdin/stdout for the protocol and opens no HTTP port in this mode; do not send ordinary terminal input to that process.

The agent calls the computation described by your schema. JSEE does not need an LLM SDK or API key. Tool access and approval settings belong to your MCP client. See [MCP over stdio](../cli/README.md#mcp-over-stdio) for upload chunks, quotas and session lifetime.

## Make an offline browser app

For the JavaScript version above:

```sh
npx @jseeio/jsee schema.json -o multiply.html --bundle=offline-strict
```

Open `multiply.html` with networking disabled and click **Run**. This example has no external model dependencies, so the generated file contains what it needs. The generated browser app runs locally; it does not include the Node HTTP or MCP server.

For models using API calls, external weights, dynamic imports or Python packages, read [bundle requirements](../cli/README.md#--bundle) before claiming offline support. Native ES-module and Python HTML export have additional constraints. Host-owned renderers and editor closures are not serialized automatically.

## Use Python instead

Install `python -m pip install jsee` and save this as `model.py` alongside the descriptor:

```python
def multiply(left: float, right: float) -> dict:
    product = left * right
    return {'product': product, 'report': f'{left:g} × {right:g} = {product:g}\n'}
```

In `schema.json`, replace only `model` with:

```json
{"url":"model.py","type":"py","entry":"multiply"}
```

Keep the same inputs, outputs and `input.json`. Use the Python environment’s `jsee` executable:

```sh
jsee inspect schema.json --json
jsee validate schema.json
jsee run schema.json --input input.json --json
jsee serve schema.json --port 3000
```

The product and report match the JavaScript version. No Node.js is needed for these commands or the served form. Python MCP additionally requires Python 3.10+ and `python -m pip install 'jsee[server]'`; configure the client’s command as the absolute path to that environment’s `jsee`, with `args: ["serve", "/absolute/path/multiply/schema.json", "--mcp-only"]`.

This step uses native Python on the server. Browser-only Python uses Pyodide and needs a browser-compatible package set; it is a separate deployment choice. See the [Python guide](../../py/README.md) for function annotations, streaming and deployment.

## Next steps

- Add a slider, choice, table, JSON or media input using the [schema reference](../schema/README.md#inputs).
- Reuse this computation inside a larger page with the [browser API](../browser/README.md).
- Build a file transformation with the [CSV cleaning example](https://github.com/jseeio/jsee/tree/main/examples/clean-sales).
- If initialization fails, check the browser console or server stderr. A failed canonical run has an `error.code` and `error.message`; see [error behavior](../cli/README.md#json-commands-and-canonical-http).
