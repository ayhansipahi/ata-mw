import { Hono } from 'hono'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { validate } from '../src'

const user = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } as const
const paging = { type: 'object', properties: { page: { type: 'integer' }, tag: { type: 'array' } }, required: ['page'] } as const
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } as const
const post = (body: string) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body })

describe('request', () => {
  it('hands validated, coerced data to c.req.valid', async () => {
    const app = new Hono()
    app.post('/users/:id', validate({ request: { params: idParam, query: paging, body: user } }), (c) =>
      c.json({ id: c.req.valid('param').id, page: c.req.valid('query').page, name: c.req.valid('json').name }),
    )
    const res = await app.request('/users/7?page=2', post('{"name":"ada"}'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 7, page: 2, name: 'ada' })
  })

  it('lets the handler read the body again', async () => {
    const app = new Hono()
    app.post('/x', validate({ request: { body: user } }), async (c) => c.json(await c.req.json()))
    const res = await app.request('/x', post('{"name":"ada"}'))
    expect(await res.json()).toEqual({ name: 'ada' })
  })

  it('keeps repeated query keys as arrays and single keys as scalars', async () => {
    const app = new Hono()
    app.get('/x', validate({ request: { query: paging } }), (c) => c.json(c.req.valid('query')))
    const res = await app.request('/x?page=1&tag=a&tag=b')
    expect(await res.json()).toEqual({ page: 1, tag: ['a', 'b'] })
  })

  it('answers 400 with the failing part and ata errors', async () => {
    const app = new Hono()
    app.get('/x', validate({ request: { query: paging } }), (c) => c.json({ ok: true }))
    const res = await app.request('/x?page=abc')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; part: string; errors: Array<{ keyword: string }> }
    expect(body).toMatchObject({ error: 'Bad Request', part: 'query' })
    expect(body.errors[0]).toMatchObject({ keyword: 'type' })
  })

  it('answers 400, not 500, for malformed and empty JSON bodies', async () => {
    const app = new Hono()
    app.post('/x', validate({ request: { body: user } }), (c) => c.json({ ok: true }))
    for (const body of ['{oops', '']) {
      const res = await app.request('/x', post(body))
      expect(res.status).toBe(400)
      const json = (await res.json()) as { part: string; errors: Array<{ code: string }> }
      expect(json.part).toBe('body')
      expect(json.errors[0]).toMatchObject({ code: 'ATA9001' })
    }
  })

  it('reports an earlier failing part before a malformed body', async () => {
    const app = new Hono()
    app.post('/x', validate({ request: { query: paging, body: user } }), (c) => c.json({ ok: true }))
    const res = await app.request('/x?page=abc', post('{oops'))
    expect(await res.json()).toMatchObject({ part: 'query' })
  })

  it('validates headers (lowercased)', async () => {
    const headers = { type: 'object', properties: { 'x-count': { type: 'integer' } }, required: ['x-count'] } as const
    const app = new Hono()
    app.get('/x', validate({ request: { headers } }), (c) => c.json(c.req.valid('header')))
    expect((await app.request('/x')).status).toBe(400)
    const ok = await app.request('/x', { headers: { 'X-Count': '3' } })
    expect(await ok.json()).toEqual({ 'x-count': 3 })
  })

  it('lets onError replace the 400', async () => {
    const app = new Hono()
    app.get('/x', validate({ request: { query: paging } }, { onError: (failure, c) => c.json({ bad: failure.part }, 422) }), (c) => c.json({}))
    const res = await app.request('/x')
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ bad: 'query' })
  })
})

describe('response', () => {
  it('passes a response that matches its status schema, keeping its headers', async () => {
    const app = new Hono()
    app.post('/x', validate({ response: { 201: user } }), (c) => c.json({ name: 'ada' }, 201, { 'x-trace': '1' }))
    const res = await app.request('/x', { method: 'POST' })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-trace')).toBe('1')
    expect(await res.json()).toEqual({ name: 'ada' })
  })

  it('turns a response that breaks its schema into a generic 500, details only to the hook', async () => {
    const onResponseError = vi.fn()
    const app = new Hono()
    app.get('/x', validate({ response: { 200: user } }, { onResponseError }), (c) => c.json({ name: 42, secret: 'x' }))
    const res = await app.request('/x')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    expect(onResponseError).toHaveBeenCalledOnce()
    expect(onResponseError.mock.calls[0]![0]).toMatchObject({ status: 200 })
    expect(onResponseError.mock.calls[0]![0].errors.length).toBeGreaterThan(0)
  })

  it('skips statuses without a schema, non-JSON and empty responses', async () => {
    const app = new Hono()
    const mw = validate({ response: { 200: user } })
    app.get('/teapot', mw, (c) => c.json({ anything: true }, 418))
    app.get('/text', mw, (c) => c.text('plain'))
    app.get('/empty', mw, (c) => c.body(null, 204))
    expect((await app.request('/teapot')).status).toBe(418)
    expect(await (await app.request('/text')).text()).toBe('plain')
    expect((await app.request('/empty')).status).toBe(204)
  })

  it('skips a JSON content type with an unparsable body instead of crashing', async () => {
    const app = new Hono()
    app.get('/x', validate({ response: { 200: user } }), (c) => c.body('{oops', 200, { 'content-type': 'application/json' }))
    const res = await app.request('/x')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{oops')
  })

  it('checks the onError output against the default schema', async () => {
    const errorBody = { type: 'object', properties: { caught: { type: 'string' } }, required: ['caught'] } as const
    const onResponseError = vi.fn()
    const app = new Hono()
    app.onError((err, c) => c.json(c.req.path === '/conforming' ? { caught: err.message } : { message: err.message }, 500))
    const mw = validate({ response: { default: errorBody } }, { onResponseError })
    app.get('/conforming', mw, () => {
      throw new Error('boom')
    })
    app.get('/broken', mw, () => {
      throw new Error('boom')
    })
    expect(await (await app.request('/conforming')).json()).toEqual({ caught: 'boom' })
    expect(onResponseError).not.toHaveBeenCalled()
    expect(await (await app.request('/broken')).json()).toEqual({ error: 'Internal Server Error' })
    expect(onResponseError).toHaveBeenCalledOnce()
    expect(onResponseError.mock.calls[0]![0]).toMatchObject({ status: 500 })
  })

  it('leaves handler exceptions to Hono onError', async () => {
    const app = new Hono()
    app.onError((err, c) => c.json({ caught: err.message }, 500))
    app.get('/x', validate({ response: { 200: user } }), () => {
      throw new Error('boom')
    })
    const res = await app.request('/x')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ caught: 'boom' })
  })

  it('does not validate the 400 it sends itself', async () => {
    const app = new Hono()
    app.get('/x', validate({ request: { query: paging }, response: { default: { type: 'object', required: ['never'] } } }), (c) => c.json({}))
    expect((await app.request('/x')).status).toBe(400)
  })
})

describe('setup', () => {
  it('throws when ata rejects a schema', () => {
    expect(() => validate({ request: { body: { typo: 1 } as never }, options: { strictSchema: true } })).toThrow(/request\.body/)
  })
})

describe('types', () => {
  it('types c.req.valid from the spec', () => {
    const app = new Hono()
    app.post('/users/:id', validate({ request: { params: idParam, query: paging, body: user } }), (c) => {
      expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ readonly name: string }>()
      expectTypeOf(c.req.valid('param').id).toEqualTypeOf<number>()
      expectTypeOf(c.req.valid('query').page).toEqualTypeOf<number>()
      return c.json({})
    })
    expect(app).toBeDefined()
  })
})
