# 高阶：自定义 Action handler

框架内置三种 action：`flow`（应用内导航）、`external-url`（整页浏览器跳转）、`compound`（按顺序执行的 action 元组）。对大多数应用够用。

本配方展示怎么加自己的 —— 适用于有一类操作需要横切处理（分析、确认、遥测）又不想污染每个调用点。

## 用例：带确认的 action

加 `"confirm"` action kind：dispatch `{ kind: "confirm", message, then }`，框架在 dispatch `then` 之前（`then` 本身也是个 action）显示确认对话框。

```ts
dispatch({
    kind: "confirm",
    message: "Delete this item permanently?",
    then: { kind: "flow", url: "/items/42/deleted" },
});
```

用户点 Cancel → 不导航。点 OK → 内层 flow action 触发。

## 步骤 1：定义 action 类型

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

形状你定 —— `kind` 只要在已注册 handler 中唯一即可。

## 步骤 2：扩展 `Action` 类型 union

TypeScript 不会自动扩展框架的 `Action` 类型。声明模块增强：

```ts
// src/lib/actions/confirm.ts
declare module "@finesoft/front" {
    interface ActionRegistry {
        confirm: ConfirmAction;
    }
}
```

框架暴露 `ActionRegistry` 的话（大多数可插拔框架会），TypeScript 就知道你的新 kind。没暴露的话，注册时 cast：

```ts
framework.actionDispatcher.register("confirm" as any, handleConfirm as any);
```

运行时不在乎 —— `kind` dispatch 时就是普通字符串。

## 步骤 3：写 handler

```ts
// src/lib/actions/confirm.ts
import type { Framework } from "@finesoft/front";

export function registerConfirmHandler(framework: Framework): void {
    framework.actionDispatcher.register("confirm", async (action: ConfirmAction) => {
        if (typeof window === "undefined") {
            // SSR：没法弹确认 —— 直接 dispatch 内层 action
            await framework.actionDispatcher.dispatch(action.then);
            return;
        }

        const confirmed = window.confirm(action.message);
        if (!confirmed) return;

        await framework.actionDispatcher.dispatch(action.then);
    });
}
```

要点：

- handler 服务端和客户端都跑。服务端没有 `window` —— 决定「没 UI」对你的 action 意味着什么。
- 递归 dispatch（`actionDispatcher.dispatch(action.then)`）走普通管线，包含任何其他自定义 handler。
- 框架已经用递归深度限制（默认 4）保护 compound action。你的 handler 通过 dispatch 到达，继承了这个限制。

## 步骤 4：应用启动时注册

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

SSR 端镜像一份：

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

或者更简单：在 `bootstrap()` 内注册，两端都自动拿到。

## 步骤 5：使用

```ts
// 在 view 组件里
import { makeConfirmAction, makeFlowAction } from "@finesoft/front";

function onDelete(id: string) {
    framework.actionDispatcher.dispatch(
        makeConfirmAction(`Delete item ${id}?`, makeFlowAction(`/items/${id}/deleted`)),
    );
}
```

## 替换已有 handler

每个 `kind` 只能注册一次。dispatcher 对重复注册打 warning 并跳过：

```ts
framework.actionDispatcher.register("flow", myFlowHandler);
// [ActionDispatcher] kind="flow" already registered, skipping
```

要替换先 unregister：

```ts
framework.actionDispatcher.removeAction("flow");
framework.actionDispatcher.register("flow", myFlowHandler);
```

适用于想用日志或分析包默认 flow handler：

```ts
import { registerFlowActionHandler, type FlowActionDependencies } from "@finesoft/front";

const baseHandler = framework.actionDispatcher.getHandler("flow"); // 假设暴露
framework.actionDispatcher.removeAction("flow");
framework.actionDispatcher.register("flow", async (action) => {
    console.log("[nav]", action.url);
    await baseHandler(action);
});
```

实践中，导航的横切关注点优先用中间件（`beforeLoad`）—— 替换 flow handler 太侵入。

## 自定义 kind 的 compound action

`CompoundAction` 配任何已注册 kind 都行：

```ts
framework.actionDispatcher.dispatch({
    kind: "compound",
    actions: [
        makeFlowAction("/checkout/complete"),
        makeConfirmAction("Add to email list?", { kind: "subscribe", email: user.email }),
    ],
});
```

每个内层 action 顺序跑。一个 handler 抛错短路 compound 剩余 action —— 想要 best-effort 语义就 `try/catch` 包起来。

## 服务端考虑

Controller dispatch action 时 action handler 在 SSR 期间在服务端跑。常见模式：

- **外部 URL**：服务端没法让用户导航 —— 大多数应用提前返回。框架内置 `external-url` handler 在 SSR 上正是这样做的。
- **Confirm 类**：没用户能问。要么自动接受（用内层 action）要么自动拒绝（丢弃）。
- **仅遥测**：两端工作一样。记录就行。

handler 依赖服务端没有的浏览器 API，用 `typeof window === "undefined"` 守卫。

## 测试

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

## 自定义 action vs 中间件 怎么选

| 关注点                          | 自定义 action | 中间件（`beforeLoad`） |
| ------------------------------- | ------------- | ---------------------- |
| 导航到特定 URL 前确认           | ✅            | ❌（每个导航都跑）     |
| 每次导航的审计日志              | ❌            | ✅                     |
| 引入新的操作机制                | ✅            | ❌                     |
| 把守所有导航到 admin 路由的访问 | ❌            | ✅                     |

自定义 action 是**新种类的操作**。中间件是**已有操作的横切关注点**。
