# Application actions

The WebSession is the ActionDispatcher and navigation state owner. Native views, intercepted links and custom handlers share `app.perform(action)`. Actions cover both URL navigation and structured Stack, Tab and Split changes; there is no separate navigation command object.

`FlowAction` loads a URL. Without an explicit navigation tree or codec, the departing page is released; structured apps retain their existing branches. Navigating to the current URL reloads its existing entry. An explicit `push` creates a new entry, including for an equal target.

`perform` resolves after guards, data loading, commit and native acknowledgement. It returns the resulting navigation snapshot; a rejected tree action returns an uncommitted snapshot with `rejection`. Compound actions execute in order and stop on rejection or failure. An optional second argument `{ signal }` reaches guarded page loading.

`app.onAction(kind, handler)` and `app.removeAction(kind)` register or explicitly replace handlers on the same executor. Keep business data operations on `app.runtime.execute`. ExternalUrlAction opens a new window with `noopener,noreferrer`; `{ kind: "reuseEntry", entryId }` reveals a retained instance without requiring a second URL.

A handler receives `(action, invocation)`. When it delegates to another action, pass the same invocation to `app.perform(nextAction, invocation)` so the entire sequence shares cancellation. New URL navigation cancels earlier groups; structured edits remain serialized and invalidate an older URL still resolving. Modal and external actions do not replace background navigation.

Browser navigation and guard redirects accept HTTP(S). ExternalUrlAction also accepts `mailto:` and `tel:`. Invalid URLs and executable or unsupported protocols are rejected before browser handoff; applications requiring a custom protocol can explicitly replace that action handler.

## URL and structured actions

```ts
await app.perform({ kind: "flow", url: "/items/42" });
await app.perform({ kind: "push", intent: "item", params: { id: 42 } });
await app.perform({ kind: "selectTab", key: "favorites" });
await app.perform({ kind: "pop" });
await app.perform({ kind: "refresh" });
```

## Migrating existing consumers

| Previous API                                         | Replacement                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `app.navigation.navigate(url)`                       | `app.perform({ kind: "flow", url })`                                                                             |
| `app.navigation.push(intent, params)`                | `app.perform({ kind: "push", intent, params })`                                                                  |
| `controller.apply(operation)`                        | `controller.perform(action)` with the same structured fields                                                     |
| `controller.resolve()` at startup                    | `controller.start()`                                                                                             |
| `app.actionDispatcher.onAction/removeAction`         | `app.onAction/removeAction`                                                                                      |
| `FlowAction.entryId`                                 | `{ kind: "reuseEntry", entryId }`                                                                                |
| `NavigationHandle`, `SessionHandle`, `SessionAccess` | `NavigationBridge` for cleanup; `SessionStore` for persistence; `BrowserSession.restoreFromUrl` for browser boot |

The old navigation commands and forwarding methods are removed. All other tree operations use the corresponding Action kind. Pure tree-building functions remain available for immutable composition.

## Modal presentation

Pass `onModal(page, { app, snapshot })` to `createBrowserApp`, then call:

```ts
import { makeFlowAction } from "@finesoft/front/web";
await app.perform(makeFlowAction("/items/42", "modal"));
```

The host runs navigation policies and page guards before invoking `onModal` once. The callback renders the modal with the application's native UI; background navigation and history remain unchanged. A denial supplies an error page and sanitized snapshot, never rejected page data. Internal redirects remain modal, and external redirects hand off without delivering a modal. Register `onModal` before using modal actions. SSR views cannot perform browser actions.
