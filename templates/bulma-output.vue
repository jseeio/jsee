<template>
  <div class="card mb-5" v-if="!(typeof output.value === 'undefined')">
    <header class="card-header">
      <p class="card-header-title is-size-6" v-if="output.name">
        {{ output.name }}
      </p>
      <!-- <p class="card-header-icon" v-if="output.type != 'function'"> -->
      <p class="card-header-icon">
        <button class="button is-small" v-on:click="save()">Save</button>
        <button class="button is-small" v-on:click="copy()">Copy</button>
      </p>
    </header>
    <div class="card-content">
      <div class="content" v-if="(output.type == 'svg') || (output.type == 'html')">
        <div v-html="output.value"></div>
      </div>
      <div class="content" v-else-if="output.type == 'object'">
        <json-viewer :value="output.value" copyable sort />
      </div>
      <div class="content" v-else-if="output.type == 'code'">
        <pre>{{ output.value }}</pre>
      </div>
      <div class="content" v-else-if="output.type == 'function'">
        <div ref="customContainer"></div>
      </div>
      <div class="content" v-else>
        <pre>{{ output.value }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
  export { component as default } from "./common-outputs.js"
</script>

