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
  package.json              private root, scripts: build, test, typecheck
  pnpm-workspace.yaml
  tsconfig.base.json
  .github/workflows/ci.yml  typecheck + test + build, Node 20, 22, 24
  LICENSE                   MIT
  README.md                 short: what it is, 3 install lines, 3 examples
  packages/
    core/     @ata-mw/core
    express/  @ata-mw/express
    hono/     @ata-mw/hono
    middy/    @ata-mw/middy
```

Tooling defaults (changeable in the plan): pnpm workspaces, TypeScript, tsdown (ESM + CJS + d.ts),
vitest, Node >= 20 (same floor as ata-validator).

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
- **Invalid schema in the spec:** `validate(spec)` throws at setup time.
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
| **Middy** | Written to `event.body`, `queryStringParameters`, `pathParameters`. A string body is parsed first (replaces `http-json-body-parser`) | `ValidatedEvent<typeof spec>` helper type | `after` hook: `request.response.body` is parsed and validated (HTTP-shaped responses only) | `before` returns a response (early exit) |

Hook signatures (`onError`, `onResponseError`): Express `(failure, req, res, next)`, Hono `(failure, c)`,
Middy `(failure, request)`.

Query handling: Express and Middy pass the framework's query object through. Hono follows
`hono/validator`: a key with a single value is a scalar, repeated keys become arrays.

## Dependencies

- `@ata-mw/core`: peer `ata-validator >= 1.42`.
- `@ata-mw/express`, `@ata-mw/hono`, `@ata-mw/middy`: dependency `@ata-mw/core`;
  peers `express >= 4`, `hono >= 4`, `@middy/core >= 5`.

## Testing

- **core:** vitest unit tests. Spec compile errors, coerce defaults per part, error shape,
  response status matching (exact, `default`, skipped).
- **Per adapter:** integration against the real framework. Express through Node `http`,
  Hono through `app.request()`, Middy by invoking the wrapped handler.
- **Types:** vitest typecheck. Asserts `Infer<S>` reaches the handler in all three adapters.
- **Matrix:** Express 4 and 5; Node 20, 22, 24.
- **Edge claim:** the Hono adapter test also runs under
  `node --disallow-code-generation-from-strings`.
- Every behavior in the Error section has at least one test.

## Things the plan must verify (stated as assumptions here, not facts)

1. Express 5 `req.query` is a prototype getter; shadowing it with an own property through
   `Object.defineProperty` works on both Express 4 and 5.
2. Middy early-response semantics: what a `before` return skips and whether `after` still runs.
3. Hono `c.res.clone().json()` cost and correct handling of non-JSON and empty bodies.
4. Typing of chained Express handlers: `RequestHandler` generics infer correctly from the
   validate middleware into a following inline handler.
5. tsdown is current and fits a pnpm monorepo of four packages; fall back to tsup if not.
6. Whether ata `validate()` returns coerced data without mutating the input (`test_no_input_mutation`
   in ata suggests yes).
