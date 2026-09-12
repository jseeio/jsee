const fs = require('fs')
const path = require('path')
const os = require('os')
const { once } = require('events')
const gen = require('../../src/cli')

const token = 'host-policy-test-token'
const allowed = 'https://client.example'
const bearer = { Authorization: 'Bearer ' + token }

test.each([true, false])('host policy covers every route (canonical=%s)', async canonical => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-host-policy-'))
  const filename = path.join(directory, 'schema.json')
  fs.writeFileSync(path.join(directory, 'model.js'), 'let n = 0; module.exports = () => ({answer: ++n, file: "inside"})')
  fs.writeFileSync(filename, JSON.stringify({ model: { name: 'compute', url: 'model.js' }, outputs: [{ name: 'answer', type: 'number' }, { name: 'file', type: 'file' }] }))
  let server
  try {
    server = await gen([...(canonical ? ['serve', filename] : ['--inputs', filename, '--serve']), '--port', '0', '--auth-token', token, '--cors-origin', allowed])
    if (!server.listening) await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port
    const routes = ['/', '/api', '/api/openapi.json', '/model.js', '/dist/jsee.core.js', '/__jsee/file?path=model.js', '/__jsee/folder?path=.', '/missing', '/compute', '/schema', '/openapi.json', '/run', '/__jsee/artifacts/unknown/0']
    for (const route of routes) {
      for (const method of ['GET', 'POST', 'HEAD', 'OPTIONS', 'DELETE']) {
        const response = await fetch(base + route, { method })
        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toContain('Bearer')
        expect(response.headers.get('cache-control')).toBe('no-store')
      }
      const denied = await fetch(base + route, { headers: { ...bearer, Origin: 'https://denied.example' } })
      expect(denied.status).toBe(403)
      expect(denied.headers.get('access-control-allow-origin')).toBeNull()
    }
    for (const auth of [bearer, { Authorization: 'Basic ' + Buffer.from('jsee:' + token).toString('base64') }]) {
      const response = await fetch(base + '/api', { headers: { ...auth, Origin: allowed } })
      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(allowed)
      expect(response.headers.get('access-control-allow-credentials')).toBe('true')
      expect(response.headers.get('vary')).toContain('Origin')
      expect(await response.text()).not.toContain(token)
    }
    const preflight = await fetch(base + '/run', { method: 'OPTIONS', headers: { Origin: allowed, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers').toLowerCase()).toContain('authorization')
    // Rejected bodies must never reach parsers or models.
    expect((await fetch(base + '/compute', { method: 'POST', headers: { Origin: allowed, 'Content-Type': 'application/json' }, body: '{' })).status).toBe(401)
    const stage = await fetch(base + '/compute', { method: 'POST', headers: { ...bearer, Origin: base, 'Content-Type': 'application/json' }, body: '{}' })
    expect((await stage.json()).answer).toBe(1)
    if (canonical) {
      const response = await fetch(base + '/run', { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{}' })
      const run = await response.json()
      expect(run.outputs.answer).toBe(2)
      expect((await fetch(base + run.artifacts[0].uri)).status).toBe(401)
      const file = await fetch(base + run.artifacts[0].uri, { headers: { ...bearer, Origin: allowed } })
      expect(await file.text()).toBe('inside')
      expect(file.headers.get('access-control-allow-origin')).toBe(allowed)
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

const { HostPolicy, takeHostOptions } = require('../../src/host-policy')
const decisions = require('../fixtures/host-policy.json')
test.each(decisions)('$name', fixture => {
  const result = new HostPolicy(fixture.options).evaluate(fixture.method, fixture.headers)
  expect(result.status).toBe(fixture.status)
  expect(result.headers['Access-Control-Allow-Origin'] || null).toBe(fixture.allowOrigin)
  expect(JSON.stringify(result)).not.toContain(token)
})

test('host options cannot become input aliases or logged argv', () => {
  const parsed = takeHostOptions(['serve', 'schema.json', '--auth-token=' + token, '--cors-origin', allowed, '--x', '2'])
  expect(parsed.args).toEqual(['serve', 'schema.json', '--x', '2'])
  expect(parsed.options.authToken).toBe(token)
  expect(takeHostOptions(['--', '--auth-token=literal-input']).args).toEqual(['--', '--auth-token=literal-input'])
})

test('invalid policy fails before model imports and secrets stay out of diagnostics', async () => {
  for (const options of [{ authToken: '' }, { authToken: 'a b' }, { authToken: true }, { authToken: token, corsOrigins: ['*'] }, { corsOrigins: ['null'] }, { corsOrigins: ['https://x/path'] }, { corsOrigins: ['*', allowed] }, { authTokenEnv: 'JSEE_TEST_MISSING_HOST_TOKEN' }]) {
    expect(() => new HostPolicy(options)).toThrow()
  }
  await expect(gen(['serve', 'nonexistent.json', '--auth-token-env', 'JSEE_TEST_MISSING_HOST_TOKEN'])).rejects.toThrow('not set')
})

test('authenticated streaming retains host cache and origin policy', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jsee-host-stream-'))
  fs.writeFileSync(path.join(directory, 'model.js'), 'module.exports = async function * () {yield {answer:1}}')
  const filename = path.join(directory, 'schema.json')
  fs.writeFileSync(filename, JSON.stringify({ model: { name: 'events', url: 'model.js', stream: true } }))
  let server
  try {
    server = await gen(['--inputs', filename, '--serve', '--port', '0', '--auth-token', token, '--cors-origin', allowed])
    if (!server.listening) await once(server, 'listening')
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/events', { method: 'POST', headers: { ...bearer, Origin: allowed, 'Content-Type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data: [DONE]')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBe(allowed)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
