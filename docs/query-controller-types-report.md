# 单对象 Controller 入参与独立 Query

按用户最终选择，Controller 使用 `execute({ params, query, context })`，失败恢复使用 `fallback({ params, query, context, error })`。路由和 Controller 保持分文件，输入字段类型只在路由中维护。

## 使用方式

```ts
// app-definition.ts
export const product = definePage({
    id: "product",
    routes: [
        {
            path: "/products/:id",
            params: { id: int() },
            query: { q: str() },
        },
    ],
    create: () => new ProductController(),
});

// controllers/product.ts：初次编写时的形式
export class ProductController extends BaseController {
    execute({ params, query, context }): ProductPage {
        context.signal.throwIfAborted();
        return { id: params.id.toFixed(), pageType: "product", title: query.q };
    }

    fallback({ params, error }): ProductPage {
        return { id: String(params.id), pageType: "product", title: error.message };
    }
}
```

框架自动维护 `import type`、方法参数注解和基类泛型。生成声明集中在 `.finesoft/controller-types.d.ts`，Controller 源码末尾不追加声明区块。首次运行 `vp dev`、`vp check` 或构建后，编辑器获得标准 TypeScript 补全和错误检查；修改路由字段不需要同步修改这些引用。

后续已精简自动生成的引用。实际保存形式为：

```ts
import type {
    ProductControllerInput as Input,
    ProductControllerFailure as Failure,
} from "../../../.finesoft/controller-types";

export class ProductController extends BaseController<Input, ProductPage> {
    execute({ params, query, context }: Input): ProductPage {
        /* 业务逻辑 */
    }
    fallback({ params, error }: Failure): ProductPage {
        /* 回退逻辑 */
    }
}
```

`Input` 包含完整的 params/query/context，基类不再重复拆分输入，也不再生成多余的 `Awaited<Promise<ProductPage>>`。短名称冲突时使用类名消歧，新增同文件控制器不会重命名已有别名，业务额外导入的类型保留。基类统一使用 `BaseController<Input, Result>`；必填 query、直接 `perform` 的入参与结果、fallback 返回值继续受到类型检查。仅提供 params/query/context，额外必填的顶层输入字段不能通过 `perform` 调用。

按后续要求，已删除旧 Params/Result/Query 泛型分支、用于区分新旧输入的类型标记、旧声明区块和 `__Front…` 的迁移逻辑，以及旧 Params 类型导出的识别。调用方、模板和文档已统一到完整 Input 契约。下方保留各轮历史验证记录。

`query: { q: str() }` 与 `params: { id: int() }` 使用相同的 schema 声明机制。Query 仍有自身语义：必填字符串缺失时校验失败；`optional(str())` 允许缺失；`withDefault(str(), "")` 在缺失时使用空字符串。模板搜索页采用后者，因此 `/search` 仍可显示全部结果。

## 实现与兼容范围

- `params` 只包含路径参数；`query` 单独传递。同名字段互不覆盖，普通导航、结构化导航、模态、重定向、SSR 和水合使用同一输入分离规则。
- 导航树、资源标识与预取键保留 query，避免 query 改变后错误复用旧页面。结构化调用形如 `app.perform({ kind: "push", intent: "product", params: { id: 42 }, query: { q: "book" } })`；页面引用使用 `product.leaf({ id: 42 }, { query: { q: "book" } })`。
- `list()` 的反向路由编码成重复键，保留数组顺序；`optional(list(...))` 和 `withDefault(list(...), [...])` 使用统一的缺省处理。显式空字符串仍接受 schema 校验，普通单值 query 遇到重复键继续取最后一项。
- 移除本轮之前新增的内联 `create: () => ({ execute, fallback })` API。保留独立 `BaseController`、既有 `handler(params, context, query)` 和 `perform(params, context, query)` 工厂契约。
- 参数类型生成复用 `RouteInputFor`，params/query 的 schema map 复用同一推导实现。类型生成器只在开发和构建工具入口运行，不执行业务模块，不构造 Controller，不添加运行时类型注册表或第二轮参数校验。
- React、Vue、Svelte 的 full/minimal 六个模板及对抗应用已迁移。共享模板来源保持统一。

