# 结构化导航

Tabs、Stack、Split 是不可变导航声明。页面引用生成操作目标；分支、列名称仍是明确的布局标识。

## 路由定义驱动参数类型

路径参数和 query 都在路由中声明类型，并分别读取为 `params.id`、`query.tab`。既有 `handler` 仍接收路径参数和执行上下文，第三个参数接收 query：

```ts
import { definePage, defineWebApp, int, optional, oneOf } from "@finesoft/front/web";

export const product = definePage({
    id: "product",
    routes: [
        {
            path: "/products/:id",
            params: { id: int() },
            query: { tab: optional(oneOf(["details", "reviews"])) },
        },
    ],
    handler(params, context, query) {
        context.signal.throwIfAborted();
        // params.id: number；query.tab?: "details" | "reviews"
        return { id: params.id.toFixed(), pageType: "product" as const, title: "Product" };
    },
});
export const definition = defineWebApp({
    id: "shop",
    pages: [product],
    getErrorPage: (status, title) => ({ id: String(status), pageType: "error", title }),
});

product.leaf({ id: 42 });
// product.leaf({ id: "42" }); // 编译错误
```

需要错误恢复时使用独立的 `BaseController` 子类；`execute` 可同步或异步返回，`fallback` 可省略，取消执行不会进入 `fallback`。已有 `perform` 工厂继续支持。`create` 不接受只有 `execute/fallback` 的对象。

### 独立 Controller 类

路由与类可以分文件。只在路由中维护输入类型，类统一使用 `execute({ params, query, context })` / `fallback({ params, query, context, error })`：

```ts
// controllers/product.ts — 编写时不用重复参数类型
import { BaseController } from "@finesoft/front";
import type { ProductPage } from "../models/product";

export class ProductController extends BaseController {
    execute({ params, query, context }): ProductPage {
        return { id: params.id.toFixed(), pageType: "product", title: "Product" };
    }
}
```

```ts
// app-definition.ts
import { definePage, int } from "@finesoft/front/web";
import { ProductController } from "./controllers/product";

export const product = definePage({
    id: "product",
    routes: [{ path: "/products/:id", params: { id: int() } }],
    create: () => new ProductController(),
});
```

框架根据 `create` 返回的类定位 `BaseController` 子类，只维护 `import type`、参数注解与基类泛型。`context` 保留 DI、取消信号等执行服务；query 不混入 params。类型声明集中在 `.finesoft/controller-types.d.ts`，不会在 Controller 文件末尾追加声明区块。保存的类源码会出现这些引用，业务无需手写或同步。手写参数类型保留；移除参数注解与基类输入泛型即可交给生成器管理。建议保留方法的返回页面类型。

生成后使用短类型名，基类直接接收完整输入类型：

```ts
import type {
    ProductControllerInput as Input,
    ProductControllerFailure as Failure,
} from "../../../.finesoft/controller-types";

export class ProductController extends BaseController<Input, ProductPage> {
    async execute({ params, query, context }: Input): Promise<ProductPage> {
        /* 业务逻辑 */
    }
    fallback({ params, error }: Failure): ProductPage {
        /* 回退逻辑 */
    }
}
```

`Input` 已包含 `params`、`query` 和 `context`，无需在基类中再次拆开；`Failure` 额外包含 `error`。同文件有多个控制器或名称冲突时使用带类名的别名。基类统一使用 `BaseController<Input, Result>`，手写输入可使用 `ControllerInput<Params, Query>`。直接调用 `perform` 的参数与结果保持类型检查。

旧的多个位置参数写法需要先迁移为单对象参数。生成器只更新类型引用，不改写方法业务逻辑；遇到旧的多参数 `execute` / `fallback` 签名时会报告迁移提示。

这使用标准 TypeScript 声明，因此编辑器补全与命令行检查一致。它不会执行路由模块、实例化 Controller，也不会增加运行时代码。同一类用于多个路由时，params/query 分别保留对应路由的输入类型，需要正常收窄。

取消路由注册但保留类时，框架保留该类最后一次生成的输入契约，避免破坏它的独立使用；重新注册后按新路由更新。引用式 `tsconfig.json` 会自动选择包含 `src` 的应用项目；有多个候选项目时，通过 `controllerTypes.tsconfig` 指定应用配置。

模板已配置自动生成。现有项目安装开发依赖 `typescript`，并把框架插件的创建放在 `lazyPlugins` 外，确保 `vp check` 读取配置时也会生成类型：

```ts
const front = finesoftFrontViteConfig({
    controllerTypes: { root: import.meta.dirname },
});
export default defineConfig({
    lint: { options: { typeAware: true, typeCheck: true } },
    plugins: lazyPlugins(() => [front, react()]),
});
```

`vp dev` 启动后监听源码变更；`vp check` 与构建也会生成。初次打开项目先运行其中一个命令。将 `.finesoft/` 加入 `.gitignore`，提交类中的框架管理引用。直接使用 `tsc` 或自定义工具链时，先调用 `@finesoft/front/vite` 导出的 `generateControllerTypes({ root })`。`controllerTypes: false` 关闭自动维护。

`createBrowserApp({ definition, target })` 返回的 `app`、`createWebSession` 和 SSR 的 `render(app)` 都保留该定义的参数关联：

