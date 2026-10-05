import type { MiddlewareObj, Request } from '@middy/core'
import {
  MalformedBody,
  badRequestBody,
  compileSpec,
  internalErrorBody,
  parseJson,
  type PartOf,
  type RequestFailure,
  type RequestParts,
  type ResponseFailure,
  type RouteSpec,
} from '@ata-mw/core'

export type { RequestFailure, ResponseFailure, RouteSpec } from '@ata-mw/core'

/** An API Gateway proxy response. */
export interface HttpResponse {
  statusCode: number
  headers?: Record<string, string>
  body?: unknown
  [key: string]: unknown
}

export interface MiddyHooks {
  /** Replaces the default 400 response. Return the full response object. */
  onError?: (failure: RequestFailure, request: Request) => HttpResponse | Promise<HttpResponse>
  /** Notification only (log it): the client always gets the generic 500. */
  onResponseError?: (failure: ResponseFailure, request: Request) => void
}

/** The event fields the middleware reads and rewrites. Any API Gateway event type fits. */
export interface HttpEventLike {
  body?: unknown
  queryStringParameters?: unknown
  pathParameters?: unknown
  headers?: unknown
}

/** The event your handler receives: `body`, `queryStringParameters` and `pathParameters` follow the spec. */
export type ValidatedEvent<S extends RouteSpec, E extends HttpEventLike = HttpEventLike> = Omit<
  E,
  'body' | 'queryStringParameters' | 'pathParameters'
> & {
  body: PartOf<S, 'body', E['body']>
  queryStringParameters: PartOf<S, 'query', E['queryStringParameters']>
  pathParameters: PartOf<S, 'params', E['pathParameters']>
}

const JSON_HEADERS = { 'content-type': 'application/json' }

// @middy/core does not export its hook type.
type Hook = NonNullable<MiddlewareObj<any, any>['before']>

/** With `middy().use(validate(spec))` the handler's `event` is typed as `ValidatedEvent<typeof spec>`. */
export function validate<const S extends RouteSpec>(spec: S, hooks: MiddyHooks = {}): MiddlewareObj<ValidatedEvent<S>, any> {
  const compiled = compileSpec(spec)

  // Returning a value from `before` ends the invocation: the handler and every `after` hook are skipped.
  const before: Hook = async (request) => {
    const { event } = request
    const parts: RequestParts = {}
    if (compiled.has('params')) parts.params = event.pathParameters
    if (compiled.has('query')) parts.query = event.queryStringParameters
    if (compiled.has('headers')) parts.headers = event.headers
    if (compiled.has('body')) {
      if (typeof event.body === 'string') {
        const parsed = parseJson(event.body)
        parts.body = parsed.ok ? parsed.value : new MalformedBody(parsed.errors)
      } else {
        parts.body = event.body
      }
    }

    const result = compiled.validateRequest(parts)
    if (!result.ok) {
      const failure = { part: result.part, errors: result.errors }
      if (hooks.onError) return hooks.onError(failure, request)
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify(badRequestBody(failure)) }
    }
    if (compiled.has('body')) event.body = result.data.body
    if (compiled.has('query')) event.queryStringParameters = result.data.query
    if (compiled.has('params')) event.pathParameters = result.data.params
  }

  // Assigns `request.response` instead of returning, so the `after` hooks of other middleware still run.
  const after: Hook = async (request) => {
    const res = request.response
    if (!res || typeof res.statusCode !== 'number' || res.isBase64Encoded) return
    let payload: unknown
    if (typeof res.body === 'string') {
      const parsed = parseJson(res.body)
      if (!parsed.ok) return
      payload = parsed.value
    } else if (typeof res.body === 'object' && res.body !== null) {
      payload = res.body
    } else {
      return
    }
    const result = compiled.validateResponse(res.statusCode, payload)
    if (result.ok) return
    hooks.onResponseError?.({ status: res.statusCode, errors: result.errors }, request)
    request.response = {
      ...res,
      statusCode: 500,
      headers: { ...res.headers, ...JSON_HEADERS },
      body: JSON.stringify(internalErrorBody),
    }
  }

  return compiled.hasResponse ? { before, after } : { before }
}
