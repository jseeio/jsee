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
      <div class="columns">
        <div class="column" v-bind:class="($parent.design && $parent.design.grid && ($parent.design.grid.length > 0)) ? 'is-' + $parent.design.grid[0] : ''">
          <div class="card bordered">
            <div class="card-content" id="inputs">
              <ul>
                <li v-for="(input, index) in $parent.inputs">
                  <vue-input v-bind:input="input" v-if="$parent.display(index)" v-on:inchange="$parent.run()"></vue-input>
                </li>
              </ul>
              <pre v-if="$parent.model.debug">{{ $parent.inputs }}</pre>
              <!-- <button class="button is-primary" id="run"><span>▸</span>&nbsp;&nbsp;Run</button> -->
            </div>
            <div class="card">
              <footer class="card-footer">
                <button v-on:click="$parent.reset()" class="button icon card-footer-item is-danger is-small">
                  <span class="has-text-danger-dark">✕</span>
                  <span>&nbsp; Reset</span>
                </button>
                <button v-on:click="$parent.run()" class="button icon card-footer-item is-primary is-small">
                  <span class="has-text-primary-dark">▸</span>
                  <span>&nbsp; Run</span>
                </button>
              </footer>
            </div>
          </div>
        </div>
        <div class="column" id="outputs">
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
