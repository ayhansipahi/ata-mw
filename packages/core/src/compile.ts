import { Validator } from 'ata-validator'
import type { ValidatorOptions } from 'ata-validator'
import {
  MalformedBody,
  REQUEST_PARTS,
  type CompiledSpec,
  type RequestParts,
  type RequestPart,
  type RouteSpec,
  type SchemaInput,
} from './spec'

const COERCE_BY_DEFAULT: ReadonlySet<RequestPart> = new Set(['params', 'query', 'headers'])

const isValidator = (x: unknown): x is Validator<any> =>
  typeof x === 'object' && x !== null && typeof (x as { validate?: unknown }).validate === 'function'

function build(input: SchemaInput, options: ValidatorOptions, where: string): Validator<any> {
  // ata accepts null (validates nothing) and undefined (throws on the first validate); a missing import must fail here.
  if (input == null) throw new Error(`@ata-mw: missing schema at ${where} (got ${input})`)
  if (isValidator(input)) return input
  try {
    return new Validator(input, options)
  } catch (cause) {
    throw new Error(`@ata-mw: invalid schema at ${where}: ${(cause as Error).message}`, { cause })
  }
}

// fromEntries defines own properties; assigning `out['__proto__'] = ...` would re-parent the copy instead.
const lowerKeys = (source: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]))

/** Compile every schema in the spec once. Throws if ata rejects a schema (pass `options.strictSchema` for authoring checks). */
export function compileSpec(spec: RouteSpec): CompiledSpec {
  const request = new Map<RequestPart, Validator<any>>()
  for (const part of REQUEST_PARTS) {
    const input = spec.request?.[part]
    if (input === undefined) continue // `false` and `true` are real (boolean) schemas
    const options: ValidatorOptions = { ...(COERCE_BY_DEFAULT.has(part) ? { coerceTypes: true } : {}), ...spec.options }
    request.set(part, build(input, options, `request.${part}`))
  }

  // Response schemas share the spec's options (formats, keywords, schemas, strictSchema) but never rewrite the payload:
  // ata would otherwise coerce, fill defaults or strip fields in place.
  const responseOptions: ValidatorOptions = { ...spec.options, coerceTypes: false, useDefaults: false, removeAdditional: false }
  const response = new Map<number | 'default', Validator<any>>()
  for (const [key, input] of Object.entries(spec.response ?? {})) {
    if (key !== 'default' && !/^[1-5]\d\d$/.test(key)) {
      throw new Error(`@ata-mw: invalid response key "${key}": use a status code from 100 to 599, or "default"`)
    }
    response.set(key === 'default' ? 'default' : Number(key), build(input, responseOptions, `response.${key}`))
  }

  return {
    has: (part) => request.has(part),
    hasResponse: response.size > 0,

    validateRequest(parts: RequestParts) {
      const data: RequestParts = {}
      for (const part of REQUEST_PARTS) {
        const validator = request.get(part)
        if (!validator) continue
        let value = parts[part]
        if (value instanceof MalformedBody) return { ok: false, part, errors: value.errors }
        if (part === 'headers') value = lowerKeys((value ?? {}) as Record<string, unknown>)
        else if (part !== 'body') value ??= {}
        const result = validator.validate(value)
        if (!result.valid) return { ok: false, part, errors: result.errors }
        data[part] = result.data
      }
      return { ok: true, data }
    },

    validateResponse(status, payload) {
      const validator = response.get(status) ?? response.get('default')
      if (!validator) return { ok: true, skipped: true }
      if (validator.isValidObject(payload)) return { ok: true, skipped: false }
      const result = validator.validate(payload)
      return result.valid ? { ok: true, skipped: false } : { ok: false, errors: result.errors }
    },
  }
}
