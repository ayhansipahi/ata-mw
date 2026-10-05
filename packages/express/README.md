# @ata-mw/express

Express middleware that validates the request and the response with [ata-validator](https://github.com/ata-core/ata-validator). Works on Express 4 and 5.

```bash
npm install @ata-mw/express ata-validator
```

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
    // req.params.id is a number, req.body.name a string; res.json is checked against the schema
    res.json({ id: req.params.id, name: req.body.name })
  },
)
```

- Mount `express.json()` (or another body parser) before a route that declares `request.body`. Without one `req.body` is `undefined` and the body schema fails with a 400.
- Validated, coerced values are written to `req.params`, `req.query` and `req.body`. `req.headers` is validated but not rewritten.
- `res.json(...)` is typed as the union of the declared response schemas. To send an error body for a status you did not declare, add a `default` response schema or cast.
- Hooks: `validate(spec, { onError(failure, req, res, next) {}, onResponseError(failure, req, res) {} })`. `onError` replaces the 400. `onResponseError` is for logging; the client always gets the generic 500.

The spec, the error format and the limits are described in the [ata-mw README](https://github.com/ayhansipahi/ata-mw#readme).
