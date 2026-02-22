<style lang="scss" scoped>
  .control {
    margin-top: -1px;
  }
  .jsee-toggle {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
    input { opacity: 0; width: 0; height: 0; position: absolute; }
  }
  .jsee-toggle-track {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    background: #ccc;
    transition: background 0.2s;
    cursor: pointer;
    &.active { background: #00d1b2; }
  }
  .jsee-toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    &.active { left: 18px; }
  }
  .jsee-range {
    display: flex;
    align-items: center;
    gap: 8px;
    input[type="range"] { flex: 1; }
    .jsee-range-value { font-size: 12px; min-width: 30px; text-align: center; }
  }
  .jsee-accordion-header {
    display: flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    padding: 4px 0;
    &:hover { color: #00d1b2; }
  }
  .jsee-accordion-arrow {
    display: inline-block;
    width: 0; height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 6px solid currentColor;
    margin-right: 6px;
    transition: transform 0.2s;
    &.collapsed { transform: rotate(-90deg); }
  }
  .jsee-accordion-body {
    overflow: hidden;
    transition: max-height 0.25s ease;
    &.collapsed { max-height: 0 !important; }
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

  <div class="field" v-if="input.type == 'slider'">
    <label v-bind:for="input.name" class="is-size-7">
      {{ input.name }}: <strong>{{ input.value }}</strong>
    </label>
    <div class="control">
      <input
        v-model.number="input.value"
        v-bind:id="input.name"
        v-bind:min="input.min || 0"
        v-bind:max="input.max || 100"
        v-bind:step="input.step || 1"
        v-bind:disabled="input.disabled"
        v-on:input="changeHandler"
        type="range"
        style="width: 100%"
      >
    </div>
  </div>

  <div class="field" v-if="input.type == 'range'">
    <label class="is-size-7">
      {{ input.name }}: <strong>{{ (input.value || [])[0] }} – {{ (input.value || [])[1] }}</strong>
    </label>
    <div class="control jsee-range">
      <span class="jsee-range-value">{{ (input.value || [])[0] }}</span>
      <input
        v-bind:value="(input.value || [])[0]"
        v-on:input="input.value = [Number($event.target.value), (input.value || [])[1]]; changeHandler()"
        v-bind:min="input.min || 0"
        v-bind:max="(input.value || [])[1]"
        v-bind:step="input.step || 1"
        v-bind:disabled="input.disabled"
        type="range"
      >
      <input
        v-bind:value="(input.value || [])[1]"
        v-on:input="input.value = [(input.value || [])[0], Number($event.target.value)]; changeHandler()"
        v-bind:min="(input.value || [])[0]"
        v-bind:max="input.max || 100"
        v-bind:step="input.step || 1"
        v-bind:disabled="input.disabled"
        type="range"
      >
      <span class="jsee-range-value">{{ (input.value || [])[1] }}</span>
    </div>
  </div>

  <div class="field" v-if="input.type == 'date'">
    <label v-bind:for="input.name" class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <input
        v-model="input.value"
        v-bind:id="input.name"
        v-bind:disabled="input.disabled"
        v-on:change="changeHandler"
        class="input"
        type="date"
      >
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

  <div class="field" v-if="input.type == 'toggle'">
    <div class="control">
      <label class="is-size-7" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
        <span class="jsee-toggle">
          <input type="checkbox" v-model="input.value" v-bind:id="input.name" v-on:change="changeHandler">
          <span class="jsee-toggle-track" v-bind:class="{ active: input.value }"></span>
          <span class="jsee-toggle-thumb" v-bind:class="{ active: input.value }"></span>
        </span>
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

  <div class="field" v-if="input.type == 'radio'">
    <label class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <label v-for="option in input.options" :key="option" class="radio is-size-7" style="display: block; margin-left: 0;">
        <input type="radio" v-model="input.value" :value="option" :name="input.name" v-on:change="changeHandler">
        {{ option }}
      </label>
    </div>
  </div>

  <div class="field" v-if="input.type == 'multi-select'">
    <label class="is-size-7">{{ input.name }}</label>
    <div class="control">
      <label v-for="option in input.options" :key="option" class="checkbox is-size-7" style="display: block;">
        <input type="checkbox" :value="option" v-model="input.value" v-on:change="changeHandler">
        {{ option }}
      </label>
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
          v-bind:autoload="input.urlAutoLoad === true"
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

  <div class="field" v-if="input.type == 'group'">
    <div class="jsee-accordion-header" v-if="input.label || input.collapsed !== undefined" v-on:click="toggleCollapsed">
      <span class="jsee-accordion-arrow" v-bind:class="{ collapsed: collapsed }"></span>
      <label class="is-size-7"><strong>{{ input.label || input.name }}</strong></label>
    </div>
    <div class="field-body" v-bind:class="{ 'jsee-accordion-body': input.label || input.collapsed !== undefined, collapsed: collapsed }" style="max-height: 2000px;">
      <vue-input v-for="(el, index) in input.elements" v-bind:input="el"></vue-input>
    </div>
  </div>
</template>

<script>
  export { component as default } from "./common-inputs.js"
</script>
