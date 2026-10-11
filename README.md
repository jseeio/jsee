# JSEE

One computation, a web UI, a command line and an agent tool.

Describe inputs, outputs and a model in a JSON schema. JSEE builds the form, runs the model and displays its results. The same descriptor can expose a supported model through a CLI, HTTP API or MCP tool. JavaScript runs in the browser or Node.js; Python runs through Pyodide in the browser or natively on a Python server.

```text
                 schema + model
                       │
           ┌───────────┼───────────┐
           ▼           ▼           ▼
        Browser    CLI / HTTP   MCP tool
        for people  for programs for agents
```

## Try it in the browser

Save this complete example as `index.html` and open it. Enter two numbers and click **Run**; `3` and `4` produce `12`. This example loads JSEE from the CDN, then computes locally.

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Multiply with JSEE</title>
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@0.9.0/dist/jsee.core.js"></script>
<script>
  function multiply(a, b) {
    return a * b
  }
  new JSEE(multiply, '#app')
</script>
</html>
```

JSEE infers a simple form from this function. Use an explicit schema when you need types, defaults, descriptions, files or named outputs.

## When JSEE fits

Use JSEE for calculators, data transformations, simulations and model interfaces that need a reusable computation behind them. It supplies forms, file inputs, workers, progress, cancellation and output rendering. Browser apps can keep data on the device; [bundling](docs/cli/README.md#--bundle) can make a computation portable as an HTML file.

It also [embeds in an existing application](docs/browser/README.md#host-owned-regions), with host-owned controls and persistent renderers. The host still owns routing, accounts and collaboration. JSEE is not an application framework or a sandbox for untrusted code.

## Installation

**Browser** — no build step:

```html
<script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@0.9.0/dist/jsee.core.js"></script>
```

**JavaScript** — CLI and Node.js execution:

```sh
npm install @jseeio/jsee
```

Use `npx @jseeio/jsee` to run the installed CLI. It requires Node.js 20+.

**Python** — includes the browser runtime; no Node.js required:

```sh
python -m pip install jsee
```

Requires Python 3.9+. For Python MCP support, use Python 3.10+ and `python -m pip install 'jsee[server]'`. Models may need additional packages.

These docs describe **0.9.0**. Pin package versions when reproducing a deployment. See [runtime bundles](docs/schema/README.md#runtime-bundles) for core versus full and [development](docs/development/README.md) for installation from a checkout.

## Quick start

### JavaScript: create an app

In an empty directory:

```sh
npx @jseeio/jsee init
npx @jseeio/jsee schema.json --client
```

The first command creates `schema.json`, `model.js` and a README. Open `http://localhost:3000` to use the generated form; `--client` runs its model in the browser. Stop the development server with Ctrl+C.

For a complete example you can call from the UI, CLI, HTTP and an MCP client, follow [Your first computation](docs/guide/README.md). It includes every file and the expected results.

### Python: serve a function

Save as `app.py`:

```python
import jsee


def multiply(a: float, b: float = 2.0) -> float:
    return a * b


if __name__ == '__main__':
    jsee.serve(multiply, port=5050)
```

Run `python app.py`, then open `http://localhost:5050`. The form uses the function’s type hints. You can also call it from another terminal:

```sh
curl http://localhost:5050/multiply \
  -H 'Content-Type: application/json' \
  -d '{"a":3,"b":4}'
```

The response is `{"result":12.0}`. Stop the server with Ctrl+C. For the shared `/run` endpoint and an MCP tool, use a file-backed descriptor as shown in the [tutorial](docs/guide/README.md#use-python-instead). See [JSEE for Python](py/README.md) for annotations, schema generation, streaming and WSGI deployment.

## How it works

The schema names a `model`, declares its `inputs` and describes its `outputs`. Browser JSEE creates editable controls, loads the model and routes returned values to matching output names. Models can run in workers and report progress; an array of models forms a pipeline. The browser API lets a host update controls, invoke a run, stop it and dispose of resources.

CLI, HTTP and MCP derive their input/output descriptions from the same schema. They validate values and return declared outputs. File and media results use retrievable artifacts; their handles can be passed to another run in the same store. Models stay ordinary source files. A runtime must support the model’s language and execution features; moving a descriptor does not translate its code.

<!-- Retain entry points from the previous single-page reference. -->
<a id="schema"></a>
<a id="schema-blocks"></a>
<a id="structured-and-media-inputs"></a>
<a id="runtime-bundles"></a>
<a id="jsee-instance-api"></a>
<a id="cli--nodejs"></a>
<a id="cli--python"></a>
<a id="python"></a>
<a id="mcp-over-stdio"></a>
<a id="json-commands-and-canonical-http"></a>
<a id="http-authentication-and-cors"></a>
<a id="repository-verification"></a>

## Documentation

| I want to… | Start here |
|---|---|
| Build and call a complete computation | [Tutorial: UI → CLI → HTTP → MCP](docs/guide/README.md) |
| Choose controls, outputs or a theme | [Schema reference](docs/schema/README.md) |
| Embed an app, handle progress or update a renderer | [Browser API](docs/browser/README.md) |
| Run a pipeline, serve an API or exchange files | [CLI, HTTP and MCP](docs/cli/README.md) |
| Bundle an app for offline use | [Bundle modes and requirements](docs/cli/README.md#--bundle) |
| Serve a Python function or deploy with WSGI | [Python guide](py/README.md) |
| Build, test or contribute to JSEE | [Development](docs/development/README.md) |

Runnable source examples include [CSV cleaning and downloads](https://github.com/jseeio/jsee/tree/main/examples/clean-sales), [Python CSV summary](https://github.com/jseeio/jsee/tree/main/examples/python-summary), [ranked scores](https://github.com/jseeio/jsee/tree/main/examples/scores) and [live light/dark styling](https://github.com/jseeio/jsee/blob/main/examples/mono-theme.html). Follow each example’s serving instructions; some require a built runtime or model dependencies.

## Status and limitations

- Browser regression coverage qualifies Chromium. Firefox and WebKit are not yet qualified. Strict Python/WASM CSP deployments need separate verification; see the [worker/CSP reference](docs/schema/README.md#security-and-csp).
- Native Node and Python canonical invocation support local, terminal computations. Schema imports, streaming and remote model execution are outside that invocation path. Browser execution and legacy streaming routes have different capabilities; see [whole-pipeline invocation](docs/cli/README.md#whole-pipeline-invocation).
- Identified pipeline stages are supported in browser/Node execution, not native Python. [Named stages](docs/browser/README.md#named-stages-in-the-existing-pipeline) are optional; ordinary sequential pipelines remain available.
- MCP supports one descriptor over **stdio**. Remote MCP, canonical streaming and forced server-side cancellation are pending.
- Worker isolation keeps computation off the UI thread. Browser security flags gate JSEE operations; server execution runs trusted code with the process’s permissions. Neither is an OS sandbox.
- Offline use depends on the model’s assets and dependencies. API models need their server; Python bundles need Pyodide assets and declared packages. See [bundle modes](docs/cli/README.md#--bundle).

### Versioning

JavaScript and Python share a major/minor compatibility line; compatible fixes can have different patch versions. `schemaVersion: 1` versions the descriptor format separately. Omitting it retains version-1 behavior. Package version agreement does not remove runtime-specific limits.

## Development and help

See [development and verification](docs/development/README.md) for builds, tests and documentation checks. Report problems with the descriptor, runtime version and reproducer in [GitHub issues](https://github.com/jseeio/jsee/issues). JSEE is [MIT licensed](LICENSE).

## Changelog

See the [changelog](CHANGELOG.md) for release changes.
