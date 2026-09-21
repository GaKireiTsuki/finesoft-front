# Environment boundaries

All APIs import from `@finesoft/front`; each API still requires its appropriate runtime. The package and compiler select internal implementations without loading unused UI or platform peers.

## Boundaries / 边界

```ts
import { defineOperation } from "@finesoft/front";
// createBrowserApp: browser
// startNodeHandler: Node
// createHttpHandler: Request/Response host (Node or Worker)
// finesoftFrontViteConfig: build configuration
```

Do not read window/document/storage at module evaluation in shared application declarations. UI bindings select only the chosen framework. Node DNS and filesystem code must remain out of browser/Worker graphs. Test the built installed package in its actual runtime; source alias imports can hide missing artifacts.
