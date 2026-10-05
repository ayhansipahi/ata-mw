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
  if (isValidator(input)) return input
  try {
    return new Validator(input, options)
  } catch (cause) {
    throw new Error(`@ata-mw: invalid schema at ${where}: ${(cause as Error).message}`, { cause })
  }
}

function lowerKeys(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(source)) out[key.toLowerCase()] = source[key]
  return out
}

/** Compile every schema in the spec once. Throws if ata rejects a schema (pass `options.strictSchema` for authoring checks). */
export function compileSpec(spec: RouteSpec): CompiledSpec {
  const request = new Map<RequestPart, Validator<any>>()
  for (const part of REQUEST_PARTS) {
    const input = spec.request?.[part]
    if (!input) continue
    const options: ValidatorOptions = { ...(COERCE_BY_DEFAULT.has(part) ? { coerceTypes: true } : {}), ...spec.options }
    request.set(part, build(input, options, `request.${part}`))
  }

  // useDefaults: false keeps response validation verdict-only: ata would otherwise fill defaults into the payload.
  const response = new Map<number | 'default', Validator<any>>()
  for (const [key, input] of Object.entries(spec.response ?? {})) {
    response.set(key === 'default' ? 'default' : Number(key), build(input, { useDefaults: false }, `response.${key}`))
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
