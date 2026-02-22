const FileReader = window['FileReader']
import FilePicker from './file-picker.vue'

const component = {
  props: ['input'],
  emits: ['inchange'],
  components: { FilePicker },
  data () {
    return {
      collapsed: this.input && this.input.collapsed === true,
      activeTab: 0
    }
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
    },
    autosize (e) {
      const el = e.target
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    },
    call (method) {
      console.log('calling: ', method)
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
        const el = this.$el.querySelector('textarea')
        if (el) {
          el.style.height = 'auto'
          el.style.height = el.scrollHeight + 'px'
        }
      })
    }
  }
}

export { component }
