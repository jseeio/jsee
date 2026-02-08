<template>
  <div :id="id" class="vfp">
  <!-- Based on https://github.com/rowanwins/vue-file-picker/ -->
    <div
      class="vfp-bgArea"
      :class="{ 'vfp-active': isActive }"
      @dragover="setActive"
      @dragleave="cancelActive"
      @drop="fileAdded"
    >
      <!-- icon -->
      <div class="vfp-iconHolder vfp-gridItem"
        v-if="!showUrlInputAuto"
      >
        <slot name="icon">
          <svg height="40" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M18 32h12v-12h8l-14-14-14 14h8zm-8 4h28v4h-28z"
              fill="#CACFD2"
            />
          </svg>
        </slot>
      </div>

      <!-- invisible native file input -->
      <input
        id="vfp-filePicker"
        class="vfp-inputfile vfp-gridItem"
        type="file"
        name="vfp-filePicker"
        :accept="accept"
        :multiple="allowMultiple"
        @change="fileAdded"
      />

      <!-- main label OR url input (switches) -->
      <label
        v-if="!showUrlInputAuto"
        class="vfp-label vfp-gridItem vfp-clickable"
        for="vfp-filePicker"
      >
        <slot name="label">
          <strong>{{ label }}</strong>
        </slot>
        <span class="vfp-info">{{ info }}</span>
      </label>

      <!-- secondary toggle -->
      <div
        v-if="!showUrlInputAuto"
      > 
      <!-- Trigger File input -->
        <button
        class="vfp-button vfp-gridItem"
        @click="activateFileDialog"
        style="margin-right:5px"
        >
          From Disk
        </button>

        <button
        v-if="!showUrlInputAuto"
        class="vfp-button vfp-gridItem"
        @click="activateUrl"
        >
          From URL
        </button>
      </div>

      <!-- v-model.trim="urlInput" -->
      <div v-if="showUrlInputAuto">
        <input
          class="vfp-urlInput vfp-gridItem"
          type="text"
          v-model.trim="urlModel"
          placeholder="Paste file URL here"
          :style="{
            borderColor: urlSuccess ? 'green' : urlError ? 'red' : ''
          }"
        />
        <button
          class="vfp-urlInput vfp-gridItem vfp-button"
          @click="loadUrl"
        >
          Load
        </button>
        <button
          class="vfp-urlInput vfp-gridItem vfp-button" 
          @click="clearUrl"
        >
          Cancel
        </button>
      </div>


    </div>
  </div>
</template>

