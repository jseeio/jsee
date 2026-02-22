import { saveAs } from 'file-saver'
import domtoimage from 'dom-to-image'
import showdown from 'showdown'

const { sanitizeName } = require('../src/utils.js')

const mdConverter = new showdown.Converter({ tables: true })

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
      activeOutputTab: 0,
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
    },
    'output._messages': {
      deep: true,
      handler () {
        this.$nextTick(() => {
          if (this.$refs.chatMessages) {
            this.$refs.chatMessages.scrollTop = this.$refs.chatMessages.scrollHeight
          }
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
    tableToDelimited (delim) {
      const d = this.output.value
      if (!d || !d.columns) return ''
      const esc = (v) => {
        const s = String(v == null ? '' : v)
        return s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0
          ? '"' + s.replace(/"/g, '""') + '"'
          : s
      }
      const lines = [d.columns.map(esc).join(delim)]
      for (const row of d.rows) {
        lines.push(row.map(esc).join(delim))
      }
      return lines.join('\n')
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
          case 'table':
            extension = 'csv'
            break
          case 'markdown':
            extension = 'md'
            break
          case 'image':
            extension = 'png'
            break
          default:
            extension = 'txt'
        }
        filename = name + '.' + extension
      }

      // Prepare blob
      if (this.output.type === 'image') {
        fetch(this.output.value)
          .then(r => r.blob())
          .then(blob => saveAs(blob, filename))
          .catch(() => {
            let blob = new Blob([this.output.value], {type: 'text/plain;charset=utf-8'})
            saveAs(blob, filename)
          })
        return
      }
      if (this.output.type === 'function') {
        domtoimage.toBlob(this.$refs.customContainer)
          .then(blob => {
            saveAs(blob, filename)
          })
        return
      }
      let value = this.output.type === 'table'
        ? this.tableToDelimited(',')
        : stringify(this.output.value)
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
      } else if (this.output.type === 'image') {
        fetch(this.output.value)
          .then(r => r.blob())
          .then(blob => {
            const item = new ClipboardItem({ [blob.type]: blob })
            navigator.clipboard.write([item])
              .then(() => this.$emit('notification', 'Image copied to clipboard'))
              .catch(() => this.$emit('notification', 'Failed to copy image'))
          })
          .catch(() => {
            navigator.clipboard.writeText(this.output.value)
            this.$emit('notification', 'Copied image URL')
          })
      } else if (this.output.type === 'table') {
        let value = this.tableToDelimited('\t')
        navigator.clipboard.writeText(value)
        this.$emit('notification', 'Copied as TSV')
      } else {
        let value = stringify(this.output.value)
        navigator.clipboard.writeText(value)
        this.$emit('notification', 'Copied')
      }
    },
    downloadFile () {
      let filename = this.output.filename || this.output.name || 'output'
      let value = this.output.value
      if (typeof value === 'string' && value.startsWith('data:')) {
        fetch(value)
          .then(r => r.blob())
          .then(blob => saveAs(blob, filename))
          .catch(() => {
            let blob = new Blob([value], { type: 'application/octet-stream' })
            saveAs(blob, filename)
          })
      } else {
        let content = typeof value === 'string' ? value : JSON.stringify(value)
        let blob = new Blob([content], { type: 'application/octet-stream' })
        saveAs(blob, filename)
      }
    },
    renderMarkdown (text) {
      if (typeof text !== 'string') return ''
      return mdConverter.makeHtml(text)
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
