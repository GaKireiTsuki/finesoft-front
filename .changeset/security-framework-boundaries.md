---
"@finesoft/front": patch
"@finesoft/create-app": patch
---

Fix framework security boundaries for server-controller source isolation, initial navigation disclosure, proxy authentication ordering, query cache tenant isolation, prerender path containment and protected outbound requests. Preserve the complete HTTP client safety configuration in generated applications.

Setup now runs before proxy routes and preview fails if configured setup cannot load. Invocations with bindings or a custom fetch use execution-local query caching unless an explicit `cache.partition` covers the complete security scope. Cloudflare protected hostname requests require configured `trustedOrigins` or an effective DNS policy. Initial partial failures and external redirect handoffs no longer expose successful sibling pages; unsupported server-controller factory forms fail the client build.
