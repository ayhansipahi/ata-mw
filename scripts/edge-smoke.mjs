// Run on the built packages with code generation from strings blocked:
//   node --disallow-code-generation-from-strings scripts/edge-smoke.mjs
// Proves the dist files load as ESM and CJS, and that the Hono adapter validates where `new Function` is refused.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Hono } from 'hono'

const require = createRequire(import.meta.url)

let blocked = false
try {
  new Function('return 1')
} catch {
  blocked = true
}
assert.ok(blocked, 'run this script with --disallow-code-generation-from-strings')

for (const [name, exportName] of [
  ['@ata-mw/core', 'compileSpec'],
  ['@ata-mw/express', 'validate'],
  ['@ata-mw/hono', 'validate'],
  ['@ata-mw/middy', 'validate'],
]) {
  assert.equal(typeof (await import(name))[exportName], 'function', `${name} (ESM)`)
  assert.equal(typeof require(name)[exportName], 'function', `${name} (CJS)`)
}

const spec = {
  request: { query: { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'] } },
  response: { 200: { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'] } },
}
const { validate } = await import('@ata-mw/hono')

const app = new Hono()
app.get('/x', validate(spec), (c) => c.json({ page: c.req.valid('query').page }))
const ok = await app.request('/x?page=2')
assert.equal(ok.status, 200)
assert.deepEqual(await ok.json(), { page: 2 })
assert.equal((await app.request('/x?page=abc')).status, 400)

const broken = new Hono()
broken.get('/x', validate(spec), (c) => c.json({ page: 'nope' }))
assert.equal((await broken.request('/x?page=1')).status, 500)

console.log('edge smoke ok: ESM and CJS load, Hono validates with code generation blocked')
