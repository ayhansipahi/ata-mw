import { describe, expect, it } from 'vitest'
import { badRequestBody, internalErrorBody, parseJson } from '../src'

describe('parseJson', () => {
  it('parses valid JSON, scalars and null included', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJson('null')).toEqual({ ok: true, value: null })
    expect(parseJson('"s"')).toEqual({ ok: true, value: 's' })
  })

  it('returns ata parse errors for malformed and empty text', () => {
    for (const text of ['{oops', '']) {
      const result = parseJson(text)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors[0]).toMatchObject({ code: 'ATA9001', keyword: '__parse__' })
    }
  })
})

describe('default bodies', () => {
  it('shapes the 400 body', () => {
    const errors = [{ keyword: 'type', instancePath: '/n', schemaPath: '#/type', params: {}, message: 'must be integer' }]
    expect(badRequestBody({ part: 'query', errors })).toEqual({ error: 'Bad Request', part: 'query', errors })
  })

  it('keeps the 500 body free of details', () => {
    expect(internalErrorBody).toEqual({ error: 'Internal Server Error' })
  })
})
