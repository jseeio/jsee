<template>
  <div class="jsee-structured">
    <label :for="id">{{ input.label || input.name }}</label>
    <textarea v-if="input.type === 'object' || jsonMode" :id="id" :value="draft" :disabled="input.disabled" :readonly="input.readonly"
      :aria-invalid="!!input._parseError" :aria-describedby="errorId" @input="editJson($event.target.value)"></textarea>
    <template v-else>
      <div class="table-scroll">
        <table :id="id" :aria-label="input.label || input.name">
          <thead><tr>
            <th class="rownum"></th>
            <th v-for="(column, col) in columns" :key="column" scope="col">
              <span>{{ column }}</span>
              <button type="button" class="link" :disabled="locked" :aria-label="`Remove column ${column}`" @click="removeColumn(col, column)">&times;</button>
            </th>
            <th></th>
          </tr></thead>
          <tbody><tr v-for="(row, index) in rows" :key="index">
            <td class="rownum">{{ index + 1 }}</td>
            <td v-for="(column, col) in columns" :key="column"><input :aria-label="`Row ${index + 1}, ${column}`" :value="cellText(matrix ? row[col] : row[column])"
              :disabled="input.disabled" :readonly="input.readonly" @change="editCell(index, column, col, $event.target.value)"
              @paste="pasteCells($event, index, col)"></td>
            <td><button type="button" class="link" :disabled="locked" :aria-label="`Remove row ${index + 1}`" @click="removeRow(index)">Remove</button></td>
          </tr></tbody>
        </table>
        <p v-if="!rows.length" class="empty" @paste="pasteCells($event, 0, 0)" tabindex="0" :aria-label="`Paste rows into ${input.label || input.name}`">
          No rows yet. Paste a block from a spreadsheet or CSV here, or add a column and a row below.
        </p>
      </div>
      <label v-if="!columns.length"><input type="checkbox" v-model="pasteHeader" :disabled="locked"> First pasted row contains column names</label>
      <div class="controls">
        <button type="button" :disabled="locked" @click="addRow">Add row</button>
        <input v-model="newColumn" aria-label="New column name" placeholder="column name" :disabled="locked">
        <button type="button" :disabled="locked || !newColumn || columns.includes(newColumn)" @click="addColumn">Add column</button>
      </div>
      <small>Paste from Excel, Sheets or a CSV to fill the grid. Cells accept JSON values; other text stays a string. Use "42" for a numeric-looking string.</small>
    </template>
    <button v-if="input.type === 'table'" type="button" :disabled="!!input._parseError" @click="jsonMode = !jsonMode">{{ jsonMode ? 'Edit cells' : 'Edit JSON' }}</button>
    <small v-if="input.description">{{ input.description }}</small>
    <span v-if="input._parseError || input._error" :id="errorId" role="alert">{{ input._parseError || input._error }}</span>
  </div>
</template>

<script>
const { cloneSchema, prepareInputs } = require('../src/schema')
const { parseDelimited } = require('../src/table-paste')

