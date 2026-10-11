<style scoped lang="scss">
@use './mono';
.jsee-app {
  /* Theme variables — light (default) */
  --jsee-primary: #00d1b2;
  --jsee-primary-dark: #016c5c;
  --jsee-bg: #fff;
  --jsee-bg-secondary: #f5f5f5;
  --jsee-text: #333;
  --jsee-text-secondary: #666;
  --jsee-border: #e0e0e0;
  --jsee-card-bg: #fff;
  --jsee-input-bg: #fff;
  --jsee-input-border: #ddd;
  --jsee-label-bg: #f2f2f2;
  --jsee-focus-ring: rgba(72, 139, 199, 0.2);
  --jsee-focus-border: #7ab8e6;
  --jsee-toggle-active: #00d1b2;
  --jsee-gradient-start: #4395d0;
  --jsee-gradient-end: #00d1b2;
  --jsee-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --jsee-radius: 6px;

  font-family: var(--jsee-font);
  font-size: 14px;
  line-height: 1.5;
  color: var(--jsee-text);
  box-sizing: border-box;
  *, *::before, *::after { box-sizing: border-box; }

  .jsee-header {
    margin-bottom: 16px;
  }
  .jsee-title {
    font-size: 24px;
    font-weight: 600;
    margin: 0 0 4px;
  }
  .jsee-description {
    margin: 0;
    color: var(--jsee-text-secondary);
  }

  /* design.grid arrives as --jsee-grid-columns rather than an inline
     grid-template-columns, so the narrow-screen rules below still apply. */
  .jsee-grid {
    display: grid;
    grid-template-columns: var(--jsee-grid-columns, minmax(0, 1fr) minmax(0, 2fr));
    gap: 20px;
  }
  @media (max-width: 768px) {
    .jsee-grid { grid-template-columns: 1fr; }
  }

  .jsee-grid[data-layout="sidebar"] {
    grid-template-columns: var(--jsee-grid-columns, 280px minmax(0, 1fr));
  }
  .jsee-grid > div {
    min-width: 0;
  }
  /* Hosts that place the app below their own header bound the panel with
     --jsee-sidebar-max-height so its footer stays on screen. */
  .jsee-grid[data-layout="sidebar"] > div:first-child {
    position: sticky;
    top: 0;
    max-height: var(--jsee-sidebar-max-height, 100vh);
    overflow-y: auto;
  }
  @media (max-width: 768px) {
    .jsee-grid[data-layout="sidebar"] {
      grid-template-columns: 1fr;
    }
    .jsee-grid[data-layout="sidebar"] > div:first-child {
      position: static;
      max-height: none;
    }
  }

  .jsee-12-grid {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 8px;
  }
  .jsee-12-grid > * {
    min-width: 0;
  }
  @media (max-width: 768px) {
    .jsee-12-grid { grid-template-columns: 1fr; }
    .jsee-12-grid > * { grid-column: span 1 !important; }
  }

  .jsee-card {
    border: 0;
    border-radius: var(--jsee-radius);
    background: var(--jsee-card-bg);
    box-shadow: rgba(14, 63, 126, 0.04) 0 0 0 1px, rgba(42, 51, 69, 0.04) 0 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0 3px 3px -1.5px, rgba(42, 51, 70, 0.04) 0 6px 6px -3px, rgba(14, 63, 126, 0.04) 0 12px 12px -6px, rgba(14, 63, 126, 0.04) 0 24px 24px -12px;
    position: relative;
  }

  .jsee-card-body {
    padding: 16px;
  }
  #inputs, #outputs {
    position: relative;
  }

  #inputs .jsee-input-col {
    padding: 0 4px;
    margin-bottom: 2px;
  }

  /* Long forms keep Run/Stop reachable: the footer sticks to the bottom of the
     nearest scroll container (page or sidebar panel) while the card is in view. */
  .jsee-card-footer {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    border-top: 1px solid var(--jsee-border);
    background: linear-gradient(90deg, var(--jsee-gradient-start) 0%, var(--jsee-gradient-end) 100%);
    border-radius: 0 0 var(--jsee-radius) var(--jsee-radius);
  }
  .jsee-card-footer.reset {
    background: linear-gradient(90deg, #ff577f 0%, var(--jsee-gradient-start) 50%, var(--jsee-gradient-end) 100%);
  }
  .jsee-card-footer button {
    flex: 1;
    padding: 10px 16px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 14px;
    color: #fff;
  }
  .jsee-card-footer button:hover {
    background: rgba(255,255,255,0.15);
  }
  .jsee-reset-btn {
    text-align: left;
  }
  .jsee-reset-btn::before {
    content: '\2715  ';
  }
  .jsee-run-btn {
    text-align: right;
    border-left: 1px dashed rgba(255,255,255,0.5);
  }
  .jsee-run-btn::after {
    content: ' \25B8';
  }
  .jsee-stop-btn {
    background: #e74c3c !important;
  }
  .jsee-stop-btn::after {
    content: ' \25A0' !important;
  }

  .jsee-examples {
    margin-top: 16px;
  }
  .jsee-examples p {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--jsee-text-secondary);
  }
  .jsee-example-btn {
    display: block;
    width: 100%;
    padding: 6px 10px;
    margin-top: 4px;
    border: 1px solid var(--jsee-border);
    border-radius: 4px;
    background: var(--jsee-bg-secondary);
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    text-align: left;
    white-space: normal;
    color: var(--jsee-text);
  }
  .jsee-example-btn:hover {
    background: var(--jsee-border);
  }
}
/* Dark theme overrides */
@mixin dark-palette {
  --jsee-bg: #1a1a1a;
  --jsee-bg-secondary: #222;
  --jsee-text: #e0e0e0;
  --jsee-text-secondary: #aaa;
  --jsee-border: #333;
  --jsee-card-bg: #252525;
  --jsee-input-bg: #2a2a2a;
  --jsee-input-border: #444;
  --jsee-label-bg: #303030;
  --jsee-focus-ring: rgba(72, 139, 199, 0.35);
  --jsee-toggle-active: #00d1b2;
}
.jsee-app[data-color-scheme="dark"] { @include dark-palette; color-scheme: dark; }
.jsee-app[data-color-scheme="light"] { color-scheme: light; }
.jsee-app[data-color-scheme="auto"] { color-scheme: light; }
@media (prefers-color-scheme: dark) {
  .jsee-app[data-color-scheme="auto"] { @include dark-palette; color-scheme: dark; }
}
@include mono.theme;
</style>

