<style scoped>
.jsee-output-card {
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
  margin-bottom: 16px;
}
.jsee-output-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
}
.jsee-output-title {
  font-size: 14px;
  font-weight: 400;
  margin: 0;
  color: #333;
}
.jsee-output-actions {
  display: flex;
  gap: 4px;
}
.jsee-output-actions button {
  padding: 2px 8px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: #666;
  border-radius: 3px;
}
.jsee-output-actions button:hover {
  background: #f0f0f0;
  color: #333;
}
.jsee-output-body {
  padding: 12px;
  overflow: auto;
}
.jsee-output-body pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 13px;
}

.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  width: 100vw;
  height: 100vh;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.is-fullscreen .jsee-output-body {
  flex: 1 1 auto;
  overflow: auto;
}
.is-fullscreen .jsee-output-body, .is-fullscreen .custom-container {
  height: 100% !important;
}
</style>

<template>
  <div
    class="jsee-output-card"
    v-show="!(typeof output.value === 'undefined')"
    :class="{ 'is-fullscreen': isFullScreen }"
    ref="cardRoot"
  >
    <div class="jsee-output-header">
      <p class="jsee-output-title" v-if="output.name">{{ output.name }}</p>
      <div class="jsee-output-actions">
        <button v-on:click="save()">Save</button>
        <button v-on:click="copy()">Copy</button>
        <button v-if="!isFullScreen" @click="toggleFullScreen" title="Expand to full screen">Fullscreen</button>
        <button v-else @click="toggleFullScreen" title="Exit full screen">Close</button>
      </div>
    </div>
    <div class="jsee-output-body">
      <div :id="outputName" v-if="(output.type == 'svg') || (output.type == 'html')">
        <div v-html="output.value"></div>
      </div>
      <div :id="outputName" v-else-if="output.type == 'object'">
        <json-viewer :value="output.value" copyable sort />
      </div>
      <div :id="outputName" v-else-if="output.type == 'code'">
        <pre>{{ output.value }}</pre>
      </div>
      <div :id="outputName" v-else-if="output.type == 'function'">
        <div class="custom-container" ref="customContainer"></div>
      </div>
      <div :id="outputName" v-else-if="output.type === 'table'">
        <virtual-table :data="output.value" />
      </div>
      <div :id="outputName" v-else-if="output.type === 'markdown'">
        <div v-html="renderMarkdown(output.value)"></div>
      </div>
      <div :id="outputName" v-else-if="output.type == 'blank'">
        <!-- will be filled by custom render function -->
      </div>
      <div :id="outputName" v-else>
        <pre>{{ output.value }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
  import { component } from "./common-outputs.js"
  import VirtualTable from "./virtual-table.vue"
  export default {
    ...component,
    components: { ...(component.components || {}), VirtualTable }
  }
</script>
