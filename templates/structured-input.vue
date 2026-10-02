<template>
  <div class="jsee-structured">
    <label :for="id">{{ input.label || input.name }}</label>
    <textarea v-if="input.type === 'object' || jsonMode" :id="id" :value="draft" :disabled="input.disabled" :readonly="input.readonly"
      :aria-invalid="!!input._parseError" :aria-describedby="errorId" @input="editJson($event.target.value)"></textarea>
    <template v-else>
      <div class="table-scroll">
        <table :id="id" :aria-label="input.label || input.name">
          <thead><tr><th v-for="column in columns" :key="column" scope="col">{{ column }}</th><th>Rows</th></tr></thead>
          <tbody><tr v-for="(row, index) in rows" :key="index">
            <td v-for="(column, col) in columns" :key="column"><input :aria-label="`Row ${index + 1}, ${column}`" :value="cellText(matrix ? row[col] : row[column])"
              :disabled="input.disabled" :readonly="input.readonly" @change="editCell(index, column, col, $event.target.value)"></td>
            <td><button type="button" :disabled="locked" :aria-label="`Remove row ${index + 1}`" @click="removeRow(index)">Remove</button></td>
          </tr></tbody>
        </table>
      </div>
      <button type="button" :disabled="locked" @click="addRow">Add row</button>
      <input v-model="newColumn" aria-label="New column name" :disabled="locked">
      <button type="button" :disabled="locked || !newColumn || columns.includes(newColumn)" @click="addColumn">Add column</button>
      <small>Cells accept JSON values; other text stays a string. Use "42" for a numeric-looking string.</small>
    </template>
    <button v-if="input.type === 'table'" type="button" :disabled="!!input._parseError" @click="jsonMode = !jsonMode">{{ jsonMode ? 'Edit cells' : 'Edit JSON' }}</button>
    <small v-if="input.description">{{ input.description }}</small>
    <span v-if="input._parseError || input._error" :id="errorId" role="alert">{{ input._parseError || input._error }}</span>
  </div>
</template>

<script>
const { cloneSchema, prepareInputs } = require('../src/schema')
export default {
  props: ['input'],
  emits: ['change'],
  data () { return { draft: '', newColumn: '', jsonMode: false } },
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
    cellText (value) { return value === undefined ? '' : JSON.stringify(value) },
    editCell (row, column, col, text) {
      let value
      try { value = JSON.parse(text) } catch (_) { value = text }
      const next = cloneSchema(this.input.value)
      if (this.matrix) next.rows[row][col] = value
      else Object.defineProperty(next[row], column, { value, enumerable: true, writable: true, configurable: true })
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
    }
  }
}
</script>

<style scoped>
.jsee-structured { margin: 8px 0; }
label, small, textarea { display: block; }
textarea { width: 100%; min-height: 120px; box-sizing: border-box; }
.table-scroll { overflow-x: auto; }
table { border-collapse: collapse; }
th, td { padding: 3px; text-align: left; }
td input { width: 120px; }
button { margin: 4px; }
[role=alert] { display: block; color: #b42318; }
</style>
