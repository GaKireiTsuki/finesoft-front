# HTTP 客户端

`HttpClient` 是可选的类型化 fetch 封装，需要显式传入 `fetch`。服务端的连接地址校验由主机提供；浏览器应用也必须显式选择 DNS 策略。

```ts
import { HttpClient, type HttpClientConfig } from "@finesoft/front";
interface User {
    id: string;
    name: string;
}
export class UserApi extends HttpClient {
    constructor(config: HttpClientConfig) {
        super(config);
    }
    getById(id: string, signal?: AbortSignal) {
        return this.get<User>(`/users/${encodeURIComponent(id)}`, undefined, { signal });
    }
    create(user: Omit<User, "id">) {
        return this.post<User>("/users", user);
    }
    remove(id: string) {
        return this.del<void>(`/users/${encodeURIComponent(id)}`);
    }
}
```

## 主机绑定

```ts
// Node 主机代码；浏览器和 Worker 模块不要引入此入口。
import { nodeSafeFetchOptions } from "@finesoft/front/node";
const api = new UserApi({ baseUrl: "https://api.example.com", fetch, ...nodeSafeFetchOptions });
```

浏览器可用绝对 API URL、所选 fetch 实现和 `validateDns: false` 构造同一个类，这表示明确交由浏览器解析 DNS。服务端缺少必需能力时，不应静默关闭校验。默认禁止内部或回环地址；确有需要时，由主机配置显式允许。

Node 入口随包提供按需加载的连接传输实现，无需额外安装传输依赖。标准 Node/Vercel/Netlify 主机、开发和预览主机使用 `nodeSafeFetchOptions`：实际创建连接时查询并校验全部 DNS 地址，将同一结果交给 socket，保留主机名、TLS SNI、请求取消及连接复用。连接池按需加载，不进入浏览器或 Worker 模块。自定义 Node fetch 必须支持 Undici `dispatcher` 选项。单独使用 `nodeDnsLookup` 只做预检，不能防止查询与连接之间的 DNS 重绑定。

受保护的 fetch 逐跳校验重定向，最多跟随 20 次，跨源时移除认证和 Cookie 请求头。显式 `manual` / `error` 模式保持原意。浏览器不可读取的 opaque redirect 会拒绝；需要重发 body 的重定向不缓冲或重放 `Request.body` / 流式 body，请使用可重放的 `RequestInit.body`（如字符串）或最终 URL。`allowInternalHosts: true` 是完全退出这些保护的显式配置。

需要作用域业务服务时，声明类型化 provider，并通过 `context.get(token)` 获取，见[依赖注入](./07-di-container.md)。绑定本次调用的 fetch 和 signal，让请求能够接收取消信号。命令取消前可能已完成写入，取消不会回滚；操作运行时不会自动重试或缓存命令。

请求和响应拦截器按注册顺序执行。`HttpError` 表示非成功 HTTP 结果。泛型返回类型描述预期数据；必要时应在业务边界校验不可信的响应内容。底层受保护方法为 `get`、`post`、`put`、`del` 和 `request`；`get` / `del` 的查询参数位于请求选项之前。
