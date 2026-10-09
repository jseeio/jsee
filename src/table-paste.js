// Clipboard-only CSV/TSV parsing. Detect separators in the first logical row;
// semicolons in cell text must not override tabs or commas. No file ingestion.
function detectDelimiter (text) {
  let quoted = false
  const found = new Set()
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted) {
      if ('\t,;'.includes(ch)) found.add(ch)
      if (ch === '\n' || ch === '\r') break
    }
  }
  return ['\t', ',', ';'].find(separator => found.has(separator)) || ','
}

// Returns an array of rows, each an array of raw cell strings. Trailing blank
// lines are dropped so a copied block with a final newline does not add a row.
function parseDelimited (text, delimiter) {
  if (typeof text !== 'string' || text === '') return []
  const sep = delimiter || detectDelimiter(text)
  const rows = [], explicit = []
  let row = []
  let field = ''
  let quoted = false
  let dirty = false

  const endField = () => { row.push(field); field = ''; dirty = true }
  const endRow = () => { explicit.push(dirty || field !== ''); endField(); rows.push(row); row = []; dirty = false }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') { quoted = true; dirty = true; continue }
    if (ch === sep) { endField(); continue }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); continue }
    if (ch === '\n') { endRow(); continue }
    field += ch
  }
  if (quoted) throw new Error('Unclosed quote in pasted text')
  if (field !== '' || dirty || row.length) endRow()

  while (rows.length && !explicit[explicit.length - 1]) { rows.pop(); explicit.pop() }
  return rows
}

module.exports = { parseDelimited, detectDelimiter }
