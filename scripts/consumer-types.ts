// Compiled against the built packages (no path aliases): checks that the published .d.mts files resolve and infer.
import middy from '@middy/core'
import express from 'express'
import { Hono } from 'hono'
import { expectTypeOf } from 'vitest'
import { validate as expressValidate } from '@ata-mw/express'
import { validate as honoValidate } from '@ata-mw/hono'
import { validate as middyValidate } from '@ata-mw/middy'

const name = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } as const

express().post('/x', expressValidate({ request: { body: name }, response: { 200: name } }), (req, res) => {
  expectTypeOf(req.body).toEqualTypeOf<{ readonly name: string }>()
  res.json({ name: req.body.name })
})

new Hono().post('/x', honoValidate({ request: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }), (c) => {
  expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ readonly name: string }>()
  return c.json({ name: c.req.valid('json').name })
})

middy()
  .use(middyValidate({ request: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } }))
  .handler(async (event) => {
    expectTypeOf(event.body).toEqualTypeOf<{ readonly name: string }>()
    return { statusCode: 200, body: JSON.stringify({ name: event.body.name }) }
  })
