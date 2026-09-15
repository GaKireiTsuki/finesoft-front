# Application structure

Keep cross-environment declarations separate from native view bindings and platform entry modules.

## Files / 文件

```text
src/app-definition.ts  # pages, routes, policies, optional navigation
src/views.ts           # selected UI imports and explicit pageType bindings
src/main.tsx           # standard browser start
src/ssr.tsx            # selected standard SSR renderer
src/data-app.ts        # optional independent data operations/endpoints
src/node.ts            # optional Node host
src/worker.ts          # optional Worker host
```

App components, controllers, stores and view registries remain business code. Moving declarations from startup into app-definition does not remove their authoring cost. Optional modules group static definitions; they do not create runtime plugin discovery or a second execution engine.
