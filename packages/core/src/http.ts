import { Validator } from 'ata-validator'
import type { ValidationError } from 'ata-validator'
import type { RequestFailure } from './spec'

/** Default 400 body. */
export const badRequestBody = (failure: RequestFailure) => ({
  error: 'Bad Request' as const,
  part: failure.part,
  errors: failure.errors,
})

/** Default 500 body for a response that broke its schema. Carries no validation details. */
export const internalErrorBody = { error: 'Internal Server Error' } as const

let probe: Validator<unknown> | undefined

/** Parse JSON text. A failure carries ata's own parse error (`ATA9001`). */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false; errors: ValidationError[] } {
  probe ??= new Validator({})
  const result = probe.validateAndParse(text)
  return result.valid ? { ok: true, value: result.value } : { ok: false, errors: result.errors }
}
