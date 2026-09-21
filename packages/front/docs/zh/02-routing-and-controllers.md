# 路由、控制器与类型化页面

六个模板均使用 `BaseController` 加载页面。它继续作为公开 API 提供；`definePage` 将控制器工厂或函数处理器接入 Web 应用，两种写法共用运行时、执行作用域和策略。

## 各层职责

| API                               | 职责                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `BaseController<TInput, TResult>` | 实现 `execute`，通过继承的 `perform` 处理参数、取消和 `fallback`  |
| `definePage({ id, create })`      | 声明页面加载工厂，生成可复用的 `route`、`leaf` 和 `bindView` 引用 |
| `defineWebApp`                    | 组装页面声明、路由、守卫及可选导航结构                            |
| 原生页面组件                      | 接收 `page` 数据，渲染 UI 和处理交互                              |

控制器、页面、路由与公开数据声明统一从 `@finesoft/front` 导入。

## 用 BaseController 加载页面

`src/lib/controllers/product.ts`：

```ts
import { BaseController, DEP_KEYS } from "@finesoft/front";
import { markPublic, type BasePage } from "@finesoft/front";

export interface ProductPage extends BasePage {
    pageType: "product";
    product: { id: number; name: string };
}

export class ProductController extends BaseController {
    async execute({ params, context }): Promise<ProductPage> {
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

    override fallback({ params }): ProductPage {
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

框架根据下方路由声明维护类型导入、方法注解和基类泛型；这里展示首次编写时的源码，省略自动生成的引用。运行 `vp dev`、`vp check` 或构建即可生成。类型集中在 `.finesoft/controller-types.d.ts`，Controller 文件末尾不再追加声明区块。配置方式见[控制器类型自动关联](./11-navigation.md)。

两个方法统一接收一个对象：`execute({ params, query, context })` 和 `fallback({ params, query, context, error })`，只解构需要的字段即可。Query 与路径参数分开，根据路由中的 `query` 声明推断类型。

这个示例使用本地数据；实际业务可以在 `execute` 中调用服务。`context` 提供当前执行的 `signal`、`fetch`、`get(token)` 和 `execute(operation, input)`。执行异步请求时，将 `context.signal` 传给请求 API，取消才能传递到实际工作。

`fallback` 仅在 `execute` 发生普通异常时调用，返回类型仍是 `ProductPage`；示例选择展示不可用状态。未覆写时默认重新抛出错误，交给页面加载流程的错误处理。取消、`AbortError` 和 `ExecutionError("cancelled")` 会继续抛出，不进入 `fallback`。运行时策略在控制器外执行，策略拒绝也不会由控制器回退处理。

## 注册工厂、路由与导航目标

`src/app-definition.ts`：

```ts
import { int } from "@finesoft/front";
import { definePage, defineWebApp } from "@finesoft/front";
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

页面声明拥有唯一操作标识，控制器不再重复声明 intentId。URL `/products/42` 经 `int()` 解码后，`execute` 收到 `params: { id: 42 }`；代码内的 `product.leaf({ id: 42 })` 保留同样的参数类型。

`create` 每次实际执行时返回新控制器。声明、路由发现及引用辅助方法只读取定义；命中已预取或保留的页面结果时也无需创建控制器。请求身份放在执行上下文或有作用域的 provider 中；页面草稿放在页面实例中。

`id` 是操作标识，`pageType` 选择视图，每个叶子节点生成独立 EntryId。`product.bindView("product", ProductView)` 检查结果中的字面量页面类型，不从操作 id 推断类型。显式保留 `ProductPage.pageType: "product"` 才能获得该检查；宽泛的 `BasePage.pageType: string` 无法约束视图名称。

类型化叶子参数保留控制器类型；外部 URL 仍需显式 codec 解码。泛型提供编译期类型约束，不替代运行期输入校验，也不会自动证明任意 codec 与业务校验规则等价。

## 简单页面的函数写法

只需直接返回页面数据时，可以使用 `handler`。它也能通过执行上下文使用依赖、取消和嵌套操作；需要回退逻辑时，在函数内自行处理。`create` 和 `handler` 二选一。

```ts
import { definePage, markPublic } from "@finesoft/front";

export const home = definePage({
    id: "load-home",
    handler: () => markPublic({ id: "home", pageType: "home" as const, title: "Home" }, []),
});
```

模板采用控制器类来保持组织方式一致；函数形式适用于简短加载逻辑。既有函数处理器接收 `(params, context, query)`。继承基类是可选的，实现 `perform(params, context, query)` 契约也能由 `create` 工厂接入。

## 服务端 Controller 与两种上下文

需要机密、HttpOnly Cookie 或响应设置的页面使用 `@finesoft/front` 的 `BaseServerController`。方法仍然是 `execute({ params, query, context })` / `fallback({ params, query, context, error })`，路由仍通过 `definePage({ create, routes })` 注册。类型生成器识别基类并维护同样简短的 `Input` / `Failure` 引用，不需要第二套路由声明。

```ts
import { BaseServerController } from "@finesoft/front";
import { markPublic } from "@finesoft/front";
import { loadAccount } from "./account-service";

export class AccountController extends BaseServerController {
    async execute({ params, context }) {
        const account = await loadAccount(params.id, context.getCookie("session"));
        context.responseHeaders.set("Cache-Control", "private, no-store");
        return markPublic(
            { id: String(params.id), pageType: "account", title: account.name, account },
            { account: { id: true, name: true } },
        );
    }
}
```

