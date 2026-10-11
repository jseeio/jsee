const { test, expect } = require('@playwright/test')

for (const initial of ['omitted', 'null']) test(`setDesign is reactive when initial design is ${initial}`, async ({ page }) => {
  await page.goto('/load/')
  await page.evaluate(async initial => {
    document.body.innerHTML = '<div id="app"></div>'
    const schema = { persist: false, autorun: false,
      model: { worker: true, code: 'function () { return { scores: [{ label: "score", score: 0.8 }] } }' },
      inputs: [{ name: 'x', type: 'string', default: 'keep me' }],
      outputs: [{ name: 'scores', type: 'scores' }]
    }
    if (initial === 'null') schema.design = null
    window.app = new JSEE({ container: '#app', schema, verbose: false })
    await window.app.ready
    await window.app.invoke()
    window.originalWorker = window.app._workers[0]
    window.originalMeter = document.querySelector('[role="meter"]')
    await window.app.setDesign({ theme: 'mono', colorScheme: 'dark' })
  }, initial)
  await expect(page.locator('#x')).toHaveCSS('color', 'rgb(236, 236, 236)')
  await expect(page.locator('.jsee-scores')).toHaveCSS('color', 'rgb(236, 236, 236)')
  await expect(page.locator('#x')).toHaveValue('keep me')
  expect(await page.evaluate(() => ({
    design: window.app.getSchema().design,
    workerRetained: window.originalWorker === window.app._workers[0],
    viewRetained: window.originalMeter === document.querySelector('[role="meter"]')
  }))).toEqual({ design: { theme: 'mono', colorScheme: 'dark' }, workerRetained: true, viewRetained: true })
  await page.evaluate(() => window.app.setDesign({ colorScheme: 'light' }))
  await expect(page.locator('#x')).toHaveCSS('color', 'rgb(17, 17, 17)')
  await page.evaluate(() => window.app.destroy())
})

async function mount(page, regions=false) {
  await page.goto('/load/')
  await page.evaluate(async regions => {
    document.body.innerHTML = '<div id="app"></div><div id="fields"></div><div id="results"></div><div id="other"></div>'
    window.mounts = 0
    window.disposals = 0
    window.app = new JSEE({ container: '#app', verbose: false, toasts: false,
      regions: regions ? { [regions]: '#fields', outputs: '#results' } : {},
      renderers: { retained: container => {
        window.mounts++
        const node = document.createElement('input')
        node.setAttribute('aria-label', 'Retained selection')
        container.append(node)
        return { update() {}, dispose() { window.disposals++ } }
      } },
      schema: { persist: false, autorun: false, design: { theme: 'mono' },
        model: { worker: true, code: 'function (data) { return { result: data.group.x } }' },
        inputs: [{ name: 'group', type: 'group', elements: [{ name: 'x', type: 'string', default: 'hello' }] }],
        outputs: [{ name: 'result', type: 'string', renderer: 'retained' }]
      }
    })
    window.other = new JSEE({ container: '#other', verbose: false, schema: {
      persist: false, autorun: false, model: { worker: false, code: 'function () {}' },
      inputs: [{ name: 'y', type: 'string' }], outputs: []
    } })
    await Promise.all([window.app.ready, window.other.ready])
    if (regions === 'inputGroups') window.app.selectInputGroup('group')
    await window.app.invoke()
    window.originalWorker = window.app._workers[0]
  }, regions)
}

for (const regions of [false, 'inputs', 'inputGroups']) test(`mono follows system and changes live without remounting; regions=${regions}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await mount(page, regions)
  const root = page.locator('#app .jsee-app').first()
  const field = page.locator('#x')
  await expect(field).toHaveCSS('color', 'rgb(17, 17, 17)')
  await expect(page.locator('#other .jsee-card').first()).not.toHaveCSS('box-shadow', 'none')
  await page.getByLabel('Retained selection').fill('keep me')
  await field.fill('changed')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(field).toHaveCSS('color', 'rgb(236, 236, 236)')
  await page.evaluate(() => window.app.setDesign({ colorScheme: 'light' }))
  await expect(field).toHaveCSS('color', 'rgb(17, 17, 17)')
  await expect(root).toHaveAttribute('data-color-scheme', 'light')
  await page.evaluate(() => window.app.setDesign({ colorScheme: 'dark', primary: '#123456', radius: 9 }))
  await expect(field).toHaveCSS('border-top-left-radius', '9px')
  expect(await page.evaluate(() => ({
    inputs: window.app.getInputs(), design: window.app.getSchema().design,
    mounts: window.mounts, disposals: window.disposals, workerRetained: window.originalWorker === window.app._workers[0]
  }))).toEqual({ inputs: { group: { x: 'changed' } }, design: { theme: 'mono', colorScheme: 'dark', primary: '#123456', radius: 9 }, mounts: 1, disposals: 0, workerRetained: true })
  await expect(page.getByLabel('Retained selection')).toHaveValue('keep me')
  await page.evaluate(() => window.app.setDesign({ theme: null, colorScheme: null, primary: null, radius: null }))
  await expect(field).toHaveCSS('color', 'rgb(51, 51, 51)')
  expect(await page.evaluate(() => window.app._workers.length)).toBe(1)
  await page.evaluate(() => { window.app.destroy(); window.other.destroy() })
  expect(await page.evaluate(() => window.disposals)).toBe(1)
})

test('design patches validate atomically and mono example is responsive', async ({ page }) => {
  await mount(page)
  expect(await page.evaluate(async () => {
    const errors = []
    for (const patch of [{ primary: '#bad', colorScheme: 'sepia' }, { framework: 'other' }, { grid: [1, -1] }]) {
      try { await window.app.setDesign(patch) } catch (e) { errors.push(e.message) }
    }
    return { errors, design: window.app.getSchema().design }
  })).toMatchObject({ errors: [expect.stringMatching(/colorScheme/), expect.stringMatching(/framework/), expect.stringMatching(/grid/)], design: { theme: 'mono' } })
  await page.goto('/examples/mono-theme.html')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('#name')).toBeVisible()
  await page.getByLabel('Color scheme').selectOption('dark')
  await expect(page.locator('.jsee-app').first()).toHaveAttribute('data-color-scheme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.locator('#name').fill('Ada')
  await page.getByRole('button', { name: /^Run/ }).click()
  await expect(page.locator('#outputs')).toContainText('Ada')
})
