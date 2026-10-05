# @ata-mw/core

The engine behind [`@ata-mw/express`](https://github.com/ayhansipahi/ata-mw/tree/main/packages/express), [`@ata-mw/hono`](https://github.com/ayhansipahi/ata-mw/tree/main/packages/hono) and [`@ata-mw/middy`](https://github.com/ayhansipahi/ata-mw/tree/main/packages/middy). Use it to write an adapter for another framework.

```bash
npm install @ata-mw/core ata-validator
```

```ts
import { compileSpec, badRequestBody, internalErrorBody, parseJson, MalformedBody } from '@ata-mw/core'

// Compile once, at setup. Throws if ata rejects a schema or a response key is not a status code or "default".
const compiled = compileSpec({
  request: { query: { type: 'object', properties: { page: { type: 'integer' } }, required: ['page'] } },
  response: { 200: { type: 'object', required: ['items'] } },
})

// Per request: pass the raw parts, get validated and coerced data back.
const result = compiled.validateRequest({ query: { page: '2' } })
if (result.ok) result.data.query // { page: 2 }
else badRequestBody({ part: result.part, errors: result.errors }) // { error: 'Bad Request', part, errors }

// Per response: `{ ok: true, skipped: true }` when no schema matches the status and there is no `default`.
compiled.validateResponse(200, { items: [] }) // { ok: true, skipped: false }
```

- Parts are validated in the order `params`, `query`, `headers`, `body`; the first failure wins. Header names are lowercased first. A missing `params`, `query` or `headers` counts as `{}`.
- A body that is not valid JSON: `parseJson(text)` returns ata's parse error. Put `new MalformedBody(errors)` in `parts.body` and `validateRequest` reports it as the `body` failure, in order.
- `internalErrorBody` is the generic 500 body. Response validation never rewrites the payload.

The spec shape, the defaults and the error format are described in the [ata-mw README](https://github.com/ayhansipahi/ata-mw#readme).
