# ata-mw

Validation middleware for **Express**, **Hono** and **Middy**, built on [ata-validator](https://github.com/ata-core/ata-validator). One spec describes the request and the response. Handlers get validated, coerced data with types inferred from the JSON Schema.

| Package | For |
|---|---|
| [`@ata-mw/express`](packages/express) | Express 4 and 5 |
| [`@ata-mw/hono`](packages/hono) | Hono 4, including runtimes where code generation is blocked |
| [`@ata-mw/middy`](packages/middy) | Middy 5 and later, API Gateway events |
| [`@ata-mw/core`](packages/core) | The shared engine. Use it to write another adapter |

## Install

```bash
npm install @ata-mw/express ata-validator
```

Use `@ata-mw/hono` or `@ata-mw/middy` instead of `express` for those frameworks. `ata-validator >= 1.42` is a peer dependency. Node 22 or later.

## The spec

Every adapter takes the same spec:

```ts
validate({
  request: {
    params: schema, // every part is optional
    query: schema,
    headers: schema, // names are lowercased: write schema properties in lowercase
    body: schema, // JSON
  },
  response: {
    200: schema, // by status code
    default: schema, // any other status
  },
  options: {}, // ata-validator options for the request parts
})
```

A schema is a JSON Schema object, or a `Validator` from `ata-validator` that you built yourself. Schemas compile once, when the middleware is created. A schema ata rejects throws there, not on the first request, and so does a `response` key that is neither a status code (100 to 599) nor `default`. Pass `options: { strictSchema: true }` to also catch unknown keywords.

`query`, `params` and `headers` coerce types by default (`?page=2` becomes `2`). `body` does not. Set `options.coerceTypes` to change it for every part.

A query key sent once is a string, and coercion does not wrap it into an array, so `{ type: 'array' }` rejects `?tag=a`. Accept both with `anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }]`.

## Errors

A request that fails validation gets a `400`:

```json
{
  "error": "Bad Request",
  "part": "query",
  "errors": [{ "code": "ATA1001", "path": "/page", "message": "must be integer" }]
}
```

The first failing part wins, in the order `params`, `query`, `headers`, `body`. A body that is not valid JSON is reported as the `body` failure. Replace the response with the `onError` hook.

`errors[].received` echoes the offending value (ata truncates long ones). If a field can hold a secret, such as a password or a token, build the 400 yourself in `onError` and leave `errors` out.

A response that breaks its schema is a bug in your server, not in the client's request. The client gets `500 { "error": "Internal Server Error" }` with no details. The details go to `onResponseError`, which is for logging. A response with no matching schema (and no `default`), a non-JSON response and an empty response are not validated, and a response is never rewritten (no coercion, no defaults).

## Express

```ts
import express from 'express'
import { validate } from '@ata-mw/express'

const app = express()
app.use(express.json())

app.post(
  '/users/:id',
  validate({
    request: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
    response: {
      200: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] },
    },
  }),
  (req, res) => {
    res.json({ id: req.params.id, name: req.body.name }) // typed, and checked against the response schema
  },
)
```

## Hono

```ts
import { Hono } from 'hono'
import { validate } from '@ata-mw/hono'

const app = new Hono()

app.post(
  '/users/:id',
  validate({
    request: {
      params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  }),
  (c) => c.json({ id: c.req.valid('param').id, name: c.req.valid('json').name }),
)
```

## Middy

```ts
import middy from '@middy/core'
import { validate } from '@ata-mw/middy'

export const handler = middy()
  .use(
    validate({
      request: {
        params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    }),
  )
  .handler(async (event) => ({
    statusCode: 200,
    body: JSON.stringify({ id: event.pathParameters.id, name: event.body.name }),
  }))
```

## Limits in this version

- `body` is JSON (or an already parsed object). No form or multipart bodies.
- Middy validates HTTP-shaped responses (`{ statusCode, body }`) only.
- Express types `res.json` as the union of the declared response schemas. Declare a `default` schema for error bodies, or cast.
- Express checks `res.json` and `res.send(object)` only. `res.jsonp`, `res.end`, streams and string bodies are not validated, and once a response schema is declared `res.send('text')` is a type error (use `res.end('text')` or cast).
- A `default` response schema also checks the JSON your error handler sends (Express `app.use((err, ...))`, Hono `app.onError`): a body that does not conform becomes the generic 500. Middy does not validate responses built in an `onError` hook.
- Response validation costs a parse on Hono and Middy (the body is JSON text). Leave `response` out of the spec on routes where that matters.

## Development

```bash
npm install
npm run typecheck
npm test
npm run test:dist   # build, check the built types, run under --disallow-code-generation-from-strings
```

MIT.
