# Advanced: custom action handler

The framework ships three action kinds: `flow` (in-app navigation), `external-url` (full browser navigation), and `compound` (a tuple of actions executed in order). For most apps these are enough.

This recipe shows how to add your own — useful when you have a class of operations that need cross-cutting handling (analytics, confirmations, telemetry) without polluting every callsite.

## Use case: confirmation-gated action

We'll add a `"confirm"` action kind: dispatch it with `{ kind: "confirm", message, then }`, and the framework shows a confirmation dialog before dispatching `then` (which is itself an action).

```ts
dispatch({
    kind: "confirm",
    message: "Delete this item permanently?",
    then: { kind: "flow", url: "/items/42/deleted" },
});
```

The user clicks Cancel → no navigation. Clicks OK → the inner flow action fires.

## Step 1: define the action type

```ts
// src/lib/actions/confirm.ts
import { type Action } from "@finesoft/front";

export interface ConfirmAction {
    kind: "confirm";
    message: string;
    then: Action;
}

export function makeConfirmAction(message: string, then: Action): ConfirmAction {
    return { kind: "confirm", message, then };
}

export function isConfirmAction(action: Action): action is ConfirmAction {
    return (action as any).kind === "confirm";
}
```

The shape is yours — `kind` just has to be unique among registered handlers.

## Step 2: extend the `Action` type union

TypeScript doesn't auto-expand the framework's `Action` type. Declare a module augmentation:

```ts
// src/lib/actions/confirm.ts
declare module "@finesoft/front" {
    interface ActionRegistry {
        confirm: ConfirmAction;
    }
}
```

If the framework exposes `ActionRegistry` (most pluggable frameworks do), this lets TypeScript know about your new kind. If it doesn't, cast at registration time:

```ts
framework.actionDispatcher.register("confirm" as any, handleConfirm as any);
```

The runtime doesn't care — `kind` is a plain string at dispatch time.

## Step 3: write the handler

```ts
// src/lib/actions/confirm.ts
import type { Framework } from "@finesoft/front";

export function registerConfirmHandler(framework: Framework): void {
    framework.actionDispatcher.register("confirm", async (action: ConfirmAction) => {
        if (typeof window === "undefined") {
            // SSR: confirmation isn't possible — fall through to the inner action
            await framework.actionDispatcher.dispatch(action.then);
            return;
        }

        const confirmed = window.confirm(action.message);
        if (!confirmed) return;

        await framework.actionDispatcher.dispatch(action.then);
    });
}
```

Key points:

- The handler runs on both server and client. On the server `window` doesn't exist — decide what "no UI" means for your action.
- Recursive dispatch (`actionDispatcher.dispatch(action.then)`) goes through the regular pipeline, including any other custom handlers.
- The framework already protects compound actions with a recursion-depth limit (default 4). Your handler is reached via dispatch, so it inherits that limit.

## Step 4: register at app startup

```ts
// src/main.ts
import { startBrowserApp } from "@finesoft/front/browser";
import { bootstrap } from "./bootstrap";
import { registerConfirmHandler } from "./lib/actions/confirm";

startBrowserApp({
    bootstrap,
    onBeforeStart(framework) {
        registerConfirmHandler(framework);
    },
    mount: /* ... */,
});
```

Mirror on the SSR side:

```ts
// src/ssr.ts
export const render = createSSRRender({
    bootstrap,
    onBeforeStart(framework) {
        registerConfirmHandler(framework);
    },
    async renderApp(page) {
        /* ... */
    },
});
```

Or, simpler: register inside `bootstrap()` so both sides get it automatically.

## Step 5: use it

```ts
// In a view component
import { makeConfirmAction, makeFlowAction } from "@finesoft/front";

function onDelete(id: string) {
    framework.actionDispatcher.dispatch(
        makeConfirmAction(`Delete item ${id}?`, makeFlowAction(`/items/${id}/deleted`)),
    );
}
```

## Replacing an existing handler

Each `kind` can be registered exactly once. The dispatcher warns on duplicate registrations and skips:

```ts
framework.actionDispatcher.register("flow", myFlowHandler);
// [ActionDispatcher] kind="flow" already registered, skipping
```

To replace, unregister first:

```ts
framework.actionDispatcher.removeAction("flow");
framework.actionDispatcher.register("flow", myFlowHandler);
```

Useful when you want to wrap the default flow handler with logging or analytics:

```ts
import { registerFlowActionHandler, type FlowActionDependencies } from "@finesoft/front";

const baseHandler = framework.actionDispatcher.getHandler("flow"); // hypothetical
framework.actionDispatcher.removeAction("flow");
framework.actionDispatcher.register("flow", async (action) => {
    console.log("[nav]", action.url);
    await baseHandler(action);
});
```

In practice, prefer middleware (`beforeLoad`) for cross-cutting concerns on navigation — replacing the flow handler is invasive.

## Compound actions with custom kinds

`CompoundAction` works with any registered kind:

```ts
framework.actionDispatcher.dispatch({
    kind: "compound",
    actions: [
        makeFlowAction("/checkout/complete"),
        makeConfirmAction("Add to email list?", { kind: "subscribe", email: user.email }),
    ],
});
```

Each inner action runs sequentially. A handler that throws short-circuits the remaining actions in the compound — wrap with `try/catch` if you want best-effort semantics.

## Server-side considerations

Action handlers run on the server during SSR if the controller dispatches them. Common patterns:

- **External URLs**: the server can't navigate the user — most apps return early. The framework's built-in `external-url` handler does exactly that on SSR.
- **Confirm-style**: no user to ask. Either auto-accept (use the inner action) or auto-reject (drop it).
- **Telemetry-only**: works the same on both sides. Just record.

If your handler depends on browser APIs that don't exist on the server, gate with `typeof window === "undefined"`.

## Testing

```ts
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { Framework } from "@finesoft/front";
import { registerConfirmHandler, makeConfirmAction } from "./confirm";

describe("confirm action", () => {
    afterEach(() => vi.restoreAllMocks());

    test("dispatches inner action when confirmed", async () => {
        const framework = Framework.create({});
        registerConfirmHandler(framework);
        vi.stubGlobal("window", { confirm: () => true });

        const innerHandler = vi.fn();
        framework.actionDispatcher.register("test", innerHandler);

        await framework.actionDispatcher.dispatch(
            makeConfirmAction("ok?", { kind: "test" } as any),
        );

        expect(innerHandler).toHaveBeenCalled();
    });

    test("skips inner action when cancelled", async () => {
        const framework = Framework.create({});
        registerConfirmHandler(framework);
        vi.stubGlobal("window", { confirm: () => false });

        const innerHandler = vi.fn();
        framework.actionDispatcher.register("test", innerHandler);

        await framework.actionDispatcher.dispatch(
            makeConfirmAction("ok?", { kind: "test" } as any),
        );

        expect(innerHandler).not.toHaveBeenCalled();
    });
});
```

## When to use a custom action vs middleware

| Concern                                         | Custom action | Middleware (`beforeLoad`)    |
| ----------------------------------------------- | ------------- | ---------------------------- |
| Confirmation before navigating to specific URLs | ✅            | ❌ (would run for every nav) |
| Audit log on every navigation                   | ❌            | ✅                           |
| New mechanism for performing an operation       | ✅            | ❌                           |
| Gate-keeping all navigation to admin routes     | ❌            | ✅                           |

Custom actions are for **new kinds of operations.** Middleware is for **cross-cutting concerns on existing operations.**
