# 应用动作

`createBrowserApp` 使用一个 `ActionDispatcher`。原生页面调用 `app.perform(action)`；FlowAction 和 `app.navigation.navigate(url)` 复用相同的守卫与导航提交。普通 URL 跳转压入当前栈，并保留其他分支；首次访问和显式编码的导航快照仍可恢复整棵树。

## Business confirmation / 业务确认

```ts
async function openAfterConfirmation() {
    if (window.confirm("Open this page?")) await app.navigation.navigate("/items");
}
```

业务命令放在可移植操作，浏览器负责交互。浏览器句柄的 `app.actionDispatcher` 提供现有 `onAction`、`removeAction` 注册方法，不要再创建第二个 FlowAction 执行器。ExternalUrlAction 以 `noopener,noreferrer` 打开新窗口；CompoundAction 顺序执行子动作；带 `entryId` 的 FlowAction 复用已保留条目。

浏览器导航和守卫重定向接受 HTTP(S)。ExternalUrlAction 还支持 `mailto:` 和 `tel:`。无效地址、可执行或不支持的协议会在浏览器跳转前被拒绝；需要自定义协议的应用可显式替换相应 action handler。

## 模态展示

创建浏览器应用时传入 `onModal(page, { app, snapshot })`，页面中调用：

```ts
import { makeFlowAction } from "@finesoft/front/web";

await app.perform(makeFlowAction("/items/42", "modal"));
```

宿主完成导航策略、页面守卫和加载后，调用一次 `onModal`。回调用应用的原生 UI 展示模态，背景导航和 history 保持原样。策略拒绝时只交付错误页及已过滤的快照，不交付被拒绝的页面数据。站内重定向仍以模态交付；外部重定向直接跳转，不再交付模态。使用模态动作前必须配置 `onModal`。SSR 视图不能执行浏览器动作。