```ts
await app.perform({ kind: "push", intent: "product", params: { id: 42 } });
// id: "42"、缺少 id 或未知 intent 都会产生编译错误。
```

`route()` 和页面引用的 `.route()` 返回值也保留已声明的 codec 类型。保留工厂返回值的推导；不要用宽类型 `WebAppDefinition` 注解覆盖 `definition`。显式标为 `PageRoute` 的变量允许省略 codec，接收方类型也必须考虑未配置 codec 的情况；需要校验声明形状时可用 `satisfies PageRoute` 保留具体类型。组件需要显式声明应用类型时使用 `WebAppView<typeof definition>`（或 `ViewProps<Page, typeof definition>`），无需再写参数接口。通用 `WebAppView` 仍用于与任意应用兼容的布局和 Outlet。

字符串数组如 `routes: ["/items/:id", "/products/:id"]` 继续支持多个别名，未声明 codec 的路径参数为 `string`，`:tab?` 为可选字符串。不同别名的参数结构不同时，控制器接收联合类型，需要先判断对应属性。相同参数匹配多个别名时，结构化目标需提供 `url` 指明路径，例如 `product.leaf({ id: 42 }, { url: "/products/42" })`。

`optional`、`withDefault`、`list` 与第三方 Standard Schema 的输出决定接收方类型。`leaf` 和结构化 Action 使用同一输出形状；默认值字段在该形状中为必填，URL 导航省略它时仍由 Router 填入默认值。运行时仍由原有 Router 校验和转换参数，不增加第二次 Schema 校验。

### Query 与路径参数

两者共用 codec 与推导规则，在 Controller 的对象入参中分别提供，不需要手动解析 URL：

```ts
routes: [
    {
        path: "/products/:id",
        params: { id: int() },
        query: {
            q: withDefault(str(), ""),
            tags: optional(list(str())),
        },
    },
];
// execute({ params, query, context }) 内：
// params.id 是 number，query.q 是 string，query.tags 是 string[] | undefined。
await app.perform({
    kind: "push",
    intent: "product",
    params: { id: 42 },
    query: { q: "a & b", tags: ["new", "sale"] },
});
```

框架把 params 编入路径、query 编入查询串；数组保留顺序并编码成重复键。普通 URL 导航仍可直接使用 `/products/42?q=a%20%26%20b&tags=new&tags=sale`。

Query 的字段名不限于路径占位符；`optional` 允许缺失，`withDefault` 仅在缺失时补值，显式空字符串仍参与校验。`list` 收集同名键，缺失时为 `[]`；`optional(list(...))` 缺失时为 `undefined`，`withDefault(list(...), [...])` 使用默认数组。普通单值字段遇到重复键仍取最后一个值。未声明的 query 保持字符串兼容行为，不会获得声明字段的类型保证；同名字段各自保留，例如 `/products/42?id=other` 的 params.id 为 42，query.id 为 "other"（声明为 str 时）。

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

## Action 导航

所有导航通过 `app.perform(action)` 执行。URL 使用 `{ kind: "flow", url }`；结构化导航使用下列 Action：

| kind              | Fields                                                        |
| ----------------- | ------------------------------------------------------------- |
| push / replaceTop | intent, params?, query?, target?, url?                        |
| pop               | count?, target?                                               |
| popToRoot         | target?                                                       |
| popTo             | index, target?                                                |
| selectTab         | key, target?                                                  |
| selectColumn      | columnId, intent (undefined clears), params?, query?, target? |
| setVisibility     | visibility, target?                                           |
| reuseEntry        | entryId                                                       |
| refresh           | —                                                             |
| hydrate           | tree                                                          |

## 导航事务策略

`defineWebApp({ beforeNavigate, beforeCommit })` 可选地声明整棵树的策略。数组中的每个策略每次事务只运行一次，空树退出也会执行；先执行应用定义的策略，再执行控制器附加策略。`beforeLoad` / `afterLoad` 仍按每个可见页面运行。

`beforeNavigate` 接收原快照 `from`、候选树 `tree`、稳定的 `transitionId`、当前 `execution` 及其 `signal`、`isServer`，返回 `next`、`deny` 或 `redirect`。页面重定向沿用同一事务标识，不重复运行准入策略；各跳转仍由原所有者释放执行资源。`beforeCommit` 另接收加载完成的 `candidate`，仅允许 `next` 或 `deny`，在消费预取缓存、写入快照、历史、事件和视图之前执行。普通应用无需配置策略或手动管理作用域。

拒绝返回带 `rejection` 的未提交快照，空树也能表达拒绝。会话恢复会在替换 scope 和业务 slice 前检查是否提交。浏览器首屏拒绝显示错误页，不提交导航或记录页面访问；后续拒绝保留当前草稿。扁平和导航 SSR 都执行相同策略，不输出被拒绝页面的数据或公开缓存许可。CSR 空壳继续由浏览器执行导航。

自有历史条目的后退或前进被拒绝时，History 补偿回已提交条目并保持滚动身份；附加元数据让刷新后仍可识别所有权与位置。缺少兼容元数据的外部条目会给出诊断，不猜测应跨越几个历史位置。异步策略应把 `signal` 传给自身 I/O；取消不会回滚已经完成的业务写入。
