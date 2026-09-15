# 路由与类型化页面

页面定义一次后，路由与导航目标复用同一引用；工厂在每次执行时创建新的控制器。

## Page / 页面

```ts
import { definePage, defineWebApp, markPublic } from "@finesoft/front/web";
export const home = definePage({
    id: "load-home",
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
export const app = defineWebApp({
    id: "example",
    controllers: [home],
    routes: [home.route("/")],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
```

## Typed target / 类型化目标

```ts
import { definePage } from "@finesoft/front/web";
import { int } from "@finesoft/front";
export const product = definePage({
    id: "load-product",
    handler: (params: { id: number }) => ({
        id: String(params.id),
        pageType: "product" as const,
        title: "Product " + params.id,
    }),
});
export const productRoute = product.route("/products/:id", { params: { id: int() } });
export const target = product.leaf({ id: 42 });
```

`id` 是操作标识，`pageType` 选择视图，叶子节点自动生成独立 EntryId。`bindView` 检查结果中的字面量页面类型，不从操作 id 推断类型。宽泛的 `BasePage.pageType: string` 不提供该检查。叶子参数保留处理器/控制器类型；外部 URL 仍需显式 codec 解码。任意 codec 与处理器 schema 的等价性不会自动得到证明。`BaseController` 可选，默认 fallback 重新抛出错误。

<Ch02RouteResolver />
