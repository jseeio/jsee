<style lang="scss" scoped>
.jsee-field {
  margin-bottom: 6px;
}
.jsee-label {
  display: inline-block;
  font-size: 12px;
  color: var(--jsee-text-secondary, #555);
  background: var(--jsee-label-bg, #f2f2f2);
  padding: 1px 6px;
  border-radius: 3px 3px 0 0;
  margin-bottom: -1px;
}
.jsee-input, .jsee-textarea, .jsee-select {
  display: block;
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  border: 1px solid var(--jsee-input-border, #ddd);
  border-radius: 0 3px 3px 3px;
  background: var(--jsee-input-bg, #fff);
  color: var(--jsee-text, #333);
  font-family: inherit;
  &:focus {
    outline: none;
    border-color: var(--jsee-focus-border, #7ab8e6);
    box-shadow: 0 0 0 2px var(--jsee-focus-ring, rgba(72, 139, 199, 0.2));
  }
}
.jsee-textarea {
  min-height: 60px;
  max-height: 400px;
  resize: vertical;
  overflow-y: auto;
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
  background: var(--jsee-input-border, #ccc);
  transition: background 0.2s;
  cursor: pointer;
  &.active { background: var(--jsee-toggle-active, #00d1b2); }
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
  font-size: 12px;
  &:hover { color: var(--jsee-primary, #00d1b2); }
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
.jsee-input-error {
  display: block;
  font-size: 11px;
  color: var(--jsee-error, #e74c3c);
  margin-top: 2px;
}
.jsee-input-invalid {
  border-color: var(--jsee-error, #e74c3c) !important;
}
.jsee-btn {
  display: block;
  width: 100%;
  padding: 6px 10px;
  margin-top: 8px;
  border: 1px solid var(--jsee-input-border, #ddd);
  border-radius: 3px;
  background: var(--jsee-bg-secondary, #fafafa);
  color: var(--jsee-text, #333);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  &:hover { background: var(--jsee-border, #f0f0f0); }
}
.jsee-group {
  display: flex;
  gap: 8px;
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
      v-bind:class="{ 'jsee-input-invalid': input._error }"
      type="number"
    >
    <span class="jsee-input-error" v-if="input._error">{{ input._error }}</span>
  </div>

  <div class="jsee-field" v-if="input.type == 'string' || input.type == 'color'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <input
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
      v-on:change="changeHandler"
      v-on:keydown.enter="input.enter ? $emit('inchange') : null"
      class="jsee-input"
      v-bind:class="{ 'jsee-input-invalid': input._error }"
    >
    <span class="jsee-input-error" v-if="input._error">{{ input._error }}</span>
  </div>

  <div class="jsee-field" v-if="input.type == 'text'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <textarea
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:placeholder="input.placeholder ? input.placeholder : input.name"
      v-on:change="changeHandler"
      v-on:input="autosize"
      class="jsee-textarea"
      v-bind:class="{ 'jsee-input-invalid': input._error }"
    ></textarea>
    <span class="jsee-input-error" v-if="input._error">{{ input._error }}</span>
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

  <div class="jsee-field" v-if="input.type == 'range'">
    <label class="jsee-label">
      {{ input.name }}: <strong>{{ (input.value || [])[0] }} – {{ (input.value || [])[1] }}</strong>
    </label>
    <div class="jsee-range">
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

  <div class="jsee-field" v-if="input.type == 'date'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <input
      v-model="input.value"
      v-bind:id="input.name"
      v-bind:disabled="input.disabled"
      v-on:change="changeHandler"
      class="jsee-input"
      v-bind:class="{ 'jsee-input-invalid': input._error }"
      type="date"
    >
    <span class="jsee-input-error" v-if="input._error">{{ input._error }}</span>
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
      v-bind:class="{ 'jsee-input-invalid': input._error }"
    >
      <option v-for="(option, oi) in input.options">{{ option }}</option>
    </select>
    <span class="jsee-input-error" v-if="input._error">{{ input._error }}</span>
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

  <div class="jsee-field" v-if="input.type == 'folder'">
    <label v-bind:for="input.name" class="jsee-label">{{ input.name }}</label>
    <div v-if="!input.disabled && (!input.value || input.value.length === 0)">
      <div class="vfp-bgArea" style="min-height: 80px; padding: 15px 10px;"
        @dragover.prevent @dragleave.prevent @drop.prevent="folderDropped">
        <input type="file" webkitdirectory style="display:none" ref="folderPicker"
          @change="folderSelected">
        <div style="text-align: center">
          <button class="jsee-btn" style="display:inline-block; width:auto"
            @click="$refs.folderPicker.click()">Choose Folder</button>
          <span style="font-size:12px; color:#888; margin-left:8px">or drop a folder here</span>
        </div>
      </div>
    </div>
    <div v-if="input.value && input.value.length > 0">
      <div style="font-size:11px; color:var(--jsee-text-secondary, #888); margin-bottom:4px">
        {{ input.value.length }} files
      </div>
      <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--jsee-border, #ddd); border-radius: 3px">
        <div v-for="(file, fi) in input.value" :key="fi"
          style="padding: 3px 8px; font-size: 12px; border-bottom: 1px solid var(--jsee-border, #f0f0f0); display:flex; align-items:center; gap:6px">
          <input v-if="input.select" type="checkbox"
            v-model="file.selected" @change="folderSelectionChanged">
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ file.name }}</span>
          <span style="color:var(--jsee-text-secondary, #aaa); font-size:10px">{{ formatSize(file.size) }}</span>
        </div>
      </div>
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
    <!-- Accordion -->
    <div v-if="effectiveStyle === 'accordion'">
      <div class="jsee-accordion-header" v-on:click="toggleCollapsed">
        <span class="jsee-accordion-arrow" v-bind:class="{ collapsed: collapsed }"></span>
        <strong>{{ input.label || input.name }}</strong>
      </div>
      <div class="jsee-group jsee-accordion-body" v-bind:class="{ collapsed: collapsed }" style="max-height: 2000px;">
        <vue-input v-for="(el, index) in input.elements" v-bind:input="el"></vue-input>
      </div>
    </div>
    <!-- Tabs -->
    <div v-else-if="effectiveStyle === 'tabs'">
      <div class="jsee-tabs-header">
        <button v-for="(el, ti) in input.elements" :key="ti"
          class="jsee-tab-btn" :class="{ active: activeTab === ti }"
          v-on:click="activeTab = ti">
          {{ el.label || el.name || 'Tab ' + (ti + 1) }}
        </button>
      </div>
      <div class="jsee-tabs-body">
        <div v-for="(el, ti) in input.elements" :key="ti" v-show="activeTab === ti">
          <template v-if="el.type === 'group'">
            <vue-input v-for="(child, ci) in el.elements" :key="ci" :input="child"></vue-input>
          </template>
          <vue-input v-else :input="el"></vue-input>
        </div>
      </div>
    </div>
    <!-- Blocks (default) -->
    <div v-else class="jsee-group">
      <vue-input v-for="(el, index) in input.elements" v-bind:input="el"></vue-input>
    </div>
  </div>
</template>

<script>
  export { component as default } from "./common-inputs.js"
</script>