<template>
  <section>
    <div class="jsee-app" :data-theme="design && design.theme" :data-color-scheme="colorScheme" :style="designStyle">
      <div class="jsee-header" v-if="model">
        <h2 class="jsee-title" v-if="model.title">{{ model.title }}</h2>
        <p class="jsee-description" v-if="model.description">{{ model.description }}</p>
      </div>
      <div class="jsee-grid" :data-layout="design && design.layout ? design.layout : undefined" :style="gridStyle">
        <component :is="regions.inputs ? Teleport : 'div'" :to="regions.inputs" :style="regions.inputGroups ? { display: 'none' } : undefined">
        <div :class="{ 'jsee-app': regions.inputs }" :style="designStyle" :data-theme="design && design.theme" :data-color-scheme="colorScheme">
          <!-- Inputs -->
          <div class="jsee-card">
            <div class="jsee-card-body" id="inputs" v-if="inputs && inputs.length > 0"
              :class="{ 'jsee-12-grid': hasInputColumns }">
              <component v-for="(input, index) in inputs" :key="index"
                :is="regions.inputGroups ? Teleport : 'div'" :to="regions.inputGroups">
              <div v-show="!regions.inputGroups || state.selectedInputGroup === input.name"
                class="jsee-input-col" :class="{ 'jsee-app': regions.inputGroups }"
                :data-theme="design && design.theme" :data-color-scheme="colorScheme"
                :style="[regions.inputGroups ? designStyle : undefined, input.columns ? { gridColumn: 'span ' + input.columns } : undefined]"
              >
                <vue-input
                  v-bind:input="input"
                  v-bind:security="security"
                  v-if="input.display !== false && displayInput(index)"
                  v-on:inchange="run()"
                ></vue-input>
              </div>
              </component>
              <pre v-if="model && model.debug">{{ inputs }}</pre>
            </div>
            <div v-if="!jsee || jsee.controls !== false" class="jsee-card-footer" v-bind:class="{ reset: dataChanged }">
              <button
                v-on:click="reset()"
                v-if="inputs && inputs.length > 0 && dataChanged"
                class="jsee-reset-btn"
              >
                Reset
              </button>
              <button
                v-if="!running"
                v-on:click="run('run')"
                class="jsee-run-btn"
              >
                Run
              </button>
              <button v-if="!running && jsee && jsee.namedPipeline" v-on:click="jsee.rerun()" class="jsee-rerun-btn">Rerun all</button>
              <button
                v-if="running"
                v-on:click="stop()"
                class="jsee-run-btn jsee-stop-btn"
              >
                Stop
              </button>
            </div>
          </div>
          <!-- Examples -->
          <div class="jsee-examples" v-if="examples">
            <p>Examples</p>
            <div v-for="(example, index) in examples">
              <button
                v-on:click="reset(example)"
                class="jsee-example-btn"
              >
                {{ JSON.stringify(example, null, 2) }}
              </button>
            </div>
          </div>
        </div>
        </component>
        <component :is="regions.outputs ? Teleport : 'div'" :to="regions.outputs">
        <div id="outputs" :class="{ 'jsee-app': regions.outputs }" :style="designStyle" :data-theme="design && design.theme" :data-color-scheme="colorScheme">
          <!-- Outputs -->
          <div v-if="outputs" :class="{ 'jsee-12-grid': hasOutputColumns }">
            <div
              v-for="(output, index) in outputs"
              :key="index"
              :style="output.columns ? { gridColumn: 'span ' + output.columns } : undefined"
            >
              <vue-output
                v-if="output.display !== false"
                v-bind:output="output"
                v-bind:security="security"
                v-on:notification="notify($event)"
              ></vue-output>
            </div>
            <pre v-if="debug">{{ outputs }}</pre>
          </div>
        </div>
        </component>
      </div>
    </div>
  </section>
