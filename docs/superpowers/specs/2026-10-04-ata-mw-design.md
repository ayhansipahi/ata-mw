# ata-mw: design

Date: 2026-10-04
Repo: `ayhansipahi/ata-mw` (public, MIT)

## Goal

Validation middleware for TypeScript web frameworks, built on
[ata-validator](https://github.com/ata-core/ata-validator). One spec, three adapters:
Express, Hono, Middy. Validates the request (body, query, params, headers) and the response.
Validated data reaches the handler with types inferred from the JSON Schema (`Infer<S>`).

Why this exists: ata-core ships `fastify-ata`, `ata-mcp`, `ata-zod`, `ata-valibot`, but nothing
for Express, Hono or Middy. ata runs where `new Function` is blocked (Workers, Deno Deploy,
strict CSP), so the Hono adapter is meant to work on the edge.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Packaging | Monorepo, separate packages: `@ata-mw/core`, `@ata-mw/express`, `@ata-mw/hono`, `@ata-mw/middy` |
| Architecture | Shared core + thin adapters, ata-native (JSON Schema or ata `Validator`). No Standard Schema layer |
| Scope v1 | Request (body, query, params, headers) and response validation |
| Repo | `ayhansipahi/ata-mw`, public, MIT |

## Non-goals (v1)

- Standard Schema inputs (zod, valibot, ...). `ata-zod` and `ata-valibot` cover those.
- Form and multipart bodies. `body` means JSON (or an already-parsed object).
- Middy responses that are not HTTP-shaped (`{ statusCode, body }`).
- Rewriting response payloads (coerce, defaults, `removeAdditional`). Response validation is verdict-only.
- Publish pipeline (changesets, provenance). Added when the user approves a first release.
- Koa, Fastify (already covered by `fastify-ata`), Elysia, others.

## Repo layout

```
ata-mw/
  package.json              private root, "workspaces": ["packages/*"], scripts: build, test, typecheck, test:dist
  tsconfig.json             one config for src and tests; tsconfig.dist.json checks the built types
  scripts/                  edge-smoke.mjs, consumer-types.ts (run against the built packages)
  .github/workflows/ci.yml  typecheck + test + test:dist, Node 22, 24
  LICENSE                   MIT
  README.md                 short: what it is, 3 install lines, 3 examples
  packages/
    core/     @ata-mw/core
    express/  @ata-mw/express
    hono/     @ata-mw/hono
    middy/    @ata-mw/middy
```

Tooling: npm workspaces, TypeScript 6, tsdown (ESM + CJS + d.ts), vitest 5, Node >= 22
(see Amendments).

## Spec shape (shared by all adapters)

```ts
type SchemaInput = JSONSchema | Validator   // ata types; a Validator is detected by its validate() method

interface RouteSpec {
  request?: {
    body?: SchemaInput
    query?: SchemaInput
    params?: SchemaInput
    headers?: SchemaInput        // keys are lowercase; schema property names must be lowercase
  }
  response?: {
    [status: number]: SchemaInput
    default?: SchemaInput
  }
  options?: ValidatorOptions     // ata options for request parts
}
```

Adapters accept `const S extends RouteSpec` so `Infer<S[...]>` flows into handler types.
Each package exports `validate(spec, hooks?)`.

### Core (`@ata-mw/core`)

```ts
compileSpec(spec): CompiledSpec            // throws on an invalid schema (fails at boot)

CompiledSpec.validateRequest(parts): { ok: true, data } | { ok: false, part, errors }
CompiledSpec.validateResponse(status, payload): { ok: true } | { ok: false, errors } | { skipped: true }
```

- Schemas compile once, in `compileSpec`. Nothing compiles per request.
- `ata-validator` is a peer dependency of core. A passed `Validator` is recognised by duck typing,
  never `instanceof`, so two installed copies of ata do not break it.
- Request defaults: `coerceTypes: true` for `query`, `params`, `headers` (they arrive as strings);
  `coerceTypes: false` for `body`. `options` overrides these. A user-supplied `Validator` is used as given.
- Response validators use ata defaults with no coercion, no defaults, no `removeAdditional`.
- `validateResponse` returns `skipped` when there is no schema for the status and no `default`.

## Error behavior

- **Request failure:** HTTP 400, body
  `{ "error": "Bad Request", "part": "body", "errors": [ ...ata errors... ] }`.
  Customizable through the `onError` hook (signature per adapter, see below). First failing part wins
  (order: params, query, headers, body).
- **Response failure:** a server bug, not a client error. The client gets
  `500 { "error": "Internal Server Error" }`. Details go to `onResponseError(info)`; the validation
  details are never sent to the client.
- **Not validated:** response with no matching schema, or a non-JSON response.
- **Invalid schema in the spec:** `validate(spec)` throws at setup time, with whatever error ata's
  constructor throws, prefixed with the schema location (`request.body`, `response.200`). ata only
  rejects authoring mistakes such as unknown keywords when `options.strictSchema: true` is set.
- **Unexpected runtime exceptions:** left to the framework's own path (Express `next(err)`,
  Hono `onError`, Middy `onError`).
