<style scoped>
:deep(.jsee-app) {
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

  .jsee-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 20px;
  }
  @media (max-width: 768px) {
    .jsee-grid { grid-template-columns: 1fr; }
  }

  .jsee-grid[data-layout="sidebar"] {
    grid-template-columns: 280px 1fr;
  }
  .jsee-grid[data-layout="sidebar"] > div:first-child {
    position: sticky;
    top: 0;
    max-height: 100vh;
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
    grid-template-columns: repeat(12, 1fr);
    gap: 8px;
  }
  @media (max-width: 768px) {
    .jsee-12-grid { grid-template-columns: 1fr; }
    .jsee-12-grid > * { grid-column: span 1 !important; }
  }

  .jsee-card {
    border: 1px solid var(--jsee-border);
    border-radius: var(--jsee-radius);
    background: var(--jsee-card-bg);
    position: relative;
  }

  .jsee-card-body {
    padding: 16px;
  }

  #inputs .jsee-input-col {
    padding: 0 4px;
    margin-bottom: 2px;
  }

  #overlay {
    display: none;
    position: absolute;
    inset: -1px;
    background: var(--jsee-bg-secondary);
    opacity: .6;
    z-index: 1000;
    align-items: center;
    justify-content: center;
  }

  .jsee-card-footer {
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
:deep(.jsee-app[data-theme="dark"]) {
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
</style>

<template>
  <section>
    <div class="jsee-app" :data-theme="$parent.design && $parent.design.theme ? $parent.design.theme : undefined" :style="designStyle">
      <div class="jsee-header" v-if="$parent.model">
        <h2 class="jsee-title" v-if="$parent.model.title">{{ $parent.model.title }}</h2>
        <p class="jsee-description" v-if="$parent.model.description">{{ $parent.model.description }}</p>
      </div>
      <div class="jsee-grid" :data-layout="$parent.design && $parent.design.layout ? $parent.design.layout : undefined" :style="gridStyle">
        <div>
          <!-- Inputs -->
          <div class="jsee-card">
            <div class="jsee-card-body" id="inputs" v-if="$parent.inputs && $parent.inputs.length > 0"
              :class="{ 'jsee-12-grid': hasInputColumns }">
              <div
                v-for="(input, index) in $parent.inputs"
                :key="index"
                class="jsee-input-col"
                :style="input.columns ? { gridColumn: 'span ' + input.columns } : undefined"
              >
                <vue-input
                  v-bind:input="input"
                  v-if="input.display !== false && $parent.display(index)"
                  v-on:inchange="$parent.run()"
                ></vue-input>
              </div>
              <pre v-if="$parent.model.debug">{{ $parent.inputs }}</pre>
            </div>
            <div class="jsee-card-footer" v-bind:class="{ reset: $parent.dataChanged }">
              <button
                v-on:click="$parent.reset()"
                v-if="$parent.inputs && $parent.inputs.length > 0 && $parent.dataChanged"
                class="jsee-reset-btn"
              >
                Reset
              </button>
              <button
                v-on:click="$parent.run('run')"
                class="jsee-run-btn"
              >
                Run
              </button>
            </div>
          </div>
          <!-- Examples -->
          <div class="jsee-examples" v-if="$parent.examples">
            <p>Examples</p>
            <div v-for="(example, index) in $parent.examples">
              <button
                v-on:click="$parent.reset(example)"
                class="jsee-example-btn"
              >
                {{ JSON.stringify(example, null, 2) }}
              </button>
            </div>
          </div>
        </div>
        <div id="outputs">
          <!-- Outputs -->
          <div v-if="$parent.outputs" :class="{ 'jsee-12-grid': hasOutputColumns }">
            <div
              v-for="(output, index) in $parent.outputs"
              :key="index"
              :style="output.columns ? { gridColumn: 'span ' + output.columns } : undefined"
            >
              <vue-output
                v-bind:output="output"
                v-on:notification="$parent.notify($event)"
              ></vue-output>
            </div>
            <pre v-if="$parent.debug">{{ $parent.outputs }}</pre>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
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
    computed: {
      designStyle () {
        const d = this.$parent.design
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
        const d = this.$parent.design
        if (!d || !d.grid || !Array.isArray(d.grid) || d.grid.length < 2) return undefined
        return { gridTemplateColumns: d.grid.map(n => n + 'fr').join(' ') }
      },
      hasInputColumns () {
        const inputs = this.$parent.inputs
        return inputs && inputs.some(i => i.columns)
      },
      hasOutputColumns () {
        const outputs = this.$parent.outputs
        return outputs && outputs.some(o => o.columns)
      }
    }
  }
</script>
