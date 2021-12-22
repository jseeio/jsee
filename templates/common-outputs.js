import { saveAs } from 'file-saver'

const Blob = window['Blob']

function stringify (v) {
  return typeof v === 'string'
    ? v
    : JSON.stringify(v)
}

const component = {
  props: ['output'],
  emits: ['notification'],
  methods: {
    save () {
      // Prepare filename
      let filename
      if (this.output.filename) {
        filename = this.output.filename
      } else {
        let name = this.output.name ? this.output.name : 'output'
        let extension = this.output.type === 'svg' ? 'svg': 'txt'
        filename = name + '.' + extension
      }

      // Prepare blob
      let value = stringify(this.output.value)
      let blob = new Blob([value], {type: 'text/plain;charset=utf-8'})
      saveAs(blob, filename)
    },
    copy () {
      let value = stringify(this.output.value)
      navigator.clipboard.writeText(value)
      this.$emit('notification', 'Copied')
    }
  },
}

export { component }
