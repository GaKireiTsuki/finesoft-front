# HTTP 客户端

`HttpClient` 是可选的类型化 fetch 封装，需要显式传入 `fetch`。服务端 DNS 校验需要主机提供查询能力；浏览器应用也必须显式选择 DNS 策略。

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
import { nodeDnsLookup } from "@finesoft/front/node";
const api = new UserApi({ baseUrl: "https://api.example.com", fetch, lookup: nodeDnsLookup });
```

浏览器可用绝对 API URL、所选 fetch 实现和 `validateDns: false` 构造同一个类，这表示明确交由浏览器解析 DNS。服务端缺少必需能力时，不应静默关闭校验。默认禁止内部或回环地址；确有需要时，由主机配置显式允许。

需要作用域业务服务时，声明类型化 provider，并通过 `context.get(token)` 获取，见[依赖注入](./07-di-container.md)。绑定本次调用的 fetch 和 signal，让请求能够接收取消信号。命令取消前可能已完成写入，取消不会回滚；操作运行时不会自动重试或缓存命令。

请求和响应拦截器按注册顺序执行。`HttpError` 表示非成功 HTTP 结果。泛型返回类型描述预期数据；必要时应在业务边界校验不可信的响应内容。底层受保护方法为 `get`、`post`、`put`、`del` 和 `request`；`get` / `del` 的查询参数位于请求选项之前。
