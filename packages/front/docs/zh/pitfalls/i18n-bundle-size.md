# 陷阱：i18n 包体积

## 症状

Lighthouse 抱怨首屏 JS 载荷过大。网络面板首屏有个巨大 chunk。你的 `dist/client/assets/index-*.js` 比应有的大，`vp build --analyze` 显示 messages 文件夹占了 bundle 的大头。

## 根因

翻译被打进了主客户端 chunk 而不是按 locale 拆。要么：

- 你在模块顶层直接 import 了 `src/locales/*.json`：

    ```ts
    import zh from "../locales/zh-Hans.json";
    import en from "../locales/en-US.json";
    import ja from "../locales/ja-JP.json";
    ```

    三个 locale 都进了每个用户的 bundle，即使每个用户只看到一种。

- 你在模块顶层构造了一个 `Translator`，所有 messages 都内联：

    ```ts
    const t = new SimpleTranslator({
        locale: "en-US",
        messages: { ...zhMessages, ...enMessages, ...jaMessages },
    });
    ```

- 你通过 `serializeServerData` 把翻译序列化进了 HTML，每个 SSR 页面响应都带全字典。

## 修法

### 用 `messagesDir` 而不是静态 import

配置 Vite 插件：

```ts
finesoftFrontViteConfig({
    i18n: { messagesDir: "src/locales" },
});
```

插件生成按 locale 的 loader。服务端从磁盘读；浏览器端动态 import 对应 chunk。Vite 把每个 locale 的 JSON 拆成独立 chunk，只有匹配解析后 locale 的 chunk 被请求。

```
dist/client/assets/
├── index-abc123.js       ← 主 bundle（无翻译）
├── locale-en-US-def456.js ← 只有 en-US 访客加载
├── locale-zh-Hans-789.js  ← 只有 zh-Hans 访客加载
└── locale-ja-JP-xyz.js    ← 只有 ja-JP 访客加载
```

### 别把翻译序列化进 HTML

框架**故意不**把字典放进 `PrefetchedIntents`。浏览器和初始渲染并行拉自己的 locale chunk。

如果你在用自己的机制手动注入翻译进页面，停下：

```html
<!-- 不好 —— 每个 SSR 响应都带字典 -->
<script>
    window.__TRANSLATIONS__ = { hello: "你好" /* 几百个 key */ };
</script>
```

```ts
// 好 —— 框架作为独立 chunk 加载
// （用 messagesDir 时自动处理）
```

### 检查实际发了什么

```bash
vp build
ls -lah dist/client/assets/locale-*
ls -lah dist/client/assets/index-*
```

加新 locale JSON 时 index chunk 应该不变。变了就有问题。

可视化拆解：

```bash
vp build --analyze
```

打开交互式 bundle treemap。locale chunk 应该小（KB 级）、独立、有名字。

## 「多大算太大」

首屏关键 JS（index chunk）大致阈值：

- 静态营销站：<50 KB gzipped
- 标准 SPA：<150 KB gzipped
- 重 dashboard：<300 KB gzipped

翻译把 index chunk 推过这些，就该拆开。按 locale 的 10-50 KB chunk 正常，不用担心。

## 服务端：字典被缓存，不打包

服务端框架第一次请求时从磁盘读 locale JSON 并缓存：

```
请求 1（zh-Hans）：磁盘读 zh-Hans.json，缓存
请求 2（zh-Hans）：从缓存返回
请求 3（en-US）：磁盘读 en-US.json，缓存
```

你也不发巨大的 SSR bundle —— `tsdown` 打包服务端入口，但 locale JSON 是运行时从磁盘读的，没嵌入。

这意味着：

- ✅ 冷启动成本：每个 locale 一次磁盘读，每个 worker 一次
- ✅ 稳态：零开销 —— locale 留在 `Map` 里
- ❌ 可变性：编辑 JSON，服务器保持缓存的旧版本直到重启

可变性问题通常不是问题 —— 翻译入源代码控制，重新部署就重新加载。运行时更新翻译的话，用自定义 `loadMessages` 回调从服务拉。

## 字典确实巨大怎么办

单 locale 字典是几 MB（罕见 —— 大多数应用 <100 KB）：

### 按 namespace 拆

```
src/locales/
├── en-US/
│   ├── common.json
│   ├── checkout.json
│   ├── admin.json
│   └── help-center.json
└── zh-Hans/
    └── ...
```

写自定义 `loadMessages` 只加载某页面需要的 namespace：

```ts
createSSRRender({
    bootstrap,
    async loadMessages(locale) {
        // 只 eager 加载 "common"；其他按需懒加载
        return import(`./locales/${locale}/common.json`);
    },
    async renderApp(page) {
        /* ... */
    },
});
```

视图层渲染 admin 字符串前调 `await translator.loadNamespace("admin")`。

### 视图挂载时懒加载

非常大的可选字典（帮助内容、错误码消息），从视图层按需拉，而不是框架启动时。框架不需要知道 —— 它们只是数据。

## 网络侧优化

正确拆分后还能加速 locale 拉取：

- 给 locale chunk 设长 `Cache-Control`（Vite 内容 hash 文件名让这安全）
- 预加载用户的 locale chunk：
    ```html
    <link rel="preload" href="/assets/locale-en-US-def456.js" as="script" crossorigin />
    ```
- 高流量应用，让 locale chunk 走主 JS 同一 HTTP/2 连接 push

## 为什么不直接把翻译放 HTML

因为：

- 每个页面响应都带完整字典 —— 包括用户从不访问的页面的内容
- 当 HTML 按 locale 变化并含字典时，CDN 层无法缓存
- SSR 延迟随字典大小线性增长

按 locale 的 chunk 是正确权衡：发一次、永久缓存、只对用户实际拥有的 locale 发。

## 参考

- [第 5 章：i18n](../05-i18n.md) —— locale 处理全貌
- Vite 插件源：`packages/server/src/vite-plugin.ts`（搜 `messagesDir`）
