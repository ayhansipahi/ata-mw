import type { Context, MiddlewareHandler } from 'hono'
import {
  MalformedBody,
  REQUEST_PARTS,
  badRequestBody,
  compileSpec,
  internalErrorBody,
  parseJson,
  type CompiledSpec,
  type InferSchema,
  type RequestFailure,
  type RequestParts,
  type ResponseFailure,
  type RouteSpec,
} from '@ata-mw/core'

export type { RequestFailure, ResponseFailure, RouteSpec } from '@ata-mw/core'

export interface HonoHooks {
  /** Replaces the default 400 response. */
  onError?: (failure: RequestFailure, c: Context) => Response | Promise<Response>
  /** Notification only (log it): the client always gets the generic 500. */
  onResponseError?: (failure: ResponseFailure, c: Context) => void
}

// What the client sends: query, param and header values are strings. What the handler gets: the validated, coerced data.
type Raw<T> = { [K in keyof T]: string | string[] }

type Targets<S extends RouteSpec, Wire extends boolean> = (S extends { request: { body: infer B } }
  ? { json: InferSchema<B> }
  : {}) &
  (S extends { request: { query: infer Q } } ? { query: Wire extends true ? Raw<InferSchema<Q>> : InferSchema<Q> } : {}) &
  (S extends { request: { params: infer P } } ? { param: Wire extends true ? Raw<InferSchema<P>> : InferSchema<P> } : {}) &
  (S extends { request: { headers: infer H } } ? { header: Wire extends true ? Raw<InferSchema<H>> : InferSchema<H> } : {})

/** Hono `Input` for the middleware: `c.req.valid('json' | 'query' | 'param' | 'header')` is typed from the spec. */
export type HonoInput<S extends RouteSpec> = { in: Targets<S, true>; out: Targets<S, false> }

const TARGET = { params: 'param', query: 'query', headers: 'header', body: 'json' } as const

// c.req.queries() always returns arrays; a key sent once is a scalar, like hono/validator.
const scalars = (queries: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(queries).map(([key, values]) => [key, values.length === 1 ? values[0] : values]))

async function guardResponse(compiled: CompiledSpec, hooks: HonoHooks, c: Context) {
  const res = c.res
  if (!res.headers.get('content-type')?.includes('json')) return
  let payload: unknown
  try {
    payload = await res.clone().json()
  } catch {
    return
  }
  const result = compiled.validateResponse(res.status, payload)
  if (result.ok) return
  hooks.onResponseError?.({ status: res.status, errors: result.errors }, c)
  c.res = c.json(internalErrorBody, 500)
}

export function validate<const S extends RouteSpec>(spec: S, hooks: HonoHooks = {}): MiddlewareHandler<any, string, HonoInput<S>> {
  const compiled = compileSpec(spec)
  return async (c, next) => {
    const parts: RequestParts = {}
    if (compiled.has('params')) parts.params = c.req.param()
    if (compiled.has('query')) parts.query = scalars(c.req.queries())
    if (compiled.has('headers')) parts.headers = c.req.header()
    if (compiled.has('body')) {
      const parsed = parseJson(await c.req.text())
      parts.body = parsed.ok ? parsed.value : new MalformedBody(parsed.errors)
    }

    const result = compiled.validateRequest(parts)
    if (!result.ok) {
      const failure = { part: result.part, errors: result.errors }
      return hooks.onError ? hooks.onError(failure, c) : c.json(badRequestBody(failure), 400)
    }
    for (const part of REQUEST_PARTS) {
      if (compiled.has(part)) c.req.addValidatedData(TARGET[part], result.data[part] as {})
    }

    await next()
    if (compiled.hasResponse) await guardResponse(compiled, hooks, c)
  }
}
