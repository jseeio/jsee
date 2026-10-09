const FileReader = window['FileReader']
import FilePicker from './file-picker.vue'
import StructuredInput from './structured-input.vue'
import MediaInput from './media-input.vue'

const component = {
  props: ['input', 'security'],
  emits: ['inchange'],
  inject: {
    jsee: { default: null }
  },
  components: { FilePicker, StructuredInput, MediaInput },
  data () {
    return {
      collapsed: this.input && this.input.collapsed === true,
      activeTab: 0
    }
  },
  watch: {
    'input.collapsed' (value) { this.collapsed = value === true }
  },
  computed: {
    effectiveStyle () {
      if (this.input.style) return this.input.style
      if (this.input.collapsed !== undefined || this.input.label) return 'accordion'
      return 'blocks'
    }
  },
  methods: {
    changeHandler () {
      if (this.input.reactive) {
        this.$emit('inchange')
      }
    },
    toggleCollapsed () {
      this.collapsed = !this.collapsed
      this.input.collapsed = this.collapsed
    },
    autosize (e) {
      const el = e.target
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    },
    runAction () {
      const caller = this.input && this.input.name
        ? this.input.name.toLowerCase().replace(/ /g, '_')
        : 'run'
      if (this.jsee && this.jsee.run) {
        this.jsee.run(caller)
      }
    },
    folderSelected (e) {
      const files = Array.from(e.target.files)
      this.input.value = files.map(f => ({
        name: f.webkitRelativePath || f.name,
        path: f.webkitRelativePath || f.name,
        size: f.size,
        type: f.type,
        selected: true,
        _file: f
      }))
      this.changeHandler()
    },
    folderDropped (e) {
      const files = Array.from(e.dataTransfer.files)
      this.input.value = files.map(f => ({
        name: f.name,
        path: f.name,
        size: f.size,
        type: f.type,
        selected: true,
        _file: f
      }))
      this.changeHandler()
    },
    rangeInput (e, which) {
      const val = Number(e.target.value)
      const v = this.input.value || [0, 100]
      if (v[0] === v[1]) {
        // Same point: direction determines which thumb moves
        if (val > v[0]) this.input.value = [v[0], val]
        else if (val < v[0]) this.input.value = [val, v[1]]
      } else if (which === 'min') {
        this.input.value = [Math.min(val, v[1]), v[1]]
      } else {
        this.input.value = [v[0], Math.max(val, v[0])]
      }
      this.changeHandler()
    },
    folderSelectOne (file) {
      this.input.value.forEach(f => { f.selected = false })
      file.selected = true
      if (this.input.reactive) {
        this.$emit('inchange')
      }
    },
    folderSelectionChanged () {
      if (this.input.reactive) {
        this.$emit('inchange')
      }
    },
    formatSize (bytes) {
      if (!bytes) return ''
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    }
  },
  mounted () {
    if (this.input.type === 'text' && this.input.value) {
      this.$nextTick(() => {
        // The input component has a fragment root; $el can be a text anchor.
        const el = this.$refs.textarea
        if (el) {
          el.style.height = 'auto'
          el.style.height = el.scrollHeight + 'px'
        }
      })
    }
  }
}

export { component }
