const { parseDelimited, detectDelimiter } = require('../../src/table-paste')

test.each([
  ['spreadsheet tabs', 'item\tqty\nWidget\t3', '\t'],
  ['plain commas', 'item,qty\nWidget,3', ','],
  ['semicolon locales', 'item;qty\nWidget;3', ';'],
  ['tabs outrank commas inside quotes', '"a,b"\tc', '\t'],
  ['commas when nothing else appears', 'single value', ',']
])('detects the delimiter for %s', (_name, text, expected) => {
  expect(detectDelimiter(text)).toBe(expected)
})

test('reads a spreadsheet block into rows of raw cells', () => {
  expect(parseDelimited('item\tqty\nWidget\t3\nGizmo\t1')).toEqual([
    ['item', 'qty'], ['Widget', '3'], ['Gizmo', '1']
  ])
})

test.each([
  ['quoted separators', 'a,b\n"x,y",2', [['a', 'b'], ['x,y', '2']]],
  ['escaped quotes', 'a\n"he said ""hi"""', [['a'], ['he said "hi"']]],
  ['newlines inside quotes', 'a,b\n"two\nlines",2', [['a', 'b'], ['two\nlines', '2']]],
  ['carriage returns', 'a,b\r\n1,2\r\n', [['a', 'b'], ['1', '2']]],
  ['bare carriage returns', 'a,b\r1,2', [['a', 'b'], ['1', '2']]]
])('preserves %s', (_name, text, expected) => {
  expect(parseDelimited(text)).toEqual(expected)
})

test('keeps empty cells but drops trailing blank lines', () => {
  expect(parseDelimited('a,b,c\n1,,3\n\n\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']])
})

test('keeps a deliberate empty quoted cell', () => {
  expect(parseDelimited('a,b\n"",2')).toEqual([['a', 'b'], ['', '2']])
})

test.each([
  ['an empty string', '', []],
  ['a non-string', null, []],
  ['only newlines', '\n\n', []]
])('returns no rows for %s', (_name, text, expected) => {
  expect(parseDelimited(text)).toEqual(expected)
})

test('treats a single value as one cell so ordinary edits are untouched', () => {
  expect(parseDelimited('hello')).toEqual([['hello']])
})

test('honours an explicit delimiter over detection', () => {
  expect(parseDelimited('a\tb,c', ',')).toEqual([['a\tb', 'c']])
})

test('pads nothing: short lines stay short for the caller to fill', () => {
  expect(parseDelimited('a,b,c\n1,2')).toEqual([['a', 'b', 'c'], ['1', '2']])
})

test.each([
  ['TSV with semicolon text', 'note;details\tqty\nhello\t2', [['note;details', 'qty'], ['hello', '2']]],
  ['CSV with semicolon text', 'name,qty\nfoo;bar,2', [['name', 'qty'], ['foo;bar', '2']]],
  ['quoted empty final row', 'value\n""\n\n', [['value'], ['']]],
  ['explicit empty final cells', 'a,b\n,\n', [['a', 'b'], ['', '']]]
])('preserves %s without guessing from later text', (_name, text, rows) => {
  expect(parseDelimited(text)).toEqual(rows)
})

test('rejects unfinished quoted clipboard text', () => {
  expect(() => parseDelimited('a,b\n"unfinished,2')).toThrow(/quote/i)
})
