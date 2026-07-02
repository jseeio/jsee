export function predict (inputs) {
  return {
    result: inputs.x * 4,
    workerScope: typeof document === 'undefined'
  }
}
