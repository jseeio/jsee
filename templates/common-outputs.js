import { saveAs } from 'file-saver'
import domtoimage from 'dom-to-image'

const Blob = window['Blob']

function stringify (v) {
  return typeof v === 'string'
    ? v
    : JSON.stringify(v)
}

const component = {
  props: ['output'],
  emits: ['notification'],
  mounted() {
    this.executeRenderFunction()
  },
  updated() {
    this.executeRenderFunction()
  },
  computed: {
    isRenderFunction() {
      return typeof this.output.value === 'function'
    }
  },
  methods: {
    save () {
      // Prepare filename
      let filename
      let extension
      if (this.output.filename) {
        filename = this.output.filename
      } else {
        let name = this.output.name ? this.output.name : 'output'
        switch (this.output.type) {
          case 'function':
            extension = 'png'
            break
          case 'svg':
            extension = 'svg'
            break
          default:
            extension = 'txt'
        }
        filename = name + '.' + extension
      }

      // Prepare blob
      if (this.output.type === 'function') {
        domtoimage.toBlob(this.$refs.customContainer)
          .then(blob => {
            saveAs(blob, filename)
          })
      }
      let value = stringify(this.output.value)
      let blob = new Blob([value], {type: 'text/plain;charset=utf-8'})
      saveAs(blob, filename)
    },
    copy () {
      if (this.output.type === 'function') {
        // Copy the image to the clipboard
        domtoimage.toBlob(this.$refs.customContainer)
          .then(blob => {
            const item = new ClipboardItem({ [blob.type]: blob });
            navigator.clipboard.write([item])
              .then(() => {
                this.$emit('notification', 'Image copied to clipboard');
              })
              .catch(err => {
                console.error('Failed to copy image: ', err);
                this.$emit('notification', 'Failed to copy image');
              });
          })
          .catch(err => {
            console.error('Failed to generate image blob: ', err);
            this.$emit('notification', 'Failed to generate image');
          });
      } else {
        let value = stringify(this.output.value)
        navigator.clipboard.writeText(value)
        this.$emit('notification', 'Copied')
      }
    },
    executeRenderFunction() {
      if (this.isRenderFunction && this.$refs.customContainer) {
        // Clear previous content
        this.$refs.customContainer.innerHTML = ''
        // Execute the render function with the container
        this.output.value(this.$refs.customContainer)
      }
    }
  },
}

export { component }
