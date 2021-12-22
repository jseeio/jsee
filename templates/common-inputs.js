const FileReader = window['FileReader']

const component = {
  props: ['input'],
  emits: ['inchange'],
  methods: {
    changeHandler () {
      if (this.input.reactive) {
        this.$emit('inchange')
      }
    },
    loadFile (e) {
      const reader = new FileReader()
      this.input.file = e.target.files[0]
      reader.readAsText(this.input.file)
      reader.onload = () => {
        this.input.value = reader.result
        if (typeof this.input.cb !== 'undefined') {
          this.input.cb.run()
        } else if (this.input.reactive) {
          this.$emit('inchange')
        }
      }
    }
  }
}

export { component }
