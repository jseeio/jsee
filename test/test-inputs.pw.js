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

test.describe('Input layout', () => {
  test('sizes a prefilled multiline input after its component mounts', async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(urlQueryEscaped(echoSchema([
      { name: 'text', type: 'text', default: Array(12).fill('a line').join('\n') }
    ])))
    await expect(page.locator('#text')).toHaveValue(Array(12).fill('a line').join('\n'))
    const size = await page.locator('#text').evaluate(el => ({ height: el.style.height, overflow: el.scrollHeight - el.clientHeight }))
    expect(errors).toEqual([])
    expect(size.height).not.toBe('')
    expect(size.overflow).toBeLessThanOrEqual(2)
  })

  test('keeps full-width controls inside their fields in grid layouts', async ({ page }) => {
    const schema = echoSchema([
      { name: 'timesteps_rollout', type: 'int', default: 1024 },
      { name: 'mode', type: 'categorical', options: ['short', 'medium', 'long'], default: 'medium' }
    ])
    schema.design = { grid: [3, 9] }

    await page.goto(urlQueryEscaped(schema))
    const overflow = await page.locator('#timesteps_rollout').evaluate((input) => {
      const inputRect = input.getBoundingClientRect()
      const fieldRect = input.closest('.jsee-field').getBoundingClientRect()
      return inputRect.right - fieldRect.right
    })

    expect(overflow).toBeLessThanOrEqual(0.5)
  })
})

