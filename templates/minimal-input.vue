<style lang="scss" scoped>
.jsee-field {
  margin-bottom: 6px;
}
.jsee-label {
  display: inline-block;
  font-size: 12px;
  color: #555;
  background: #f2f2f2;
  padding: 1px 6px;
  border-radius: 3px 3px 0 0;
  margin-bottom: -1px;
}
.jsee-input, .jsee-textarea, .jsee-select {
  display: block;
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid #ddd;
  border-radius: 0 3px 3px 3px;
  background: #fff;
  font-family: inherit;
  &:focus {
    outline: none;
    border-color: #7ab8e6;
    box-shadow: 0 0 0 2px rgba(72, 139, 199, 0.2);
  }
}
.jsee-textarea {
  min-height: 60px;
  resize: vertical;
}
.jsee-checkbox-label, .jsee-radio-label {
  display: block;
  font-size: 12px;
  cursor: pointer;
  padding: 1px 0;
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
.jsee-btn {
  display: block;
  width: 100%;
  padding: 6px 10px;
  margin-top: 8px;
  border: 1px solid #ddd;
  border-radius: 3px;
  background: #fafafa;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  &:hover { background: #f0f0f0; }
}
.jsee-group {
  display: flex;
  gap: 8px;
}
</style>

<template>
  <div class="jsee-field" v-if="input.type == 'int' || input.type == 'float' || input.type == 'number'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <input
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:step="input.type == 'int' ? 1 : 0.001"
      v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
      v-bind:min="input.min"
      v-bind:max="input.max"
      v-bind:disabled="input.disabled"
      v-on:change="changeHandler"
      class="jsee-input"
      type="number"
    >
  </div>

  <div class="jsee-field" v-if="input.type == 'string' || input.type == 'color'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <input
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
      v-on:change="changeHandler"
      class="jsee-input"
    >
  </div>

  <div class="jsee-field" v-if="input.type == 'text'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <textarea
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
      v-on:change="changeHandler"
      class="jsee-textarea"
    ></textarea>
  </div>

  <div class="jsee-field" v-if="input.type == 'slider'">
    <label v-bind:for="input.name" class="jsee-label">
      {{ input.name }}: <strong>{{ input.value }}</strong>
    </label>
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

  <div class="jsee-field" v-if="input.type == 'date'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <input
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:disabled="input.disabled"
      v-on:change="changeHandler"
      class="jsee-input"
      type="date"
    >
  </div>

  <div class="jsee-field" v-if="input.type == 'checkbox' || input.type == 'bool'">
    <label class="jsee-checkbox-label">
      <input
        v-model="input.value"
        v-bind:id="input.name"
        v-on:change="changeHandler"
        type="checkbox"
      >
      {{ input.name }}
    </label>
  </div>

  <div class="jsee-field" v-if="input.type == 'toggle'">
    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px;">
      <span class="jsee-toggle">
        <input type="checkbox" v-model="input.value" v-bind:id="input.name" v-on:change="changeHandler">
        <span class="jsee-toggle-track" v-bind:class="{ active: input.value }"></span>
        <span class="jsee-toggle-thumb" v-bind:class="{ active: input.value }"></span>
      </span>
      {{ input.name }}
    </label>
  </div>

  <div class="jsee-field" v-if="input.type == 'categorical' || input.type == 'select'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <select
      v-model="input.value"
      v-bind:id="input.name"
      v-on:change="changeHandler"
      class="jsee-select"
    >
      <option v-for="(option, oi) in input.options">{{ option }}</option>
    </select>
  </div>

  <div class="jsee-field" v-if="input.type == 'radio'">
    <label class="jsee-label">{{ input.name }}</label>
    <label v-for="option in input.options" :key="option" class="jsee-radio-label">
      <input type="radio" v-model="input.value" :value="option" :name="input.name" v-on:change="changeHandler">
      {{ option }}
    </label>
  </div>

  <div class="jsee-field" v-if="input.type == 'multi-select'">
    <label class="jsee-label">{{ input.name }}</label>
    <label v-for="option in input.options" :key="option" class="jsee-checkbox-label">
      <input type="checkbox" :value="option" v-model="input.value" v-on:change="changeHandler">
      {{ option }}
    </label>
  </div>

  <div class="jsee-field" v-if="input.type == 'file'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <div v-if="!input.disabled">
      <file-picker
        v-model="input.value"
        v-model:url="input.url"
        v-bind:raw="input.raw === true || input.stream === true"
        v-bind:autoload="input.urlAutoLoad === true"
        v-on:change="changeHandler"
      ></file-picker>
    </div>
    <div v-else>
      <input
        class="jsee-input"
        v-bind:id="input.name"
        v-bind:value="input.default"
        disabled
      >
    </div>
  </div>

  <div class="jsee-field" v-if="input.type == 'action' || input.type == 'button'">
    <button
      v-on:click="$parent.$parent.run(input.name.toLowerCase().replace(/ /g, '_'))"
      class="jsee-btn"
    >
      {{ input.title ? input.title : input.name }}
    </button>
  </div>

  <div class="jsee-field" v-if="input.type == 'group'">
    <div class="jsee-group">
      <vue-input v-for="(el, index) in input.elements" v-bind:input="el"></vue-input>
    </div>
  </div>
</template>

<script>
  export { component as default } from "./common-inputs.js"
</script>
