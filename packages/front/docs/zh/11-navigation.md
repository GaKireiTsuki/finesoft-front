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
