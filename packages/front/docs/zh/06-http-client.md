# 6. HTTP 客户端

`HttpClient` 是 `fetch` 之上的薄层、强类型包装，给你：

- 面向类的子类化，便于组织 API 表面
- 请求/响应拦截器：鉴权、日志、重试
- 结构化的 `HttpError` 替代不透明的 reject
- 大小写不敏感的头处理，与 `Response.headers.get()` 语义一致

它**不是** axios 的替代。它是为框架需求设计的小而锋利的工具。

## 子类化

预期用法是按每个逻辑 API 表面子类化：

```ts
import { HttpClient } from "@finesoft/front";

interface User {
    id: string;
    name: string;
}

interface NewUser {
    name: string;
    email: string;
}

export class UserApi extends HttpClient {
    async list(): Promise<User[]> {
        return this.get<User[]>("/users");
    }

    async getById(id: string): Promise<User> {
        return this.get<User>(`/users/${id}`);
    }

    async create(data: NewUser): Promise<User> {
        return this.post<User>("/users", data);
    }

    async update(id: string, data: Partial<NewUser>): Promise<User> {
        return this.patch<User>(`/users/${id}`, data);
    }

    async delete(id: string): Promise<void> {
        await this.delete(`/users/${id}`);
    }
}
```

每个子类实例绑定一个 `baseUrl` 和共享 options。

## 实例化

```ts
const api = new UserApi({
    baseUrl: "/api",
    defaultHeaders: {
        "X-App-Version": "1.0.0",
    },
});
```

注册到 DI 里让 Controller 能 resolve：

```ts
import { DEP_KEYS } from "@finesoft/front";

container.register("userApi", () => new UserApi({ baseUrl: "/api" }));
```

然后在 Controller 里：

```ts
async execute(params, container) {
    const api = container.resolve<UserApi>("userApi");
    const users = await api.list();
    return { kind: "users", items: users };
}
```

## 方法

| 方法                              | HTTP 动词 | 带 body？ |
| --------------------------------- | --------- | --------- |
| `get<T>(path, options?)`          | GET       | 否        |
| `post<T>(path, body?, options?)`  | POST      | 是        |
| `put<T>(path, body?, options?)`   | PUT       | 是        |
| `patch<T>(path, body?, options?)` | PATCH     | 是        |
| `delete<T>(path, options?)`       | DELETE    | 否        |

所有方法返回 `Promise<T>`。响应 body 按 `Content-Type` 解析：

- `application/json` → `JSON.parse`
- `text/*` → `string`
- 其他 → `Response`（你自己处理解析）

## 单次请求 options

```ts
await api.get<User>("/users/42", {
    headers: { "X-Request-Id": requestId },
    signal: abortController.signal,
    credentials: "include",
});
```

所有标准 `RequestInit` 字段直通。单次请求头与 `defaultHeaders` 合并（key 冲突时单次请求胜）。

## 拦截器

### 请求拦截器

请求发出前改 URL 和 `RequestInit`。

```ts
const api = new UserApi({
    baseUrl: "/api",
    requestInterceptors: [
        (url, init) => {
            init.headers = {
                ...init.headers,
                Authorization: `Bearer ${getToken()}`,
            };
            return init;
        },
    ],
});
```

多个拦截器按数组顺序跑。每个接收上一个返回的 `init`。

### 响应拦截器

`fetch` resolve 之后、body 解析之前检查 `Response`。

```ts
new UserApi({
    baseUrl: "/api",
    responseInterceptors: [
        async (response, url) => {
            if (response.status === 401) {
                await refreshToken();
                // 可选：throw 让你自己的代码触发重试
            }
            return response;
        },
    ],
});
```

返回不同的 `Response` 可以替换响应（如 5xx 时走缓存）。

### 动态添加拦截器

```ts
api.useRequestInterceptor((url, init) => {
    init.headers = { ...init.headers, "X-Trace-Id": traceId };
    return init;
});

api.useResponseInterceptor((resp) => {
    metrics.recordLatency(resp.url, performance.now() - start);
    return resp;
});
```

用于构造时不知道的横切关注点。

## 错误处理

`HttpClient` 对非 2xx 响应抛 `HttpError`：

```ts
import { HttpError } from "@finesoft/front";

try {
    const user = await api.getById("missing");
} catch (e) {
    if (e instanceof HttpError) {
        e.status; // 404
        e.statusText; // "Not Found"
        e.url; // "/api/users/missing"
        e.body; // unknown —— 已解析的响应 body（如可解析）
    }
}
```

网络错误（DNS、连接被拒、abort）会以标准 `TypeError` / `DOMException` 形式抛出，不是 `HttpError`。需要都关心的话两个都 catch：

```ts
try {
    await api.list();
} catch (e) {
    if (e instanceof HttpError) {
        if (e.status >= 500) showRetryBanner();
        else showInputError(e.body);
    } else {
        showOfflineBanner();
    }
}
```

## 服务端 vs 浏览器

`HttpClient` 直接用 `fetch`，Node 22+ 原生支持。无需平台特定代码。

浏览器端请求可以打：

- 你的框架自己的 proxy 路由（`/api/*` → 通过 `proxies` 配置去上游）
- 公网源直接（上游配好 CORS）

服务端请求通常打：

- 内网的内部服务
- 直接打 proxy 上游（SSR 时跳过 proxy hop）

如果你把 `/api` proxy 到 `https://upstream.example`，Controller 在 SSR 期间调 `api.get("/api/users")` 会走 proxy 再出网 —— 浪费。在服务端用 `baseUrl: process.env.UPSTREAM_URL`，在浏览器端用 `baseUrl: "/api"`，按 `framework.platform.isServer` 决定。

## 重试

框架不内置重试拦截器。自己包：

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === attempts - 1) throw e;
            if (e instanceof HttpError && e.status < 500) throw e; // 4xx 不重试
            await new Promise((r) => setTimeout(r, 2 ** i * 200));
        }
    }
    throw new Error("unreachable");
}

const user = await withRetry(() => api.getById(id));
```

作为外层包装而不是拦截器 —— 拦截器每次请求跑一次，重试逻辑需要重跑包括所有早期拦截器在内的整次请求。

## Abort 和超时

用 `AbortController`：

```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
    const user = await api.getById(id, { signal: controller.signal });
} finally {
    clearTimeout(timeout);
}
```

中途导航走的 Controller，把 controller 存起来并在 `fallback()` 清理或下次 dispatch 时 abort。

## 发非 JSON body

`post`/`put`/`patch` 默认 JSON 序列化 body，除非已经是 string、`FormData`、`URLSearchParams` 或 `Blob`：

```ts
// JSON（默认）
api.post("/users", { name: "Alice" });

// 表单
const form = new FormData();
form.append("file", file);
api.post("/upload", form);

// URL 编码
api.post("/login", new URLSearchParams({ user: "alice", pass: "secret" }));

// 原始文本
api.post("/webhook", "raw payload", { headers: { "Content-Type": "text/plain" } });
```

客户端对对象自动设 `Content-Type: application/json`，`FormData` 不动头（让浏览器自己设 multipart 边界）。

## 下一步

- [DI 容器](./07-di-container.md) —— 注册 API 客户端，按请求 scope 化实例
- [可观测性](./08-observability.md) —— 记录请求失败，监控里捕获
