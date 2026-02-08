<style lang="scss" scoped>
  .control {
    margin-top: -1px;
  }
</style>

<template>
  <div class="field" v-if="input.type == 'int' || input.type == 'float' || input.type == 'number'">
    <label v-bind:for="input.name" class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <input 
        v-model="input.value" 
        v-bind:id="input.name"
        v-bind:step="input.type == 'int' ? 1 : 0.001"
        v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
        v-bind:min="input.min"
        v-bind:max="input.max"
        v-bind:disabled="input.disabled"
        v-on:change="changeHandler"
        class="input"
        type="number"
      >
    </div>
  </div>

  <div class="field"  v-if="input.type == 'string' || input.type == 'color'">
    <label v-bind:for="input.name" class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <input 
        v-model="input.value" 
        v-bind:id="input.name"
        v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
        v-on:change="changeHandler"
        class="input"
      >
    </div>
  </div>

  <div class="field"  v-if="input.type == 'text'">
    <label v-bind:for="input.name" class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <textarea
        v-model="input.value" 
        v-bind:id="input.name"
        v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
        v-on:change="changeHandler"
        class="textarea" 
        ></textarea>
    </div>
  </div>

  <div class="field" v-if="input.type == 'checkbox' || input.type == 'bool'">
    <div class="control">
      <label class="checkbox is-size-7">
        <input 
          v-model="input.value"
          v-bind:id="input.name"
          v-on:change="changeHandler"
          type="checkbox"
        >
        {{ input.name }}
      </label>
    </div>
  </div>

  <div class="field" v-if="input.type == 'categorical' || input.type == 'select'">
    <label v-bind:for="input.name" class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <div class="select is-fullwidth">
        <select 
          v-model="input.value" 
          v-bind:id="input.name"
          v-on:change="changeHandler"
        >
          <option 
            v-for="(option, oi) in input.options" 
          >{{ option }}</option>
        </select>
      </div>
    </div>
  </div>

  <div class="field" v-if="input.type == 'file'">
    <label v-bind:for="input.name" class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <div class="file has-name is-fullwidth" v-bind:class="{ 'is-primary': !input.file }" v-if="!input.disabled">
        <file-picker
          v-model="input.value"
          v-model:url="input.url"
          v-bind:raw="input.raw === true || input.stream === true"
          v-on:change="changeHandler"
        ></file-picker>
      </div>
      <div class="file has-name is-fullwidth" v-bind:class="{ 'is-primary': !input.file }" v-else>
        <input 
          class="input"
          v-bind:id="input.name"
          v-bind:value="input.default"
          disabled
        >
      </div>
    </div>
  </div>

  <div class="field"  v-if="input.type == 'action' || input.type == 'button'">
    <button 
      v-on:click="$parent.$parent.run(input.name.toLowerCase().replace(/ /g, '_'))"
      class="button is-small"
      style="width: 100%; padding: 5px 0; margin-top: 8px; text-align: left;"
    >
      <span>&nbsp; {{ input.title ? input.title : input.name }} &nbsp;</span>
    </button>
  </div>

  <div class="field is-horizontal" v-if="input.type == 'group'">
    <div class="field-body">
      <vue-input v-for="(el, index) in input.elements" v-bind:input="el" ></vue-input>
    </div>
  </div>
</template>

<script>
  export { component as default } from "./common-inputs.js"
</script>
