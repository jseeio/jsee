<style scoped>
/* Quickly stretch the card when browser goes native full‑screen
   (actual FS API above) OR when the helper class is present. */
   /* 
   .is-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 9999;
    width: 100vw;
    height: 100vh;
    overflow: auto;
    background: #fff;
  }
  .is-fullscreen .card-content, .is-fullscreen .content { 
    height: 100% !important; 
  }
  */

  /* Full‑screen override */
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

.is-fullscreen .card-content {
  flex: 1 1 auto;
  overflow: auto;
}

/* Ensure Plotly div or other content can grow */
.is-fullscreen .content, .is-fullscreen .custom-container {
  height: 100% !important;
}
</style>

<template>
  <div 
    class="card mb-5" 
    v-show="!(typeof output.value === 'undefined')"
    :class="{ 'is-fullscreen': isFullScreen }"
    ref="cardRoot"
  > 
    <header class="card-header">
      <p class="card-header-title is-size-6" v-if="output.name">
        {{ output.name }}
      </p>
      <!-- <p class="card-header-icon" v-if="output.type != 'function'"> -->
      <p class="card-header-icon">
        <button class="button is-small" v-on:click="save()">Save</button>
        <button class="button is-small" v-on:click="copy()">Copy</button>
        <button
          class="button is-small"
          v-if="!isFullScreen"
          @click="toggleFullScreen"
          title="Expand to full screen"
        >
          Fullscreen
        </button>
        <button
          class="button is-small"
          v-else
          @click="toggleFullScreen"
          title="Exit full screen"
        >
          Close
        </button>
      </p>
    </header>
    <div class="card-content">
      <div class="content" :id="outputName" v-if="(output.type == 'svg') || (output.type == 'html')">
        <div v-html="output.value"></div>
      </div>
      <div class="content" :id="outputName" v-else-if="output.type == 'object'">
        <json-viewer :value="output.value" copyable sort />
      </div>
      <div class="content" :id="outputName" v-else-if="output.type == 'code'">
        <pre>{{ output.value }}</pre>
      </div>
      <div class="content" :id="outputName" v-else-if="output.type == 'function'">
        <div class="custom-container" ref="customContainer"></div>
      </div>
      <div class="content" :id="outputName" v-else-if="output.type == 'blank'">
        <!-- will be filled by custom render function -->
      </div>
      <div class="content" :id="outputName" v-else>
        <pre>{{ output.value }}</pre>
      </div>
    </div>
  </div>
</template>

<script>
  export { component as default } from "./common-outputs.js"
</script>

