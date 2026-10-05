# @ata-mw/hono

Hono middleware that validates the request and the response with [ata-validator](https://github.com/ata-core/ata-validator). ata falls back to its interpreted engine where `new Function` is refused, and this adapter's CI run uses `node --disallow-code-generation-from-strings` to prove it.

```bash
npm install @ata-mw/hono ata-validator
```

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
    response: {
      200: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] },
    },
  }),
  (c) => {
    const { id } = c.req.valid('param') // number
    const { name } = c.req.valid('json') // string
    return c.json({ id, name })
  },
)
```

- Validated data is read with `c.req.valid('json' | 'query' | 'param' | 'header')`, like `hono/validator`. The handler can still call `c.req.json()`.
- A query key sent once is a scalar, a repeated key is an array.
- The response is checked after the handler: a JSON response that breaks its schema is replaced by a generic 500 and the other headers are kept. Non-JSON and empty responses are not validated.
- A `default` response schema also checks the JSON your `app.onError` handler sends: a body that does not conform becomes the generic 500. Leave `default` out, or make it match your error format.
- Hooks: `validate(spec, { onError(failure, c) { return c.json(...) }, onResponseError(failure, c) {} })`.

The spec, the error format and the limits are described in the [ata-mw README](https://github.com/ayhansipahi/ata-mw#readme).
