import type { Infer, JSONSchema, Validator } from 'ata-validator'
import type { RequestPart, RouteSpec } from './spec'

/** The data type a schema literal or a `Validator` describes. */
export type InferSchema<S> = S extends Validator<infer T> ? T : S extends JSONSchema ? Infer<S> : unknown

/** Data type of one request part, or `Fallback` when the spec does not declare it. */
export type PartOf<S extends RouteSpec, K extends RequestPart, Fallback = unknown> =
  S extends { request: { [P in K]: infer V } } ? InferSchema<V> : Fallback

/** Union of every declared response data type, or `Fallback` when the spec declares none. */
export type ResponseOf<S extends RouteSpec, Fallback = unknown> =
  S extends { response: infer R } ? { [K in keyof R]: InferSchema<R[K]> }[keyof R] : Fallback
