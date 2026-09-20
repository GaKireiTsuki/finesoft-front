# 路由、控制器与类型化页面

六个模板均使用 `BaseController` 加载页面。它继续作为公开 API 提供；`definePage` 将控制器工厂或函数处理器接入 Web 应用，两种写法共用运行时、执行作用域和策略。

## 各层职责

| API                                | 职责                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| `BaseController<TParams, TResult>` | 实现 `execute`，通过继承的 `perform` 处理参数、取消和 `fallback`  |
| `definePage({ id, create })`       | 声明页面加载工厂，生成可复用的 `route`、`leaf` 和 `bindView` 引用 |
| `defineWebApp`                     | 组装页面声明、路由、守卫及可选导航结构                            |
| 原生页面组件                       | 接收 `page` 数据，渲染 UI 和处理交互                              |

`BaseController` 来自 `@finesoft/front`；页面、路由和公开数据声明来自 `@finesoft/front/web`。

## 用 BaseController 加载页面

`src/lib/controllers/product.ts`：

```ts
import { BaseController, DEP_KEYS, type ExecutionContext } from "@finesoft/front";
import { markPublic, type BasePage } from "@finesoft/front/web";

export interface ProductPage extends BasePage {
    pageType: "product";
    product: { id: number; name: string };
}

export class ProductController extends BaseController<{ id: number }, ProductPage> {
    async execute(params: { id: number }, context: ExecutionContext): Promise<ProductPage> {
        const logger = await context.get(DEP_KEYS.LOGGER_FACTORY);
        logger.loggerFor("ProductController").info(`Loading product ${params.id}`);
        context.record("product.load", { productId: params.id });

        return markPublic(
            {
                id: String(params.id),
                pageType: "product",
                title: `Product ${params.id}`,
                product: { id: params.id, name: `Product ${params.id}` },
            },
            { product: { id: true, name: true } },
        );
    }

    override fallback(params: { id: number }, _error: Error): ProductPage {
        return markPublic(
            {
                id: String(params.id),
                pageType: "product",
                title: "Product unavailable",
                product: { id: params.id, name: "Unavailable" },
            },
            { product: { id: true, name: true } },
        );
    }
}
```

这个示例使用本地数据；实际业务可以在 `execute` 中调用服务。`context` 提供当前执行的 `signal`、`fetch`、`get(token)` 和 `execute(operation, input)`。执行异步请求时，将 `context.signal` 传给请求 API，取消才能传递到实际工作。

`fallback` 仅在 `execute` 发生普通异常时调用，返回类型仍是 `ProductPage`；示例选择展示不可用状态。未覆写时默认重新抛出错误，交给页面加载流程的错误处理。取消、`AbortError` 和 `ExecutionError("cancelled")` 会继续抛出，不进入 `fallback`。运行时策略在控制器外执行，策略拒绝也不会由控制器回退处理。

## 注册工厂、路由与导航目标

`src/app-definition.ts`：

```ts
import { int } from "@finesoft/front";
import { definePage, defineWebApp } from "@finesoft/front/web";
import { ProductController } from "./lib/controllers/product";

export const product = definePage({
    id: "load-product",
    create: () => new ProductController(),
    routes: [{ path: "/products/:id", params: { id: int() } }],
});
export const target = product.leaf({ id: 42 });

export const app = defineWebApp({
    id: "example",
    pages: [product],
    getErrorPage: (status, message) => ({ id: String(status), pageType: "error", title: message }),
});
```

页面声明拥有唯一操作标识，控制器不再重复声明 intentId。URL `/products/42` 经 `int()` 解码后，`execute` 收到 `{ id: 42 }`；代码内的 `product.leaf({ id: 42 })` 保留同样的参数类型。

`create` 每次实际执行时返回新控制器。声明、路由发现及引用辅助方法只读取定义；命中已预取或保留的页面结果时也无需创建控制器。请求身份放在执行上下文或有作用域的 provider 中；页面草稿放在页面实例中。

`id` 是操作标识，`pageType` 选择视图，每个叶子节点生成独立 EntryId。`product.bindView("product", ProductView)` 检查结果中的字面量页面类型，不从操作 id 推断类型。显式保留 `ProductPage.pageType: "product"` 才能获得该检查；宽泛的 `BasePage.pageType: string` 无法约束视图名称。

类型化叶子参数保留控制器类型；外部 URL 仍需显式 codec 解码。泛型提供编译期类型约束，不替代运行期输入校验，也不会自动证明任意 codec 与业务校验规则等价。

## 简单页面的函数写法

只需直接返回页面数据时，可以使用 `handler`。它也能通过执行上下文使用依赖、取消和嵌套操作；需要回退逻辑时，在函数内自行处理。`create` 和 `handler` 二选一。

```ts
import { definePage, markPublic } from "@finesoft/front/web";

export const home = definePage({
    id: "load-home",
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
```

模板采用控制器类来保持组织方式一致；函数形式适用于简短加载逻辑。继承基类是可选的，实现 `perform(input, context)` 契约也能由 `create` 工厂接入。

## 独立业务操作也可以用控制器

`BaseController` 的结果泛型不要求是页面。通过 `implementController` 将类绑定到操作后，可以在独立数据运行时执行；HTTP / Worker 入口也可以调用该操作。

```ts
import {
    BaseController,
    createRuntime,
    defineApp,
    defineOperation,
    implementController,
} from "@finesoft/front";

type TotalInput = { unitPrice: number; quantity: number };
interface TotalResult {
    total: number;
}

class TotalController extends BaseController<TotalInput, TotalResult> {
    execute({ unitPrice, quantity }: TotalInput): TotalResult {
        return { total: unitPrice * quantity };
    }
}

const calculateTotal = defineOperation<TotalInput, TotalResult>({
    id: "calculate-total",
    kind: "query",
});
const runtime = createRuntime({
    app: defineApp({
        id: "data-example",
        operations: [calculateTotal],
        implementations: [implementController(calculateTotal, () => new TotalController())],
    }),
});

try {
    const result = await runtime.execute(calculateTotal, { unitPrice: 29, quantity: 2 });
    console.log(result); // { total: 58 }
} finally {
    await runtime.dispose();
}
```

操作声明定义输入输出契约，控制器负责实现。将操作暴露为 HTTP 接口仍需显式配置端点，注册控制器本身不会公开接口。

<Ch02RouteResolver />
