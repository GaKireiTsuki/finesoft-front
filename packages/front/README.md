# @finesoft/front

Portable operations, Web navigation, browser/SSR rendering, HTTP, Node/Worker hosts and Vite tooling through one public entry. React, Vue and Svelte use optional native Outlet bindings.

```bash
vp dlx @finesoft/create-app my-app
```

[English guide](./docs/README.md) · [简体中文](./docs/zh/README.md)

Import every framework API from `@finesoft/front`. Select native bindings with `Outlet("react" | "vue" | "svelte")` and `useSnapshot(renderer, app)`. Applications own their native mount and SSR render. The Vite plugin maintains a project-specific type entry so only the selected peers are needed. For standalone TypeScript tooling, run `vp exec finesoft-types` first.

MIT
