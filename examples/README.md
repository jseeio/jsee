# JSEE Examples

Self-contained HTML files demonstrating JSEE patterns. To run:

```bash
npm run build-dev
npx http-server . -p 8080
# Open http://localhost:8080/examples/
```

## Examples

| File | What it shows |
|------|---------------|
| [inputs-all.html](inputs-all.html) | Every input type: string, int, slider, date, checkbox, toggle, select, radio, multi-select, text |
| [markdown-output.html](markdown-output.html) | Markdown output type with tables, formatting, dynamic content |
| [minimal-theme.html](minimal-theme.html) | `design.framework: "minimal"` — lightweight theme without Bulma |
| [reactive-inputs.html](reactive-inputs.html) | Reactive sliders with live preview (CSS box builder) |
| [pipeline.html](pipeline.html) | Multi-model pipeline: generate → transform |
| [worker.html](worker.html) | Web Worker execution with `ctx.progress()` (Monte Carlo Pi) |
