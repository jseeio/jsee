const FileReader = window['FileReader']
import FilePicker from './file-picker.vue'

const component = {
  props: ['input'],
  emits: ['inchange'],
  components: { FilePicker },
  data () {
    return {
      collapsed: this.input && this.input.collapsed === true
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
    call (method) {
      console.log('calling: ', method)
    }
  }
}

export { component }
