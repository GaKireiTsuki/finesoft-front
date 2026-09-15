# Custom deployment adapters

A build adapter implements Adapter from the Vite entry. Its job is to emit deployment files and bind platform Request/Response and cleanup capabilities. Runtime SSR uses createSSRHandler/createSSRHost from the SSR entry. Keep one shared response assembler; custom generators must preserve request context, status, headers, cookies, locale and redirects. The internal buildBundle/generateSSREntry helpers are private implementation, not exported public APIs. The repository’s Node/Cloudflare/Netlify/Vercel adapters are reference implementations; validate emitted code in the target runtime before claiming support.

```ts
import type { Adapter, AdapterContext } from "@finesoft/front/vite";
// Supply { name, async build(context: AdapterContext) { ... } } as the Vite adapter.
// Runtime module:
import { createSSRHost } from "@finesoft/front/ssr";
```
