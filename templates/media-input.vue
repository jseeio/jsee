<template>
  <div ref="target" class="jsee-media-input" tabindex="0" @dragover.prevent @drop.prevent="input.type !== 'image' && select($event.dataTransfer.files)">
    <label :for="id">{{ input.label || input.name }}</label>
    <input ref="picker" :id="id" type="file" :accept="input.accept || input.type + '/*'" :disabled="input.disabled || input.readonly" :aria-invalid="!!input._parseError" :aria-describedby="id + '-error'" @change="input.type !== 'image' && select($event.target.files)">
    <template v-if="input.type === 'image' && input.capture?.camera">
      <video ref="camera" v-show="camera.active" autoplay muted playsinline :aria-label="(input.label || input.name) + ' camera'"></video>
      <button type="button" :disabled="locked" @click="camera.active || camera.pending ? stopCamera() : startCamera(false)">{{ camera.active || camera.pending ? 'Stop camera' : 'Camera' }}</button>
      <button v-if="camera.active" type="button" :disabled="locked" @click="stopCamera(true)">Use snapshot</button>
      <button v-if="input.capture.live && !jsee.namedPipeline && !camera.active && !camera.pending" type="button" :disabled="locked" @click="startCamera(true)">Live</button>
    </template>
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
  inject: ['jsee'],
  emits: ['change'],
  data () { return { preview: null, camera: { active: false, pending: false, live: false } } },
  computed: { id () { return 'jsee-media-' + this.$.uid }, locked () { return this.input.disabled || this.input.readonly } },
  mounted () {
    if (this.input.type === 'image') this.source = this.jsee.createImageInput(this.input, {
      target: this.$refs.target, picker: this.$refs.picker, video: this.$refs.camera,
      onImage: file => this.select([file]),
      onState: state => { this.camera = state },
      onError: error => { this.input._parseError = error.message }
    })
  },
  watch: {
    locked (value) { if (value) this.stopCamera() },
    'input.value': { immediate: true, handler (value) {
      if (this.preview) URL.revokeObjectURL(this.preview)
      this.preview = typeof Blob !== 'undefined' && value instanceof Blob ? URL.createObjectURL(value) : null
    } }
  },
  beforeUnmount () { this.source?.dispose(); if (this.preview) URL.revokeObjectURL(this.preview) },
  methods: {
    async startCamera (live) {
      this.input._parseError = null
      try { await this.source.start({ live }) } catch (error) { this.input._parseError = error.message }
    },
    async stopCamera (snapshot=false) {
      try { await this.source?.stop({ snapshot }) } catch (error) { this.input._parseError = error.message }
    },
    clear () {
      this.source?.stop().catch(error => { this.input._parseError = error.message })
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