这是对 Controller 方法签名及 query 读取位置的有意调整。旧业务类需要将 `execute(params, context)` 改为单对象参数，将 query 字段读取迁移到 `query`；`fallback` 的错误放入同一对象的 `error`。生成器维护类型引用，不自动改写方法业务逻辑，遇到旧的多参数签名会给出迁移提示。已有手写类型注解保留。

## 本地验证

证据保存在 `reports/query-controller-types/`。

此处记录首次实现的验证数据；保存路由后的热更新延迟已继续优化，新的前后对照见 [Controller 类型热更新延迟优化](./controller-type-latency-report.md)。

- `vp install` 已成功。
- `vp check --fix`：468 个文件通过格式、lint 和类型检查。
- `vp test`：111 个测试文件、915 项测试全部通过，包含类型生成、取消与失败恢复、同名字段隔离、query 缓存标识、SSR 水合、普通和模态导航回归。
- `vp run -r build`：21 个构建任务通过。
- 真实 `vp check`：execute/fallback 的数字 params 与字符串 query 通过；分别改变路由 codec 后，错误的 `toFixed` / `toUpperCase` 使用被拒绝；修正方法后通过。
- 真实开发服务：params/query 声明随路由保存自动更新，本机一次观测耗时 1111 ms，无重复写入循环。这个数值衡量开发工具更新延迟，不代表生产性能。
- 本地 tarball 的 portable、React、Vue、Svelte、Node、tooling 六类隔离消费者通过导入、完整声明检查和入口依赖检查；运行入口没有引入 TypeScript 编译器或类型生成器。打包结束后原始清单已恢复。
- 六套实际脚手架在仓库外安装本地 tarball，原生 `vp check`、TypeScript / Vue / Svelte 对应检查及 client/SSR 构建全部通过。
- 实际 Chrome：六模板 production preview 的 SSR、CSR、详情导航、返回、404 和各自状态恢复流程通过；三个 full 模板的搜索字符串、缺省 query、重复 query 键通过，三个 minimal 模板的开发入口、语言加载和独立挂载通过。未记录页面错误或水合不匹配。

浏览器首轮新增的缺省 query 断言误用了首页三条推荐数量；实际搜索数据源有四条。根据数据源和页面输出将断言修正为四条并确认第四项内容后，上述完整浏览器流程重跑通过。保留首轮日志以便追溯。

独立只读复核未发现 Critical / Important 问题。以上是本地验证；本次改动尚未提交、推送或发布。

## 生成引用精简的后续验证

2026-09-21，证据目录 `reports/controller-type-syntax/`：

- `vp check --fix`：470 个文件通过；`vp test`：111 个文件、934 项测试通过；全部 21 个构建任务通过。
- 新增检查覆盖旧长引用迁移、短名称冲突、同文件新增控制器后别名稳定、手写类型导入保留，以及直接 `perform` 的输入/结果和额外必填字段约束。独立复核发现的问题均已修复并通过复核。
- 实际公开包的原生 `vp check` 与 Vite 保存流程通过：错误的 params/query 方法仍被拒绝，只改 codec 不重写 Controller，未发现重复写入循环。
- 12 轮路由版本切换和 12 种新 schema 的本机测量：缓存复用中位 124 μs，重复保存约 42 μs，全新 schema 约 131 ms。真实 Vite 六次保存的中位延迟约 1.57 ms，其中首次新类型约 135 ms，另有一次约 74 ms 的波动；不包含编辑器界面刷新。
- BaseController 的编译后 JavaScript 在忽略格式化产生的括号和尾逗号后 AST 等价，精简没有增加运行时处理步骤。

## 兼容层清理验证

随后移除旧接口兼容层，证据目录为 `reports/controller-contract-cleanup/`。`vp check --fix` 的 470 个文件、全部 933 项测试和 21 个构建任务通过。测试数量减少一项，对应已删除的旧声明区块迁移测试；新增类型断言确认旧泛型写法被拒绝、无类型标记的完整 Input 可用。

构建后的公开包也通过原生类型检查与 Vite 保存更新验证，错误的 params/query 使用及旧泛型写法均被拒绝。BaseController 编译后的运行时 AST 保持等价。模板、对抗应用、业务操作绑定、验证脚本和中英文使用文档已统一为新接口。独立复核补正了一处 fallback 旧签名示例。
