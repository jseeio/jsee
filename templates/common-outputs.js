import { saveAs } from 'file-saver'
import domtoimage from 'dom-to-image'

const { sanitizeName } = require('../src/utils.js')

const Blob = window['Blob']

function stringify (v) {
  return typeof v === 'string'
    ? v
    : JSON.stringify(v)
}

const component = {
  props: ['output'],
  emits: ['notification'],
  data () {
    return {
      outputName: 'output',
      isFullScreen: false,
    }
  },
  mounted() {
    this.outputName = this.output.alias 
      ? this.output.alias
      : this.output.name
        ? sanitizeName(this.output.name) 
        : 'output_' + Math.floor(Math.random() * 1000000)
    this.executeRenderFunction()
    document.addEventListener('fullscreenchange', this.onFullScreenChange)
  },
  beforeUnmount() {
    document.removeEventListener('fullscreenchange', this.onFullScreenChange)
  },
  // updated() {
  //   this.executeRenderFunction()
  // },
  watch: {
    'output.value': function (newValue, oldValue) {
      if (newValue !== oldValue) {
        this.$nextTick(() => {
          this.executeRenderFunction()
        })
      }
    }
  },
  computed: {
    isRenderFunction() {
      return typeof this.output.value === 'function'
    }
  },
  methods: {
    toggleFullScreen() {
      const el = this.$refs.cardRoot || this.$el
      if (!this.isFullScreen) {
        if (el.requestFullscreen) {
          el.requestFullscreen()
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen()
        } else if (el.mozRequestFullScreen) {
          el.mozRequestFullScreen()
        } else if (el.msRequestFullscreen) {
          el.msRequestFullscreen()
        }
        // state will flip in onFullScreenChange
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen()
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen()
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen()
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen()
        }
        // state will flip in onFullScreenChange
      }
    },
    onFullScreenChange() {
      this.isFullScreen = !!document.fullscreenElement
    },
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
