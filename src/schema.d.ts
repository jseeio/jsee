/** JSON descriptors use schemaVersion 1 independently of package versions. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type InputType = 'int' | 'float' | 'number' | 'string' | 'color' | 'text' | 'categorical' | 'select' | 'bool' | 'checkbox' | 'file' | 'group' | 'action' | 'button' | 'slider' | 'radio' | 'toggle' | 'date' | 'multi-select' | 'range' | 'folder' | 'table' | 'object' | 'image' | 'audio' | 'video'
export type ModelType = 'function' | 'class' | 'module' | 'async-init' | 'async-function' | 'get' | 'post' | 'py'
export type OutputType = 'text' | 'string' | 'int' | 'float' | 'bool' | 'table' | 'chart' | '3d' | 'map' | 'pdf' | 'gallery' | 'gauge' | 'number' | 'alert' | 'highlight' | 'chat' | 'viewer' | 'markdown' | 'image' | 'audio' | 'video' | 'object' | 'html' | 'svg' | 'code' | 'file' | 'group' | 'function' | 'blank'
export type DType = 'float32' | 'float64' | 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32'
export type Alias = string | string[]
export type GroupStyle = 'blocks' | 'accordion' | 'tabs'
export type Columns = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export interface InputProperties {
  name?: string
  label?: string
  description?: string
  default?: unknown
  value?: unknown
  options?: JsonValue[]
  required?: boolean
  nullable?: boolean
  min?: number
  max?: number
  step?: number
  alias?: Alias
  display?: string | boolean
  validate?: string
  error?: string
  disabled?: boolean
  readonly?: boolean
  reactive?: boolean
  enter?: boolean
  raw?: boolean
  stream?: boolean
  select?: boolean
  arrayBuffer?: boolean
  dtype?: DType
  url?: string
  urlAutoLoad?: boolean
  accept?: string
  placeholder?: string
  columns?: Columns
  [extension: string]: unknown
}

export type Input = InputProperties & (
  | { type: 'group'; elements: Input[]; style?: GroupStyle; collapsed?: boolean }
  | { type: 'button' | 'action' }
  | { name: string; type?: Exclude<InputType, 'group' | 'button' | 'action'> }
)

export interface OutputProperties {
  name?: string
  label?: string
  description?: string
  alias?: Alias
  value?: unknown
  columns?: Columns
  filename?: string
  mime?: string
  contentType?: string
  width?: number | string
  height?: number | string
  precision?: number
  prefix?: string
  suffix?: string
  min?: number
  max?: number
  [extension: string]: unknown
}

export type Output = OutputProperties & (
  | { type: 'group'; elements: Output[]; style?: GroupStyle }
  | { type?: Exclude<OutputType, 'group'> }
)

export interface ModelContext {
  log(...values: unknown[]): void
  progress(value: number | null): void
  isCancelled(): boolean
}

// Model parameters and result shapes belong to the computation, not to a single UI signature.
export type ModelFunction = (...args: any[]) => any
export type ModelConstructor = new (...args: any[]) => object
export type Import = string | { url: string; code?: string; [extension: string]: unknown }
export type Imports = string | Import[]
export interface PyodideOptions {
  url?: string
  indexURL?: string
  packages?: string[]
  [extension: string]: unknown
}

export interface Model {
  name?: string
  title?: string
  description?: string
  url?: string
  code?: string | ModelFunction | ModelConstructor
  type?: ModelType
  container?: 'object' | 'args'
  worker?: boolean
  timeout?: number
  method?: string
  export?: string
  entry?: string
  imports?: Imports
  autorun?: boolean
  reactive?: boolean
  stream?: boolean
  pyodide?: string | PyodideOptions
  [extension: string]: unknown
}
export type Models = Model | ModelFunction | Model[]

export interface Design {
  layout?: string
  framework?: string
  theme?: string
  primary?: string
  secondary?: string
  bg?: string
  fg?: string
  font?: string
  radius?: string | number
  grid?: [number, number]
  [extension: string]: unknown
}

/** Operation gates do not sandbox arbitrary model code. */
export interface Security {
  mode?: 'trusted' | 'secure'
  trusted?: boolean
  allowEval?: boolean
  allowNetwork?: boolean
  allowRawHtml?: boolean
  allowNotifications?: boolean
  allowFileViewer?: boolean
  [extension: string]: unknown
}

export interface Page {
  title?: string
  url?: string
  ga?: string
  social?: Record<string, string>
  org?: { name?: string; url?: string; description?: string; [extension: string]: unknown }
  [extension: string]: unknown
}

export interface SchemaProperties {
  $schema?: string
  schemaVersion?: 1
  id?: string
  title?: string
  description?: string
  model?: Models
  render?: Models
  view?: Models
  inputs?: Input[]
  outputs?: Output[]
  imports?: Imports
  design?: Design
  security?: Security
  examples?: (Record<string, unknown> | unknown[])[]
  autorun?: boolean
  reactive?: boolean
  persist?: boolean
  notify?: boolean
  interval?: number
  inferInputTypes?: boolean
  page?: Page
  [extension: string]: unknown
}

export type Schema = SchemaProperties & (
  | { model: Models }
  | { render: Models }
  | { view: Models }
  | { inputs: Input[] }
)

export interface InputJsonSchema {
  type: string | string[]
  properties?: Record<string, InputJsonSchema>
  required?: string[]
  [keyword: string]: unknown
}

export function assertSchemaVersion(schema: unknown): void
export function cloneSchema<T>(value: T): T
export function getOptionValue(option: unknown): unknown
export function getInputDefaultValue(input: Input): unknown
export function collectInputValues(inputs?: Input[], read?: (input: Input) => unknown): Record<string, unknown>
export function jseeInputsToJsonSchema(inputs?: Input[]): InputJsonSchema
/** Copies containers, applies explicit defaults, and rejects invalid values before execution. */
export function prepareInputs(inputs: Input[] | undefined, data: unknown): Record<string, unknown>

export function matchesFileAccept(accept?: string, name?: string, mime?: string): boolean
export function tableOutputJsonSchema(): Record<string, unknown>
