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

// A fresh object per response: a warm Lambda must never share headers between invocations.
const jsonHeaders = () => ({ 'content-type': 'application/json' })

// @middy/core does not export its hook type.
type Hook = NonNullable<MiddlewareObj<any, any>['before']>

// Thrown from `before` so the invocation takes Middy's error path and the `onError` hooks of other middleware
// (CORS, error handlers) still run. Returning from `before` would skip all of them.
class RequestRejected extends Error {
  constructor(readonly failure: RequestFailure) {
    super('request validation failed')
  }
}

/** With `middy().use(validate(spec))` the handler's `event` is typed as `ValidatedEvent<typeof spec>`. */
export function validate<const S extends RouteSpec>(spec: S, hooks: MiddyHooks = {}): MiddlewareObj<ValidatedEvent<S>, any> {
  const compiled = compileSpec(spec)

  const before: Hook = async (request) => {
    const { event } = request
    const parts: RequestParts = {}
    if (compiled.has('params')) parts.params = event.pathParameters
    if (compiled.has('query')) parts.query = event.queryStringParameters
    if (compiled.has('headers')) parts.headers = event.headers
    if (compiled.has('body')) {
      if (typeof event.body === 'string') {
        // REST APIs with binary media types send JSON bodies base64-encoded.
        const text = event.isBase64Encoded === true ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
        const parsed = parseJson(text)
        parts.body = parsed.ok ? parsed.value : new MalformedBody(parsed.errors)
      } else {
        parts.body = event.body
      }
    }

    const result = compiled.validateRequest(parts)
    if (!result.ok) throw new RequestRejected({ part: result.part, errors: result.errors })
    if (compiled.has('body')) event.body = result.data.body
    if (compiled.has('query')) event.queryStringParameters = result.data.query
    if (compiled.has('params')) event.pathParameters = result.data.params
  }

  // Assigns `request.response` instead of returning, so the `onError` hooks of other middleware still run.
  const onError: Hook = async (request) => {
    if (!(request.error instanceof RequestRejected)) return
    const { failure } = request.error
    request.response = hooks.onError
      ? await hooks.onError(failure, request)
      : { statusCode: 400, headers: jsonHeaders(), body: JSON.stringify(badRequestBody(failure)) }
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
      headers: { ...res.headers, ...jsonHeaders() },
      body: JSON.stringify(internalErrorBody),
    }
  }

  return compiled.hasResponse ? { before, after, onError } : { before, onError }
}
