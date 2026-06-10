---
"@finesoft/front": minor
---

Add typed route params: zero-dependency built-in param primitives (`int`, `str`, `num`, `bool`, `oneOf`, `uuid`) and modifiers (`optional`, `withDefault`) that implement the Standard Schema interface, plus support for any Standard Schema validator (zod/valibot/arktype). The new `route()` helper constrains `params` keys to the path's `:param` names at compile time. `Router.resolve` / `Framework.routeUrl` are now async; param/query validation failure falls through to the existing 404 path. `Intent.params` is widened to `Record<string, unknown>`.
