const assert = require('assert')
const {
  sanitizeHtml,
  parseMultipart,
  coerceParam,
  inferOutputType
} = require('../../src/utils')

let seed = 123456789
function rand () {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 0x100000000
}

function pick (items) {
  return items[Math.floor(rand() * items.length)]
}

function randomToken (length=8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'
  let out = ''
  for (let i = 0; i < length; i++) out += pick(chars)
  return out
}

function multipartBody (boundary, fields) {
  const chunks = []
  fields.forEach(field => {
    chunks.push(`--${boundary}\r\n`)
    if (field.filename) {
      chunks.push(`Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`)
      chunks.push('Content-Type: application/octet-stream\r\n\r\n')
      chunks.push(field.value)
      chunks.push('\r\n')
    } else {
      chunks.push(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`)
      chunks.push(String(field.value))
      chunks.push('\r\n')
    }
  })
  chunks.push(`--${boundary}--\r\n`)
  return Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
}

function assertNoDangerousHtml (html) {
  const compact = html.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase()
  assert(!/<\s*script/i.test(html), `script tag survived: ${html}`)
  assert(!/<\s*iframe/i.test(html), `iframe tag survived: ${html}`)
  assert(!/\son[a-z0-9_-]+\s*=/i.test(html), `event handler survived: ${html}`)
  assert(!compact.includes('javascript:'), `javascript URL survived: ${html}`)
  assert(!compact.includes('vbscript:'), `vbscript URL survived: ${html}`)
  assert(!compact.includes('data:text/html'), `HTML data URL survived: ${html}`)
}

const urlAttacks = [
  'javascript:alert(1)',
  'java\nscript:alert(1)',
  'java\tScript:alert(1)',
  'jav&#x61;script:alert(1)',
  'javascript&#x3a;alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>'
]

for (let i = 0; i < 200; i++) {
  const tag = pick(['a', 'img', 'svg', 'p', 'span'])
  const attr = pick(['href', 'src', 'poster', 'xlink:href'])
  const quote = pick(['"', "'"])
  const attack = pick(urlAttacks)
  const event = `on${randomToken(5)}=${quote}window.__bad=1${quote}`
  const html = `<${tag} ${attr}=${quote}${attack}${quote} ${event}><script>bad()</script>safe</${tag}>`
  assertNoDangerousHtml(sanitizeHtml(html, { mode: 'secure' }))
}

for (let i = 0; i < 100; i++) {
  const boundary = '----jsee-' + randomToken(12)
  const fields = [
    { name: 'n', value: String(Math.floor(rand() * 1000)) },
    { name: 'flag', value: pick(['true', 'false']) },
    { name: 'text', value: randomToken(16) },
    { name: 'file', filename: randomToken(6) + '.bin', value: Buffer.from(randomToken(24)) }
  ]
  const parsed = parseMultipart(`multipart/form-data; boundary="${boundary}"`, multipartBody(boundary, fields))
  assert.strictEqual(typeof parsed.n, 'number')
  assert.strictEqual(typeof parsed.flag, 'boolean')
  assert.strictEqual(parsed.text, fields[2].value)
  assert(Buffer.isBuffer(parsed.file))
  assert.strictEqual(parsed.file.toString(), fields[3].value.toString())
}

for (let i = 0; i < 100; i++) {
  const value = String(Math.floor(rand() * 10000))
  assert.strictEqual(coerceParam(value, 'int', 'n'), Number(value))
  assert.strictEqual(coerceParam('true', 'toggle', 'flag'), true)
  assert.strictEqual(coerceParam('false', 'checkbox', 'flag'), false)
}

assert.strictEqual(inferOutputType('image', 'https://example.com/a.PNG?sig=1'), 'image')
assert.strictEqual(inferOutputType('pdf', '/docs/report.PDF#page=2'), 'pdf')
assert.strictEqual(inferOutputType('gallery', ['a.webp?x=1', 'b.jpg']), 'gallery')

console.log('probe-release-fuzz: ok')
