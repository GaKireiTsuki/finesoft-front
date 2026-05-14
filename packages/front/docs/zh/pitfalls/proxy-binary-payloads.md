# 陷阱：proxy 二进制载荷

## 症状

你把上游 proxy 出去，上游返回图片 / PDF / protobuf，然后：

- 图片过来损坏（缩略图碎裂、灰色块）
- PDF 打不开（"invalid PDF structure"）
- protobuf 客户端抛 "unexpected wire type" / 解码错
- 文件大小在源和 proxy 出去后略不一样

头看起来正常。状态 200。body 是坏的。

## 根因

早期版本的 proxy 通过 `response.text()` 转发响应。`text()` 把字节按 **UTF-8** 解码 —— JSON 和 HTML 可以，但**会破坏**任何非 UTF-8 字节序列：

- 非合法 UTF-8 的字节被替换为 `U+FFFD`（替换字符 `0xEF 0xBF 0xBD`）
- 解码后的字符串再 UTF-8 编码回响应时**得到与原始不同的字节序列**

PNG 以 `0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A` 开头 —— 开头的 `0x89` 不是合法 UTF-8，变成 `0xEF 0xBF 0xBD`。浏览器的图片解码从第 0 字节起看到垃圾，直接放弃。

当前实现用 `response.arrayBuffer()`，字节原样转发：

```ts
// packages/server/src/proxy.ts
const body = await resp.arrayBuffer();
return c.newResponse(body, resp.status, respHeaders);
```

字节级保留响应。图片正确显示、PDF 能打开、protobuf 能解码。

## 验证

框架自己的测试（`packages/server/test/proxy.test.ts`）用 PNG signature 检查：

```ts
const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
const fetchMock = vi.fn(
    async () =>
        new Response(binary, {
            status: 200,
            headers: { "Content-Type": "image/png" },
        }),
);

// ... handler 跑过之后 ...

expect(new Uint8Array(capturedBuffer)).toEqual(binary);
```

怀疑 proxy 在破坏二进制：

```bash
# 比较直连和 proxy 后的哈希
curl -s https://upstream.example/image.png | sha256sum
curl -s http://localhost:3000/api/image.png | sha256sum
```

哈希不同 = 破坏。哈希相同 = proxy 没事，看别处。

## 什么情况下会撞到

当前版本（用 `arrayBuffer`）不会撞到。这条陷阱主要作为以下场景的历史参照：

- **从旧版本升级** —— 升级后验证二进制端点
- **写自己的自定义 proxy 逻辑** —— 抄旧示例会把 bug 引回来
- **诊断你前面的第三方 proxy 是否也有同问题** —— 对它做同样的 `arrayBuffer` 测试

## 自定义 proxy —— 写对

你自己写 proxy 代码（在框架的 `registerProxyRoutes` 之外），用 `arrayBuffer`：

```ts
// 好
app.all("/api/*", async (c) => {
    const resp = await fetch(targetUrl);
    const body = await resp.arrayBuffer();
    return c.newResponse(body, resp.status, {
        "Content-Type": resp.headers.get("Content-Type") ?? "application/octet-stream",
    });
});
```

```ts
// 不好 —— 破坏非 UTF-8 字节
app.all("/api/*", async (c) => {
    const resp = await fetch(targetUrl);
    return c.text(await resp.text(), resp.status);
});
```

## 大 body 流式转发

> 10 MB 的响应，框架打包的 proxy 返回 HTTP 502，避免全部加载进内存。需要支持更大的响应，写流式 proxy：

```ts
app.all("/api/*", async (c) => {
    const resp = await fetch(targetUrl);
    return new Response(resp.body, {
        status: resp.status,
        headers: {
            "Content-Type": resp.headers.get("Content-Type") ?? "application/octet-stream",
        },
    });
});
```

`resp.body` 是 `ReadableStream`。直接返回它流式转字节不缓冲。但你失去大小守卫 —— 只在信任上游时这么干。

## 大小限制在两处

框架强制 `MAX_RESPONSE_SIZE = 10 * 1024 * 1024`（10 MB）在两条路径：

1. **运行时**（`registerProxyRoutes`）：先查 `Content-Length` 头，再查 fetch 后的 `body.byteLength`
2. **生成代码**（`generateProxyCode`）：serverless 内联版本发同样两条检查

改一处大小限制，两处都改。测试 `generated proxy code embeds the same response size limit as runtime (parity)` 强制这点。

## 为什么 `Content-Length` 和 `byteLength` 都要

`Content-Length` 是上游**声明**的。`byteLength` 是实际到达的。有些上游声明 `Content-Length: 1000` 但流 10MB。有些完全不发 `Content-Length`。

两次检查覆盖两种：

- 声明的 `Content-Length` 触发快速拒绝，避免下载 100MB 再拒
- 实际收到的字节数最终拒绝，防 `Content-Length` 缺失或撒谎

## 参考

- [第 9 章：服务器与部署 · proxy 路由](../09-server-and-deployment.md#proxy-路由)
- 实际实现：`packages/server/src/proxy.ts`
- 回归测试：`packages/server/test/proxy.test.ts`