</template>

<script>
  import { Teleport } from 'vue'
  function hexToRgb (hex) {
    if (typeof hex !== 'string' || hex[0] !== '#') return null
    const n = parseInt(hex.slice(1), 16)
    if (hex.length === 4) {
      return [(n >> 8 & 0xf) * 17, (n >> 4 & 0xf) * 17, (n & 0xf) * 17]
    }
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function mix (c, white, t) {
    return c.map((v, i) => Math.round(v + (white[i] - v) * t))
  }

  function rgbHex (c) {
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
  }

  function lighter (hex, t) {
    const c = hexToRgb(hex)
    return c ? rgbHex(mix(c, [255, 255, 255], t)) : hex
  }

  function darker (hex, t) {
    const c = hexToRgb(hex)
    return c ? rgbHex(mix(c, [0, 0, 0], t)) : hex
  }

  export default {
    // Vue 3.2 skips descendant cleanup for a disabled Teleport nested in a removed
    // element. Use ordinary elements for the standalone layout instead.
    setup () { return { Teleport } },
    inject: {
      jsee: { default: null }
    },
    computed: {
      regions () { return this.jsee && this.jsee.regions || {} },
      state () {
        return this.jsee && this.jsee.state ? this.jsee.state : {}
      },
      model () {
        return this.state.model
      },
      design () {
        return this.state.design
      },
      inputs () {
        return this.state.inputs || []
      },
      outputs () {
        return this.state.outputs || []
      },
      examples () {
        return this.state.examples
      },
      security () {
        return this.state._security
      },
      dataChanged () {
        return this.state.dataChanged === true
      },
      running () {
        return this.state.running === true
      },
      debug () {
        return this.state.debug === true
      },
      colorScheme () {
        const d = this.design || {}
        return d.colorScheme || (d.theme === 'dark' ? 'dark' : ['mono', 'auto'].includes(d.theme) ? 'auto' : 'light')
      },
      designStyle () {
        const d = this.design
        if (!d) return undefined
        const s = {}
        if (d.primary) {
          s['--jsee-primary'] = d.primary
          s['--jsee-primary-dark'] = darker(d.primary, 0.4)
          s['--jsee-gradient-end'] = d.primary
          s['--jsee-toggle-active'] = d.primary
        }
        if (d.secondary) {
          s['--jsee-gradient-start'] = d.secondary
        } else if (d.primary) {
          s['--jsee-gradient-start'] = darker(d.primary, 0.25)
        }
        if (d.bg) {
          s['--jsee-bg'] = d.bg
          s['--jsee-bg-secondary'] = darker(d.bg, 0.04)
          s['--jsee-card-bg'] = d.bg
          s['--jsee-input-bg'] = d.bg
          s['--jsee-label-bg'] = darker(d.bg, 0.05)
          s['--jsee-border'] = darker(d.bg, 0.12)
          s['--jsee-input-border'] = darker(d.bg, 0.13)
        }
        if (d.fg) {
          s['--jsee-text'] = d.fg
          s['--jsee-text-secondary'] = lighter(d.fg, 0.4)
        }
        if (d.font) {
          s['--jsee-font'] = d.font
        }
        if (typeof d.radius !== 'undefined') {
          s['--jsee-radius'] = typeof d.radius === 'number' ? d.radius + 'px' : d.radius
        }
        return Object.keys(s).length ? s : undefined
      },
      gridStyle () {
        if (this.regions.inputGroups) return { gridTemplateColumns: 'minmax(0, 1fr)' }
        const d = this.design
        if (d && d.grid && Array.isArray(d.grid) && d.grid.length >= 2) {
          return { '--jsee-grid-columns': d.grid.map(n => `minmax(0, ${n}fr)`).join(' ') }
        }
        // Grid editors need room, so a schema with one defaults to even columns
        // instead of the narrow 1fr/2fr form column. An explicit grid or layout
        // still wins.
        if (!d || !d.layout) {
          if (this.inputs.some(i => i && i.type === 'table' && i.display !== false)) {
            return { '--jsee-grid-columns': 'minmax(0, 1fr) minmax(0, 1fr)' }
          }
        }
        return undefined
      },
      hasInputColumns () {
        const inputs = this.inputs
        return inputs && inputs.some(i => i.columns)
      },
      hasOutputColumns () {
        const outputs = this.outputs
        return outputs && outputs.some(o => o.columns)
      }
    },
    methods: {
      displayInput (index) {
        return this.jsee && this.jsee.display ? this.jsee.display(index) : true
      },
      reset (example) {
        if (this.jsee && this.jsee.reset) this.jsee.reset(example)
      },
      run (caller) {
        if (this.jsee && this.jsee.run) this.jsee.run(caller)
      },
      stop () {
        if (this.jsee && this.jsee.stop) this.jsee.stop()
      },
      notify (msg) {
        if (this.jsee && this.jsee.notify) this.jsee.notify(msg)
      }
    }
  }
</script>