export default {
  props: ['input'],
  emits: ['change'],
  data () { return { draft: '', newColumn: '', jsonMode: false, pasteHeader: true } },
  computed: {
    id () { return 'jsee-structured-' + this.$.uid },
    errorId () { return this.id + '-error' },
    locked () { return this.input.disabled || this.input.readonly },
    matrix () { return this.input.value && !Array.isArray(this.input.value) },
    rows () { return this.matrix ? this.input.value.rows || [] : this.input.value || [] },
    columns () { return this.matrix ? this.input.value.columns || [] : [...new Set(this.rows.flatMap(row => Object.keys(row)))] }
  },
  watch: {
    'input.value': { immediate: true, deep: true, handler (value) { this.draft = JSON.stringify(value, null, 2) ?? '' } }
  },
  methods: {
    update (value) {
      try {
        prepareInputs([{ ...this.input, required: false }], { [this.input.name]: value })
        this.input.value = value
        this.input._parseError = null
        this.input._error = null
        this.$emit('change')
      } catch (error) { this.input._parseError = 'Invalid JSON value: ' + error.message }
    },
    editJson (text) {
      this.draft = text
      try { this.update(JSON.parse(text)) } catch (_) { this.input._parseError = 'Enter valid JSON' }
    },
    // Show plain strings as-is. Only fall back to JSON syntax when the bare text
    // would read back as a different value, so "Widget" stays Widget but the
    // string "42" keeps its quotes.
    cellText (value) {
      if (value === undefined) return ''
      if (typeof value === 'string' && this.parseCell(value) === value) return value
      return JSON.stringify(value)
    },
    parseCell (text) {
      try {
        return JSON.parse(text, (_key, value) => {
          if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Unsafe number')
          return value
        })
      } catch (_) { return text }
    },
    setCell (next, row, column, col, value) {
      if (this.matrix) next.rows[row][col] = value
      else Object.defineProperty(next[row], column, { value, enumerable: true, writable: true, configurable: true })
    },
    editCell (row, column, col, text) {
      const next = cloneSchema(this.input.value)
      this.setCell(next, row, column, col, this.parseCell(text))
      this.update(next)
    },
    // Spreadsheet-style paste: a multi-cell block expands from the target cell,
    // growing rows and columns as needed. A single cell falls through to the
    // browser so ordinary editing is untouched.
    pasteCells (event, row, col) {
      if (this.locked) return
      const text = event.clipboardData && event.clipboardData.getData('text/plain')
      if (!text) return
      let grid
      try { grid = parseDelimited(text) } catch (error) {
        event.preventDefault(); this.input._parseError = error.message; return
      }
      if (grid.length === 0) return
      if (grid.length === 1 && grid[0].length === 1) return
      event.preventDefault()

      let next = cloneSchema(this.input.value) || (this.matrix ? { columns: [], rows: [] } : [])
      let columns = this.columns.slice()
      let header = null

      // An empty grid takes its column names from the first pasted line.
      if (!columns.length && this.pasteHeader) {
        header = grid.shift().map((name, i) => String(name || 'column_' + (i + 1)))
        if (new Set(header).size !== header.length) {
          this.input._parseError = 'Duplicate column names in pasted header'; return
        }
        columns = header
        if (this.matrix) next.columns = columns.slice()
      }

      const width = (header ? 0 : col) + Math.max(...grid.map(line => line.length), 0)
      for (let i = columns.length; i < width; i++) {
        const base = 'column_' + (i + 1)
        let name = base, suffix = 2
        while (columns.includes(name)) name = base + '_' + suffix++
        columns.push(name)
        if (this.matrix) { next.columns.push(name); next.rows.forEach(r => { while (r.length < columns.length) r.push('') }) }
        else next.forEach(r => Object.defineProperty(r, name, { value: '', enumerable: true, writable: true, configurable: true }))
      }

      const start = header ? 0 : row
      const body = this.matrix ? next.rows : next
      for (let r = 0; r < grid.length; r++) {
        const target = start + r
        while (body.length <= target) {
          body.push(this.matrix ? columns.map(() => '') : Object.fromEntries(columns.map(c => [c, ''])))
        }
        for (let c = 0; c < grid[r].length; c++) {
          const column = columns[(header ? 0 : col) + c]
          if (column === undefined) continue
          this.setCell(next, target, column, (header ? 0 : col) + c, this.parseCell(grid[r][c]))
        }
      }
      this.update(next)
    },
    addRow () {
      const next = cloneSchema(this.input.value || [])
      if (this.matrix) next.rows.push(this.columns.map(() => ''))
      else next.push(Object.fromEntries(this.columns.map(column => [column, ''])))
      this.update(next)
    },
    removeRow (index) {
      const next = cloneSchema(this.input.value)
      ;(this.matrix ? next.rows : next).splice(index, 1)
      this.update(next)
    },
    addColumn () {
      const next = cloneSchema(this.input.value || [])
      if (this.matrix) { next.columns.push(this.newColumn); next.rows.forEach(row => row.push('')) }
      else {
        if (!next.length) next.push({})
        next.forEach(row => Object.defineProperty(row, this.newColumn, { value: '', enumerable: true, writable: true, configurable: true }))
      }
      this.newColumn = ''
      this.update(next)
    },
    removeColumn (col, column) {
      const next = cloneSchema(this.input.value)
      if (this.matrix) { next.columns.splice(col, 1); next.rows.forEach(row => row.splice(col, 1)) }
      else next.forEach(row => { delete row[column] })
      this.update(next)
    }
  }
}
</script>

<style scoped>
.jsee-structured { margin: 8px 0; }
label, small, textarea { display: block; }
textarea { width: 100%; min-height: 120px; box-sizing: border-box; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 3px; text-align: left; }
th { font-size: 12px; white-space: nowrap; }
td input { width: 100%; min-width: 72px; box-sizing: border-box; }
.rownum { width: 1%; color: #888; font-size: 11px; text-align: right; padding-right: 6px; user-select: none; }
.link { border: 0; background: none; cursor: pointer; color: #888; padding: 0 4px; font-size: 12px; }
.link:hover:not(:disabled) { color: #b42318; }
.controls { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 4px; }
.controls input { min-width: 0; flex: 0 1 140px; }
.empty { margin: 4px 0; padding: 10px; border: 1px dashed var(--jsee-input-border, #ddd); border-radius: 4px; color: var(--jsee-text-secondary, #666); font-size: 12px; }
button { margin: 0; }
[role=alert] { display: block; color: #b42318; }
</style>
