# Application actions

Standard browser start owns FlowAction navigation. Application-specific confirmations can call the existing handle after the user approves.

## Business confirmation / 业务确认

```ts
async function openAfterConfirmation() {
    if (window.confirm("Open this page?")) await handle.navigate("/items");
}
```

Keep business commands in portable operations and use the browser for interaction. Do not register a second FlowAction executor. A custom ActionDispatcher handler is an advanced application concern; the framework does not expose an ActionRegistry module-augmentation protocol. Modal rendering is supplied with `onModal(page, context)` and receives the matching candidate snapshot exactly once after guarded completion.
