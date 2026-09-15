# 资源释放边界

普通业务使用 runtime/HTTP/browser 标准所有者，不手动开 scope。runtime.execute 完成调用与清理；HTTP 流保留 scope 至响应体完成、失败或取消。移除嵌入应用时等待 handle.dispose。释放等待正在初始化的资源，再按依赖顺序恰好一次释放拥有值。后台任务不能保留请求上下文、请求资源或 getter。runManagedTask 使用独立任务上下文及主机 waitUntil，不支持时返回能力错误。取消阻止框架后续提交，不回滚外部修改。
