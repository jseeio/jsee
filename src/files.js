// One containment policy for application files and generated artifact consumers.
const fs = require('fs')
const path = require('path')

function makeHttpError (message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

function hasDeniedPathSegment (relativePath) {
  return relativePath
    .split(path.sep)
    .filter(Boolean)
    .some(part => part.startsWith('.') || part === 'node_modules')
}

function resolveInside (root, requested) {
  if (!requested || typeof requested !== 'string') {
    throw makeHttpError('path required', 400)
  }
  const realRoot = fs.realpathSync(root)
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(realRoot, requested)
  let realCandidate
  try {
    realCandidate = fs.realpathSync(candidate)
  } catch (error) {
    throw makeHttpError('path not found', 404)
  }
  const relative = path.relative(realRoot, realCandidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw makeHttpError('path outside app root', 403)
  }
  if (hasDeniedPathSegment(relative)) {
    throw makeHttpError('path denied', 403)
  }
  return realCandidate
}

module.exports = { makeHttpError, resolveInside }
