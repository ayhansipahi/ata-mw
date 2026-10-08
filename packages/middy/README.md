# @ata-mw/middy

Middy middleware that validates API Gateway requests and responses with [ata-validator](https://github.com/ata-core/ata-validator). `@middy/core` 5 or later.

```bash
npm install @ata-mw/middy
```

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
      response: {
        200: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id', 'name'] },
      },
    }),
  )
  .handler(async (event) => {
    // event.pathParameters.id is a number, event.body.name a string
    return { statusCode: 200, body: JSON.stringify({ id: event.pathParameters.id, name: event.body.name }) }
  })
```

- `event.body` (a JSON string is parsed, base64 is decoded first), `event.queryStringParameters` and `event.pathParameters` are replaced with the validated, coerced values, so `http-json-body-parser` is not needed. API Gateway sends `null` for absent parameters; that counts as `{}`. `event.headers` is validated (names lowercased) but not rewritten.
- Only HTTP-shaped responses (`{ statusCode, body }`) are validated, and only when `body` is JSON. Base64 and non-HTTP results pass through. Responses built in an `onError` hook, the 400 included, are not validated.
- A request that fails validation takes Middy's error path, so the `onError` hooks of other middleware (for example `@middy/http-cors`) still run on the 400. Those hooks run in reverse order of registration: register `validate` after them, as in `.use(httpCors()).use(validate(spec))`.
- A response that breaks its schema is replaced by a generic 500 in the `after` hook. Headers are kept and the `after` hooks of other middleware still run.
- Without `.use` inference, annotate the handler with `ValidatedEvent<typeof spec, YourEventType>`.
- Hooks: `validate(spec, { onError(failure, request) { return { statusCode: 422, body: '...' } }, onResponseError(failure, request) {} })`.

The spec, the error format and the limits are described in the [ata-mw README](https://github.com/ayhansipahi/ata-mw#readme).
