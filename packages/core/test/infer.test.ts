import { Validator } from 'ata-validator'
import { describe, expectTypeOf, it } from 'vitest'
import type { InferSchema, PartOf, ResponseOf, RouteSpec } from '../src'

const body = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } as const
const query = { type: 'object', properties: { page: { type: 'integer' } } } as const

function spec<const S extends RouteSpec>(s: S): S {
  return s
}

describe('type inference', () => {
  it('infers a schema literal', () => {
    expectTypeOf<InferSchema<typeof body>>().toEqualTypeOf<{ readonly name: string }>()
  })

  it('infers a Validator', () => {
    const v = new Validator(body)
    expectTypeOf<InferSchema<typeof v>>().toEqualTypeOf<{ readonly name: string }>()
  })

  it('reads declared parts and falls back for undeclared ones', () => {
    const s = spec({ request: { body, query }, response: { 200: body, 404: query } })
    expectTypeOf<PartOf<typeof s, 'body'>>().toEqualTypeOf<{ readonly name: string }>()
    expectTypeOf<PartOf<typeof s, 'query'>>().toEqualTypeOf<{ readonly page?: number }>()
    expectTypeOf<PartOf<typeof s, 'params', 'none'>>().toEqualTypeOf<'none'>()
    expectTypeOf<ResponseOf<typeof s>>().toEqualTypeOf<{ readonly name: string } | { readonly page?: number }>()
    const empty = spec({})
    expectTypeOf<ResponseOf<typeof empty, 'none'>>().toEqualTypeOf<'none'>()
  })
})
