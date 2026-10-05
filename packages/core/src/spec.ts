import type { JSONSchema, ValidationError, Validator, ValidatorOptions } from 'ata-validator'

export type { ValidationError, ValidatorOptions }

/** A JSON Schema literal, or an ata `Validator` you built yourself (used as given). */
export type SchemaInput = JSONSchema | Validator<any>

export interface RequestSpec {
  body?: SchemaInput
  query?: SchemaInput
  params?: SchemaInput
  /** Header names are lowercased before validation: write schema property names in lowercase. */
  headers?: SchemaInput
}

export interface ResponseSpec {
  [status: number]: SchemaInput
  default?: SchemaInput
}

export interface RouteSpec {
  request?: RequestSpec
  response?: ResponseSpec
  /** ata options for the request parts. `coerceTypes` is on by default for params, query and headers. */
  options?: ValidatorOptions
}

/** Validation order. The first failing part wins. */
export const REQUEST_PARTS = ['params', 'query', 'headers', 'body'] as const
export type RequestPart = (typeof REQUEST_PARTS)[number]

/** A request body that was not valid JSON. Put it in `RequestParts.body` and `validateRequest` reports it as the body failure. */
export class MalformedBody {
  constructor(readonly errors: ValidationError[]) {}
}

export type RequestParts = { [P in RequestPart]?: unknown }

export interface RequestFailure {
  part: RequestPart
  errors: ValidationError[]
}

export interface ResponseFailure {
  status: number
  errors: ValidationError[]
}

export type RequestResult =
  | { ok: true; data: RequestParts }
  | { ok: false; part: RequestPart; errors: ValidationError[] }

export type ResponseResult =
  | { ok: true; skipped: boolean }
  | { ok: false; errors: ValidationError[] }

export interface CompiledSpec {
  /** True when the spec declares a schema for this request part. */
  has(part: RequestPart): boolean
  /** True when the spec declares at least one response schema. */
  readonly hasResponse: boolean
  validateRequest(parts: RequestParts): RequestResult
  /** `{ ok: true, skipped: true }` when no schema matches the status and there is no `default`. */
  validateResponse(status: number, payload: unknown): ResponseResult
}
