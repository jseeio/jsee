// Host policy runs before routing/body reads; models and descriptors never own credentials.
const crypto = require('crypto')
const methods = ['GET', 'HEAD', 'POST', 'OPTIONS']
const requestHeaders = ['authorization', 'content-type']
const hostFlags = ['auth-token', 'auth-token-env', 'cors-origin']
const digest = value => crypto.createHash('sha256').update(value).digest()

function originValue (value) {
  if (typeof value !== 'string' || !/^https?:\/\/(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::[0-9]+)?$/.test(value)) return null
  try { const url = new URL(value); return url.origin === value ? value : null } catch (_) { return null }
}

class HostPolicy {
  constructor ({ authToken, authTokenEnv, corsOrigins, canonical=false }={}) {
    if (authTokenEnv !== undefined) {
      if (authToken !== undefined) throw new Error('Use only one of auth-token and auth-token-env')
      if (typeof authTokenEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(authTokenEnv)) throw new Error('auth-token-env must name an environment variable')
      authToken = process.env[authTokenEnv]
      if (authToken === undefined) throw new Error('auth-token-env variable is not set')
    }
    if (authToken !== undefined && (typeof authToken !== 'string' || authToken.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/.test(authToken))) throw new Error('auth-token must be a nonempty Bearer token (at most 4096 characters)')
    this.tokenHash = authToken === undefined ? null : digest(authToken)
    this.origins = corsOrigins === undefined ? (canonical || this.tokenHash ? [] : ['*']) : Array.isArray(corsOrigins) ? corsOrigins.slice() : [corsOrigins]
    if (this.origins.length === 1 && this.origins[0] === 'none') this.origins = []
    if (this.origins.some(origin => origin !== '*' && !originValue(origin))) throw new Error('cors-origin must be an HTTP(S) origin, none, or *')
    if (this.origins.includes('*') && (this.tokenHash || this.origins.length !== 1)) throw new Error('Wildcard CORS requires no authentication and no other origins')
  }

  authorize (authorization='') {
    if (!this.tokenHash) return true
    if (typeof authorization !== 'string' || authorization.length > 8192) return false
    const match = /^(Bearer|Basic) +([^\s]+)$/i.exec(authorization)
    if (!match) return false
    let value = match[2]
    if (match[1].toLowerCase() === 'basic') {
      const bytes = Buffer.from(value, 'base64')
      if (bytes.toString('base64') !== value || !bytes.toString('utf8').startsWith('jsee:')) return false
      value = bytes.toString('utf8').slice(5)
    }
    return crypto.timingSafeEqual(this.tokenHash, digest(value))
  }

  evaluate (method, incoming, scheme='http') {
    const origin = incoming.origin
    const headers = { Vary: 'Origin' }
    if (this.tokenHash) headers['Cache-Control'] = 'no-store'
    const reject = (status, error) => ({ status, error, headers: { ...headers, 'Cache-Control': 'no-store' } })
    if (this.origins.includes('*')) headers['Access-Control-Allow-Origin'] = '*'
    else if (origin !== undefined) {
      // Forwarded headers are untrusted. TLS proxies declare their public origin explicitly.
      const same = originValue(scheme + '://' + incoming.host)
      if (!originValue(origin) || origin !== same && !this.origins.includes(origin)) return reject(403, 'Origin is not allowed')
      headers['Access-Control-Allow-Origin'] = origin
      if (this.tokenHash) headers['Access-Control-Allow-Credentials'] = 'true'
    }
    headers['Access-Control-Expose-Headers'] = 'Content-Disposition'
    if (method === 'OPTIONS' && origin !== undefined && incoming['access-control-request-method']) {
      const requested = (incoming['access-control-request-headers'] || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean)
      if (!methods.includes(incoming['access-control-request-method']) || requested.some(name => !requestHeaders.includes(name))) return reject(403, 'Preflight is not allowed')
      // A preflight carries no credentials; it grants no access to the actual request.
      headers['Access-Control-Allow-Methods'] = methods.join(', ')
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
      return { status: 204, headers }
    }
    if (!this.authorize(incoming.authorization)) {
      headers['WWW-Authenticate'] = 'Basic realm="JSEE", charset="UTF-8", Bearer realm="JSEE"'
      return reject(401, 'Authentication required')
    }
    return { status: method === 'OPTIONS' ? 204 : null, headers }
  }

  middleware () {
    return (req, res, next) => {
      const decision = this.evaluate(req.method, req.headers, req.socket.encrypted ? 'https' : 'http')
      res.set(decision.headers)
      if (decision.status === 204) return res.status(204).end()
      if (decision.status) return res.status(decision.status).json({ error: decision.error })
      next()
    }
  }

  openapi (spec) {
    if (!this.tokenHash) return spec
    return { ...spec, components: { ...spec.components, securitySchemes: {
      ...spec.components?.securitySchemes, jseeBearer: { type: 'http', scheme: 'bearer' }, jseeBasic: { type: 'http', scheme: 'basic' }
    } }, security: [{ jseeBearer: [] }, { jseeBasic: [] }] }
  }
}

function takeHostOptions (args) {
  const options = require('minimist')(args, { string: hostFlags })
  // Remove host-only flags before descriptor aliases/defaults and verbose argv logging.
  const remaining = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--') { remaining.push(...args.slice(index)); break }
    const key = args[index].split('=')[0].slice(2)
    if (args[index].startsWith('--') && hostFlags.includes(key)) {
      if (!args[index].includes('=') && args[index + 1] && !args[index + 1].startsWith('-')) index++
    } else remaining.push(args[index])
  }
  return { args: remaining, options: { authToken: options['auth-token'], authTokenEnv: options['auth-token-env'], corsOrigins: options['cors-origin'] } }
}

module.exports = { HostPolicy, takeHostOptions }