test.describe('Disabled inputs', () => {
  test('locks every interactive control type', async ({ page }) => {
    const schema = {
      persist: false,
      model: {
        worker: false,
        code: `function disabledMatrix (inputs) {
          return { caller: inputs.caller || 'none' }
        }`,
        autorun: false
      },
      inputs: [
        { name: 'n', type: 'int', default: 1, disabled: true },
        { name: 's', type: 'string', default: 'locked', disabled: true },
        { name: 'c', type: 'color', default: '#123456', disabled: true },
        { name: 't', type: 'text', default: 'locked', disabled: true },
        { name: 'sl', type: 'slider', min: 0, max: 10, default: 5, disabled: true },
        { name: 'r', type: 'range', min: 0, max: 10, default: [2, 8], disabled: true },
        { name: 'd', type: 'date', default: '2026-01-01', disabled: true },
        { name: 'cb', type: 'checkbox', default: true, disabled: true },
        { name: 'tg', type: 'toggle', default: true, disabled: true },
        { name: 'sel', type: 'select', options: ['a', 'b'], default: 'a', disabled: true },
        { name: 'rad', type: 'radio', options: ['a', 'b'], default: 'a', disabled: true },
        { name: 'multi', type: 'multi-select', options: ['a', 'b'], default: ['a'], disabled: true },
        {
          name: 'folder',
          type: 'folder',
          select: true,
          disabled: true,
          default: [{ name: 'a.txt', path: 'a.txt', size: 1, type: 'text/plain', selected: true }]
        },
        { name: 'do_it', type: 'action', title: 'Do It', disabled: true }
      ],
      outputs: [{ name: 'caller', type: 'code' }]
    }

    await page.goto(urlQueryEscaped(schema))

    const selectors = [
      '#n',
      '#s',
      '#c',
      '#t',
      '#sl',
      'input[type="range"]',
      '#d',
      '#cb',
      '#tg',
      '#sel',
      'input[type="radio"][value="a"]',
      'input[type="radio"][value="b"]',
      'input[type="checkbox"][value="a"]',
      'input[type="checkbox"][value="b"]',
      '.jsee-field:has-text("folder") input[type="checkbox"]',
      'button:has-text("Do It")'
    ]

    for (const selector of selectors) {
      await expect(page.locator(selector).first()).toBeDisabled()
    }
  })
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

test.describe('Secure output rendering', () => {
  test('sanitizes raw HTML, markdown, and chat when secure mode disables raw HTML', async ({ page }) => {
    const schema = {
      security: { mode: 'secure', allowEval: true },
      model: {
        worker: false,
        code: `function () {
          return {
            page: '<p><strong>safe html</strong></p><img src="x" onerror="window.__jseeHtmlBad = 1"><script>window.__jseeHtmlScript = 1</script><a href="javascript:window.__jseeHrefBad = 1">bad</a>',
            note: '## Safe markdown\\n\\n<img src="x" onerror="window.__jseeMarkdownBad = 1">\\n\\n<script>window.__jseeMarkdownScript = 1</script>\\n\\n**bold**',
            chat: '<img src="x" onerror="window.__jseeChatBad = 1"> **safe chat**'
          }
        }`
      },
      inputs: [],
      outputs: [
        { name: 'page', type: 'html' },
        { name: 'note', type: 'markdown' },
        { name: 'chat', type: 'chat' }
      ]
    }

    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('#page strong')).toContainText('safe html')
    await expect(page.locator('#note strong')).toContainText('bold')
    await expect(page.locator('.jsee-chat-bubble strong')).toContainText('safe chat')
    await page.waitForTimeout(300)

    const flags = await page.evaluate(() => {
      const values = {
        htmlBad: window.__jseeHtmlBad,
        htmlScript: window.__jseeHtmlScript,
        hrefBad: window.__jseeHrefBad,
        markdownBad: window.__jseeMarkdownBad,
        markdownScript: window.__jseeMarkdownScript,
        chatBad: window.__jseeChatBad
      }
      return Object.fromEntries(Object.entries(values).filter((entry) => typeof entry[1] !== 'undefined'))
    })
    expect(flags).toEqual({})

    const unsafeDom = await page.locator('#outputs').evaluate(el => ({
      eventAttrs: el.querySelectorAll('[onerror]').length,
      scripts: el.querySelectorAll('script').length,
      jsUrls: Array.from(el.querySelectorAll('[href]'))
        .filter(node => /^javascript:/i.test(node.getAttribute('href') || '')).length
    }))
    expect(unsafeDom).toEqual({
      eventAttrs: 0,
      scripts: 0,
      jsUrls: 0
    })
  })

  test('enforces secure network, notification, and file viewer flags at runtime', async ({ page }) => {
    let apiHits = 0
    await page.route('**/secure-probe-api', route => {
      apiHits += 1
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: 'network-called' })
      })
    })

    await page.goto(`http://localhost:${port}/load/`)
    const results = await page.evaluate(async () => {
      document.body.innerHTML = '<div id="network"></div><div id="notify"></div><div id="media"></div>'
      const notificationCalls = {
        requestPermission: 0,
        constructed: 0
      }
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })
      window.Notification = function () {
        notificationCalls.constructed += 1
      }
      window.Notification.permission = 'default'
      window.Notification.requestPermission = () => {
        notificationCalls.requestPermission += 1
        return Promise.resolve('granted')
      }

      const networkApp = new JSEE({
        container: '#network',
        schema: {
          security: { mode: 'secure', allowEval: true },
          model: { type: 'post', url: '/secure-probe-api', worker: false },
          inputs: [{ name: 'x', type: 'int', default: 1 }],
          outputs: [{ name: 'result', type: 'code' }]
        },
        verbose: false
      })
      await networkApp._initPromise
      await networkApp.run().catch(() => {})

      const notifyApp = new JSEE({
        container: '#notify',
        schema: {
          security: { mode: 'secure', allowEval: true },
          notify: true,
          model: { worker: false, code: 'function done () { return { result: "ok" } }' },
          outputs: [{ name: 'result', type: 'code' }]
        },
        verbose: false
      })
      await notifyApp._initPromise
      await notifyApp.run()

      const mediaApp = new JSEE({
        container: '#media',
        schema: {
          security: { mode: 'secure', allowEval: true },
          model: {
            worker: false,
            code: `function media () {
              return {
                image: 'data:image/png;base64,iVBORw0KGgo=',
                audio: 'data:audio/wav;base64,UklGRg==',
                video: 'data:video/mp4;base64,AAAA',
                report: 'data:application/pdf;base64,JVBERi0xLjQKJUVPRgo=',
                gallery: ['data:image/png;base64,iVBORw0KGgo='],
                viewer: '/tmp/report.pdf',
                download: 'secret'
              }
            }`
          },
          outputs: [
            { name: 'image', type: 'image' },
            { name: 'audio', type: 'audio' },
            { name: 'video', type: 'video' },
            { name: 'report', type: 'pdf' },
            { name: 'gallery', type: 'gallery' },
            { name: 'viewer', type: 'viewer' },
            { name: 'download', type: 'file' }
          ]
        },
        verbose: false
      })
      await mediaApp._initPromise
      await mediaApp.run()
      await new Promise(resolve => setTimeout(resolve, 100))

      return {
        notificationCalls,
        mediaElements: document.querySelectorAll('#media img, #media audio, #media video, #media iframe, #media .jsee-file-download-btn').length,
        blockedMessages: Array.from(document.querySelectorAll('#media .jsee-output-missing')).map(el => el.textContent.trim())
      }
    })

    expect(apiHits).toBe(0)
    expect(results.notificationCalls).toEqual({
      requestPermission: 0,
      constructed: 0
    })
    expect(results.mediaElements).toBe(0)
    expect(results.blockedMessages.length).toBeGreaterThanOrEqual(7)
    expect(results.blockedMessages.every(message => message.includes('security.allowFileViewer'))).toBe(true)
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