- **Malformed JSON body:** 400 with `part: "body"` and a parse error (Hono, Middy string bodies).
  In Express a body parser must run before the middleware. If `request.body` is declared and
  `req.body` is `undefined`, validation fails with 400 (documented in the README).

## Adapters

| | Validated request data | Types | Response capture | Request failure |
|---|---|---|---|---|
| **Express** | Written to `req.body`, `req.query`, `req.params` (coerced, defaults applied). `headers`: validate only, not written | `RequestHandler<P, ResBody, ReqBody, ReqQuery>` generics from `Infer<S>` | `res.json` is wrapped; status and payload are validated when it is called | `res.status(400).json(...)` |
| **Hono** | `c.req.valid('json' \| 'query' \| 'param' \| 'header')` (Hono's own idiom) | `MiddlewareHandler<E, P, Input>`; `c.req.valid(...)` is typed | After `await next()`: `c.res.clone().json()` is validated; on failure `c.res` is replaced by a 500 | `return c.json(..., 400)` |
| **Middy** | Written to `event.body`, `queryStringParameters`, `pathParameters`. A string body is parsed first (replaces `http-json-body-parser`) | `ValidatedEvent<typeof spec>` helper type | `after` hook: `request.response.body` is parsed and validated (HTTP-shaped responses only) | `before` throws a private `RequestRejected`; this middleware's `onError` assigns the 400 to `request.response`, so other middleware's `onError` hooks (CORS) still run |

Hook signatures (`onError`, `onResponseError`): Express `(failure, req, res, next)`, Hono `(failure, c)`,
Middy `(failure, request)`.

Query handling: Express and Middy pass the framework's query object through. Hono follows
`hono/validator`: a key with a single value is a scalar, repeated keys become arrays.

## Dependencies

- `@ata-mw/core`: peer `ata-validator >= 1.42`.
- `@ata-mw/express`, `@ata-mw/hono`, `@ata-mw/middy`: dependency `@ata-mw/core`; peers
  `ata-validator >= 1.42` (so npm keeps one copy), `express >= 4`, `hono >= 4`, `@middy/core >= 5`.
  The Middy adapter imports types only from `@middy/core`.

## Testing

- **core:** vitest unit tests. Spec compile errors, coerce defaults per part, error shape,
  response status matching (exact, `default`, skipped).
- **Per adapter:** integration against the real framework. Express through Node `http`,
  Hono through `app.request()`, Middy by invoking the wrapped handler.
- **Types:** `expectTypeOf` assertions inside the test files, checked by `tsc --noEmit`. Asserts
  `Infer<S>` reaches the handler in all three adapters. `consumer-types.ts` repeats this against
  the built `.d.mts` files.
- **Matrix:** Express 4 and 5; Node 22 and 24 (see Amendments).
- **Edge claim:** `scripts/edge-smoke.mjs` runs the built Hono adapter under
  `node --disallow-code-generation-from-strings`, and loads every built package as ESM and CJS.
- Every behavior in the Error section has at least one test.

## Amendments (2026-10-05, found while writing the plan)

Every assumption in the original "Things the plan must verify" list was run in a scratch copy
before the plan was written.

| # | Spec said | Now | Why |
|---|---|---|---|
| 1 | Node >= 20, CI on Node 20, 22, 24 | `engines.node >=22`, CI on Node 22 and 24 | vitest 5 needs Node >= 22.12, tsdown 0.23 needs >= 22.18, Middy 7 needs >= 22. Node 20 reached end of life on 2026-04-30 |
| 2 | pnpm workspaces | npm workspaces | pnpm is not installed here; npm 11 workspaces cover the need with one tool fewer |
| 3 | Request body is parsed by the adapter | A body that is not valid JSON travels as `MalformedBody` and is reported as the `body` failure only after `params`, `query` and `headers` pass | Keeps the documented "first failing part wins" order true for malformed bodies too |
| 4 | `validateResponse` returns `{ ok }` or `{ skipped }` | Returns `{ ok: true, skipped: boolean }` or `{ ok: false, errors }` | One discriminant (`ok`) for adapters |
| 5 | Middy `validate` returns a middleware | Returns `MiddlewareObj<ValidatedEvent<S>>`, so `middy().use(validate(spec)).handler(event => ...)` types `event` without an annotation. A bad response is written to `request.response` in `after`, never returned | Returning from an `after` hook stops the `after` hooks of other middleware |
| 6 | Express `ResBody` from `Infer<S>` | `res.json` is typed as the union of all declared response schemas. A handler that sends an error body for an undeclared status must declare a `default` schema or cast | Makes compile-time checking of responses real. Documented in the Express README |
| 7 | Response validators use ata defaults | Response validators use `useDefaults: false` and the success path uses `isValidObject` | ata's `validate()` mutates its input and fills defaults; response payloads must stay untouched |
| 8 | One tsconfig, tests typed by `tsc`, dist checks in `scripts/` | see the layout and Testing sections | Fewer files; the same guarantees, checked on the built output too |
| 9 | Middy 400 is returned from `before` | The 400 travels Middy's error path (see Adapters). Returning from `before` skips every other middleware's `onError` and `after` hook, so a CORS middleware never decorated the 400. Found in the final review | Documented: register `validate` after such middleware, because `onError` hooks run in reverse order |
| 10 | Response validators use ata defaults | Response validators receive the spec's `options` (formats, keywords, `schemas`, `strictSchema`) with `coerceTypes`, `useDefaults` and `removeAdditional` forced off | Final review: `strictSchema` and custom formats never reached response schemas |
| 11 | Middy body is a JSON string | A base64 body (`isBase64Encoded`) is decoded first | REST APIs with binary media types send JSON bodies base64-encoded |

Results of the six assumptions:

1. Express 5 `req.query` shadowing with `Object.defineProperty` works on Express 4 and 5. Confirmed.
2. Middy: a value returned from `before` skips the handler and all `after` hooks; a value returned
   from `after` stops the remaining `after` hooks. Confirmed in `@middy/core` 7.9.2 source.
3. Hono `c.res.clone().json()` works; `c.res = c.json(..., 500)` replaces the response and keeps the
   other headers (except `content-type`). Confirmed.
4. Chained Express handlers: `req.body`, `req.query`, `req.params` and `res.json` are typed from the
   middleware in the next inline handler. Confirmed with type tests.
5. tsdown 0.23 builds ESM and CJS with `.d.mts` and `.d.cts`, and externalizes dependencies. Confirmed.
6. ata `validate()` mutates its input in place (coercion, defaults) and returns the same object;
   `validateJSON()` does not return the parsed value, `validateAndParse()` does. Confirmed. Failed
   validation can leave the input partly coerced, which is harmless because the request is rejected.
