<style scoped>
.jsee-output-card {
  border: 1px solid var(--jsee-border, #e0e0e0);
  border-radius: var(--jsee-radius, 6px);
  background: var(--jsee-card-bg, #fff);
  margin-bottom: 16px;
}
.jsee-output-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--jsee-border, #f0f0f0);
}
.jsee-output-title {
  font-size: 14px;
  font-weight: 400;
  margin: 0;
  color: var(--jsee-text, #333);
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
  color: var(--jsee-text-secondary, #666);
  border-radius: 3px;
}
.jsee-output-actions button:hover {
  background: var(--jsee-bg-secondary, #f0f0f0);
  color: var(--jsee-text, #333);
}
.jsee-output-body {
  padding: 12px;
  overflow: auto;
  color: var(--jsee-text, #333);
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
  background: var(--jsee-card-bg, #fff);
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
.jsee-tabs-header {
  display: flex;
  border-bottom: 2px solid var(--jsee-border, #e0e0e0);
  margin-bottom: 8px;
}
.jsee-tab-btn {
  padding: 6px 14px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--jsee-text-secondary, #666);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.jsee-tab-btn.active {
  color: var(--jsee-primary, #00d1b2);
  border-bottom-color: var(--jsee-primary, #00d1b2);
}
.jsee-tab-btn:hover { color: var(--jsee-text, #333); }
.jsee-file-output { text-align: center; }
.jsee-file-download-btn {
  padding: 8px 20px;
  border: 1px solid var(--jsee-border, #e0e0e0);
  border-radius: 4px;
  background: var(--jsee-bg-secondary, #f5f5f5);
  cursor: pointer;
  font-size: 13px;
  color: var(--jsee-text, #333);
}
.jsee-file-download-btn:hover {
  background: var(--jsee-border, #e0e0e0);
}
.jsee-chat-messages {
  max-height: 400px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}
.jsee-chat-msg {
  display: flex;
}
.jsee-chat-user {
  justify-content: flex-end;
}
.jsee-chat-assistant {
  justify-content: flex-start;
}
.jsee-chat-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}
.jsee-chat-bubble p { margin: 0; }
.jsee-chat-bubble p + p { margin-top: 4px; }
.jsee-chat-user .jsee-chat-bubble {
  background: var(--jsee-primary, #00d1b2);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.jsee-chat-assistant .jsee-chat-bubble {
  background: var(--jsee-bg-secondary, #f5f5f5);
  color: var(--jsee-text, #333);
  border-bottom-left-radius: 4px;
}
.jsee-output-missing {
  padding: 24px;
  text-align: center;
  color: var(--jsee-text-secondary, #888);
  font-size: 13px;
  background: var(--jsee-bg-secondary, #f9f9f9);
  border-radius: 4px;
}
.jsee-output-missing a {
  color: var(--jsee-primary, #00d1b2);
}
.jsee-gallery-grid {
  display: grid;
  gap: 8px;
}
.jsee-gallery-grid img {
  width: 100%;
  height: auto;
  object-fit: cover;
  border-radius: 4px;
  cursor: pointer;
}
.jsee-gallery-lightbox {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.jsee-gallery-lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
}
.jsee-highlight-segment {
  padding: 2px 4px;
  border-radius: 3px;
  position: relative;
  display: inline;
}
.jsee-highlight-label {
  font-size: 10px;
  font-weight: 600;
  margin-left: 2px;
  opacity: 0.7;
  vertical-align: super;
}
.jsee-gauge { text-align: center; }
.jsee-gauge-track { fill: none; stroke: var(--jsee-border, #e0e0e0); stroke-width: 12; stroke-linecap: round; }
.jsee-gauge-fill { fill: none; stroke-width: 12; stroke-linecap: round; }
.jsee-gauge-value { font-size: 28px; font-weight: 600; fill: var(--jsee-text, #333); }
.jsee-gauge-label { font-size: 12px; fill: var(--jsee-text-secondary, #666); }

.jsee-number { text-align: center; padding: 12px 0; }
.jsee-number-value { font-size: 36px; font-weight: 700; color: var(--jsee-text, #333); }
.jsee-number-prefix, .jsee-number-suffix { font-size: 20px; font-weight: 400; opacity: 0.6; }
.jsee-number-delta { font-size: 14px; margin-top: 4px; }
.jsee-number-delta.positive { color: #27ae60; }
.jsee-number-delta.negative { color: #e74c3c; }
.jsee-number-delta.neutral { color: var(--jsee-text-secondary, #666); }
.jsee-number-label { font-size: 13px; color: var(--jsee-text-secondary, #666); margin-top: 4px; }

.jsee-alert { padding: 12px 16px; border-radius: 4px; border-left: 4px solid; font-size: 13px; line-height: 1.5; }
.jsee-alert[data-type="info"] { background: #e3f2fd; border-color: #2196f3; color: #1565c0; }
.jsee-alert[data-type="success"] { background: #e8f5e9; border-color: #4caf50; color: #2e7d32; }
.jsee-alert[data-type="warning"] { background: #fff8e1; border-color: #ff9800; color: #e65100; }
.jsee-alert[data-type="error"] { background: #ffebee; border-color: #f44336; color: #c62828; }

.jsee-pdf-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 13px;
}
.jsee-pdf-controls button {
  padding: 2px 10px;
  border: 1px solid var(--jsee-border, #e0e0e0);
  border-radius: 3px;
  background: var(--jsee-bg-secondary, #f5f5f5);
  cursor: pointer;
  font-size: 12px;
}
</style>

<template>
  <!-- Group output: no card wrapper, children render as separate vue-output -->
  <div v-if="output.type === 'group'" :id="outputName">
    <template v-if="output.style === 'tabs'">
      <div class="jsee-tabs-header">
        <button v-for="(el, ti) in output.elements" :key="ti"
          class="jsee-tab-btn" :class="{ active: activeOutputTab === ti }"
          v-on:click="activeOutputTab = ti">
          {{ el.name || 'Tab ' + (ti + 1) }}
        </button>
      </div>
      <div v-for="(el, ti) in output.elements" :key="ti" v-show="activeOutputTab === ti">
        <vue-output :output="el" v-on:notification="$emit('notification', $event)"></vue-output>
      </div>
    </template>
    <template v-else>
      <vue-output v-for="(el, ti) in output.elements" :key="ti"
        :output="el" v-on:notification="$emit('notification', $event)"></vue-output>
    </template>
  </div>
  <!-- Regular output: card wrapper -->
  <div
    v-else
    class="jsee-output-card"
    v-show="!(typeof output.value === 'undefined') || output.type === 'chat'"
    :class="{ 'is-fullscreen': isFullScreen }"
    ref="cardRoot"
  >
    <div class="jsee-output-header" v-if="output.type !== 'chat'">
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
      <div :id="outputName" v-else-if="output.type === 'image'">
        <img :src="output.value" style="max-width: 100%; height: auto;" />
      </div>
      <div :id="outputName" v-else-if="output.type === 'audio'">
        <audio controls :src="output.value" style="width: 100%;"></audio>
      </div>
      <div :id="outputName" v-else-if="output.type === 'video'">
        <video controls :src="output.value" style="max-width: 100%; height: auto;"></video>
      </div>
      <div :id="outputName" v-else-if="output.type === 'chart'" ref="chartContainer">
        <div v-if="!hasPlot" class="jsee-output-missing">
          Chart requires <a href="https://observablehq.com/plot/" target="_blank">Observable Plot</a>.
          Add to imports or use the full bundle.
        </div>
      </div>
      <div :id="outputName" v-else-if="output.type === '3d'" ref="threeDContainer"
        :style="{ height: (output.height || 400) + 'px' }">
        <div v-if="!hasThree" class="jsee-output-missing">
          3D viewer requires <a href="https://threejs.org/" target="_blank">Three.js</a>.
          Add to imports or use the full bundle.
        </div>
      </div>
      <div :id="outputName" v-else-if="output.type === 'map'" ref="mapContainer"
        :style="{ height: (output.height || 400) + 'px' }">
        <div v-if="!hasLeaflet" class="jsee-output-missing">
          Map requires <a href="https://leafletjs.com/" target="_blank">Leaflet</a>.
          Add to imports or use the full bundle.
        </div>
      </div>
      <div :id="outputName" v-else-if="output.type === 'pdf'" ref="pdfContainer"
        :style="{ height: (output.height || 600) + 'px', overflow: 'auto' }">
        <div v-if="!hasPdfjs" class="jsee-output-missing">
          PDF viewer requires <a href="https://mozilla.github.io/pdf.js/" target="_blank">pdf.js</a>.
          Add to imports or use the full bundle.
        </div>
      </div>
      <div :id="outputName" v-else-if="output.type === 'gallery'">
        <div class="jsee-gallery-grid"
          :style="{ gridTemplateColumns: 'repeat(' + (output.columns || 3) + ', 1fr)', gap: (output.gap || 8) + 'px' }">
          <img v-for="(src, gi) in (output.value || [])" :key="gi" :src="src"
            @click="lightboxSrc = src" />
        </div>
        <div v-if="lightboxSrc" class="jsee-gallery-lightbox" @click="lightboxSrc = null">
          <img :src="lightboxSrc" />
        </div>
      </div>
      <div :id="outputName" v-else-if="output.type === 'highlight'">
        <span v-for="(seg, si) in (output.value || [])" :key="si">
          <span v-if="seg.label" class="jsee-highlight-segment"
            :style="{ background: seg.color || '#e3f2fd' }">{{ seg.text }}<span class="jsee-highlight-label">{{ seg.label }}</span></span>
          <span v-else>{{ seg.text }}</span>
        </span>
      </div>
      <div :id="outputName" v-else-if="output.type === 'gauge'" class="jsee-gauge">
        <svg viewBox="0 0 200 120" style="max-width: 220px; margin: 0 auto; display: block;">
          <path class="jsee-gauge-track" d="M 20 90 A 80 80 0 0 1 180 90" />
          <path class="jsee-gauge-fill"
            :stroke="output.color || 'var(--jsee-primary, #00d1b2)'"
            d="M 20 90 A 80 80 0 0 1 180 90"
            :stroke-dasharray="(Math.min(1, Math.max(0, ((typeof output.value === 'object' && output.value !== null ? output.value.value : output.value) - (output.min != null ? output.min : 0)) / ((output.max != null ? output.max : 100) - (output.min != null ? output.min : 0)))) * 251.33) + ' 251.33'" />
          <text class="jsee-gauge-value" x="100" y="88" text-anchor="middle">{{ typeof output.value === 'object' && output.value !== null ? output.value.value : output.value }}</text>
          <text class="jsee-gauge-label" x="100" y="108" text-anchor="middle">{{ (typeof output.value === 'object' && output.value !== null ? output.value.label : null) || output.label || '' }}</text>
        </svg>
      </div>
      <div :id="outputName" v-else-if="output.type === 'number'" class="jsee-number">
        <template v-if="output.value != null">
          <div class="jsee-number-value">
            <span v-if="output.prefix" class="jsee-number-prefix">{{ output.prefix }}</span>{{ output.precision != null
              ? (typeof output.value === 'object' && output.value !== null ? output.value.value : output.value).toFixed(output.precision)
              : (typeof output.value === 'object' && output.value !== null ? output.value.value : output.value).toLocaleString() }}<span v-if="output.suffix" class="jsee-number-suffix">{{ output.suffix }}</span>
          </div>
          <div v-if="typeof output.value === 'object' && output.value !== null && output.value.delta != null"
            class="jsee-number-delta"
            :class="output.value.delta > 0 ? 'positive' : output.value.delta < 0 ? 'negative' : 'neutral'">
            {{ output.value.delta > 0 ? '\u25B2' : output.value.delta < 0 ? '\u25BC' : '\u2013' }} {{ Math.abs(output.value.delta) }}
          </div>
          <div v-if="output.label || (typeof output.value === 'object' && output.value !== null && output.value.label)"
            class="jsee-number-label">
            {{ (typeof output.value === 'object' && output.value !== null ? output.value.label : null) || output.label }}
          </div>
        </template>
      </div>
      <div :id="outputName" v-else-if="output.type === 'alert'" class="jsee-alert"
        :data-type="(typeof output.value === 'object' && output.value !== null ? output.value.type : null) || output.alertType || 'info'">
        {{ typeof output.value === 'object' && output.value !== null ? output.value.message : output.value }}
      </div>
      <div :id="outputName" v-else-if="output.type === 'chat'" class="jsee-chat">
        <div class="jsee-chat-messages" ref="chatMessages">
          <div v-for="(msg, mi) in (output._messages || [])" :key="mi"
            class="jsee-chat-msg" :class="'jsee-chat-' + msg.role">
            <div class="jsee-chat-bubble" v-html="renderMarkdown(msg.content)"></div>
          </div>
        </div>
      </div>
      <div :id="outputName" v-else-if="output.type === 'file'" class="jsee-file-output">
        <button class="jsee-file-download-btn" v-on:click="downloadFile()">⬇ Download {{ output.filename || output.name || 'file' }}</button>
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
