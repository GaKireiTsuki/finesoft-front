# Event recording

Portable operations emit structured events through their execution context; the runtime accepts a recorder.

## Recorder / 记录器

```ts
import { ConsoleEventRecorder, createRuntime } from "@finesoft/front";
const runtime = createRuntime({ app, recorder: new ConsoleEventRecorder() });
// In a handler: context.record("cart.updated", { itemCount: 3 });
```

Record business outcomes without copying credentials, raw request bodies or private page data. Recorder failures are isolated from execution. Browser impressions require the explicit browser observer; portable core only defines the event contract.
