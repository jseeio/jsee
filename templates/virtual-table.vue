<style scoped>
.vt-wrap {
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
}
.vt-scroll {
  overflow: auto;
  max-height: 500px;
  border: 1px solid #eee;
  border-radius: 4px;
}
.vt-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}
.vt-table th {
  padding: 6px 12px;
  text-align: left;
  border-bottom: 2px solid #ddd;
  background: #f8f8f8;
  font-weight: 600;
  position: sticky;
  top: 0;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  z-index: 1;
}
.vt-table th:hover {
  background: #f0f0f0;
}
.vt-table th .sort-icon {
  margin-left: 4px;
  opacity: 0.3;
}
.vt-table th.sorted .sort-icon {
  opacity: 1;
}
.vt-table td {
  padding: 4px 12px;
  border-bottom: 1px solid #eee;
  white-space: nowrap;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vt-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.vt-table tbody tr:hover {
  background: #f9f9f9;
}
.vt-footer {
  font-size: 11px;
  color: #888;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
}
</style>

<template>
  <div class="vt-wrap">
    <div v-if="label" style="font-size:12px;color:#888;margin-bottom:6px">
      {{ label }} ({{ rowCount }} rows{{ truncated ? ', showing first ' + maxRows : '' }})
    </div>
    <div class="vt-scroll">
      <table class="vt-table">
        <thead>
          <tr>
            <th
              v-for="(col, ci) in columns"
              :key="ci"
              :class="{ sorted: sortCol === ci }"
              @click="toggleSort(ci)"
            >
              {{ col }}
              <span class="sort-icon">{{ sortCol === ci ? (sortAsc ? '▲' : '▼') : '⇅' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, ri) in displayRows" :key="ri">
            <td
              v-for="(cell, ci) in row"
              :key="ci"
              :class="{ num: colTypes[ci] === 'number' }"
            >{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="vt-footer" v-if="rowCount > 0">
      <span>{{ rowCount }} rows × {{ columns.length }} columns</span>
      <span v-if="truncated">Showing first {{ maxRows }} rows</span>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    data: { type: [Object, Array], required: true }
  },
  data () {
    return {
      sortCol: -1,
      sortAsc: true,
      maxRows: 5000
    }
  },
  computed: {
    normalized () {
      const d = this.data
      if (!d) return { columns: [], rows: [] }
      if (d.columns && d.rows) return d
      if (Array.isArray(d) && d.length > 0) {
        if (Array.isArray(d[0])) {
          return { columns: d[0].map(String), rows: d.slice(1) }
        }
        if (typeof d[0] === 'object') {
          const cols = Object.keys(d[0])
          return { columns: cols, rows: d.map(r => cols.map(c => r[c])) }
        }
      }
      return { columns: [], rows: [] }
    },
    columns () {
      return this.normalized.columns || []
    },
    allRows () {
      return this.normalized.rows || []
    },
    label () {
      return this.data && this.data.label
    },
    rowCount () {
      return this.allRows.length
    },
    truncated () {
      return this.rowCount > this.maxRows
    },
    colTypes () {
      const rows = this.allRows
      const n = Math.min(rows.length, 20)
      return this.columns.map((_, ci) => {
        let numCount = 0
        for (let i = 0; i < n; i++) {
          const v = rows[i] && rows[i][ci]
          if (v !== '' && v !== null && v !== undefined && !isNaN(Number(v))) numCount++
        }
        return numCount > n * 0.5 ? 'number' : 'string'
      })
    },
    sortedRows () {
      if (this.sortCol < 0) return this.allRows
      const ci = this.sortCol
      const asc = this.sortAsc
      const isNum = this.colTypes[ci] === 'number'
      const sorted = [...this.allRows]
      sorted.sort((a, b) => {
        let va = a[ci], vb = b[ci]
        if (isNum) { va = Number(va) || 0; vb = Number(vb) || 0 }
        else { va = String(va || ''); vb = String(vb || '') }
        if (va < vb) return asc ? -1 : 1
        if (va > vb) return asc ? 1 : -1
        return 0
      })
      return sorted
    },
    displayRows () {
      const rows = this.sortedRows
      return this.truncated ? rows.slice(0, this.maxRows) : rows
    }
  },
  methods: {
    toggleSort (ci) {
      if (this.sortCol === ci) {
        if (this.sortAsc) {
          this.sortAsc = false
        } else {
          this.sortCol = -1
          this.sortAsc = true
        }
      } else {
        this.sortCol = ci
        this.sortAsc = true
      }
    }
  }
}
</script>
