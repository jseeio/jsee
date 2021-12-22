# Focus on code, not UI

JSEE is a highly opinionated GUI wrapper for processing tasks. Not even close to R's [shiny](https://shiny.rstudio.com/) or Python's [streamlit](https://streamlit.io/). Mostly used in [StatSim Apps](https://statsim.com/#apps) and [JSEE.io](https://jsee.io).

JSEE is based on the idea of declarative interface design and reactivity. Instead of writing a "glue" front-end code, you can declare inputs/outputs of a model in a JSON schema and JSEE will do the rest. JSEE creates a Vue app based on the provided schema, parses files, loads needed libraries, orchestrates communication between code and GUI and uses Web Workers to run everything smoothly. It's not a swiss-army knife, not a framework. JSEE solves one specific task - wrapping algorithms in a simple web interface.

## How it works
```
             Schema   Model   Render*
    DEV ->    json    js/py     js
               .        .        .
             __Y________Y________Y___
            |                        |
            |      new JSEE (...)    |
            |________________________|
               .               .
             __Y__       ______Y_____
            |     |     |            | <~ tf.js
  USER  <-> | GUI | <-> |    Model   | <~ pyodide
            |_____|     |____________| <~ wasm
              Vue³        WebWorker*

* - optional
```

JSEE takes a schema object that contains five main blocks:

- `model` - describes a model/script (its location, is it a function or class, should it be called automatically on every GUI change)
- `render` - visualization part (optional)
- `design` - overall appearance (optional)
- `inputs` - list of inputs and their descriptions
- `outputs` - list of outputs and their descriptions (optional)

### Config/schema object

- `model` - Contains main parameters of the model/script
  - `url` (string) - URL of a JS/Python file to load, or:
  - `code` (function) - It's possible to pass functions directly to JSEE instead of using an URL
  - `name` (string) - Name of the callable object. Default value is taken from `url` or `code`
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

JSEE is a reactive version of StatSim's [Port](https://github.com/statsim/port)
