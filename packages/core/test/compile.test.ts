import { Validator } from 'ata-validator'
import { describe, expect, it } from 'vitest'
import { compileSpec, MalformedBody } from '../src'

const num = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } as const

describe('compileSpec request', () => {
  it('reports which parts and responses are declared', () => {
    const compiled = compileSpec({ request: { query: num }, response: { 200: num } })
    expect(compiled.has('query')).toBe(true)
    expect(compiled.has('body')).toBe(false)
    expect(compiled.hasResponse).toBe(true)
    expect(compileSpec({}).hasResponse).toBe(false)
  })

  it('coerces params, query and headers by default, but not body', () => {
    const compiled = compileSpec({ request: { params: num, query: num, headers: { type: 'object', properties: { 'x-n': { type: 'integer' } } }, body: num } })
    const ok = compiled.validateRequest({ params: { n: '1' }, query: { n: '2' }, headers: { 'X-N': '3' }, body: { n: 4 } })
    expect(ok).toEqual({ ok: true, data: { params: { n: 1 }, query: { n: 2 }, headers: { 'x-n': 3 }, body: { n: 4 } } })
    const bad = compiled.validateRequest({ params: { n: '1' }, query: { n: '2' }, headers: {}, body: { n: '4' } })
    expect(bad).toMatchObject({ ok: false, part: 'body' })
  })

  it('lets options override the coerce default', () => {
    const compiled = compileSpec({ request: { query: num }, options: { coerceTypes: false } })
    expect(compiled.validateRequest({ query: { n: '2' } })).toMatchObject({ ok: false, part: 'query' })
  })

  it('treats a missing params, query or headers value as an empty object', () => {
    const compiled = compileSpec({ request: { query: num, headers: num } })
    expect(compiled.validateRequest({ query: undefined, headers: undefined })).toMatchObject({ ok: false, part: 'query' })
  })

  it('fails when a body schema is declared and the body is undefined', () => {
    const compiled = compileSpec({ request: { body: num } })
    expect(compiled.validateRequest({})).toMatchObject({ ok: false, part: 'body' })
  })

  it('reports the first failing part in the order params, query, headers, body', () => {
    const compiled = compileSpec({ request: { params: num, query: num, headers: num, body: num } })
    const parts = { params: { n: 'x' }, query: { n: 'x' }, headers: { n: 'x' }, body: { n: 'x' } }
    expect(compiled.validateRequest(parts)).toMatchObject({ ok: false, part: 'params' })
    expect(compiled.validateRequest({ ...parts, params: { n: 1 } })).toMatchObject({ part: 'query' })
    expect(compiled.validateRequest({ ...parts, params: { n: 1 }, query: { n: 1 } })).toMatchObject({ part: 'headers' })
    expect(compiled.validateRequest({ ...parts, params: { n: 1 }, query: { n: 1 }, headers: { n: 1 } })).toMatchObject({ part: 'body' })
  })

  it('reports MalformedBody as the body failure, after earlier parts pass', () => {
    const compiled = compileSpec({ request: { query: num, body: num } })
    const malformed = new MalformedBody([{ keyword: '__parse__', instancePath: '', schemaPath: '', params: {}, message: 'invalid JSON' }])
    expect(compiled.validateRequest({ query: { n: 'x' }, body: malformed })).toMatchObject({ part: 'query' })
    expect(compiled.validateRequest({ query: { n: '1' }, body: malformed })).toMatchObject({ ok: false, part: 'body', errors: malformed.errors })
  })

  it('uses a given Validator as is', () => {
    const own = new Validator(num, { coerceTypes: false })
    const compiled = compileSpec({ request: { query: own } })
    expect(compiled.validateRequest({ query: { n: '2' } })).toMatchObject({ ok: false })
  })

  it('throws at setup, naming the schema location', () => {
    expect(() => compileSpec({ request: { body: { typo: 1 } as never }, options: { strictSchema: true } })).toThrow(/request\.body.*typo/)
  })
})

describe('compileSpec response', () => {
  const compiled = compileSpec({ response: { 200: num, default: { type: 'object', required: ['error'] } } })

  it('validates against the exact status, then default', () => {
    expect(compiled.validateResponse(200, { n: 1 })).toEqual({ ok: true, skipped: false })
    expect(compiled.validateResponse(200, { n: 'x' })).toMatchObject({ ok: false })
    expect(compiled.validateResponse(404, { error: 'nope' })).toEqual({ ok: true, skipped: false })
    expect(compiled.validateResponse(404, {})).toMatchObject({ ok: false })
  })

  it('skips when no schema matches and there is no default', () => {
    expect(compileSpec({ response: { 200: num } }).validateResponse(204, undefined)).toEqual({ ok: true, skipped: true })
  })

  it('never rewrites the payload: no coercion, no defaults', () => {
    const withDefault = compileSpec({ response: { 200: { type: 'object', properties: { n: { type: 'integer', default: 5 } } } } })
    const payload = {}
    withDefault.validateResponse(200, payload)
    expect(payload).toEqual({})
    expect(compiled.validateResponse(200, { n: '1' })).toMatchObject({ ok: false })
  })

  it('applies strictSchema to response schemas too, naming the location', () => {
    expect(() => compileSpec({ response: { 200: { typo: 1 } as never }, options: { strictSchema: true } })).toThrow(/response\.200.*typo/)
  })

  it('applies custom formats from options to response schemas', () => {
    const upper = compileSpec({
      response: { 200: { type: 'string', format: 'upper' } },
      options: { formats: { upper: (value) => value === value.toUpperCase() } },
    })
    expect(upper.validateResponse(200, 'ABC')).toEqual({ ok: true, skipped: false })
    expect(upper.validateResponse(200, 'abc')).toMatchObject({ ok: false })
  })

  it('keeps responses verdict-only even when options turn on coercion, defaults or removeAdditional', () => {
    const lenient = compileSpec({
      response: { 200: { type: 'object', properties: { n: { type: 'integer', default: 5 } }, additionalProperties: false } },
      options: { coerceTypes: true, useDefaults: true, removeAdditional: true },
    })
    expect(lenient.validateResponse(200, { n: '1' })).toMatchObject({ ok: false })
    const payload = { extra: 1 }
    expect(lenient.validateResponse(200, payload)).toMatchObject({ ok: false })
    expect(payload).toEqual({ extra: 1 })
  })
})
