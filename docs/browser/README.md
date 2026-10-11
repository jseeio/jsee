# Browser API and embedding

[Home](../../README.md) · [First computation](../guide/README.md) · [Schema](../schema/README.md) · [Browser API](../browser/README.md) · [CLI, HTTP and MCP](../cli/README.md) · [Python](../../py/README.md)

Use these APIs when a host page controls an app, keeps a model loaded, or supplies custom rendering. Load `dist/jsee.core.js` (or `jsee.full.js`) with a script tag; the Node package entry is the CLI, not the browser constructor. Examples below are integration fragments unless marked as complete.

On this page: [Methods](#jsee-instance-api) · [Cancellation](#cooperative-cancellation) · [Controls/progress](#host-control-state-and-progress) · [Image input](#image-acquisition-in-browser-apps) · [Renderers](#persistent-output-renderers) · [Annotations](#image-annotations-and-source-coordinates) · [Pipelines](#named-stages-in-the-existing-pipeline) · [Embedding](#host-owned-regions)

## JSEE instance API

After creating an instance with `new JSEE({schema, container})`, these methods are available:

Multiple JSEE instances can run on the same page; progress and overlay DOM nodes are scoped per instance.

| Method | Description |
|---|---|
| `await jsee.ready` | Wait for schema, model, UI and pipeline initialization; rejects on failure or destruction |
| `await jsee.setDesign(patch)` | Change theme, color scheme and layout without recreating the app; see [design](../schema/README.md#design) |
| `jsee.getInputs()` | Read a snapshot of input values after readiness; named groups remain nested |
| `await jsee.setInputs(values)` | Patch input values by schema name, including nested groups; unknown names reject atomically. Does not run unless schema reactivity is enabled |
| `await jsee.setInputState(path, patch)` | Update `disabled`, `readonly`, boolean `display` or choice `options` without changing values or triggering a run |
| `await jsee.invoke(values?)` | Run once and return declared output values (or the pipeline result when no outputs are declared). Rejects on validation, execution failure, overlap, or cancellation (`AbortError`) |
| `jsee.on(event, listener)` | Subscribe to `inputs`, `start`, `result`, `error`, `cancel`, `destroy`, `stage`, or `progress`; returns an unsubscribe function. Listener exceptions do not affect execution |
| `await jsee.stop(options?)` | Stop and wait for invocation settlement; forced by default. Opt into cooperative cancellation with `{ mode: 'cooperative', graceMs: 1000 }`; returns `{ retained }` |
| `jsee.run(caller)` | Execute the model pipeline. `caller` can be `'run'`, `'autorun'`, `'reactive'`, `'interval'`, or a custom button name |
| `jsee.output(result)` | Process and render results to output cards |
| `jsee.cancelCurrentRun()` | Stop the active run. Rejects the current run promise, sets cancellation state, and signals/terminates workers |
| `jsee.isCancelled()` | Returns `true` if cancellation was requested |
| `jsee.progress(value, details?)` | Report progress: `0`–`100` for determinate, `null` for indeterminate; optional `loaded`, `total` and `phase` metadata |
| `jsee.download(title)` | Export the current app; see [offline requirements](../cli/README.md#--bundle) |
| `jsee.destroy()` | Cancel runs and initialization fetches, terminate workers, unmount Vue, and release UI resources. Repeated calls are safe; later runs return `false` and late progress/output calls are ignored |
| `jsee.notify(text)` | Show a success toast notification |
| `jsee.log(...args)` | Log to browser console and optional `#log` DOM element as plain text |

### Cooperative cancellation

`stop()` still terminates workers by default. To retain a loaded model when its
operation can finish cleanup, use:

```js
const { retained } = await tool.stop({ mode: 'cooperative', graceMs: 1000 })
// The cancelled invoke() rejects with AbortError. After stop() resolves,
// another invocation can reuse the model when retained is true.
```

Browser JavaScript model contexts expose `ctx.signal`, an AbortSignal for the
current invocation, alongside `ctx.isCancelled()`. Pass it to abortable work:

```js
async function model(data, ctx) {
  const response = await fetch(data.url, { signal: ctx.signal })
  return { text: await response.text() }
}
```

For batched computation, yield to the event loop and check cancellation between
batches. A worker cannot receive cancellation while synchronous code blocks its
message loop. Cooperative Stop suppresses subsequent outputs/progress, prevents
downstream stages from running, and keeps the run slot occupied until the model
settles. Cleanup belongs in the model's `finally`; completed mutations are not
rolled back automatically. `retained` reports runtime retention; the adapter
owns recovery and whether its model state remains usable.

The grace period defaults to 1000 ms. If an active worker has not settled, JSEE
falls back to forced Stop, discards its workers and returns `retained: false`.
Main-thread JavaScript cannot be preempted: cooperative Stop waits for it to
settle even beyond the grace period. Run potentially blocking models in workers.
Call cooperative Stop after `ready`; before readiness it rejects without claiming
retention. Use `destroy()` to dispose initial setup. Reinitialization has no
cancellable invocation context and uses forced teardown. Explicit `stop()` or `destroy()` can escalate a pending
cooperative stop; destroy always releases the instance's resources. Native
runtimes need not supply `ctx.signal`.

### Host control state and progress

```js
const tool = new JSEE({ schema, container: '#app', progress: false })
await tool.ready
await tool.setInputState('model', { disabled: true })
await tool.setInputState(['settings', 'target'], {
  options: [{ value: 'price', label: 'Price' }]
})
const unsubscribe = tool.on('progress', event => {
  // { runId, stageId, mode, value, loaded?, total?, phase? }
  showProgress(event)
})
// In a model: ctx.progress(50, { loaded: 1024, total: 2048, phase: 'load' })
```

A string path is one literal field name, including any dots. An array traverses
named groups; unnamed groups share their parent's namespace. Named pipeline
scopes are ordinary input groups. Groups support `display` updates only; set
`disabled`/`readonly` on their fields. Unknown paths, unsupported properties and
invalid patches reject before changing anything. State patches preserve values,
do not emit `inputs`, and do not run reactive models or invalidate stage caches.
Changing options retains the current selection; an unavailable selection fails
normal validation until the caller or user explicitly changes the value.
`readonly` uses native readonly controls where possible and disables selectors,
sliders and other controls without a native readonly mode. Presentation state
does not bypass validation or authorize execution.

`progress: false` hides JSEE's progress bars while keeping `progress` events.
It is a constructor option, independent of `controls` and `toasts`. Each event
has a per-instance invocation `runId` and a named `stageId` (or `null` for unnamed
stages); progress outside an invocation has `runId: null`. `mode` is
`determinate` or `indeterminate`, and `value` is a clamped percentage or `null`.
Byte counts and phase are included only when supplied. Progress 100 does not mean
the model is ready; use the invocation's terminal result/error/cancel instead.
The runtime may emit zero when resetting progress after a worker call.

Use `ctx.progress` inside models so reports are bound to that invocation. Tagged
worker messages and retired contexts cannot update a newer call. Legacy manually
posted messages without request identity remain supported, but late messages from
that legacy path cannot be reliably attributed. Stop still terminates workers;
cooperative model retention is a separate feature.

### Image acquisition in browser apps

An `image` input accepts upload, drop and paste into its focused control. Paste
inside a text field stays text. Enable camera snapshots in the same descriptor:

```json
{"name":"photo","type":"image","accept":"image/*","capture":{"camera":true,"live":true,"maxFps":5}}
```

The generated control offers Camera, Use snapshot and, for ordinary pipelines,
Live. Camera access requires browser permission on a secure origin. `facingMode`
is optionally `"user"` or `"environment"` (default). `maxFps` defaults to 5 and
must be greater than zero and at most 60. Actual throughput depends on capture
and execution time. Snapshots use PNG, JPEG or WebP according to `accept`.

Custom layouts use the same acquisition implementation:

```js
await app.ready
const image = app.createImageInput('photo', {
  target: document.querySelector('#image-stage'), // scoped paste/drop target
  picker: document.querySelector('#image-file'), // optional native file input
  video: document.querySelector('#camera'),     // required for camera capture
  onImage: file => showPreview(file),           // selection is already stored
  onState: ({ active, pending, live }) => updateCameraButton(active, pending, live),
  onError: error => showError(error.message)
})
await image.start({ live: true })
await image.stop({ snapshot: true }) // release camera; keep its last image
image.dispose()                     // remove listeners and release tracks
```

Use an array path for named groups, such as `['settings', 'photo']`. `select(files)`
uses the same validation and selection path as upload/paste. `start()` opens a
snapshot preview; `start({live:true})` requires `capture.live`. `stop()` releases
tracks immediately and waits for an in-flight frame consumer. Each live frame
waits for the previous consumer; no capture queue accumulates. A host can supply
`onFrame: async file => ...` to handle frames itself. Do not await `stop()` or
`select()` from inside `onFrame`, since those wait for that callback to settle.

The default live consumer invokes an ordinary pipeline without changing stored
form inputs. Its general API is `app.invoke(values, {transient:true})`: supplied
values are validated for this run but are not stored in the form. Named pipelines
keep their existing explicit target/override semantics; a custom layout must
provide `onFrame` to choose that target. The generated named-pipeline control
supports snapshots only.

Disable/readonly changes, runtime Stop, page hiding and disposal stop capture.
Destroying the app disposes its acquisition instances. Stopping capture alone
does not cancel model execution; `app.stop()` controls execution separately.
Frames use encoded files by default. Opt into decoded live frames with
`capture: {camera:true, live:true, transport:"bitmap"}`. The callback then receives
an `ImageBitmap`; snapshots and uploads still supply files. Local browser JS
models must handle that distinction. Python and remote models require files.

A bitmap passed to `app.invoke({photo: bitmap}, {transient:true})` remains owned
by the caller. Each model call borrows a separate copy; worker delivery transfers
only that copy. JSEE closes model copies after settlement, including failures;
forced worker termination disposes the worker. A model may close its borrowed
copy early, but must copy it itself if it needs to retain it. Return files or
pixel data, not borrowed bitmaps. Ordinary buffers keep their existing cloning
behavior. Named stages use `invoke(undefined, {target, transient:true,
overrides:{photo:bitmap}})`; frames do not enter retained stage results.

The capture callback borrows its frame only until its returned promise settles;
JSEE also closes late frames after Stop/disposal. Bitmaps cannot be stored with
`setInputs` or sent through JSON, Python or HTTP/MCP. There is no automatic
fallback that changes a bitmap model's input type. This avoids PNG encode/decode
on the live path, but does not promise zero-copy execution or a particular speed.
Capture UI and permission are browser-only; HTTP, CLI and MCP continue to accept ordinary image files or artifact references. JSEE
owns acquisition and execution; models retain preprocessing and inference.

### Persistent output renderers

Pass a `renderers` map when constructing an embedded app, and select a name with
`output.renderer`. The output keeps its computation data type: workers return
ordinary data, and CLI/HTTP/MCP keep the same declared output schema.

```js
function countView(container, initial) {
  const label = document.createElement('span')
  container.append(label)
  const update = data => { label.textContent = String(data.count) }
  update(initial)
  return {
    update,
    dispose() { /* release listeners, observers or graphics resources here */ }
  }
}

const app = new JSEE({
  container: '#app',
  renderers: { count: countView },
  schema: {
    inputs: [{ name: 'n', type: 'int', default: 1 }],
    model: { worker: true, code: ({ n }) => ({ result: { count: n * 2 } }) },
    outputs: [{ name: 'result', type: 'object', renderer: 'count' }]
  }
})
```

The factory runs once as `renderer(container, initialData)` and returns
`{ update(data), dispose?() }`. Later output values call `update` on that same
view. JSEE does not clear its DOM on updates, so the view can retain selection,
scroll or zoom. Submit a new output value to trigger an update; nested in-place
mutations are not watched. Synchronous updates in one UI tick may be coalesced
into the latest value; this is a view lifecycle, not an event log.

Hooks run synchronously on the UI thread. If a renderer starts asynchronous
work, it owns cancellation and checks that late results still belong to the
current source. `dispose` releases its listeners, observers, timers and graphics
resources; JSEE clears the container. Replacing the renderer or output descriptor,
removing the output, clearing its value to `undefined`, blocking its media output,
or destroying the app disposes it once. `null` is a data value passed to the view.
CSS hiding, output tabs and hidden host regions preserve mounted views; setting
`output.display: false` removes the component and disposes it. Update errors
retire the view and show an error in its card; a subsequent value can mount again.

Registrations are copied at construction and scoped to the instance. Two apps
may use the same name for different renderers. Unknown names and invalid
controllers show explicit errors. The registry applies to leaf outputs; group
containers retain their existing layout. Existing function outputs that return
a cleanup function remain supported. Registered code is trusted host code;
security options gate JSEE-managed operations, not arbitrary renderer code.
Save/Copy still use the output's declared data type.

Schema export retains renderer names. Standalone `exportHTML()` and `download()`
reject outputs with host renderer registrations: they cannot serialize host
closures and dependencies. Bundle the host application with its renderer imports,
or remove `output.renderer` to use built-in presentation. The `minimal`/`bulma`
theme selection is independent; the registry does not replace Vue themes.

See [the persistent views example](https://github.com/jseeio/jsee/tree/main/examples/persistent-renderers/index.html): a
selectable sensor table and a chart keep selection and scale across worker runs.
TypeScript helpers `OutputRenderer<T>`, `RendererView<T>` and `RendererRegistry`
are exported from `@jseeio/jsee/schema`.

### Image annotations and source coordinates

`JSEE.imageView(container, initial, options)` is a reusable renderer factory.
Bundled hosts can import `{ imageView }` from `@jseeio/jsee/image-view`. Register
it under an application name, or mount it directly in a host-owned region and
call `dispose()` when that region is removed. The same update/dispose lifecycle
works in both cases. [The annotation example](https://github.com/jseeio/jsee/tree/main/examples/image-annotations/index.html)
uses worker results, a mask, a box and a point without ML dependencies.

```js
const view = JSEE.imageView(container, {
  source: imageFile, revision: 1,
  boxes: [{ x: 10, y: 20, width: 100, height: 80, color: '#fff' }],
  points: [{ x: 60, y: 60 }],
  masks: [{ width: 1, height: 1, data: [255, 0, 0, 255],
    extent: { x: 10, y: 20, width: 100, height: 80 }, opacity: 0.4 }]
}, { onSelect: ({ x, y, revision }) => console.log(x, y, revision) })
await view.ready
view.setViewport({ zoom: 2, panX: 10, panY: 0 })
view.update({ revision: 1, points: [{ x: 70, y: 60 }] })
```

Coordinates refer to the decoded/oriented source image, independent of screen
size or device pixel ratio. Masks are row-major RGBA bytes with explicit grid
width/height and an `extent` in source pixels; JSEE does not infer mask scaling,
decode model tensors or normalize scores. Masks paint without interpolation.
Boxes and point markers use the same source coordinates. `fit` is `contain`
by default; `cover` and `fill` are also supported. `mirror: true` flips source
presentation and its coordinate mapping together. Pan offsets are CSS pixels.

`sourceToClient({x,y})` and `clientToSource({x,y})` map to/from viewport CSS
coordinates; the latter includes `inside` and does not clamp letterbox clicks
onto an image edge. Mapping returns `null` before source pixels are available.
Transform precision does not undo pointer-event rounding when a large image is
scaled down. `onSelect` reports source coordinates and the current revision;
it does not execute a model. Hosts can use `setInputs` and invoke explicitly.
`setSelection(pointOrNull)` changes the marker without emitting another click.

Every new source requires an increasing nonnegative integer `revision`.
Updates for older revisions return `false`. An update at the current revision
can replace boxes, points or masks; omitted fields remain unchanged. Use empty
arrays to clear layers. Changing the source with the same revision throws.
A new revision clears the prior layers, selection, zoom and pan. Annotation-only
updates keep that state. Use `getState()` to read viewport and selection.

Sources may be URLs, Blobs/Files, bitmaps, canvases, or image/video elements.
URL/Blob decoding is asynchronous; `ready` resolves `true` when the current load
is accepted, or `false` on failure/supersession. `onError` receives load failures.
Owned decoded bitmaps close on replacement/disposal, including late loads;
caller-supplied bitmaps and media elements remain caller-owned. Dispose releases
observers/listeners and view references. This is browser presentation, not a
new model input/output transport; borrowed bitmap execution restrictions remain.

For an existing image/video, use `{ overlay: true }` and set `source` to that
element. The view paints only annotations and follows the media element's
object-fit box and pixel/percentage object-position on resize/load. The host owns playback, positioning and
viewport transforms; `setViewport` is unavailable in overlay mode. Match
`mirror` to the host's horizontal mirroring. Arbitrary CSS rotations and
calculated (`calc()`) object-position are not supported. `{ canvas }` optionally reuses
a host canvas; disposal clears it and restores its style instead of removing it.
Give the container a height when a specific display area is required.

The helper owns asynchronous image loading and stale-revision checks, not model
inference. It does not repaint live video continuously in owned-image mode;
use overlay mode on a playing video. Heatmaps, annotation editing and a gesture
UI for pan/zoom remain outside this API. Host renderer bundling restrictions
from the preceding section still apply.

### Named stages in the existing pipeline

Composers flatten tool schemas into ordinary `model` entries, input groups and
namespaced outputs. JSEE does not accept nested module schemas. Named and unnamed
lists use the same pipeline loop; unnamed lists retain their existing merge/stop behavior.

```js
const schema = {
  inputs: [
    { type: 'group', name: 'gen1', elements: [{ name: 'n', type: 'int', default: 4 }] },
    { type: 'group', name: 'fit1', elements: [{ name: 'x', type: 'int', required: false }] }
  ],
  model: [
    { id: 'gen1', scope: 'gen1', type: 'function', code: 'input => ({ count: input.n })' },
    { id: 'fit1', scope: 'fit1', type: 'function', code: 'input => ({ result: input.x * 2 })',
      bindings: { x: { stage: 'gen1', path: ['count'] } } }
  ],
  outputs: [{ name: 'fit1.result', type: 'number' }]
}
const app = new JSEE({ schema, container: '#app', runtimeURL: '/jsee.core.js' })
await app.ready
await app.invoke({ gen1: { n: 5 } }, { target: 'fit1' }) // { 'fit1.result': 10 }
```

When using IDs, every stage must have a unique ID. `scope` selects a root input
group; bindings accept `{stage, path: ['output', 'nestedField']}`, `{input: ['publicInput']}`
or `{value: literal}`. Bindings replace scoped values. `from: 'previous-stage'`
continues an internal model stack: records merge and `stop` propagates through
that chain, without stopping independent branches. Cycles/missing stages fail
before execution. `enabled: false` excludes a stage from full runs; dependents
require it enabled. Browser-only stages use `render: true` and run after their
upstream computation. Mark their public outputs `required: false` for headless use.

Default **Run** and `invoke()` reuse current named stages. `{target}` executes
only its ancestor closure and associated views; `{force: true}` explicitly reruns
all stages, or just the selected target when provided. The form exposes **Rerun all**.
Input and upstream revision changes invalidate descendants. `getStages()` reports
status/revision/results; `planPipeline(target)` returns execution order.
`getStageInputs(id)` returns mapped, unprepared values. `stop()` cancels execution.

`invoke(undefined, {target, transient: true, overrides: {inspect: true}})` supports
an author-defined inspection operation without replacing retained trained results.
JSEE does not interpret the override's meaning. Scoped dynamic input updates stay
inside the stage's input group. File bindings follow the receiver's text/raw/stream
contract. Stream sources must be replayable, not live iterators in saved projects.

`getSchema()` captures the document and live defaults. `getPipelineState()` and
`restorePipelineState(state)` store results separately, with SHA-256 definition
fingerprints instead of source copies. Restoring compares file bytes once, then
ordinary edits use immutable file identity. Render functions are not persisted;
views recreate them on restore. Function outputs may return cleanup functions.
Hosts own storage and authoring metadata.

`exportSchema()` preserves code references, resolves their URLs and pins loaded
bytes with `sha256`. File data becomes JSON-safe. `exportHTML({runtime})` embeds
JavaScript assets once per content hash through JSEE's existing offline DOM cache,
plus the supplied runtime. Named-pipeline `download()` uses `runtimeURL`.
HTML export supports JavaScript function models and declared assets, not Python,
ES-module models or undeclared network dependencies. Exports are recipes, not
retained run snapshots; random sources need seeds for identical regeneration.

Node CLI, canonical HTTP and MCP execute the same flat schema and skip render
stages. Remote JavaScript references require SHA-256 pins; model/import bytes are
verified before execution and `security.allowNetwork: false` blocks fetching.
Python execution of named stages is not implemented. See
`test/fixtures/composition.json` and `test/mcp/composition.test.js`.

### Host-owned regions

Embedded hosts can pass `controls: false` to omit JSEE's Run/Stop/Reset footer and
`toasts: false` to suppress this instance's toast messages (including loading and
error toasts). Both default to `true`. Invocation errors still reject and emit
`error`; the host must display them. These options do not change `schema.notify`,
which controls browser notifications, or the computation's execution policy.


To keep JSEE’s normal form and Run/Stop, mount an optional host editor inside an
input group instead of moving the form out of the app:

```js
await tool.ready
const target = tool.getInputGroupContainer('fit1')
// Mount or Teleport your editor into target; publish values with tool.setInputs().
// Unmount the host editor before tool.destroy().
```

Input groups accept `direction: 'column'` to stack fields vertically; the default
remains a row. Scoped model input updates recurse through declared groups, for
example `{diff1: {column: {options: ['', 'price'], value: 'price'}}}`.
Updates cannot create undeclared fields or modify another stage's scope.

In the normal form, `selectInputGroup(name)` finds nested groups and expands
the selected section and its ancestors/children, collapsing unrelated sections.
Selection changes presentation without executing or remounting models.

`getInputGroupContainer(name)` returns the group’s editor element, or `null` when
it is not rendered. The target lives until the group or app is removed and follows
accordion visibility. The host retains its own framework context; JSEE does not
load the editor’s framework. Editors are authoring UI and are not serialized into
schema/HTML exports; their settings remain ordinary input values.


For a shared inspector use `regions: {inputGroups: '#inspector'}` and call
`selectInputGroup('fit1')` after `ready`. It changes field visibility without
rerunning or disposing stages. Use `controls: false` when the host owns Run/Stop.


```js
const tool = new JSEE({
  schema,
  container: '#tool-root',
  regions: { inputs: '#tool-controls', outputs: '#tool-results' }
})
await tool.ready
const unsubscribe = tool.on('result', outputs => console.log(outputs))
const outputs = await tool.invoke({ x: 4 })
// Later: unsubscribe(); tool.destroy()
```

Create connected, instance-specific region elements outside `container` before
construction, and retain them until `destroy()`. Either region is optional.
JSEE uses its own Vue root and Teleport; host Vue/Vuetify providers are not inherited.
Each region carries JSEE's theme variables from `schema.design`. Hide the host's
region elements to switch views without rerunning or disposing the tool. Destroy
removes teleported content and listeners. Run/Stop controls remain with inputs.

The `inputs` event reports current values after Vue updates, including UI edits,
programmatic patches, reset and model-driven input updates. `start` receives the
input snapshot; `result` receives the same values returned by `invoke`; `error`
and `cancel` receive errors. Reactive schemas retain their automatic-run behavior;
use `reactive: false` and no reactive input flags for manual workspace tools.
Plain objects/arrays are copied; opaque runtime values retain their identities.
`invoke()` never queues behind another run. Existing `run()` queue/interval
behavior remains available to standalone applications.

JSEE is part of the [StatSim](https://statsim.com) ecosystem. The schema/runtime contract is the public surface; lower-level packaging and renderer internals may continue to evolve.
