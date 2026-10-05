import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import express5, { type Express, type Request, type Response } from 'express'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { validate } from '../src'

const express4 = createRequire(import.meta.url)('express4') as typeof express5

const user = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } as const
const paging = { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'] } as const
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } as const

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function serve(app: Express) {
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as { port: number }
  return `http://127.0.0.1:${port}`
}

describe.each([
  ['express 4', express4],
  ['express 5', express5],
])('%s', (_name, express) => {
  it('passes valid input through and writes coerced values to req', async () => {
    const app = express()
    app.use(express.json())
    app.post(
      '/users/:id',
      validate({ request: { params: idParam, query: paging, body: user } }),
      (req, res) => {
        res.json({ id: req.params.id, page: req.query.page, name: req.body.name, types: [typeof req.params.id, typeof req.query.page] })
      },
    )
    const url = await serve(app)
    const res = await fetch(`${url}/users/7?page=2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"ada"}' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 7, page: 2, name: 'ada', types: ['number', 'number'] })
  })

  it('writes defaults and removeAdditional results back to req', async () => {
    const withDefault = { type: 'object', properties: { page: { type: 'integer', default: 1 } } } as const
    const app = express()
    app.use(express.json())
    app.post(
      '/x',
      validate({ request: { query: withDefault, body: user }, options: { removeAdditional: true } }),
      (req, res) => {
        res.json({ page: req.query.page, body: req.body })
      },
    )
    const url = await serve(app)
    const res = await fetch(`${url}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"ada","extra":1}' })
    expect(await res.json()).toEqual({ page: 1, body: { name: 'ada' } })
  })

  it('answers 400 with the failing part and ata errors', async () => {
    const app = express()
    app.get('/x', validate({ request: { query: paging } }), (_req, res) => res.json({ ok: true }))
    const url = await serve(app)
    const res = await fetch(`${url}/x?page=abc`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'Bad Request', part: 'query' })
    expect(body.errors[0]).toMatchObject({ keyword: 'type' })
  })

  it('answers 400, not a crash, when a body schema is declared and no body parser ran', async () => {
    const app = express()
    app.post('/x', validate({ request: { body: user } }), (_req, res) => res.json({ ok: true }))
    const url = await serve(app)
    const res = await fetch(`${url}/x`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ part: 'body' })
  })

  it('validates headers without rewriting req.headers', async () => {
    const headers = { type: 'object', properties: { 'x-count': { type: 'integer' } }, required: ['x-count'] } as const
    const app = express()
    app.get('/x', validate({ request: { headers } }), (req, res) => res.json({ raw: req.headers['x-count'] }))
    const url = await serve(app)
    expect((await fetch(`${url}/x`)).status).toBe(400)
    const ok = await fetch(`${url}/x`, { headers: { 'X-Count': '3' } })
    expect(await ok.json()).toEqual({ raw: '3' })
  })

  it('lets onError replace the 400', async () => {
    const app = express()
    app.get(
      '/x',
      validate({ request: { query: paging } }, { onError: (failure, _req, res) => void res.status(422).json({ bad: failure.part }) }),
      (_req, res) => res.json({}),
    )
    const url = await serve(app)
    const res = await fetch(`${url}/x`)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ bad: 'query' })
  })

  it('passes a response that matches its status schema', async () => {
    const app = express()
    app.post('/x', validate({ response: { 201: user } }), (_req, res) => res.status(201).json({ name: 'ada' }))
    const url = await serve(app)
    const res = await fetch(`${url}/x`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ name: 'ada' })
  })

  it('turns a response that breaks its schema into a generic 500, details only to the hook', async () => {
    const onResponseError = vi.fn()
    const app = express()
    app.get('/x', validate({ response: { 200: user } }, { onResponseError }), (_req, res) => res.json({ name: 42, secret: 'x' } as never))
    const url = await serve(app)
    const res = await fetch(`${url}/x`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    expect(onResponseError).toHaveBeenCalledOnce()
    expect(onResponseError.mock.calls[0]![0]).toMatchObject({ status: 200 })
    expect(onResponseError.mock.calls[0]![0].errors.length).toBeGreaterThan(0)
  })

  it('also validates objects sent through res.send', async () => {
    const app = express()
    app.get('/x', validate({ response: { 200: user } }), (_req, res) => res.send({ name: 42 } as never))
    const url = await serve(app)
    expect((await fetch(`${url}/x`)).status).toBe(500)
  })

  it('skips statuses without a schema and non-JSON responses', async () => {
    const app = express()
    const mw = validate({ response: { 200: user } })
    app.get('/teapot', mw, (_req, res) => res.status(418).json({ anything: true } as never))
    app.get('/text', mw, (_req, res) => res.type('text').send('plain' as never))
    app.get('/empty', mw, (_req, res) => res.status(204).end())
    const url = await serve(app)
    expect((await fetch(`${url}/teapot`)).status).toBe(418)
    expect(await (await fetch(`${url}/text`)).text()).toBe('plain')
    expect((await fetch(`${url}/empty`)).status).toBe(204)
  })

  it('validates error responses against the default schema', async () => {
    const app = express()
    app.get('/x', validate({ response: { default: { type: 'object', required: ['error'] } } }), (_req, res) => res.status(404).json({ nope: true }))
    const url = await serve(app)
    expect((await fetch(`${url}/x`)).status).toBe(500)
  })

  it('checks the error handler output against the default schema', async () => {
    const errorBody = { type: 'object', properties: { caught: { type: 'string' } }, required: ['caught'] } as const
    const onResponseError = vi.fn()
    const app = express()
    const mw = validate({ response: { default: errorBody } }, { onResponseError })
    app.get('/conforming', mw, () => {
      throw new Error('boom')
    })
    app.get('/broken', mw, () => {
      throw new Error('boom')
    })
    app.use((err: Error, req: Request, res: Response, _next: unknown) => {
      res.status(500).json(req.path === '/conforming' ? { caught: err.message } : { message: err.message })
    })
    const url = await serve(app)
    expect(await (await fetch(`${url}/conforming`)).json()).toEqual({ caught: 'boom' })
    expect(onResponseError).not.toHaveBeenCalled()
    expect(await (await fetch(`${url}/broken`)).json()).toEqual({ error: 'Internal Server Error' })
    expect(onResponseError).toHaveBeenCalledOnce()
    expect(onResponseError.mock.calls[0]![0]).toMatchObject({ status: 500 })
  })

  it('leaves handler exceptions to the Express error path', async () => {
    const app = express()
    app.get('/x', validate({ response: { 200: user } }), () => {
      throw new Error('boom')
    })
    app.use((err: Error, _req: unknown, res: Response, _next: unknown) => {
      res.status(500).json({ caught: err.message })
    })
    const url = await serve(app)
    const res = await fetch(`${url}/x`)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ caught: 'boom' })
  })

  it('does not validate the 400 it sends itself', async () => {
    const app = express()
    app.get('/x', validate({ request: { query: paging }, response: { default: { type: 'object', required: ['never'] } } }), (_req, res) => res.json({}))
    const url = await serve(app)
    expect((await fetch(`${url}/x`)).status).toBe(400)
  })
})

describe('setup', () => {
  it('throws when ata rejects a schema', () => {
    expect(() => validate({ request: { body: { typo: 1 } as never }, options: { strictSchema: true } })).toThrow(/request\.body/)
  })
})

describe('types', () => {
  it('flows the spec into a chained handler', () => {
    const app = express5()
    app.post('/users/:id', validate({ request: { params: idParam, query: paging, body: user }, response: { 200: user } }), (req, res) => {
      expectTypeOf(req.body).toEqualTypeOf<{ readonly name: string }>()
      expectTypeOf(req.query).toEqualTypeOf<{ readonly page: number }>()
      expectTypeOf(req.params).toEqualTypeOf<{ readonly id: number }>()
      res.json({ name: 'ada' })
      // @ts-expect-error the response schema requires `name` to be a string
      res.json({ name: 1 })
    })
    expect(app).toBeDefined()
  })
})
