import { imageView } from '@jseeio/jsee/image-view'
import { Schema, Input, Output, Model, ModelContext, prepareInputs, cloneSchema } from '@jseeio/jsee/schema'

const schema: Schema = {
  schemaVersion: 1,
  model: { code: (inputs: { x: number }, context: ModelContext) => {
    context.progress(null)
    return { result: inputs.x * 2 }
  } },
  inputs: [
    { type: 'group', elements: [{ name: 'x', type: 'int', default: 3 }] },
    { name: 'settings', type: 'group', elements: [{ name: 'enabled', type: 'checkbox', default: false }] },
    { type: 'button', name: 'reset' },
    { name: 'option', type: 'select', options: [{ label: 'Two', value: 2 }, false, null], nullable: true }
  ],
  outputs: [{ type: 'group', elements: [{ name: 'result', type: 'number' }] }],
  design: { grid: [4, 8], radius: '4px', primary: '#123456' },
  security: { allowNetwork: false },
  extension: { package: 'custom' }
}
const copied: Schema = cloneSchema(schema)
const values: Record<string, unknown> = prepareInputs(copied.inputs, { x: 3 })
void values

const moduleModel: Model = { type: 'module', url: './compute.mjs', export: 'predict', worker: true }
const pythonModel: Model = { type: 'py', url: './model.py', entry: 'predict', pyodide: { packages: ['numpy'] } }
const functionSchema: Schema = { model: (x: number) => x * 2 }
void [moduleModel, pythonModel, functionSchema]

// @ts-expect-error Version markers are numeric and constrained.
const badVersion: Schema = { inputs: [], schemaVersion: '1' }
// @ts-expect-error A computation needs a model, view, render, or inputs.
const emptySchema: Schema = {}
// @ts-expect-error Value inputs need a name.
const unnamed: Input = { type: 'int' }
// @ts-expect-error Groups need child descriptors.
const emptyGroup: Input = { type: 'group' }
// @ts-expect-error Known properties retain their types despite extension metadata.
const badRequired: Input = { name: 'x', required: 'true' }
// @ts-expect-error Unknown widget names are authoring errors.
const typo: Input = { name: 'x', type: 'strnig' }
// @ts-expect-error Output groups need child descriptors too.
const badOutput: Output = { type: 'group', elements: {} }
// @ts-expect-error The TensorFlow integration uses normal JS models.
const oldModel: Model = { type: 'tf' }
// @ts-expect-error Grid is a pair of numeric weights.
const badGrid: Schema = { inputs: [], design: { grid: ['4', 8] } }
void [badVersion, emptySchema, unnamed, emptyGroup, badRequired, typo, badOutput, oldModel, badGrid]

const renderer: import('@jseeio/jsee/schema').OutputRenderer<{ count: number }> = (container, data) => {
  container.textContent = String(data.count)
  return { update(next) { container.textContent = String(next.count) }, dispose() { container.replaceChildren() } }
}
const renderers: import('@jseeio/jsee/schema').RendererRegistry = { count: renderer }
const renderedOutput: Output = { name: 'count', type: 'object', renderer: 'count' }
void renderers; void renderedOutput

const imageRenderer: import('@jseeio/jsee/schema').OutputRenderer<import('@jseeio/jsee/image-view').ImageViewData> = imageView
void imageRenderer
