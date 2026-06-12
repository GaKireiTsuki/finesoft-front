---
"@finesoft/front": minor
---

feat(router): typed route params follow-up — array-form key safety, optional-key inference, multi-value query, auto-typed handlers

- `defineRoutes([...])` array-object form now constrains each route's `params` keys to its own `path` literal (compile error on a param-name typo), matching the existing `route()` helper.
- `optional()` / `withDefault()` now render the param as an **optional property** (`page?: T` instead of `page: T | undefined`) in `InferParams` / `InferQuery`.
- New `list(item, { min?, max? })` codec for **multi-value query** (`?tag=a&tag=b` → `T[]`); `Router.resolve` collects all values for keys backed by a `list()` codec.
- New `defineRoute(path, { handler, params, query, fallback? })` — a functional route whose `handler` params are **auto-typed** from the codecs, with no hand-written `InferParams<typeof …>`. Mirrors `BaseController`'s `try/catch → fallback`.

All additive and backward-compatible: routes without `params` / `query` are unchanged.
