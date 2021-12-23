<template>
  <div class="card mb-5" v-if="output.value">
    <header class="card-header">
      <p class="card-header-title is-size-6" v-if="output.name">
        {{ output.name }}
      </p>
      <p class="card-header-icon">
        <button class="button is-small" v-on:click="save()">Save</button>
        <button class="button is-small" v-on:click="copy()">Copy</button>
      </p>
    </header>
    <div class="card-content">
      <div class="content" v-if="output.type == 'svg'">
        <div v-html="output.value"></div>
      </div>
      <div class="content" v-else-if="output.type == 'object'">
        <json-viewer :value="output.value" copyable sort />
      </div>
      <div class="content" v-if="output.type == 'code'">
        <pre>{{ output.value }}</pre>
      </div>
      <div class="content" v-else>
        <pre>{{ output.value }}</pre>
      </div>
    </div>
    <!-- 
    <footer class="card-footer" v-if="output.filename">
      <a v-on:click="save()" class="card-footer-item">Save</a>
      <a v-on:click="copy()" class="card-footer-item">Copy</a>
    </footer>
    -->
  </div>
</template>

<script>
  export { component as default } from "./common-outputs.js"
</script>

