module.exports = {
  env: {
    browser: true,
    node: true,
    es2020: true,
    jest: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    // Match existing style: no semicolons, single quotes, 2-space indent
    semi: ['warn', 'never'],
    quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    indent: ['warn', 2, { SwitchCase: 1, ignoredNodes: ['TemplateLiteral *'] }],
    'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    'no-undef': 'error',
    eqeqeq: ['warn', 'smart'],
    'no-eval': 'off', // intentional eval usage in main.js
  },
  globals: {
    VERSION: 'readonly',
    importScripts: 'readonly',
    JSEE: 'readonly',
    loadPyodide: 'readonly',
  },
  overrides: [
    {
      // Puppeteer tests use global `page` from jest-puppeteer
      files: ['test/**/*.test.js'],
      globals: {
        page: 'readonly',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'apps/', 'tmp/', 'load/'],
}
