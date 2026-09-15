# 应用动作

标准浏览器启动器拥有 FlowAction 导航。业务确认可在用户同意后调用现有句柄。

## Business confirmation / 业务确认

```ts
async function openAfterConfirmation() {
    if (window.confirm("Open this page?")) await handle.navigate("/items");
}
```

业务命令放在可移植操作，浏览器负责交互。不要注册第二个 FlowAction 执行器。自定义 ActionDispatcher handler 是高级业务扩展；框架没有 ActionRegistry 模块增强协议。模态渲染通过 `onModal(page, context)` 提供，守卫完成后恰好一次收到对应候选快照。
