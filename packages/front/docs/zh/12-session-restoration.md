# 会话恢复与多实例

使用 `createBrowserApp({ definition, target, history: "memory", persistenceKey: "first", session: {}, domRestore: true })` 创建嵌入应用。每个实例需要独立的 target 和稳定 persistenceKey；同一窗口只允许一个浏览器地址栏所有者。

随后用原生 API 挂载 App，再等待 `app.ready`。会话读取及恢复在第一次原生提交确认之后开始，Outlet 的 commit 不等待恢复。React 的持久化 provider 在 layout effect 注册；Vue/Svelte 在原生挂载阶段注册。`app.session.register(provider)` 返回反注册函数。provider 的 capture/restore 直接读写原生业务状态，无需额外 NameStore。

切换隐藏页面保留原生实例；pop 移除 entry 及其 scoped 草稿。`data-restore-root` 内明确标记的表单与滚动状态由 DOM 恢复层处理，范围限定在所属应用。多个实例不会读取彼此的输入。

`app.session.save()` / `clear()` 返回可检查的结果。相邻、尚未开始的隐式 save 合并；显式快照、load、restore、clear 构成顺序边界。最终 dispose 捕获当前状态并等待已登记存储操作；浏览器关闭仍不能保证异步存储完成。

清理顺序是 `try { await app.dispose(); } finally { nativeRoot.unmount(); }`，Svelte 使用其 `unmount` 函数。另一个实例仍可通过 `other.perform({ kind: "flow", url: "/" })` 工作。协议 v2 使用导航树，旧 URL-only 快照会被判为不兼容；业务切片有独立版本和迁移契约。
