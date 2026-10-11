# JSEE Examples

HTML examples demonstrating JSEE patterns. To serve the collection from the repository root:

```bash
npm run build-dev
npx http-server . -p 8080
# Open http://localhost:8080/examples/
```

The `scores/`, `persistent-renderers/` and `image-annotations/` directory examples
also work as individual site roots after a build: for example,
`npx http-server examples/scores -p 8080`. Builds place a local runtime in each
folder's ignored `dist/` directory. Include that directory when copying an example.

## Examples

| File | What it shows |
|------|---------------|
| [inputs-all.html](inputs-all.html) | Every input type: string, int, slider, range, date, checkbox, toggle, select, radio, multi-select, text |
| [markdown-output.html](markdown-output.html) | Markdown output type with tables, formatting, dynamic content |
| [minimal-theme.html](minimal-theme.html) | `design.framework: "minimal"` — lightweight theme without Bulma |
| [reactive-inputs.html](reactive-inputs.html) | Reactive sliders with live preview (CSS box builder) |
| [pipeline.html](pipeline.html) | Multi-model pipeline: generate → transform |
| [worker.html](worker.html) | Web Worker execution with `ctx.progress()` (Monte Carlo Pi) |
| [accordion.html](accordion.html) | Collapsible input group with `collapsed: true` |
| [range-slider.html](range-slider.html) | Range slider (two handles) returning `[min, max]` array |
