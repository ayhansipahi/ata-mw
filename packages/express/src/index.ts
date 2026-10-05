import type { NextFunction, Request, RequestHandler, Response } from 'express'
import {
  badRequestBody,
  compileSpec,
  internalErrorBody,
  type CompiledSpec,
  type PartOf,
  type RequestFailure,
  type ResponseFailure,
  type ResponseOf,
  type RouteSpec,
} from '@ata-mw/core'

export type { RequestFailure, ResponseFailure, RouteSpec } from '@ata-mw/core'

export interface ExpressHooks {
  /** Replaces the default 400 response. Send a response or call `next`. */
  onError?: (failure: RequestFailure, req: Request, res: Response, next: NextFunction) => void
  /** Notification only (log it): the client always gets the generic 500. */
  onResponseError?: (failure: ResponseFailure, req: Request, res: Response) => void
}

/** The middleware type: `req.params`, `req.query`, `req.body` and `res.json` follow the spec. */
export type ValidatedHandler<S extends RouteSpec> = RequestHandler<
  PartOf<S, 'params', Request['params']>,
  ResponseOf<S, any>,
  PartOf<S, 'body', any>,
  PartOf<S, 'query', Request['query']>
>

// Express 5 defines `req.query` as a getter on the prototype, so assigning to it fails. An own property wins on 4 and 5.
const shadow = (req: Request, key: 'query' | 'params', value: unknown) =>
  Object.defineProperty(req, key, { value, writable: true, configurable: true, enumerable: true })

function guardResponse(compiled: CompiledSpec, hooks: ExpressHooks, req: Request, res: Response) {
  const json = res.json
  // res.send(object) calls res.json, so this covers both.
  res.json = (payload) => {
    const result = compiled.validateResponse(res.statusCode, payload)
    if (result.ok) return json.call(res, payload)
    hooks.onResponseError?.({ status: res.statusCode, errors: result.errors }, req, res)
    res.status(500)
    return json.call(res, internalErrorBody)
  }
}

export function validate<const S extends RouteSpec>(spec: S, hooks: ExpressHooks = {}): ValidatedHandler<S> {
  const compiled = compileSpec(spec)
  const handler: RequestHandler = (req, res, next) => {
    const result = compiled.validateRequest({ params: req.params, query: req.query, headers: req.headers, body: req.body })
    if (!result.ok) {
      const failure = { part: result.part, errors: result.errors }
      if (hooks.onError) return hooks.onError(failure, req, res, next)
      res.status(400).json(badRequestBody(failure))
      return
    }
    if (compiled.has('body')) req.body = result.data.body
    if (compiled.has('query')) shadow(req, 'query', result.data.query)
    if (compiled.has('params')) shadow(req, 'params', result.data.params)
    if (compiled.hasResponse) guardResponse(compiled, hooks, req, res)
    next()
  }
  return handler as ValidatedHandler<S>
}
