<style scoped>
:deep(.jsee-app) {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
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
    color: #666;
  }

  .jsee-grid {
    display: grid;
    grid-template-columns: 1fr 2fr;
    gap: 20px;
  }
  @media (max-width: 768px) {
    .jsee-grid { grid-template-columns: 1fr; }
  }

  .jsee-card {
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    background: #fff;
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
    background: #f5f5f5;
    opacity: .6;
    z-index: 1000;
    align-items: center;
    justify-content: center;
  }

  .jsee-card-footer {
    display: flex;
    border-top: 1px solid #e0e0e0;
    background: linear-gradient(90deg, #4395d0 0%, #00d1b2 100%);
    border-radius: 0 0 6px 6px;
  }
  .jsee-card-footer.reset {
    background: linear-gradient(90deg, #ff577f 0%, #4395d0 50%, #00d1b2 100%);
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
  .jsee-run-btn {
    text-align: right;
    border-left: 1px dashed rgba(255,255,255,0.5);
  }

  .jsee-examples {
    margin-top: 16px;
  }
  .jsee-examples p {
    margin: 0 0 8px;
    font-size: 13px;
    color: #666;
  }
  .jsee-example-btn {
    display: block;
    width: 100%;
    padding: 6px 10px;
    margin-top: 4px;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    background: #fafafa;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    text-align: left;
    white-space: normal;
  }
  .jsee-example-btn:hover {
    background: #f0f0f0;
  }
}
</style>

<template>
  <section>
    <div class="jsee-app">
      <div class="jsee-header" v-if="$parent.model">
        <h2 class="jsee-title" v-if="$parent.model.title">{{ $parent.model.title }}</h2>
        <p class="jsee-description" v-if="$parent.model.description">{{ $parent.model.description }}</p>
      </div>
      <div class="jsee-grid">
        <div>
          <!-- Inputs -->
          <div class="jsee-card">
            <div class="jsee-card-body" id="inputs" v-if="$parent.inputs && $parent.inputs.length > 0">
              <div
                v-for="(input, index) in $parent.inputs"
                :key="index"
                class="jsee-input-col"
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
                ✕ Reset
              </button>
              <button
                v-on:click="$parent.run('run')"
                class="jsee-run-btn"
              >
                Run ▸
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
          <div v-if="$parent.outputs">
            <div
              v-for="(output, index) in $parent.outputs"
              :key="index"
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
  export default {}
</script>
