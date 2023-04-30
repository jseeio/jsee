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
      <div class="file has-name is-fullwidth" v-bind:class="{ 'is-primary': !input.file }">
        <label class="file-label">
          <input
            v-bind:id="input.name"
            v-on:change="loadFile"
  	  			class="file-input"
  	  			type="file"
  	  		>
          <span class="file-cta">
            <span class="file-label">
              Open
            </span>
          </span>
          <span class="file-name">
            <span v-if="input.file && input.file.name">{{ input.file.name }}</span>
            <span v-else>No file selected</span>
          </span>
        </label>
      </div>
    </div>
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