<script>
export default {
  name: 'FilePicker',
  props: {
    id:            { type: String,  default: 'filePicker' },
    accept:        { type: String,  default: '*/*' },
    allowMultiple: { type: Boolean, default: false },
    modelValue:    { type: [String, Object],  default: '' },
    url:           { type: String,  default: '' },
    raw:           { type: Boolean, default: false },
    labelValue:    { type: String,  default: 'Choose File' }
  },
  emits : ['update:modelValue', 'update:url', 'change'],
  data () {
    return {
      isActive: false,
      urlInput: '',
      urlSuccess: false,
      urlError: false,
      label: this.labelValue,
      info: 'or drag and drop it here',
      showUrlInput: true
    }
  },
  computed: {
    showUrlInputAuto () {
      return this.url.length > 0 && this.showUrlInput
    },
    requiresTypeCheck () { return this.accept !== '*/*' },
    acceptedTypes ()     { return this.accept.split(',') },
    urlModel: {
      get () { return this.url },
      set (v) { this.$emit('update:url', v) }
    }
  },
  methods: {
    /* drag-drop handling */
    cancelHandlers (e) { e.preventDefault(); e.stopPropagation() },
    setActive (e)      { this.isActive = true;  this.cancelHandlers(e) },
    cancelActive (e)   { this.isActive = false; this.cancelHandlers(e) },

    fileAdded (e) {
      this.isActive = false;
      this.cancelHandlers(e);

      const wasDropped = !!e.dataTransfer;
      if (wasDropped && this.urlModel && this.urlModel.length > 0) {
        console.log('[File picker] URL mode active, ignoring dropped files');
        return;
      }
      const files = wasDropped ? e.dataTransfer.files : e.target.files;
      this.label = Array.from(files).map(f => f.name).join(', ');
      const totalSizeinKB = Array.from(files).reduce((acc, f) => acc + f.size / 1024, 0).toFixed(2)
      this.info = `Selected ${files.length} file(s) of size ${totalSizeinKB} KB`;

      if (wasDropped && !this.allowMultiple && files.length > 1)
        throw new Error('vue-file-picker: Multiple files are not allowed');
      if (wasDropped && this.requiresTypeCheck)
        for (const f of files)
          if (!this.acceptedTypes.includes(f.type))
            throw new Error('vue-file-picker: File type not allowed');

      console.log('[File picker] Files added:', files);
      this.loadFile(files);
    },

    loadFile (e) {
      const files = e.target ? e.target.files : e
      if (this.raw) {
        const fileValue = this.allowMultiple ? Array.from(files) : files[0]
        this.$emit('update:modelValue', fileValue)
        this.$emit('change')
        return
      }
      const reader = new FileReader()
      reader.readAsText(files[0])
      reader.onload = () => {
        // No need to check for reactivity here, as the parent component will handle it
        // Just trigger basic change event
        this.$emit('update:modelValue', reader.result)
        this.$emit('change')
      }
    },

    loadUrl () {
      if (this.urlModel && this.urlModel.length > 0) {
        if (this.raw) {
          this.urlSuccess = true
          this.urlError = false
          this.label = this.urlModel.split('/').pop().split('?')[0] || 'File from URL'
          this.rawUrl = this.urlModel.split('/').slice(0, -1).join('/') // Extract URL path
          this.showUrlInput = false // Hide URL input after successful load
          this.info = `Loaded URL handle: ${this.rawUrl || this.urlModel}`
          this.$emit('update:modelValue', { kind: 'url', url: this.urlModel })
          this.$emit('change')
          return
        }

        fetch(this.urlModel)
          .then(response => response.text())
          .then(text => {
            this.urlSuccess = true
            this.urlError = false
            this.label = this.urlModel.split('/').pop().split('?')[0] || 'File from URL' 
            this.rawUrl = this.urlModel.split('/').slice(0, -1).join('/') // Extract URL path
            this.showUrlInput = false // Hide URL input after successful load
            // Show file size
            this.info = `Loaded from URL: ${this.rawUrl} (${(text.length / 1024).toFixed(2)} KB)`
            this.$emit('update:modelValue', text)
            this.$emit('change')
          })
          .catch(error => {
            this.urlSuccess = false
            this.urlError = true
            console.error('Error fetching URL:', error)
          })
      } 
    },
  
    /* switch to URL mode */
    activateUrl () {
      this.urlModel = this.urlModel || 'http://'
      this.showUrlInput = true
      this.$nextTick(() => this.$el.querySelector('.vfp-urlInput').focus())
    },

    activateFileDialog () {
      this.$el.querySelector('#vfp-filePicker').click()
    },

    clearUrl () { 
      this.showUrlInput = false
      // this.urlModel = '' 
      // this.urlSuccess = false
      // this.urlError = false
      // this.$emit('update:url', '')
      // this.$emit('update:modelValue', '')
    }
  }
}
</script>

<style lang="scss">
.vfp {
  display: flex;
  min-height: 130px;
  width: 100%;

  .vfp-bgArea {
    transition: 0.3s;
    background: #F2F3F4;
    display: grid;
    grid-template-rows: 40% 32% 28%;
    padding: 20px 10px;
    width: 100%;
    outline: 1px dashed #CACFD2;
    outline-offset: -10px;
    color: #3b3e40;
    text-align: center;
  }

  .vfp-inputfile {
    width: 0.1px;
    height: 0.1px;
    opacity: 0;
    position: absolute;
  }

  .vfp-gridItem { align-self: center; justify-self: center; }

  .vfp-label { cursor: pointer; font-size: 0.9rem; font-family: monospace; display:block; }
  .vfp-info {
    font-size: 9px;
    color: #7f8c8d;
    margin-top: 1px;
    margin-bottom: 5px;
    display: block;
  }
  .vfp-urlToggle { cursor: pointer; font-size: 0.8rem; }
  .vfp-urlInput {
    margin-top: 10px;
    width: calc(100% - 20px);
    padding: 6px 6px !important;
    border: 1px solid #CACFD2;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .vfp-button {
    cursor: pointer;
    border: none;
    padding: 4px 10px;
    border-radius: 4px;

    // hover effect
    background-color: #E4E7EA;
    &:hover {
      background-color: #D7DBDD;
    }
  }

  button.vfp-urlInput {
    margin-top: 2px;
  }

  .vfp-active {
    background-color: #D7DBDD;
    outline-color: #F2F3F4;
  }

  @media only screen and (max-width: 440px) {
    .vfp-bgArea {
      padding: 18px 10px;
      grid-template-rows: 45% 25% 30%;
      grid-row-gap: 5px;
    }
  }
}
</style>
