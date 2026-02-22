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
