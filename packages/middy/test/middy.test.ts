import middy, { type MiddlewareObj } from '@middy/core'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { validate, type HttpResponse, type MiddyHooks, type RouteSpec, type ValidatedEvent } from '../src'

const user = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } as const
const paging = { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'] } as const
const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } as const

type Event = Record<string, unknown>

function lambda(spec: RouteSpec, handler: (event: any) => unknown, hooks?: MiddyHooks) {
  return middy().use(validate(spec, hooks)).handler(handler as never)
}
const call = (fn: ReturnType<typeof lambda>, event: Event) => fn(event as never, {} as never) as Promise<HttpResponse>
const ok = (body: unknown, statusCode = 200, extra: Record<string, unknown> = {}) => ({ statusCode, body: JSON.stringify(body), ...extra })

describe('request', () => {
  it('parses a string body and hands coerced objects to the handler', async () => {
    const seen = vi.fn()
    const fn = lambda({ request: { params: idParam, query: paging, body: user } }, (event) => {
      seen(event.body, event.queryStringParameters, event.pathParameters)
      return ok({ done: true })
    })
    const res = await call(fn, { body: '{"name":"ada"}', queryStringParameters: { page: '2' }, pathParameters: { id: '7' } })
    expect(res.statusCode).toBe(200)
    expect(seen).toHaveBeenCalledWith({ name: 'ada' }, { page: 2 }, { id: 7 })
  })

  it('validates a body that is already an object', async () => {
    const fn = lambda({ request: { body: user } }, () => ok({}))
    expect((await call(fn, { body: { name: 'ada' } })).statusCode).toBe(200)
    expect((await call(fn, { body: { name: 1 } })).statusCode).toBe(400)
  })

  it('answers 400 with the failing part and skips the handler', async () => {
    const handler = vi.fn(() => ok({}))
    const fn = lambda({ request: { query: paging } }, handler)
    const res = await call(fn, { queryStringParameters: { page: 'abc' } })
    expect(res.statusCode).toBe(400)
    expect(res.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(res.body as string)).toMatchObject({ error: 'Bad Request', part: 'query' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 400, not a crash, when API Gateway sends null for absent query and path parameters', async () => {
    const fn = lambda({ request: { query: paging, params: idParam } }, () => ok({}))
    const res = await call(fn, { queryStringParameters: null, pathParameters: null })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body as string).part).toBe('params')
  })

  it('answers 400 for a malformed, empty or null body', async () => {
    const fn = lambda({ request: { body: user } }, () => ok({}))
    for (const body of ['{oops', '', null]) {
      const res = await call(fn, { body })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body as string).part).toBe('body')
    }
    const malformed = JSON.parse((await call(fn, { body: '{oops' })).body as string)
    expect(malformed.errors[0]).toMatchObject({ code: 'ATA9001' })
  })

  it('validates headers whatever their case', async () => {
    const headers = { type: 'object', properties: { 'x-count': { type: 'integer' } }, required: ['x-count'] } as const
    const fn = lambda({ request: { headers } }, () => ok({}))
    expect((await call(fn, { headers: { 'X-Count': '3' } })).statusCode).toBe(200)
    expect((await call(fn, { headers: null })).statusCode).toBe(400)
  })

  it('lets onError replace the 400', async () => {
    const fn = lambda({ request: { query: paging } }, () => ok({}), {
      onError: (failure) => ({ statusCode: 422, body: JSON.stringify({ bad: failure.part }) }),
    })
    const res = await call(fn, {})
    expect(res.statusCode).toBe(422)
    expect(res.body).toBe('{"bad":"query"}')
  })

  it('lets the onError hooks of other middleware decorate the 400', async () => {
    const cors: MiddlewareObj = {
      onError: (request) => {
        if (request.response) request.response.headers = { ...request.response.headers, 'access-control-allow-origin': '*' }
      },
    }
    const fn = middy()
      .use(cors)
      .use(validate({ request: { query: paging } }))
      .handler((() => ok({})) as never)
    const res = (await fn({} as never, {} as never)) as HttpResponse
    expect(res.statusCode).toBe(400)
    expect(res.headers).toEqual({ 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  })

  it('gives every 400 its own headers object', async () => {
    const fn = lambda({ request: { query: paging } }, () => ok({}))
    const first = await call(fn, {})
    first.headers!['x-leak'] = 'yes'
    const second = await call(fn, {})
    expect(second.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('decodes a base64 body before parsing it', async () => {
    const seen = vi.fn()
    const fn = lambda({ request: { body: user } }, (event) => {
      seen(event.body)
      return ok({})
    })
    const body = Buffer.from('{"name":"ada"}').toString('base64')
    const res = await call(fn, { body, isBase64Encoded: true })
    expect(res.statusCode).toBe(200)
    expect(seen).toHaveBeenCalledWith({ name: 'ada' })
  })
})

describe('response', () => {
  it('passes a response that matches its status schema untouched', async () => {
    const fn = lambda({ response: { 201: user } }, () => ok({ name: 'ada' }, 201, { headers: { 'x-trace': '1' } }))
    expect(await call(fn, {})).toEqual(ok({ name: 'ada' }, 201, { headers: { 'x-trace': '1' } }))
  })

  it('also validates an object body', async () => {
    const fn = lambda({ response: { 200: user } }, () => ({ statusCode: 200, body: { name: 1 } }))
    expect((await call(fn, {})).statusCode).toBe(500)
  })

  it('turns a response that breaks its schema into a generic 500, keeping headers, details only to the hook', async () => {
    const onResponseError = vi.fn()
    const fn = lambda({ response: { 200: user } }, () => ok({ name: 42, secret: 'x' }, 200, { headers: { 'x-trace': '1' } }), { onResponseError })
    const res = await call(fn, {})
    expect(res.statusCode).toBe(500)
    expect(res.headers).toEqual({ 'x-trace': '1', 'content-type': 'application/json' })
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Internal Server Error' })
    expect(onResponseError).toHaveBeenCalledOnce()
    expect(onResponseError.mock.calls[0]![0]).toMatchObject({ status: 200 })
    expect(onResponseError.mock.calls[0]![0].errors.length).toBeGreaterThan(0)
  })

  it('skips statuses without a schema, non-JSON bodies, base64 bodies and non-HTTP results', async () => {
    const spec = { response: { 200: user } }
    expect((await call(lambda(spec, () => ok({ any: 1 }, 418)), {})).statusCode).toBe(418)
    expect((await call(lambda(spec, () => ({ statusCode: 200, body: 'plain text' })), {})).body).toBe('plain text')
    expect((await call(lambda(spec, () => ({ statusCode: 200, body: 'e30=', isBase64Encoded: true })), {})).statusCode).toBe(200)
    expect(await call(lambda(spec, () => 'not http'), {})).toBe('not http')
    expect((await call(lambda(spec, () => ({ statusCode: 204 })), {})).statusCode).toBe(204)
  })

  it('skips a response whose content-type is not JSON, whatever its body parses as', async () => {
    const fn = lambda({ response: { 200: user } }, () => ({ statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: '123' }))
    const res = await call(fn, {})
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('123')
  })

  it('still validates a JSON content-type with parameters, whatever the header case', async () => {
    const fn = lambda({ response: { 200: user } }, () => ({
      statusCode: 200,
      headers: { 'CONTENT-TYPE': 'application/json; charset=utf-8' },
      body: '{"name":1}',
    }))
    expect((await call(fn, {})).statusCode).toBe(500)
  })

  it('lets handler exceptions reach the Middy error path', async () => {
    const fn = lambda({ response: { 200: user } }, () => {
      throw new Error('boom')
    })
    await expect(call(fn, {})).rejects.toThrow('boom')
  })

  it('does not stop the after hooks of other middleware when it replaces the response', async () => {
    const addHeader: MiddlewareObj = {
      after: (request) => void (request.response.headers = { ...request.response.headers, 'x-extra': '1' }),
    }
    const fn = middy()
      .use(addHeader)
      .use(validate({ response: { 200: user } }))
      .handler((() => ok({ name: 42 })) as never)
    const res = (await fn({} as never, {} as never)) as HttpResponse
    expect(res.statusCode).toBe(500)
    expect(res.headers?.['x-extra']).toBe('1')
  })
})

describe('setup', () => {
  it('throws when ata rejects a schema', () => {
    expect(() => validate({ request: { body: { typo: 1 } as never }, options: { strictSchema: true } })).toThrow(/request\.body/)
  })
})

describe('types', () => {
  it('types the event from the spec and keeps the rest of the event type', () => {
    const spec = { request: { params: idParam, query: paging, body: user } } as const
    type E = ValidatedEvent<typeof spec, { body: string | null; queryStringParameters: Record<string, string> | null; pathParameters: null; headers: Record<string, string>; path: string }>
    expectTypeOf<E['body']>().toEqualTypeOf<{ readonly name: string }>()
    expectTypeOf<E['queryStringParameters']>().toEqualTypeOf<{ readonly page: number }>()
    expectTypeOf<E['pathParameters']>().toEqualTypeOf<{ readonly id: number }>()
    expectTypeOf<E['path']>().toEqualTypeOf<string>()
    type Bare = ValidatedEvent<{}, { body: string | null }>
    expectTypeOf<Bare['body']>().toEqualTypeOf<string | null>()
  })

  it('types the handler event after middy().use(validate(spec))', () => {
    const handler = middy()
      .use(validate({ request: { body: user, query: paging } }))
      .handler(async (event) => {
        expectTypeOf(event.body).toEqualTypeOf<{ readonly name: string }>()
        expectTypeOf(event.queryStringParameters).toEqualTypeOf<{ readonly page: number }>()
        return ok({ name: event.body.name })
      })
    expect(handler).toBeDefined()
  })
})
