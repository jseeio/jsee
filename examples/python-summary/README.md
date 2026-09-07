This CSV summary runs from the same descriptor and callable in Pyodide or native Python. `model.entry` selects `summarize`; `model.name` identifies the server endpoint `/pysummary`.

From the repository root, install the maintained Python package and the example dependencies, then serve it:

```sh
npm run build
python -m pip install ./py -r test/python/requirements.txt
python py/bin/jsee examples/python-summary/schema.json
```

For browser execution, open `/load/?s=/examples/python-summary/schema.json` using the development server. The default Pyodide distribution supplies pandas; no separate Boruta installation is needed.

This repairs the historical `apps/pysummary` example preserved in `test/fixtures/real-apps/pysummary`: it removes an unused, unawaited package install, accepts the CSV through an explicit function argument, and returns the statistics. Browser and native tests use the same expected statistics in `test/fixtures/python-apps.json`.