test.describe('PDF output', () => {
  test('renders browser-native iframe', async ({ page }) => {
    const pdfDataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJUVPRgo='
    const schema = {
      model: {
        worker: false,
        code: `function () { return { report: '${pdfDataUrl}' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'report', type: 'pdf', height: 300 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    const frame = page.locator('iframe.jsee-pdf-frame')
    await expect(frame).toBeVisible()
    await expect(frame).toHaveAttribute('title', 'report')
    await expect(frame).toHaveAttribute('src', pdfDataUrl)
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

test.describe('Input tabs (group style: tabs)', () => {
  test('renders tab buttons and switches content', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return data }`,
        autorun: false
      },
      inputs: [
        {
          type: 'group',
          style: 'tabs',
          elements: [
            {
              name: 'Basic',
              type: 'group',
              elements: [
                { name: 'x', type: 'int', default: 10 }
              ]
            },
            {
              name: 'Advanced',
              type: 'group',
              elements: [
                { name: 'threshold', type: 'slider', min: 0, max: 100, step: 1, default: 50 }
              ]
            }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    // Tab buttons should be visible
    await expect(page.locator('.jsee-tab-btn').first()).toContainText('Basic')
    await expect(page.locator('.jsee-tab-btn').nth(1)).toContainText('Advanced')
    // First tab active by default — its input visible
    await expect(page.locator('#x')).toBeVisible()
    // Second tab content hidden
    await expect(page.locator('#threshold')).not.toBeVisible()
    // Click second tab
    await page.locator('.jsee-tab-btn').nth(1).click()
    await expect(page.locator('#threshold')).toBeVisible()
    await expect(page.locator('#x')).not.toBeVisible()
  })

  test('inner tab input values are included in model data', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'X:' + data.Basic.x + ':T:' + data.Advanced.threshold } }`,
        autorun: false
      },
      inputs: [
        {
          type: 'group',
          style: 'tabs',
          elements: [
            {
              name: 'Basic',
              type: 'group',
              elements: [
                { name: 'x', type: 'int', default: 42 }
              ]
            },
            {
              name: 'Advanced',
              type: 'group',
              elements: [
                { name: 'threshold', type: 'slider', min: 0, max: 100, step: 1, default: 75 }
              ]
            }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('X:42:T:75')
  })
})

test.describe('Output tabs (group style: tabs)', () => {
  test('renders tab buttons and switches output content', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { summary: '# Hello', raw: 'RAW_DATA' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        {
          type: 'group',
          style: 'tabs',
          elements: [
            { name: 'summary', type: 'markdown' },
            { name: 'raw', type: 'code' }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    // Tab buttons visible
    await expect(page.locator('.jsee-tab-btn').first()).toContainText('summary')
    await expect(page.locator('.jsee-tab-btn').nth(1)).toContainText('raw')
    // First tab active — markdown rendered
    await expect(page.locator('h1')).toContainText('Hello')
    // Click second tab
    await page.locator('.jsee-tab-btn').nth(1).click()
    await expect(page.locator('body')).toContainText('RAW_DATA')
  })
})

test.describe('Per-input reactive', () => {
  test('reactive slider triggers auto-run on change', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'VAL:' + data.x } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'slider', min: 0, max: 100, step: 1, default: 50, reactive: true }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    // Change slider value — should auto-run without clicking Run
    const slider = page.locator('#x')
    await slider.evaluate((el) => {
      el.value = 75
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(page.locator('body')).toContainText('VAL:75')
  })

  test('non-reactive slider does not auto-run', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'VAL:' + data.x } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'slider', min: 0, max: 100, step: 1, default: 50 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    const slider = page.locator('#x')
    await slider.evaluate((el) => {
      el.value = 75
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // Should NOT auto-run — no output yet
    await page.waitForTimeout(500)
    const body = await page.locator('body').textContent()
    expect(body).not.toContain('VAL:')
    // Only runs after clicking Run
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('VAL:75')
  })
})

test.describe('Output alias', () => {
  test('matches model result key via alias', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { r: 'ALIAS_HIT:' + data.x } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 7 }
      ],
      outputs: [
        { name: 'result', type: 'code', alias: 'r' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('ALIAS_HIT:7')
  })
})

test.describe('File output', () => {
  test('renders download button', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { report: 'col1,col2\\n1,2\\n3,4' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'report', type: 'file', filename: 'report.csv' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    // Download button should appear
    const btn = page.locator('.jsee-file-download-btn')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('report.csv')
  })

  test('uses filename and content from file descriptor result', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) {
          const ext = String(data.format).toLowerCase()
          return {
            file: {
              filename: 'dataset.' + ext,
              content: ext === 'csv' ? 'col1,col2\\n1,2\\n' : JSON.stringify({ ok: true }),
              mime: ext === 'csv' ? 'text/csv' : 'application/json'
            }
          }
        }`,
        autorun: false
      },
      inputs: [
        { name: 'format', type: 'select', options: ['CSV', 'JSON'], default: 'CSV' }
      ],
      outputs: [
        { name: 'file', type: 'file' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    const btn = page.locator('.jsee-file-download-btn')
    await expect(btn).toContainText('dataset.csv')

    const downloadPromise = page.waitForEvent('download')
    await btn.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('dataset.csv')
    const downloadPath = await download.path()
    const content = require('fs').readFileSync(downloadPath, 'utf8')
    expect(content).toBe('col1,col2\n1,2\n')

    await page.selectOption('#format', 'JSON')
    await page.click('button:has-text("Run")')
    await expect(btn).toContainText('dataset.json')
  })
})

test.describe('Sidebar layout', () => {
  test('applies data-layout attribute and sticky positioning', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { result: 'SIDEBAR:' + data.x } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 42 }
      ],
      design: {
        framework: 'minimal',
        layout: 'sidebar'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const grid = page.locator('.jsee-grid')
    await expect(grid).toHaveAttribute('data-layout', 'sidebar')
    // Sidebar should have sticky positioning
    const position = await grid.locator('> div:first-child').evaluate(
      (el) => getComputedStyle(el).position
    )
    expect(position).toBe('sticky')
    // Grid should use fixed 280px column
    const columns = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(columns).toContain('280px')
    // Run should still work
    await page.click('button:has-text("Run")')
    await expect(page.locator('body')).toContainText('SIDEBAR:42')
  })

  test('no data-layout attribute when layout is not set', async ({ page }) => {
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
    const grid = page.locator('.jsee-grid')
    const layout = await grid.getAttribute('data-layout')
    expect(layout).toBeNull()
  })
})

