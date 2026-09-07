const { runPipeline } = require('../../src/pipeline')

test.each([
  new Date('2026-09-07T00:00:00Z'),
  new Map([['value', 2]]),
  new Set([1, 2]),
  /value/i,
  new Uint8Array([1, 2])
])('passes an atomic %p result intact to the next stage', async value => {
  const receive = jest.fn(input => ({ received: input }))
  const result = await runPipeline([() => value, receive], { initial: true })
  expect(receive).toHaveBeenCalledWith(value)
  expect(result).toEqual({ received: value })
  expect(result.received).toBe(value)
})

test('merges record outputs and retains an undefined stage result', async () => {
  const result = await runPipeline([
    () => ({ total: 3 }), () => undefined, data => ({ doubled: data.total * 2 })
  ], { original: 1 })
  expect(result).toEqual({ original: 1, total: 3, doubled: 6 })
})
