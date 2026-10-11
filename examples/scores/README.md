# Scores example

Build from the repository root (`npm run build-dev` or `npm run build`). Both
commands copy the built runtime into this example's `dist/` directory.

Serve this directory, then open the printed URL:

```sh
npx http-server examples/scores -p 8080
```

The example also works at `/examples/scores/` when serving the repository root.
To deploy it separately, include `index.html`, `schema.json`, `model.js` and
`dist/jsee.core.js`. No CDN or published package is required.

For a single offline HTML file, from the repository root:

```sh
node bin/jsee --inputs examples/scores/schema.json -o scores.html -f --runtime inline
```