test.describe('Blank output', () => {
  test('renders empty container accessible by id', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { canvas: 'placeholder' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'canvas', type: 'blank' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    // The blank output card should be visible with an empty container
    const card = page.locator('.jsee-output-card')
    await expect(card).toBeVisible()
    const container = page.locator('#canvas')
    await expect(container).toBeAttached()
    // Container should have no visible child elements
    const children = await container.locator(':scope > *').count()
    expect(children).toBe(0)
  })
})

test.describe('Output group blocks', () => {
  test('renders all outputs stacked', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { out1: 'FIRST', out2: 'SECOND' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        {
          type: 'group',
          elements: [
            { name: 'out1', type: 'code' },
            { name: 'out2', type: 'code' }
          ]
        }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    // Both outputs visible at once (blocks mode, no tabs)
    await expect(page.locator('body')).toContainText('FIRST')
    await expect(page.locator('body')).toContainText('SECOND')
    // No tab buttons should exist
    await expect(page.locator('.jsee-tab-btn')).toHaveCount(0)
  })
})

test.describe('Gauge output', () => {
  test('renders gauge with numeric value', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { score: 73 } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'score', type: 'gauge', min: 0, max: 100 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-gauge')).toBeVisible()
    await expect(page.locator('.jsee-gauge-value')).toContainText('73')
  })

  test('renders gauge with object value and label', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { score: { value: 85, label: 'Great' } } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'score', type: 'gauge', min: 0, max: 100 }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-gauge-value')).toContainText('85')
    await expect(page.locator('.jsee-gauge-label')).toContainText('Great')
  })
})

test.describe('Number output', () => {
  test('renders number with delta', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { users: { value: 1234, delta: 56 } } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'users', type: 'number', label: 'Active Users' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    await expect(page.locator('.jsee-number-value')).toBeVisible()
    await expect(page.locator('.jsee-number-delta')).toContainText('56')
    await expect(page.locator('.jsee-number-delta')).toHaveClass(/positive/)
    await expect(page.locator('.jsee-number-label')).toContainText('Active Users')
  })
})

test.describe('Alert output', () => {
  test('renders alert from string value', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { status: 'All systems operational' } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'status', type: 'alert' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    const alert = page.locator('.jsee-alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText('All systems operational')
    await expect(alert).toHaveAttribute('data-type', 'info')
  })

  test('renders alert from object value with type', async ({ page }) => {
    const schema = {
      model: {
        worker: false,
        code: `function (data) { return { status: { message: 'Disk full', type: 'error' } } }`,
        autorun: false
      },
      inputs: [
        { name: 'x', type: 'int', default: 1 }
      ],
      outputs: [
        { name: 'status', type: 'alert' }
      ]
    }
    await page.goto(urlQueryEscaped(schema))
    await page.click('button:has-text("Run")')
    const alert = page.locator('.jsee-alert')
    await expect(alert).toContainText('Disk full')
    await expect(alert).toHaveAttribute('data-type', 'error')
  })
})

