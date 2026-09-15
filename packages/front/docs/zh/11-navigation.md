# 结构化导航

Tabs、Stack、Split 是不可变导航声明。页面引用生成操作目标；分支、列名称仍是明确的布局标识。

## Tree / 导航树

```ts
import { stack, tabs, split } from "@finesoft/front/web";
import { home, product } from "./pages";
export const navigation = tabs({
    active: "catalog",
    branches: {
        catalog: stack([home.leaf(), product.leaf({ id: 42 })]),
        compare: split([{ id: "left", content: product.leaf({ id: 42 }) }, { id: "right" }]),
    },
});
// defineWebApp({ ..., navigation })
```

相同目标仍有独立 EntryId 与草稿；ResourceKey 可共享显式缓存的查询数据，但不会共享视图状态。标准浏览器启动器拥有 URL 动作、重定向、popstate，过期 URL 结果不能覆盖后来的操作。显式树操作通过单个串行队列执行。Tabs 保留分支，Stack 保留在树条目，Split 检查各个目标。原生视图生命周期需跟随树时选择 `entries`。

## 导航事务策略

`defineWebApp({ beforeNavigate, beforeCommit })` 可选地声明整棵树的策略。数组中的每个策略每次事务只运行一次，空树退出也会执行；先执行应用定义的策略，再执行控制器附加策略。`beforeLoad` / `afterLoad` 仍按每个可见页面运行。

`beforeNavigate` 接收原快照 `from`、候选树 `tree`、稳定的 `transitionId`、当前 `execution` 及其 `signal`、`isServer`，返回 `next`、`deny` 或 `redirect`。页面重定向沿用同一事务标识，不重复运行准入策略；各跳转仍由原所有者释放执行资源。`beforeCommit` 另接收加载完成的 `candidate`，仅允许 `next` 或 `deny`，在消费预取缓存、写入快照、历史、事件和视图之前执行。普通应用无需配置策略或手动管理作用域。

拒绝返回带 `rejection` 的未提交快照，空树也能表达拒绝。会话恢复会在替换 scope 和业务 slice 前检查是否提交。浏览器首屏拒绝显示错误页，不提交导航或记录页面访问；后续拒绝保留当前草稿。扁平和导航 SSR 都执行相同策略，不输出被拒绝页面的数据或公开缓存许可。CSR 空壳继续由浏览器执行导航。

自有历史条目的后退或前进被拒绝时，History 补偿回已提交条目并保持滚动身份；附加元数据让刷新后仍可识别所有权与位置。缺少兼容元数据的外部条目会给出诊断，不猜测应跨越几个历史位置。异步策略应把 `signal` 传给自身 I/O；取消不会回滚已经完成的业务写入。
