const { parse } = require('csv-parse/sync')

function parse_sales ({ csv }) {
  const records = parse(csv, { bom: true, skip_empty_lines: true })
  const columns = records.shift() || []
  if (!columns.includes('price') || !columns.includes('quantity') || new Set(columns).size !== columns.length) {
    throw new Error('CSV needs unique column names including price and quantity')
  }
  return { columns, rows: records, rows_read: records.length }
}

async function clean_rows ({ columns, rows, missing }) {
  const priceIndex = columns.indexOf('price')
  const quantityIndex = columns.indexOf('quantity')
  const kept = []
  const amounts = []
  // Decimal syntax is shared with the native example; reject coercions such as empty strings and hex.
  const number = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) && Number.isFinite(Number(value))
  rows.forEach((row, index) => {
    if (row[priceIndex].trim() === '' && missing === 'drop') return
    if (!number(row[priceIndex]) || !number(row[quantityIndex]) || Number(row[quantityIndex]) < 0) {
      throw new Error(`Invalid price or quantity at data row ${index + 1}`)
    }
    const amount = Number(row[priceIndex]) * Number(row[quantityIndex])
    if (!Number.isFinite(amount)) throw new Error('Revenue exceeds finite numeric range')
    amounts.push(amount)
    kept.push(row)
  })
  return { kept, amounts }
}

function summarize ({ columns, kept, amounts, rows_read }) {
  const total_revenue = amounts.reduce((sum, amount) => sum + amount, 0)
  if (!Number.isFinite(total_revenue)) throw new Error('Revenue exceeds finite numeric range')
  const quote = value => /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value
  const content = [columns, ...kept].map(row => row.map(quote).join(',')).join('\n') + '\n'
  return {
    summary: { rows_read, rows_kept: kept.length, total_revenue },
    table: { columns, rows: kept },
    cleaned_csv: { filename: 'cleaned-sales.csv', mime: 'text/csv', content }
  }
}

module.exports = { parse_sales, clean_rows, summarize }
