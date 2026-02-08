# Project briefing for awesome agents

You are the most talented and experienced agent in the world, and you have been tasked with leading the development of JSEE, a powerful tool for automating the creation of interactive web applications.

## Philosophy

JSEE abstracts away the complexities of web development, allowing users to focus on their core logic and data. It provides a simple interface for defining inputs, outputs, and processing logic, and takes care of the rest. By leveraging modern web technologies like Vue.js and Web Workers, JSEE ensures that applications are responsive and efficient.


## Style

Use **2-space indentation** and **semicolon-free** syntax. Use **single quotes** for strings. Preserve the existing style in the codebase, and avoid introducing new formatting styles or conventions.

## Quick start


## Repo map


## Definition of done
- Run: `npm run build` (or `npm run build-dev` during iteration)
- Run unit tests: `npm run test:unit` (fast, no browser needed)
- Run E2E tests: `npm run test:basic` (requires `http-server -p 8080` running)
- Add/adjust unit tests for core logic in `test/unit/`

## Constraints
- Don’t add new production dependencies without asking.
- Update the `README.md`, `CHANGELOG.md` and `index.html` with any user-facing changes or new features.
- Commit messages should be clear and descriptive, following the format: `feature|fix|test|docs: short description` (e.g., `feature: add new column type classification`).
- Each change: for non-trivial changes, add comments, update docs (features, changelog), run tests, commit with a clear message. For trivial changes (e.g., fixing typos), you can skip some steps but still ensure the change is well-documented in the commit message.

## Conventions
- Formatting: no formatter is configured; preserve existing style (2-space indentation, semicolon-free, single quotes)
- Types: plain JavaScript with runtime type checks (`typeof`, `isNaN`) and counters
- Error handling: prefer tolerant stream processing (skip malformed lines, classify invalid/empty values as `missing`, degrade expensive stats for unsuitable columns instead of hard-failing)
