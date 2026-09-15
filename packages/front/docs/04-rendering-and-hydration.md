# Rendering and hydration

Rendering has two independent choices: SSR/CSR/prerender controls when HTML is produced; root/entries controls native view ownership. Standard adapters share the same application definition.

## SSR / 服务端

```ts
import { createReactSSRRender } from "@finesoft/front/renderers/react/server";
import { app } from "./app-definition";
import { views } from "./views";
export const render = createReactSSRRender({ app, renderer: views });
export { serializeServerData } from "@finesoft/front/ssr";
```

## Browser / 浏览器

```ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createReactRenderer } from "@finesoft/front/renderers/react/browser";
import { app } from "./app-definition";
import { views } from "./views";
export const handle = await startBrowserApp({
    app,
    target: document.getElementById("app")!,
    renderer: createReactRenderer(views),
});
// When the owning application removes this instance:
// await handle.dispose();
```

`root` renders one application view. `entries` retains separate native views for navigation entries and can mount application chrome. Same EntryId plus pageType updates the existing view and preserves its draft; a new entry or view type remounts it. SSR hydrates before session restoration. CSR returns a shell. Prerender produces static artifacts; eligible runtime HTML reuse still executes current page/guard checks and rendering before reuse, so it is not a render-skipping guarantee. Public data is projected before request disposal; nested fields require explicit projection. Wire protocol/buildId mismatches cause fresh loading independently of session schema versions.
