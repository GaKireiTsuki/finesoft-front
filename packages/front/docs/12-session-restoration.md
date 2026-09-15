# Session restoration and multiple instances

Session restoration is optional. Enable it with a stable per-instance persistence key and application providers; no handwritten internal scopes or entry IDs are needed.

## Two instances / 双实例

```ts
import { startBrowserApp } from "@finesoft/front/browser";
import { createReactRenderer } from "@finesoft/front/renderers/react/browser";
import { app } from "./app-definition";
import { views } from "./views";
const mount = (target: HTMLElement, persistenceKey: string) =>
    startBrowserApp({
        app,
        target,
        history: "memory",
        persistenceKey,
        session: {},
        renderer: createReactRenderer(views),
    });
const first = await mount(document.getElementById("first")!, "first");
const second = await mount(document.getElementById("second")!, "second");
await first.dispose();
await second.navigate("/");
await second.dispose();
```

Async storage reports failed/unavailable results; it does not silently claim a save. Providers own independent slices with versions and migration/discard decisions. Hydration completes before restoration. A removed entry loses its navigation-scoped state; unrelated business slices survive. Disposal finishes already registered pending writes, without promising an unconditional final save. Call the session handle’s save explicitly when the business workflow requires one. Only one instance can own the address bar; embedded instances use memory history.
