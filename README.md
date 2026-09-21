# @finesoft/front

Portable TypeScript application execution, Web navigation, independent data endpoints and explicit browser/Node/Worker hosts. Standard renderer adapters support React, Vue and Svelte.

## Start an application

```bash
vp dlx @finesoft/create-app my-app
cd my-app
vp install
vp run dev
```

The CLI copies a complete template with shared application declarations, native view bindings and ordinary browser/SSR startup. Choose the UI peers for that template.

Full provides product/search/guard examples; minimal provides Feed/detail/Notes with navigation and session restoration. Each tier has the same contracts and behavior in React, Vue and Svelte. See the [template structure](packages/front/docs/engineering/project-structure.md) / [模板约定](packages/front/docs/zh/engineering/project-structure.md).

## Public API

Every framework API imports from `@finesoft/front`: controllers, routes, Actions, contexts, native UI, browser/SSR startup, HTTP, Node/Worker hosts and Vite configuration. Use `Outlet("react" | "vue" | "svelte")` and `useSnapshot(renderer, app)` for native bindings. Internal platform modules remain isolated; the plugin maintains project-specific declarations for the selected optional peers.

```ts
import { definePage, defineWebApp, markPublic } from "@finesoft/front";
const home = definePage({
    id: "load-home",
    routes: ["/"],
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
export const app = defineWebApp({
    id: "example",
    pages: [home],
    getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
});
```

See the [getting started guide](packages/front/docs/01-getting-started.md), [中文指南](packages/front/docs/zh/01-getting-started.md), [architecture evaluation](docs/architecture.md) and [acceptance report](docs/application-boundaries-acceptance.md).

## Workspaces and validation

Private `core` owns portable execution; `web` owns page/navigation contracts; `browser` and `ssr` own rendering hosts; `server` owns HTTP/platform/build adapters. Published `front` bundles these owners into ESM entries. `create-app` publishes the scaffolder; site, templates and adversarial fixtures stay private.

```bash
vp install
vp check
vp test --coverage
vp run -r build
vp exec node scripts/verify-publish-transforms.mjs
vp exec node scripts/verify-runtime-boundaries.mjs
```

`vp pack` builds a library. `vp pm pack` creates a local tarball; prepare/postpack restore the development manifest symmetrically. Runtime packages configure builds in `vite.config.ts`. Local verification does not publish or deploy.

MIT
