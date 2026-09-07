const { isRecordObject } = require('./utils')

async function runPipeline (stages, inputs, checkCancelled=() => {}) {
  let result = inputs
  for (const stage of stages) {
    checkCancelled()
    if (isRecordObject(result) && result.stop) break
    const next = await stage(result)
    checkCancelled()
    // Binary values and arrays replace the result; only records participate in key merging.
    if (isRecordObject(result) && isRecordObject(next)) result = { ...result, ...next }
    else if (typeof next !== 'undefined') result = next
  }
  return result
}

module.exports = { runPipeline }
