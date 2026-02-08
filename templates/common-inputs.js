const FileReader = window['FileReader']
import FilePicker from './file-picker.vue'

const component = {
  props: ['input'],
  emits: ['inchange'],
  components: { FilePicker },
  methods: {
    changeHandler () {
      if (this.input.reactive) {
        this.$emit('inchange')
      }
    },
    call (method) {
      console.log('calling: ', method)
    }
  }
}

export { component }
