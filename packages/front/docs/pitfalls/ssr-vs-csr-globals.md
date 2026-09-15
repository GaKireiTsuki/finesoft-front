# Environment boundaries

Import portable operations from the root; browser DOM, Node capabilities and Vite tooling are explicit entries.

## Boundaries / 边界

```ts
import { defineOperation } from "@finesoft/front";
// Browser entry: @finesoft/front/browser
// Node host entry: @finesoft/front/node
// Worker host entry: @finesoft/front/worker
// Build config only: @finesoft/front/vite
```

Do not read window/document/storage at module evaluation in shared application declarations. UI bindings select only the chosen framework. Node DNS and filesystem code must remain out of browser/Worker graphs. Test the built installed package in its actual runtime; source alias imports can hide missing artifacts.
