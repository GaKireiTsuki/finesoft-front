# 应用 Action

WebSession 本身就是 ActionDispatcher 和导航状态所有者。原生页面、链接拦截、自定义处理器共用 `app.perform(action)`。Action 同时表达 URL 路由和 Stack、Tab、Split 结构化导航，不再有另一套导航命令对象。

`FlowAction` 加载 URL。普通应用未显式声明导航树或 codec 时，离开的页面会卸载；结构化应用保留树中分支。同址 URL 刷新原条目，显式 `push` 则创建新条目，相同目标也有独立草稿。

`perform` 等待守卫、数据加载、提交及原生视图确认完成，返回导航快照。结构化动作被拒绝时返回带 `rejection` 的未提交快照。Compound 按顺序执行，遇到拒绝或失败即停止后续动作。第二个参数 `{ signal }` 可将取消传入页面加载。

`app.onAction(kind, handler)` 与 `app.removeAction(kind)` 在同一执行器上注册或显式替换处理器。业务数据操作继续调用 `app.runtime.execute`。ExternalUrlAction 使用 `noopener,noreferrer` 打开新窗口；`{ kind: "reuseEntry", entryId }` 恢复保留实例，无须额外携带 URL。

处理器接收 `(action, invocation)`。委托其他动作时，将同一个 invocation 传给 `app.perform(nextAction, invocation)`，使整个执行序列共用取消边界。新的 URL 导航取消旧动作组；结构化动作仍顺序执行，并阻止尚未完成解析的旧 URL 覆盖它。模态和外链动作不替换背景导航。

浏览器导航与守卫重定向接受 HTTP(S)，ExternalUrlAction 还接受 `mailto:`、`tel:`。无效 URL 和可执行或不支持的协议在浏览器跳转前拒绝；需要自定义协议时可以显式替换处理器。

## 两种导航

```ts
await app.perform({ kind: "flow", url: "/items/42" });
await app.perform({ kind: "push", intent: "item", params: { id: 42 } });
await app.perform({ kind: "selectTab", key: "favorites" });
await app.perform({ kind: "pop" });
await app.perform({ kind: "refresh" });
```

## 现有代码迁移

| 旧 API                                               | 替换方式                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `app.navigation.navigate(url)`                       | `app.perform({ kind: "flow", url })`                                                                               |
| `app.navigation.push(intent, params)`                | `app.perform({ kind: "push", intent, params })`                                                                    |
| `controller.apply(operation)`                        | `controller.perform(action)`，保留原有结构化字段                                                                   |
| 首次 `controller.resolve()`                          | `controller.start()`                                                                                               |
| `app.actionDispatcher.onAction/removeAction`         | `app.onAction/removeAction`                                                                                        |
| `FlowAction.entryId`                                 | `{ kind: "reuseEntry", entryId }`                                                                                  |
| `NavigationHandle`、`SessionHandle`、`SessionAccess` | History 清理使用 `NavigationBridge`；持久化使用 `SessionStore`；浏览器启动恢复使用 `BrowserSession.restoreFromUrl` |

旧导航命令与转发方法已删除，其余树操作使用同名 Action kind。不可变树构建纯函数继续保留。

## 模态展示

创建浏览器应用时提供 `onModal(page, { app, snapshot })`，然后调用：

```ts
import { makeFlowAction } from "@finesoft/front/web";
await app.perform(makeFlowAction("/items/42", "modal"));
```

宿主先运行导航策略和页面守卫，再调用一次 `onModal`，由业务原生 UI 呈现；背景导航与历史不变。拒绝只交付错误页和已清理快照，不交付被拒绝数据。内部重定向仍处于模态会话，外部重定向直接跳转且不交付模态。使用前须配置 `onModal`；SSR 视图不能执行浏览器动作。