test.describe('Custom design colors', () => {
  test('design.primary sets accent CSS variables', async ({ page }) => {
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
        primary: '#e74c3c'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const app = page.locator('.jsee-app')
    const primary = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-primary'))
    expect(primary.trim()).toBe('#e74c3c')
    const gradEnd = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-gradient-end'))
    expect(gradEnd.trim()).toBe('#e74c3c')
  })

  test('design.bg and design.fg set background and text variables', async ({ page }) => {
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
        bg: '#fdf6e3',
        fg: '#657b83'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const app = page.locator('.jsee-app')
    const bg = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-bg'))
    expect(bg.trim()).toBe('#fdf6e3')
    const text = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-text'))
    expect(text.trim()).toBe('#657b83')
  })

  test('design.font sets font family', async ({ page }) => {
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
        font: 'Georgia, serif'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const app = page.locator('.jsee-app')
    const font = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-font'))
    expect(font.trim()).toBe('Georgia, serif')
  })

  test('design.radius sets border radius', async ({ page }) => {
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
        radius: 12
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const app = page.locator('.jsee-app')
    const radius = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-radius'))
    expect(radius.trim()).toBe('12px')
  })

  test('design.primary works with dark theme', async ({ page }) => {
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
        theme: 'dark',
        primary: '#e74c3c'
      }
    }
    await page.goto(urlQueryEscaped(schema))
    const app = page.locator('.jsee-app')
    await expect(app).toHaveAttribute('data-theme', 'dark')
    // Custom primary should override via inline style
    const primary = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-primary'))
    expect(primary.trim()).toBe('#e74c3c')
    // Dark bg should still be applied from CSS (no bg override)
    const bg = await app.evaluate(el => getComputedStyle(el).getPropertyValue('--jsee-bg'))
    expect(bg.trim()).toBe('#1a1a1a')
  })
})

test('structured editors preserve JSON values, editable rows and invalid drafts', async ({ page }) => {
  await page.goto('http://localhost:8484/load/')
  await page.evaluate(async () => {
    if (window.app) window.app.destroy()
    document.body.innerHTML = '<div id="editor-test"></div>'
    window.app = new JSEE({ container: '#editor-test', schema: {
      persist: false, model: { worker: false, autorun: false, code: 'function model(data) { self.lastEdited = data; return data }' },
      inputs: [{ name: 'document', type: 'object', required: true, default: { items: [] } }, { name: 'data', type: 'table', required: true, default: { columns: ['value'], rows: [[0], [false], [null], ['']] } }], outputs: []
    } })
    await window.app._initPromise
  })
  await page.getByLabel('document', { exact: true }).fill('{"items":[0,false,null,""]}')
  await page.getByLabel('Row 1, value', { exact: true }).fill('42')
  await page.getByRole('button', { name: 'Add row', exact: true }).click()
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  const values = await page.evaluate(() => self.lastEdited)
  expect(values.document).toEqual({ items: [0, false, null, ''] })
  expect(values.data.rows).toEqual([[42], [false], [null], [''], ['']])
  await page.getByLabel('document', { exact: true }).fill('[]')
  await page.getByRole('button', { name: 'Edit JSON', exact: true }).click()
  await page.getByLabel('data', { exact: true }).fill('[]')
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  await page.getByLabel('document', { exact: true }).fill('{bad json')
  expect(await page.evaluate(() => window.app.run())).toBe(false)
  await expect(page.getByRole('alert')).toContainText('JSON')
})

async function mountTable (page, value) {
  await page.goto('http://localhost:8484/load/')
  await page.evaluate(async (initial) => {
    if (window.app) window.app.destroy()
    document.body.innerHTML = '<div id="paste-test"></div>'
    window.app = new JSEE({ container: '#paste-test', schema: {
      persist: false, model: { worker: false, autorun: false, code: 'function model(data) { self.pasted = data; return data }' },
      inputs: [{ name: 'grid', type: 'table', default: initial }], outputs: []
    } })
    await window.app._initPromise
  }, value)
}

async function paste (page, label, text) {
  await page.getByLabel(label, { exact: true }).evaluate((el, data) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', data)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, text)
}

test('pasting a spreadsheet block fills an empty grid and names columns from its header', async ({ page }) => {
  await mountTable(page, [])
  await paste(page, 'Paste rows into grid', 'item\tqty\tprice\nWidget\t3\t12.5\nGizmo\t1\t99')
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => self.pasted.grid)).toEqual([
    { item: 'Widget', qty: 3, price: 12.5 },
    { item: 'Gizmo', qty: 1, price: 99 }
  ])
})

test('pasting into a populated grid expands from the target cell and grows rows', async ({ page }) => {
  await mountTable(page, { columns: ['a', 'b'], rows: [['x', 1]] })
  await paste(page, 'Row 1, b', '2\n3\n4')
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => self.pasted.grid.rows)).toEqual([['x', 2], ['', 3], ['', 4]])
})

test('quoted CSV survives paste: quoting escapes delimiters, it does not force a string', async ({ page }) => {
  await mountTable(page, [])
  await paste(page, 'Paste rows into grid', 'label,note\n"a,b",plain\n"42","two\nlines"')
  await expect(page.getByLabel('Row 1, label', { exact: true })).toHaveValue('a,b')
  await expect(page.getByLabel('Row 1, note', { exact: true })).toHaveValue('plain')
  // CSV quotes only protect the delimiter, so a numeric cell still reads as a number.
  await expect(page.getByLabel('Row 2, label', { exact: true })).toHaveValue('42')
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => self.pasted.grid)).toEqual([
    { label: 'a,b', note: 'plain' },
    { label: 42, note: 'two\nlines' }
  ])
})

