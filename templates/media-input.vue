<template>
  <div class="jsee-media-input" @dragover.prevent @drop.prevent="select($event.dataTransfer.files)">
    <label :for="id">{{ input.label || input.name }}</label>
    <input :id="id" type="file" :accept="input.accept || input.type + '/*'" :disabled="input.disabled || input.readonly" :aria-invalid="!!input._parseError" :aria-describedby="id + '-error'" @change="select($event.target.files)">
    <img v-if="preview && input.type === 'image'" :src="preview" :alt="input.label || input.name">
    <audio v-if="preview && input.type === 'audio'" :src="preview" controls></audio>
    <video v-if="preview && input.type === 'video'" :src="preview" controls></video>
    <button v-if="input.value !== undefined" type="button" :disabled="input.disabled || input.readonly" @click="clear">Clear</button>
    <small v-if="input.description">{{ input.description }}</small>
    <span v-if="input._parseError || input._error" :id="id + '-error'" role="alert">{{ input._parseError || input._error }}</span>
  </div>
</template>

<script>
const { matchesFileAccept } = require('../src/schema')
export default {
  props: ['input'],
  emits: ['change'],
  data () { return { preview: null } },
  computed: { id () { return 'jsee-media-' + this.$.uid } },
  watch: {
    'input.value': { immediate: true, handler (value) {
      if (this.preview) URL.revokeObjectURL(this.preview)
      this.preview = typeof Blob !== 'undefined' && value instanceof Blob ? URL.createObjectURL(value) : null
    } }
  },
  beforeUnmount () { if (this.preview) URL.revokeObjectURL(this.preview) },
  methods: {
    clear () {
      this.input.value = undefined
      this.input._parseError = null
      this.input._error = null
      this.$emit('change')
    },
    select (files) {
      if (this.input.disabled || this.input.readonly || !files.length) return
      const file = files[0]
      if (files.length !== 1 || !matchesFileAccept(this.input.type + '/*', file.name, file.type) || !matchesFileAccept(this.input.accept, file.name, file.type)) {
        this.input._parseError = 'Choose one file matching ' + (this.input.accept || this.input.type + '/*')
        return
      }
      this.input._parseError = null
      this.input._error = null
      this.input.value = file
      this.$emit('change')
    }
  }
}
</script>

<style scoped>
.jsee-media-input { margin: 8px 0; }
label, small, [role=alert] { display: block; }
img, video { display: block; max-width: 100%; max-height: 240px; }
[role=alert] { color: #b42318; }
</style>
