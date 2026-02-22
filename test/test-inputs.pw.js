const { test, expect } = require('@playwright/test')

const port = 8484
const urlQueryEscaped = (schema) => `http://localhost:${port}/load/?s=${encodeURIComponent(JSON.stringify(schema))}`

// Helper: create a schema that echoes all inputs back as output
const echoSchema = (inputs) => ({
  model: {
    worker: false,
    code: 'function (data) { return data }',
    autorun: true
  },
  inputs
})

test.describe('Slider input', () => {
  test('renders with default value and responds to changes', async ({ page }) => {
    const schema = echoSchema([
      { name: 'score', type: 'slider', min: 0, max: 100, step: 1, default: 75 }
    ])
    await page.goto(urlQueryEscaped(schema))
    // Should show the default value label
    await expect(page.locator('body')).toContainText('75')
    // The range input should exist
    const slider = page.locator('#score')
    await expect(slider).toHaveAttribute('type', 'range')
    await expect(slider).toHaveAttribute('min', '0')
    await expect(slider).toHaveAttribute('max', '100')
    // Change value via JS (range inputs can't be filled)
    await slider.evaluate((el) => {
      el.value = 30
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(page.locator('body')).toContainText('30')
  })

  test('works with float step', async ({ page }) => {
    const schema = echoSchema([
      { name: 'temp', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 }
    ])
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('body')).toContainText('0.5')
  })
})

test.describe('Radio input', () => {
  test('renders options and selects default', async ({ page }) => {
    const schema = echoSchema([
      { name: 'algorithm', type: 'radio', options: ['linear', 'quadratic', 'exponential'], default: 'linear' }
    ])
    await page.goto(urlQueryEscaped(schema))
    // All options rendered
    await expect(page.locator('body')).toContainText('linear')
    await expect(page.locator('body')).toContainText('quadratic')
    await expect(page.locator('body')).toContainText('exponential')
    // Default selected
    const defaultRadio = page.locator('input[type="radio"][value="linear"]')
    await expect(defaultRadio).toBeChecked()
  })

  test('changes value on click', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { picked: 'ALGO:' + data.algo } }`,
        autorun: false
      },
      inputs: [
        { name: 'algo', type: 'radio', options: ['a', 'b', 'c'], default: 'a' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.locator('input[type="radio"][value="b"]').check()
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('ALGO:b')
  })
})

test.describe('Toggle input', () => {
  test('renders and defaults to false', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { val: data.dark_mode } }`,
        autorun: false
      },
      inputs: [
        { name: 'dark_mode', type: 'toggle', default: false }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('body')).toContainText('dark_mode')
    // Toggle checkbox should exist and be unchecked
    const toggle = page.locator('#dark_mode')
    await expect(toggle).not.toBeChecked()
    // Click to enable
    await toggle.evaluate((el) => {
      el.click()
    })
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('true')
  })

  test('defaults to true when specified', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { val: data.enabled } }`,
        autorun: false
      },
      inputs: [
        { name: 'enabled', type: 'toggle', default: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    const toggle = page.locator('#enabled')
    await expect(toggle).toBeChecked()
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('true')
  })
})

test.describe('Date input', () => {
  test('renders with default value', async ({ page }) => {
    const schema = echoSchema([
      { name: 'start_date', type: 'date', default: '2025-01-15' }
    ])
    await page.goto(urlQueryEscaped(schema))
    const dateInput = page.locator('#start_date')
    await expect(dateInput).toHaveAttribute('type', 'date')
    await expect(dateInput).toHaveValue('2025-01-15')
  })

  test('changes value', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { date: data.d } }`,
        autorun: false
      },
      inputs: [
        { name: 'd', type: 'date', default: '2025-01-01' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.fill('#d', '2025-06-15')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('2025-06-15')
  })
})

test.describe('Select input', () => {
  test('renders options and respects default', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'MODE:' + data.mode } }`,
        autorun: false
      },
      inputs: [
        { name: 'mode', type: 'select', options: ['fast', 'balanced', 'accurate'], default: 'balanced' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    const select = page.locator('#mode')
    await expect(select).toHaveValue('balanced')
    await select.selectOption('accurate')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('MODE:accurate')
  })
})

test.describe('Multi-select input', () => {
  test('renders checkbox options', async ({ page }) => {
    const schema = echoSchema([
      { name: 'features', type: 'multi-select', options: ['color', 'size', 'shape', 'weight'] }
    ])
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('body')).toContainText('color')
    await expect(page.locator('body')).toContainText('size')
    await expect(page.locator('body')).toContainText('shape')
    await expect(page.locator('body')).toContainText('weight')
  })

  test('selects multiple values', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { selected: data.features.join(',') } }`,
        autorun: false
      },
      inputs: [
        { name: 'features', type: 'multi-select', options: ['color', 'size', 'shape'] }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.locator('input[type="checkbox"][value="color"]').check()
    await page.locator('input[type="checkbox"][value="shape"]').check()
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('color,shape')
  })
})