test('cells show plain strings bare and keep JSON syntax only where it disambiguates', async ({ page }) => {
  await mountTable(page, { columns: ['text', 'number', 'stringy', 'flag', 'blank'], rows: [['Widget', 42, '42', false, '']] })
  await expect(page.getByLabel('Row 1, text', { exact: true })).toHaveValue('Widget')
  await expect(page.getByLabel('Row 1, number', { exact: true })).toHaveValue('42')
  // The string "42" would read back as a number unquoted, so it keeps its quotes.
  await expect(page.getByLabel('Row 1, stringy', { exact: true })).toHaveValue('"42"')
  await expect(page.getByLabel('Row 1, flag', { exact: true })).toHaveValue('false')
  await expect(page.getByLabel('Row 1, blank', { exact: true })).toHaveValue('')
  // Round trip: nothing is coerced by being displayed.
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => self.pasted.grid.rows)).toEqual([['Widget', 42, '42', false, '']])
})

test('a single pasted value is left to the browser so ordinary editing still works', async ({ page }) => {
  await mountTable(page, { columns: ['a'], rows: [['keep']] })
  await paste(page, 'Row 1, a', 'solo')
  expect(await page.evaluate(() => window.app.data.inputs[0].value.rows)).toEqual([['keep']])
})

test('removing a column drops it from every row', async ({ page }) => {
  await mountTable(page, { columns: ['a', 'b'], rows: [[1, 2], [3, 4]] })
  await page.getByRole('button', { name: 'Remove column a', exact: true }).click()
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => self.pasted.grid)).toEqual({ columns: ['b'], rows: [[2], [4]] })
})

test('a table input widens the form to even columns unless the schema says otherwise', async ({ page }) => {
  await mountTable(page, [])
  const even = await page.evaluate(() => getComputedStyle(document.querySelector('.jsee-grid')).gridTemplateColumns)
  const [left, right] = even.split(' ').map(parseFloat)
  expect(Math.abs(left - right)).toBeLessThan(2)

  await page.evaluate(async () => {
    window.app.destroy()
    document.body.innerHTML = '<div id="explicit"></div>'
    window.app = new JSEE({ container: '#explicit', schema: {
      persist: false, design: { grid: [1, 3] }, model: { worker: false, autorun: false, code: 'function model(d) { return d }' },
      inputs: [{ name: 'grid', type: 'table', default: [] }], outputs: []
    } })
    await window.app._initPromise
  })
  const explicit = await page.evaluate(() => getComputedStyle(document.querySelector('.jsee-grid')).gridTemplateColumns)
  const [a, b] = explicit.split(' ').map(parseFloat)
  expect(b).toBeGreaterThan(a * 2)
})

test('typed media selects declared MIME, preserves bytes and releases previews', async ({ page }) => {
  await page.goto('http://localhost:8484/load/')
  await page.evaluate(async () => {
    if (window.app) window.app.destroy()
    document.body.innerHTML = '<div id="media-test"></div>'
    self.revokedMedia = []
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = url => { self.revokedMedia.push(url); revoke(url) }
    window.app = new JSEE({ container: '#media-test', schema: {
      persist: false, model: { worker: true, autorun: false, code: 'function model(data) { return {bytes: Array.from(new Uint8Array(data.photo)), preview:data.photo} }' },
      inputs: [{ name: 'photo', type: 'image', accept: 'image/png' }], outputs: [{ name: 'bytes', type: 'object' }, { name: 'preview', type: 'image', mime: 'image/png' }]
    } })
    await window.app._initPromise
  })
  const picker = page.locator('#media-test input[type=file]')
  await expect(picker).toHaveAttribute('accept', 'image/png')
  await picker.setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from([0, 255, 128]) })
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => window.app.data.outputs[0].value)).toEqual([0, 255, 128])
  const outputPreview = await page.evaluate(() => window.app.data.outputs[1].value)
  expect(typeof outputPreview).toBe('string')
  expect(await page.evaluate(async url => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())), outputPreview)).toEqual([0, 255, 128])
  const preview = await page.locator('#media-test .jsee-media-input img').getAttribute('src')
  expect(preview.startsWith('blob:')).toBe(true)
  await picker.setInputFiles({ name: 'bad.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([1]) })
  expect(await page.evaluate(() => window.app.run())).toBe(false)
  await page.evaluate(() => window.app.destroy())
  expect(await page.evaluate(() => self.revokedMedia)).toEqual(expect.arrayContaining([preview, outputPreview]))
})


test('file accept is forwarded and typed media honors the existing file operation gate', async ({ page }) => {
  await page.goto(urlQueryEscaped(echoSchema([{ name: 'source', type: 'file', accept: '.csv,text/csv' }])))
  await expect(page.locator('input[type=file]')).toHaveAttribute('accept', '.csv,text/csv')
  const schema = echoSchema([{ name: 'photo', type: 'image', required: false }])
  schema.security = { allowFileViewer: false }
  await page.goto(urlQueryEscaped(schema))
  await expect(page.getByLabel('photo', { exact: true })).toBeDisabled()
})

