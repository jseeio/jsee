<style lang="scss" scoped>
  :deep(.jsee-app) {
    @import "../node_modules/vue3-json-viewer/dist/index.css";
    @import "../node_modules/bulma/sass/base/_all.sass";
    @import "../node_modules/bulma/sass/utilities/_all.sass";
    @import "../node_modules/bulma/sass/form/_all.sass";
    @import "../node_modules/bulma/sass/grid/_all.sass";
    @import "../node_modules/bulma/sass/elements/_all.sass";
    @import "../node_modules/bulma/sass/helpers/_all.sass";
    @import "../node_modules/bulma/sass/components/card.sass";
    @import "../node_modules/bulma/sass/layout/section.sass";

    font-family: sans-serif;

    #overlay {
      display: none;
      position: absolute;
      top: -1px;
      left: -1px;
      right: -1px;
      bottom: -1px;
      background: #F5F5F5;
      opacity: .6;
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }


    .card-header {
      box-shadow: none;
      border-bottom: 1px solid #ececec;
    }

    .card-header-title {
      font-weight: 400;
    }

    .card-header-title, .card-header-icon {
      padding: 0.75rem 1.5rem;
      cursor: initial;
    }

    .card-header-icon button {
      border: none;
      margin: 0 0 0 5px;
      padding: 0px 7px;
      height: auto;

      &:hover {
        background-color: whitesmoke;
      }
    }

    .card-footer {
      /* background: linear-gradient(62deg, rgba(0,171,209,1) 0%, rgba(0,209,178,1) 100%); */
      background: linear-gradient(90deg, #4395d0 0%, #00d1b2 100%);
    }

    .card-footer.reset {
      background: linear-gradient(90deg, #ff577f 0%, #4395d0 50%, #00d1b2 100%);
    }

    .card-footer .button {
      background: none;
      padding: .75rem 1.5rem;
      border: none !important;
      border-radius: .25rem !important;
      font-size: 14px;
      font-weight: 400;
    }

    .reset-button {
      justify-content: left;
    }

    .reset-button:hover {
      background-color: transparent !important;
      background: linear-gradient(90deg, #ff3a56 0%, #fff0 80%);
      box-shadow: -5px 0px 5px -2px #fd4c7e30;
    }

    .card-footer .run-button {
      border-left: 1px dashed white;
      justify-content: right;
    }

    .card-footer .run-button:hover {
      background-color: transparent !important;
      background: linear-gradient(270deg, #02dbb2 0%, #fff0 80%);
      box-shadow: 5px 0px 5px -2px #48ffd43b;
    }

    .card-footer .run-button.running .run-icon {
      color: #016c5c !important;
    }

    .example-button {
      margin-top: 3px;
      padding: 5px 10px;
      border-radius: 5px !important;
      height: auto;
    }

    .field {
      margin-bottom: 5px;
    }

    .input, .textarea, .select select {
      border-color: #e8e8e8;
      border-top-left-radius: 0;
    }

    .input:focus, .textarea:focus, .select select:focus, .is-focused.input, .is-focused.textarea, .select select.is-focused, .input:active, .textarea:active, .select select:active, .is-active.input, .is-active.textarea, .select select.is-active {
      border-color: #7ab8e6;
      box-shadow: 0 0 0 0.125em rgba(72, 139, 199, 0.25);
    }

    #inputs .field > label:first-child {
      background: #f2f2f2;
      padding: 1px 5px;
      margin-top: 2px;
      display: inline-block;
      border-top-left-radius: 5px;
      border-top-right-radius: 5px;
    }

  }
</style>
<template>
  <section>
    <div class="jsee-app">
      <div class="columns">
        <div class="column is-full" id="$parent.model" v-if="$parent.model">
          <h2 class="title is-2" v-if="$parent.model.title">{{ $parent.model.title }}</h2>
          <p v-if="$parent.model.description">{{ $parent.model.description }}</p>
        </div>
      </div>
      <div class="columns is-multiline">
        <div class="column" v-bind:class="($parent.design && $parent.design.grid && ($parent.design.grid.length > 0)) ? 'is-' + $parent.design.grid[0] : ''">
          <!-- Inputs -->
          <div class="card bordered">
            <div class="card-content" id="inputs" v-if="$parent.inputs && $parent.inputs.length > 0">
              <ul>
                <li v-for="(input, index) in $parent.inputs">
                  <vue-input
                    v-bind:input="input"
                    v-if="input.display !== false && $parent.display(index)"
                    v-on:inchange="$parent.run()"
                  ></vue-input>
                </li>
              </ul>
              <pre v-if="$parent.model.debug">{{ $parent.inputs }}</pre>
              <!-- <button class="button is-primary" id="run"><span>▸</span>&nbsp;&nbsp;Run</button> -->
            </div>
            <footer class="card-footer" v-bind:class="{ reset: $parent.dataChanged }">
              <button
                v-on:click="$parent.reset()"
                v-if="$parent.inputs && $parent.inputs.length > 0 && $parent.dataChanged"
                class="button reset-button icon card-footer-item is-danger is-small"
              >
                <span class="rest-icon has-text-danger-dark">✕</span>
                <span>&nbsp; Reset</span>
              </button>
              <button
                v-on:click="$parent.run('run')"
                class="button run-button icon card-footer-item is-primary is-small"
                v-bind:class="{ running: $parent.clickRun }"
              >
                <span>&nbsp; Run &nbsp;</span>
                <span class="run-icon has-text-primary-dark">▸</span>
              </button>
            </footer>
          </div>
          <!-- Examples -->
          <div v-if="$parent.examples">
            <p style="margin-top: 20px">Examples</p>
            <div v-for="(example, index) in $parent.examples">
              <button
                v-on:click="$parent.reset(example)"
                class="button is-small example-button"
              >
                {{ example }}
              </button>
            </div>
          </div>
        </div>
        <div class="column" id="outputs" v-bind:class="($parent.design && $parent.design.grid && ($parent.design.grid.length > 1)) ? 'is-' + $parent.design.grid[1] : ''">
          <!-- Outputs -->
          <div v-if="$parent.outputs">
            <div v-for="(output, index) in $parent.outputs">
              <vue-output v-bind:output="output" v-on:notification="$parent.notify($event)"></vue-output>
            </div>
            <pre v-if="$parent.model.debug">{{ $parent.outputs }}</pre>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
<script>
  export default {}
</script>