test.describe('Range input', () => {
  test('renders two handles with default values', async ({ page }) => {
    const schema = echoSchema([
      { name: 'price', type: 'range', min: 0, max: 200, step: 5, default: [25, 150] }
    ])
    await page.goto(urlQueryEscaped(schema))
    // Should display the range values
    await expect(page.locator('body')).toContainText('25')
    await expect(page.locator('body')).toContainText('150')
    // Two range inputs should exist
    const rangeInputs = page.locator('input[type="range"]')
    await expect(rangeInputs).toHaveCount(2)
  })

  test('returns array value', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) {
          return {
            result: 'RANGE:' + data.r[0] + '-' + data.r[1] + ':' + Array.isArray(data.r)
          }
        }`,
        autorun: false
      },
      inputs: [
        { name: 'r', type: 'range', min: 0, max: 100, step: 1, default: [20, 80] }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('RANGE:20-80:true')
  })
})

test.describe('Text (textarea) input', () => {
  test('renders textarea with default value', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { text: data.notes } }`,
        autorun: false
      },
      inputs: [
        { name: 'notes', type: 'text', default: 'hello world' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    const textarea = page.locator('#notes')
    await expect(textarea).toHaveValue('hello world')
    await textarea.fill('new content')
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('new content')
  })
})

test.describe('Checkbox input', () => {
  test('renders and toggles', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { val: data.enabled } }`,
        autorun: false
      },
      inputs: [
        { name: 'enabled', type: 'checkbox', default: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    const cb = page.locator('#enabled')
    await expect(cb).toBeChecked()
    await cb.uncheck()
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('false')
  })
})

test.describe('Markdown output', () => {
  test('renders markdown as HTML', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) {
          return {
            result: '# Hello\\n\\nThis is **bold** and *italic*.\\n\\n- item 1\\n- item 2'
          }
        }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'result', type: 'markdown' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    // Markdown should be rendered as HTML, not raw text
    await expect(page.locator('h1')).toContainText('Hello')
    await expect(page.locator('strong')).toContainText('bold')
    await expect(page.locator('em')).toContainText('italic')
    await expect(page.locator('li').first()).toContainText('item 1')
  })

  test('renders table in markdown', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) {
          return {
            result: '| Name | Age |\\n|------|-----|\\n| Alice | 30 |\\n| Bob | 25 |'
          }
        }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'result', type: 'markdown' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('table')).toBeVisible()
    await expect(page.locator('body')).toContainText('Alice')
    await expect(page.locator('body')).toContainText('Bob')
  })
})

test.describe('Image output', () => {
  test('renders image from data URL', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) {
          // 1x1 red pixel PNG
          return {
            img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
          }
        }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'img', type: 'image' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    const img = page.locator('img')
    await expect(img).toBeVisible()
    const src = await img.getAttribute('src')
    expect(src).toContain('data:image/png;base64,')
  })
})

test.describe('Accordion (collapsible group)', () => {
  test('starts collapsed and expands on click', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return data }`,
        autorun: false
      },
      inputs: [
        { name: 'query', type: 'string', default: 'hello' },
        {
          name: 'advanced',
          type: 'group',
          label: 'Advanced Options',
          collapsed: true,
          elements: [
            { name: 'threshold', type: 'slider', min: 0, max: 1, step: 0.01, default: 0.5 },
            { name: 'debug', type: 'toggle', default: false }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    // Accordion header should be visible
    await expect(page.locator('body')).toContainText('Advanced Options')
    // Inner content should be hidden (collapsed class)
    const body = page.locator('.jsee-accordion-body')
    await expect(body).toHaveClass(/collapsed/)
    // Click the accordion header to expand
    await page.locator('.jsee-accordion-header').click()
    await expect(body).not.toHaveClass(/collapsed/)
    // Now inner inputs should be visible
    await expect(page.locator('#threshold')).toBeVisible()
  })

  test('starts expanded when collapsed is not set', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return data }`,
        autorun: false
      },
      inputs: [
        {
          name: 'options',
          type: 'group',
          label: 'Options',
          collapsed: false,
          elements: [
            { name: 'val', type: 'int', default: 42 }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    const body = page.locator('.jsee-accordion-body')
    await expect(body).not.toHaveClass(/collapsed/)
    await expect(page.locator('#val')).toBeVisible()
  })

  test('inner inputs are included in model data', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'T:' + data.advanced.threshold + ':D:' + data.advanced.debug } }`,
        autorun: false
      },
      inputs: [
        {
          name: 'advanced',
          type: 'group',
          label: 'Advanced',
          collapsed: true,
          elements: [
            { name: 'threshold', type: 'slider', min: 0, max: 100, step: 1, default: 50 },
            { name: 'debug', type: 'toggle', default: false }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    // Expand accordion first
    await page.locator('.jsee-accordion-header').click()
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('T:50:D:false')
  })
})

test.describe('Dark theme', () => {
  test('applies data-theme attribute and CSS variables', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'THEMED:' + data.x } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 42 }
      ],
      design: {
        framework: 'minimal',
        theme: 'dark'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    // The .jsee-app element should have data-theme="dark"
    const app = page.locator('.jsee-app')
    await expect(app).toHaveAttribute('data-theme', 'dark')
    // Dark background should be applied via CSS variable
    const bg = await app.evaluate((el) => getComputedStyle(el).getPropertyValue('--jsee-bg'))
    expect(bg.trim()).toBe('#1a1a1a')
    // Inputs and run should still work
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('THEMED:42')
  })

  test('light theme has no data-theme attribute', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'OK' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      design: {
        framework: 'minimal'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const app = page.locator('.jsee-app')
    const theme = await app.getAttribute('data-theme')
    expect(theme).toBeNull()
  })
})