test('object valueSchema validates browser inputs and outputs without coercion', async ({ page }) => {
  await page.goto('http://localhost:8484/load/')
  await page.evaluate(async () => {
    if (window.app) window.app.destroy()
    document.body.innerHTML = '<div id="shape-test"></div>'
    const shape = { type: 'array', items: { type: 'integer', minimum: 0 } }
    window.app = new JSEE({ container: '#shape-test', schema: {
      persist: false, model: { worker: false, autorun: false, code: 'function model(data) { return self.badOutput ? ["wrong"] : data.info }' },
      inputs: [{ name: 'info', type: 'object', valueSchema: shape, default: [1] }],
      outputs: [{ name: 'result', type: 'object', valueSchema: shape }]
    } })
    await window.app._initPromise
  })
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => window.app.data.outputs[0].value)).toEqual([1])
  await page.getByLabel('info', { exact: true }).fill('["1"]')
  expect(await page.evaluate(() => window.app.run())).toBe(false)
  await page.getByLabel('info', { exact: true }).fill('[]')
  expect(await page.evaluate(() => window.app.run())).toBe(true)
  expect(await page.evaluate(() => window.app.data.outputs[0].value)).toEqual([])
  await page.evaluate(() => { self.badOutput = true })
  expect(await page.evaluate(() => window.app.run())).toBe(false)
  expect(await page.evaluate(() => window.app.data.outputs[0].value)).toEqual([])
})

test('a host editor mounts in its input group without owning the form or execution', async ({ page }) => {
  await page.goto('http://localhost:8484/load/')
  await page.evaluate(async () => {
    window.app?.destroy()
    document.body.innerHTML = '<div id="editor-test"></div>'
    window.app = new JSEE({ container: '#editor-test', schema: {
      persist: false, model: { worker: false, autorun: false, code: 'function model(data) { return data.fit.config }' },
      inputs: [{ type: 'group', name: 'fit', style: 'accordion', collapsed: false,
        elements: [{ name: 'config', type: 'string', default: 'original', display: false }] }],
      outputs: [{ name: 'result', type: 'string' }]
    } })
    await window.app.ready
    const target = window.app.getInputGroupContainer('fit')
    const editor = document.createElement('button')
    editor.textContent = 'Host editor'
    editor.onclick = () => window.app.setInputs({ fit: { config: 'edited' } })
    target.append(editor)
    window.editorTarget = target
  })
  await page.getByRole('button', { name: 'Host editor' }).click()
  await page.getByRole('button', { name: /^Run\b/ }).click()
  await expect(page.locator('#outputs')).toContainText('edited')
  await page.locator('.jsee-accordion-header').click()
  await expect(page.getByRole('button', { name: 'Host editor' })).toBeHidden()
  expect(await page.evaluate(() => window.app.getInputGroupContainer('absent'))).toBeNull()
  await page.evaluate(() => window.app.destroy())
  expect(await page.evaluate(() => window.editorTarget.isConnected)).toBe(false)
})

test.describe('Responsive layout and programmatic values', () => {
  test('custom design grid collapses to one column on narrow screens', async ({ page }) => {
    const schema = echoSchema([{ name: 'a', type: 'int', default: 1 }])
    schema.design = { grid: [5, 7] }
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('#a')).toBeVisible()
    const columns = () => page.locator('.jsee-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat))
    expect((await columns()).length).toBe(1)
    await page.setViewportSize({ width: 1100, height: 800 })
    const wide = await columns()
    expect(wide.length).toBe(2)
    expect(wide[1] / wide[0]).toBeCloseTo(7 / 5, 1)
  })

  test('sidebar layout honours a custom grid and still collapses on narrow screens', async ({ page }) => {
    const schema = echoSchema([{ name: 'a', type: 'int', default: 1 }])
    schema.design = { layout: 'sidebar', grid: [1, 1] }
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('#a')).toBeVisible()
    const columns = () => page.locator('.jsee-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat))
    const wide = await columns()
    expect(wide.length).toBe(2)
    expect(Math.abs(wide[0] - wide[1])).toBeLessThan(2)
    await page.setViewportSize({ width: 390, height: 800 })
    expect((await columns()).length).toBe(1)
  })

  test('a host can bound the sticky sidebar panel below its own header', async ({ page }) => {
    const schema = echoSchema(Array.from({ length: 40 }, (_, i) => ({ name: 'n' + i, type: 'int', default: i })))
    schema.model.autorun = false
    schema.design = { layout: 'sidebar' }
    await page.setViewportSize({ width: 1100, height: 600 })
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('#n0')).toBeVisible()
    await page.evaluate(() => document.querySelector('#jsee-container').style.setProperty('--jsee-sidebar-max-height', '400px'))
    const height = await page.locator('.jsee-grid > div').first().evaluate(el => el.getBoundingClientRect().height)
    expect(height).toBeLessThanOrEqual(401)
    const box = await page.locator('.jsee-run-btn').boundingBox()
    expect(box.y + box.height).toBeLessThanOrEqual(600)
  })

  test('run controls stay visible while scrolling a long form', async ({ page }) => {
    const schema = echoSchema(Array.from({ length: 40 }, (_, i) => ({ name: 'n' + i, type: 'int', default: i })))
    schema.model.autorun = false
    await page.setViewportSize({ width: 1100, height: 600 })
    await page.goto(urlQueryEscaped(schema))
    await expect(page.locator('#n0')).toBeVisible()
    for (const field of ['#n0', '#n15']) {
      await page.locator(field).scrollIntoViewIfNeeded()
      const box = await page.locator('.jsee-run-btn').boundingBox()
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(600)
    }
  })

  test('file picker shows a file supplied programmatically and clears with it', async ({ page }) => {
    await page.goto('/load/')
    await page.evaluate(async () => {
      document.body.innerHTML = '<div id="app"></div>'
      window.app = new JSEE({ container: '#app', verbose: false, schema: { persist: false,
        model: { worker: false, autorun: false, code: 'function (data) { return { size: data.file ? data.file.size : 0 } }' },
        inputs: [{ name: 'file', type: 'file', raw: true }], outputs: [{ name: 'size', type: 'number' }] } })
      await window.app.ready
      await window.app.setInputs({ file: new File(['x,y\n1,2\n'], 'data.csv', { type: 'text/csv' }) })
    })
    try {
      await expect(page.locator('#app .vfp-label strong')).toHaveText('data.csv')
      await page.evaluate(() => window.app.setInputs({ file: null }))
      await expect(page.locator('#app .vfp-label strong')).toHaveText('Choose File')
    } finally { await page.evaluate(() => window.app.destroy()) }
  })
})

