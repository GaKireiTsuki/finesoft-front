# @finesoft/front

Full-stack TypeScript framework — router, DI, actions, SSR, and server — all in one package.

## Packages

```
core ← browser       (client runtime)
core ← ssr ← server  (server runtime, Hono-based)
front                 (published aggregation bundle)
```

| Package     | Purpose                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| **core**    | Router, DI container, action/intent dispatchers, middleware pipeline, data mappers, logging         |
| **browser** | Browser bootstrap, action handlers, history management, SSR data hydration                          |
| **ssr**     | Server-side rendering, HTML injection, prefetched intent serialization                              |
| **server**  | Hono integration, multi-platform adapters (Node, Vercel, Netlify, Cloudflare), Vite plugin          |
| **front**   | Published package — bundles all internal packages with two entry points (full-stack + browser-only) |

## Getting Started

```bash
vp install            # Install dependencies
vp dev                # Start development server
```

## Development

```bash
vp check              # Format + lint + type-check
vp test               # Run tests
vp run build -r       # Build all packages in dependency order
vp ready              # fmt + lint + build (full validation)
```

## Release

```bash
changeset             # Create a changeset
vp run build -r && changeset publish --access public
```

## License

MIT
