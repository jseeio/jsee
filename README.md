# Focus on code, not UI

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

↳ [Result](https://jsee.org/test/minimal1.html) (if you see nothing, it's probably because today is Dec 29, and the CDN hasn't updated its cache yet)

## Execution environment

JSEE is a browser-based environment for processing tasks. It creates a graphical interface, executes code in a web worker or via API, bridges all pieces together into a user-friendly web app. In some cases, JSEE does all of that automatically, without any configuration. And when the configuration is required, it's just one JSON file with an [intuitive structure](#schema). 


## Inputs and outputs

JSEE works best with functional tasks and one-way flow from inputs to outputs (i.e., inputs → processing → outputs). You can also extend it to more complex scenarios, like inputs → preprocessing → updated inputs → processing → outputs or inputs → processing → outputs → custom renderer. Even though many computational tasks have a functional form, some problems require more complex interactions between a user interface and code. For such cases, JSEE is probably too constrained. That makes it not as universal as R's [shiny](https://shiny.rstudio.com/) or Python's [streamlit](https://streamlit.io/).


## How it works

Instead of dealing with raw HTML tags, input elements or charts, JSEE makes it possible to work on a higher level and describe only `inputs` and `outputs` in a JSON schema. It similarly handles code execution, by checking the `model` part of that JSON object. Those three parts are the most important for the future app. In many cases JSEE can generate a new schema automatically by analyzing the code alone. For example, it's possible to extract a list function arguments and use them as model inputs. When JSEE receives the JSON schema it creates a new Vue app based on it and initializes a new worker for code execution. The final app can take inputs from a user, parse files, load needed libraries, orchestrate communication between code and GUI, use Web Workers to run everything smoothly

```
            Schema   Model   Render*
   DEV ─►    json    js/py     js
              │        │        │
           ┌──▼────────▼────────▼───┐
           │      new JSEE (...)    │
           └──┬───────────────┬─────┘
              │               │
           ┌──▼──┐     ┌──────▼─────┐ ◄┐ tf.js
 USER  ◄─► │ GUI │ ◄─► │    Model   │ ◄│ pyodide
           └─────┘     └────────────┘ ◄┘ wasm
             Vue³        WebWorker*

 * - optional
```

JSEE takes a schema object that contains three main blocks:
- `model` - describes a model/script/API (its location, is it a function or class, should it be called automatically on every GUI change or not)
- `inputs` - list of inputs and their descriptions
- `outputs` - list of outputs and their descriptions

Two extra blocks can be provided for further customization
- `render` - visualization part (optional). Defines custom rendering code.
- `design` - overall appearance (optional). Defines how the app looks overwriting defaults.


### Schema

- `model` - Contains main parameters of the model/script
  - `url` (string) - URL of a JS/Python script or POST/GET API
  - `code` (function) - It's possible to pass code directly to JSEE instead of using an URL
  - `name` (string) - Name of the executed object. Default value is taken from `url` or `code`
  - `autorun` (boolean, default - `false`) - Defines if the script should be evaluated on each input change event
  - `type` (string, default - `function`) - What kind of script is loaded. Influences how the code is initializated. Possible values: 
    - `function`
    - `class` 
    - `async-function`
    - `async-init`
    - `py`
    - `tf`
  - `method` (string) - If `type` is `class`, `method` defines the name of the class method to call during evaluation
  - `container` (string) - How input values are passed to the function/method:
    - `object` (default) - Pass inputs wrapped in an object, i.e. `{'x': 1, 'y': 2}`
    - `args` - Pass inputs as separate arguments
  - `worker` (boolean) - If `true`, JSEE initializes a Web Worker to run the script
- `render` - Custom rendering script. Instead of relying on JSEE for output visualization, you can provide a custom script that visualizes the results. That can be useful if you rely on custom libs for plotting.
- `design` - Design parameters
  - `layout` - Layout for the model/input/output blocks. If it's empty and the JSEE container is not, JSEE uses inner HTML as a template. If the container is empty too, it uses the default `blocks` template.
  - `framework` - Design framework to use. If a JavaScript object with the same name is present in a global context, JSEE loads it too (using Vue's `use` method).
- `inputs` - Inputs definition
- `outputs` - Outputs definition

JSEE is a reactive branch of [StatSim](https://statsim.com)'s [Port](https://github.com/statsim/port). It's still work in progress. Expect API changes.