test.describe('Pipeline presentation', () => {
  test('section groups show a prominent collapsible heading', async ({ page }) => {
    const schema = echoSchema([{ type: 'group', name: 'model', label: 'Model settings', style: 'section',
      elements: [{ name: 'depth', type: 'int', default: 3 }] }])
    schema.model.autorun = false
    await page.goto(urlQueryEscaped(schema))
    const header = page.locator('.jsee-section .jsee-accordion-header')
    await expect(header).toContainText('Model settings')
    const size = await header.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(15)
    await expect(page.locator('#depth')).toBeVisible()
    await header.click()
    // Accordion bodies collapse by clipping to zero height, like existing accordions.
    const body = page.locator('.jsee-section .jsee-accordion-body')
    await expect(body).toHaveClass(/collapsed/)
    await expect.poll(() => body.evaluate(el => el.getBoundingClientRect().height)).toBe(0)
  })

  test('stage result titles show a status chip', async ({ page }) => {
    await page.goto(urlQueryEscaped({ persist: false,
      model: [{ id: 'a', worker: false, code: 'function (data) { return { value: 7 } }' }],
      inputs: [{ name: 'n', type: 'int', default: 1 }],
      outputs: [{ type: 'group', _stage: 'a', label: 'Stage A', elements: [{ name: 'a.value', type: 'number' }] }] }))
    const chip = page.getByRole('region', { name: 'Stage A results' }).locator('.jsee-stage-status')
    await expect(chip).toHaveAttribute('data-status', 'idle')
    await page.locator('.jsee-run-btn').click()
    await expect(chip).toHaveAttribute('data-status', 'current')
    await expect(chip).toHaveText('current')
  })
})

test('table paste grows from its column offset without overwriting existing named columns', async ({ page }) => {
  await mountTable(page, { columns: ['a', 'column_3'], rows: [['old', 'old']] })
  await paste(page, 'Row 1, column_3', 'left\tright')
  expect(await page.evaluate(() => window.app.data.inputs[0].value)).toEqual({ columns: ['a', 'column_3', 'column_3_2'], rows: [['old', 'left', 'right']] })
})

test('table paste rejects duplicate headers atomically and preserves unsafe numeric text', async ({ page }) => {
  await mountTable(page, [])
  await paste(page, 'Paste rows into grid', 'name\tname\nleft\tright')
  await expect(page.getByRole('alert')).toContainText('Duplicate column')
  expect(await page.evaluate(() => window.app.data.inputs[0].value)).toEqual([])
  await paste(page, 'Paste rows into grid', 'id\tvalue\n9007199254740993\t1e400')
  expect(await page.evaluate(() => window.app.data.inputs[0].value)).toEqual([{ id: '9007199254740993', value: '1e400' }])
})

test('table paste can explicitly preserve the first row as data', async ({ page }) => {
  await mountTable(page, [])
  await page.getByLabel('First pasted row contains column names').uncheck()
  await paste(page, 'Paste rows into grid', 'Alice\t3\nBob\t4')
  expect(await page.evaluate(() => window.app.data.inputs[0].value)).toEqual([{ column_1: 'Alice', column_2: 3 }, { column_1: 'Bob', column_2: 4 }])
})
