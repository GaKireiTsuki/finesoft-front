# 会话恢复与多实例

会话恢复可选。启用时提供稳定的实例存储键和业务 provider，无需手写内部 scope 或条目 ID。

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

异步存储报告失败或不可用，不会假称保存成功。各 provider 拥有独立版本切片，可单独迁移或丢弃。水合完成后才恢复。移除条目释放导航状态，无关业务切片保留。释放会完成已登记的待写入任务，不承诺无条件最终保存；业务需要时明确调用 session 的 save。地址栏只能有一个所有者，嵌入实例使用 memory history。
