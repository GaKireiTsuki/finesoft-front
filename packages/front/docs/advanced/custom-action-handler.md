# Application actions

`createBrowserApp` owns one `ActionDispatcher`. Native pages call `app.perform(action)`; FlowAction uses the same guarded navigation as `app.navigation.navigate(url)`. Ordinary URL navigation pushes into the active stack and retains other branches. Initial URLs and explicit encoded navigation snapshots can still restore a complete tree.

## Business confirmation / 业务确认

```ts
async function openAfterConfirmation() {
    if (window.confirm("Open this page?")) await app.navigation.navigate("/items");
}
```

Keep business commands in portable operations and use the browser for interaction. `app.actionDispatcher` on the browser handle exposes the existing `onAction` and `removeAction` registration methods; do not install a second FlowAction executor. ExternalUrlAction opens a new window with `noopener,noreferrer`. CompoundAction executes its children in order. A FlowAction with `entryId` reuses that retained entry.

Browser navigation and guard redirects accept HTTP(S). ExternalUrlAction also accepts `mailto:` and `tel:`. Invalid URLs and executable or unsupported protocols are rejected before browser handoff; applications requiring a custom protocol can explicitly replace that action handler.

## Modal presentation / 模态展示

Pass `onModal(page, { app, snapshot })` to `createBrowserApp`, then call:

```ts
import { makeFlowAction } from "@finesoft/front/web";

await app.perform(makeFlowAction("/items/42", "modal"));
```

The host runs navigation policies and page guards before invoking `onModal` once. The callback renders the modal with the application's native UI; the background navigation and history remain unchanged. A denial supplies the error page and a sanitized snapshot, never the rejected page data. Internal redirects remain modal, and external redirects hand off to the destination without delivering a modal. Register `onModal` before using modal actions. SSR views cannot perform browser actions.