示例省略框架自动维护的类型注解。`account-service` 是业务实现；Controller 可以放在任意业务目录。Vite 根据继承关系替换整个服务端 Controller 模块，浏览器获得调用代理；SSR 保留原实现并直接执行。客户端导航通过同站 `POST /__finesoft/controller` 加载公开页面数据，服务端重新解析路由、执行策略和守卫。首次水合使用已有 SSR 数据，不重复请求。

| 能力                                                   | 共享 `BaseController` 的页面上下文     | `BaseServerController`              |
| ------------------------------------------------------ | -------------------------------------- | ----------------------------------- |
| `params`、`query`                                      | 独立输入，按路由推断                   | 相同                                |
| `context.url`、`path`、`intent`、`isServer`            | 当前页面与执行位置                     | 相同，`isServer` 为 `true`          |
| `getCookie(name)`                                      | 浏览器可读 Cookie；SSR 当前请求 Cookie | 读取原始请求 Cookie，包含 HttpOnly  |
| `getHeader(name)`                                      | SSR 请求头；浏览器无服务端请求头       | 当前服务端请求头                    |
| `get(token)`、`fetch`、`signal`、`execute`、日志和追踪 | 现有执行上下文                         | 相同                                |
| `request`、`responseHeaders`                           | 无专用接口                             | 原始 `Request` 与最终响应头         |
| `setCookie`、`deleteCookie`                            | 无专用接口                             | 写入最终响应，不改变原始请求 Cookie |

自动生成的页面 `Input` 使用 `ControllerContext` 或 `ServerControllerContext`。独立数据操作仍使用可移植的 `ExecutionContext`；直接执行 Page operation、没有导航时，`url` / `path` 为空。远程调用的 `request.url` 是传输端点地址，页面地址请使用 `context.url`。

### 构建边界

服务端 Controller 模块只导出 Controller 类和类型。该模块的本地运行时依赖也属于服务端边界；客户端直接导入这些依赖会报错。共享类型请使用 `import type`，共享的客户端实现放在独立模块。构造函数内的依赖创建属于受保护模块；不要在共享的 `create` 工厂参数、共享配置或页面组件中写入机密。

生产客户端 JS / source map 不包含被替换的实现。开发服务拒绝 Controller 的原始资源导入和受保护依赖的源码请求。模块与依赖索引在启动时建立，后续缓存 AST，只重新分析变更文件；开发期间已识别的私有依赖保持保护，若要将它迁回共享模块，应重启开发服务。动态计算的文件路径、`public/` 资源和另行复制的源码不属于静态导入边界。开发服务器仍只用于受信任的开发环境。

使用框架 Vite 插件及具有 SSR 请求处理能力的 Node / Worker 等宿主。纯静态托管没有远程执行端点。此入口用于注册的服务端页面 Controller，不会自动发布任意方法或代替登录、注册等命令端点。

### 显式传递请求与响应信息

框架提供 `request`、`getHeader`、`getCookie`、`fetch`、`responseHeaders`、`setCookie` 和 `deleteCookie` 等通用工具。登录状态、鉴权、令牌存储与刷新，以及凭据是否传递，均由业务代码决定。

服务端 `context.fetch` 只使用调用者提供的请求头，不会从外层请求自动继承 Cookie / Authorization，也不会把内部响应的 `Set-Cookie` 自动复制到页面响应。`credentials` 选项不会在服务端创建或启用 Cookie 存储。浏览器发起请求时，Cookie 仍遵循浏览器原生的同站请求规则。

例如，业务选择给一个内部接口传递 Authorization，并将该接口返回的 Cookie 写入最终响应：

```ts
const headers = new Headers();
const authorization = context.getHeader("authorization");
if (authorization) headers.set("authorization", authorization);

const response = await context.fetch("/api/account", { headers });
for (const cookie of response.headers.getSetCookie()) {
    context.responseHeaders.append("set-cookie", cookie);
}
```

选择哪些请求头、哪些响应 Cookie、发给哪个接口，都是上面业务代码的决定。需要多处复用时，可放进业务 `HttpClient` 拦截器或请求作用域服务，通过 `context.get` 使用。

业务也可以直接构造响应 Cookie：

```ts
context.setCookie("theme", "dark", { path: "/", sameSite: "Lax" });
context.deleteCookie("theme", { path: "/" });
```

`getCookie` 始终读取本次收到的请求；写响应 Cookie 不会修改它，也不会自动更新任何用户身份。后续业务逻辑需要新值时，使用业务自身保存的结果。`responseHeaders` 是显式响应写入工具；框架负责组装最终响应，包括错误响应中的业务响应头，同时保留框架错误正文类型及禁用缓存的约束。

远程请求提供的 `context` / `bindings` 不会成为可信身份。`markPublic` 继续控制发给浏览器的数据字段，机密也不能直接渲染进 HTML。

## 独立业务操作也可以用控制器

`BaseController` 的结果泛型不要求是页面。通过 `implementController` 将类绑定到操作后，可以在独立数据运行时执行；HTTP / Worker 入口也可以调用该操作。

```ts
import {
    BaseController,
    createRuntime,
    defineApp,
    defineOperation,
    implementController,
    type ControllerInput,
} from "@finesoft/front";

type TotalInput = { unitPrice: number; quantity: number };
interface TotalResult {
    total: number;
}

class TotalController extends BaseController<ControllerInput<TotalInput>, TotalResult> {
    execute({ params }: ControllerInput<TotalInput>): TotalResult {
        return { total: params.unitPrice * params.quantity };
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
