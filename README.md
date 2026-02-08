# JSEE

Minimal example:
```html
<html>
  <div id="jsee-container">
  <script src="https://cdn.jsdelivr.net/npm/@jseeio/jsee@latest/dist/jsee.runtime.js"></script>
  <script>
    function mul (a, b) {
      return a * b
    }
    new JSEE(mul, '#jsee-container')
  </script>
</html>
```

↳ [Result](https://jsee.org/test/minimal1.html)

## JavaScript Execution Environment

JSEE is a browser-based environment for processing tasks. It creates a graphical interface, executes code in a web worker or via API, bridges all pieces together into a user-friendly web app. In some cases, JSEE does all of that automatically, without any configuration. And when the configuration is required, it's just one JSON file with an [intuitive structure](#schema).

## Inputs and outputs

JSEE works best with functional tasks and one-way flow from inputs to outputs (i.e., inputs → processing → outputs). You can also extend it to more complex scenarios, like inputs → preprocessing → updated inputs → processing → outputs or inputs → processing → outputs → custom renderer. Even though many computational tasks have a functional form, some problems require more complex interactions between a user interface and code. For such cases, JSEE is probably too constrained. That makes it not as universal as R's [shiny](https://shiny.rstudio.com/) or Python's [streamlit](https://streamlit.io/).

## How it works

Instead of dealing with raw HTML tags, input elements or charts, JSEE makes it possible to work on a higher level and describe only `inputs` and `outputs` in a JSON schema. It similarly handles code execution, by checking the `model` part of that JSON object. Those three parts are the most important for the future app. In many cases JSEE can generate a new schema automatically by analyzing the code alone. For example, it's possible to extract a list function arguments and use them as model inputs. When JSEE receives the JSON schema it creates a new Vue app based on it and initializes a new worker for code execution. The final app can take inputs from a user, parse files, load needed libraries, orchestrate communication between code and GUI, use Web Workers to run everything smoothly

```text
            Schema   Model   Render*
   DEV  -►   json    js/py     js
              |        |        |
           ┌──▼────────▼────────▼───┐
           │      new JSEE (...)    │
           └────────────────────────┘
              |               |
           ┌──▼──┐     ┌──────▼─────┐ ◄~ tf.js
 USER  ◄-► │ GUI │ ◄-► │    Model   │ ◄~ pyodide
           └─────┘     └────────────┘ ◄~ wasm
             Vue³        WebWorker*

 * - optional
```

JSEE takes a schema object that contains three main blocks:

- `model` - describes a model/script/API (its location, is it a function or class, should it be called automatically on every GUI change or not)
- `inputs` - list of inputs and their descriptions
- `outputs` - list of outputs and their descriptions

Extra blocks can be provided for further customization

- `render` - visualization part (optional). Defines custom rendering code.
- `design` - overall appearance (optional). Defines how the app looks overwriting defaults.
- `imports` - a list of urls (optional). Defines a list of scripts to load before the model is initialized.

  ```json
  "imports": [
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs",
    "https://cdn.jsdelivr.net/pyodide/v0.17.0/full/pyodide.js"
  ]
  ```

- `examples` - a list of examples (optional). Defines a list of examples that can be used to overwrite inputs.

  ```json
  "examples": [
    { "input": "My name is Anton and I am" },
  ]
  ```

## Playground

- [Codepen](https://codepen.io/jseeio/pen/NWayjJe)

## Schema

- `model` - Contains main parameters of the model/script
  - `url` (string) - URL of a JS/Python script or POST/GET API
  - `code` (function) - It's possible to pass code directly to JSEE instead of using an URL
  - `name` (string) - Name of the executed object. Default value is taken from `url` or `code`
  - `type` (string, default - `function`) - What kind of script is loaded. Influences how the code is initializated. Possible values:
    - `function`
    - `class`
    - `async-function`
    - `async-init`
    - `py`
    - `tf`
    - Inference note: when `code` is present (including code loaded from a `.js` URL), JSEE treats the model as `function` unless `type` is explicitly set
  - `method` (string) - If `type` is `class`, `method` defines the name of the class method to call during evaluation
  - `container` (string) - How input values are passed to the function/method:
    - `object` (default) - Pass inputs wrapped in an object, i.e. `{'x': 1, 'y': 2}`
    - `args` - Pass inputs as separate arguments
  - `worker` (boolean) - If `true`, JSEE initializes a Web Worker to run the script
    - For `container: 'object'`, model functions receive a second runtime context argument (`ctx`)
    - `ctx.log(...args)` - Write runtime logs
    - `ctx.progress(value)` - Report progress (`0..100` or `null` for indeterminate)
    - `ctx.isCancelled()` - Check cooperative cancellation state (useful in long loops/streams)
- `render` - Custom rendering script. Instead of relying on JSEE for output visualization, you can provide a custom script that visualizes the results. That can be useful if you rely on custom libs for plotting.
- `design` - Design parameters
  - `layout` - Layout for the model/input/output blocks. If it's empty and the JSEE container is not, JSEE uses inner HTML as a template. If the container is empty too, it uses the default `blocks` template.
  - `framework` - Design framework to use. If a JavaScript object with the same name is present in a global context, JSEE loads it too (using Vue's `use` method).
- `inputs` - Inputs definition.
  - `name`* - Name of the input
  - `type`* - Type. Possible types:
    - `int`, `float` or `number` - Number
    - `string` - String
    - `text` - Textarea
    - `checkbox` or `bool` - Checkbox
    - `select` or `categorical` - Select (one of many `options`)
    - `file` - File Input
    - `action` or `button` - Button (its `name` will be passed as a `caller` to the model)
  - `default` - Default value
  - `raw` (boolean, file input only) - If `true`, pass the raw source to the model instead of reading text in the UI (`File` object for disk files or `{ kind: 'url', url: '...' }` for URL input)
  - `stream` (boolean, file input only) - If `true`, pass an async iterable `ChunkedReader` to the model instead of raw source handles. Supports `for await (const chunk of reader)`, `await reader.text()`, `await reader.bytes()`, and `for await (const line of reader.lines())`. Works in both main-thread and worker execution. Reader metadata (`reader.name`, `reader.size`, `reader.type`) is preserved and remains available in downstream pipeline models.
  - URL params for file inputs (e.g. `?file=https://...`) auto-load on init, so bookmarkable links run without an extra Load click
- `outputs` - Outputs definition
  - `name`* - Name of the output
  - `type`* - Type. Possible types:
    - `file` - File output (not displayer, but downloaded)
    - `object` - JavaScript Object
    - `html` or `svg` - SVG element
    - `code` - Code block
    - `function` - Render function. Rather than returning a value, a model returns a function that JSEE will call passing the container element.
    - `blank` - Blank block (can be alternative to `function` and useful for custom renderers)
- `examples` - List of examples
- `autorun` (boolean, default: `false`) - Run the model automatically on first load
- `reactive` (boolean, default: `false`) - Re-run the model on any input change (debounced). For per-input reactivity, set `reactive: true` on individual inputs instead
- `interval` (number, default: `0`) - Defines the interval between script evaluations (in milliseconds). If set to `0`, the script is evaluated only once.
- Runtime cancellation: call `jsee.cancelCurrentRun()` on the JSEE instance to request stop of the active run. Long-running models should check `ctx.isCancelled()` and return early.
- Schema validation - JSEE validates schema structure during initialization and logs warnings for non-critical issues (e.g. unknown input types, malformed aliases)

JSEE is a reactive branch of [StatSim](https://statsim.com)'s [Port](https://github.com/statsim/port). It's still work in progress. Expect API changes.

# CLI
- `--fetch` - Fetches JSEE code, models and their imports and generates a bundled HTML file
- `--cdn` - Use CDN for models (can be string with a base URL or boolean to infer from package.json). Model urls will be prefixed with the CDN URL. This helps with deployment to static hosts (e.g. GitHub Pages).
- `--execute` - Executes the model code on the server-side. 
# Server-side execution

# Changelog

See `CHANGELOG.md`.
