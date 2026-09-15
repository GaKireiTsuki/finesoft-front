# Observability

Use a runtime recorder for portable structured events. Web logging configuration belongs to app.frameworkConfig; do not create another framework instance solely to register diagnostics. ReportingLoggerFactory can forward warnings/errors through an application callback. Do not include private inputs, credentials or arbitrary upstream errors in public diagnostics. Browser impression observation is selected from the browser entry.

```ts
import { ConsoleEventRecorder, createRuntime } from "@finesoft/front";
const runtime = createRuntime({ app, recorder: new ConsoleEventRecorder() });
// In an operation: context.record("checkout.completed", { itemCount: 2 });
// In defineWebApp: frameworkConfig: { eventRecorder: recorder, reportCallback }
```
