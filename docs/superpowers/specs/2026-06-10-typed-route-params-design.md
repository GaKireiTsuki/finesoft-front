# 路由参数类型化（Typed Route Params）设计

- **日期**：2026-06-10
- **状态**：设计已定稿，待实现
- **影响包**：`@finesoft/core`（主要）、`@finesoft/browser`、`@finesoft/ssr`、`@finesoft/front`（导出面）；`@finesoft/server` 零改动
- **相关源**：`packages/core/src/router/router.ts`、`packages/core/src/bootstrap/define-routes.ts`、`packages/core/src/intents/{types,base-controller}.ts`、`packages/core/src/framework.ts`

---

## 1. 背景与动机

当前路由参数的处理链路：

1. `Router.add(pattern, intentId)` 把 `/:param`、`/:param?` 编译成正则 + `paramNames`。
2. `Router.resolve(url)` 匹配成功后，把 **path 捕获组**和 **query 参数**统一合并进一个 null-prototype 的 `Record<string, string>`，作为 `intent.params`。
3. `BaseController<TParams, TResult>` 的 `TParams` 是子类**手写的「愿望类型」**，`perform` 直接 `intent.params as TParams` 强转。

三个痛点：

- **全是字符串**：需要 number/boolean/枚举时，controller 要自己 `parseInt` / 比较字面量。
- **零运行时验证**：`/product/abc` 会匹配 `/product/:id`，controller 收到 `id="abc"` 这样的脏数据，没有任何拦截。
- **类型契约虚假**：`TParams` 与实际 URL 解析结果没有任何保证，`as` 强转掩盖了不一致。

路由参数是**系统边界上的用户输入**，对它做校验与类型化正是框架应当提供的能力，与项目既有的边界安全意识（null-prototype 防原型污染）一致。

---

## 2. 目标 / 非目标

### 目标

1. **运行时验证**：参数不符合声明类型时拦截。
2. **类型转换**：`string` → `number` / `boolean` / 字面量联合等。
3. **编译期类型推断**：`execute(params)` 拿到精确强类型，免手写泛型与 `parseInt`。
4. **零依赖底座**：内置一组原语，开箱即用，不强制用户安装任何校验库。
5. **生态可扩展**：内置原语和 zod/valibot/arktype 走同一条校验路径（Standard Schema）。
6. **path + query 都覆盖**。
7. **path 参数名一致性**：从 `path` 字面量类型推导参数名，`params` 写入 path 中不存在的参数名立即类型报错（防 typo）。`params` 的 key 为**可选**——可只为部分 path 参数声明 codec，未声明的参数保持 `string`（渐进增强、向后兼容；缺失某参数的 codec 不报错）。

### 非目标（v1 不做，留作未来增强）

- 不做链式校验 DSL（`.min().max().refine()`）——内置原语用 options 对象参数；复杂校验交给 zod/valibot。
- 不做 query 参数的 key 一致性校验（query 是开放集合，无来源可约束）。
- 不做多值 query（`?tag=a&tag=b` → 数组）的内置原语——v1 query codec 面向单值；多值留未来。
- 不引入 `400 Bad Request` 这条独立错误通道（见决策 3）。

---

## 3. 核心设计

### 3.1 统一契约：内置原语实现 Standard Schema

不发明新接口。**内置原语自身实现 [Standard Schema v1](https://standardschema.dev) 的 `~standard` 接口**，框架内部只认这一种契约，内置原语与用户的 `z.xxx()` 零分支统一处理。

Standard Schema v1 接口（**纯 type-level 规范 + 运行时鸭子类型，框架不 import 任何库**，已于 2026-06-10 核对官方 spec）：

```ts
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (
            value: unknown,
        ) => StandardResult<Output> | Promise<StandardResult<Output>>;
        readonly types?: { readonly input: Input; readonly output: Output };
    };
}

type StandardResult<Output> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<StandardIssue> };

interface StandardIssue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

// 框架自带的最小类型别名，避免运行时依赖 @standard-schema/spec
type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];
```

> **关键约束（来自 spec 核对）**：`validate` 可能返回 `Promise`。框架支持异步校验（见 3.5、决策 5）。

参数 codec 类型别名：

```ts
type ParamSchema<T = unknown> = StandardSchemaV1<string, T>;
```

### 3.2 内置原语（零依赖，新增 `packages/core/src/router/params/`）

每个构造器返回一个实现了 `~standard` 的对象，`validate` 同步执行。

| 构造器                   | 输入 → 输出                             | 校验内容                                          |
| ------------------------ | --------------------------------------- | ------------------------------------------------- |
| `str(opts?)`             | `string` → `string`                     | `minLength` / `maxLength` / `pattern`（`RegExp`） |
| `int(opts?)`             | `string` → `number`                     | `Number.isInteger` + `min` / `max`                |
| `num(opts?)`             | `string` → `number`                     | `Number.isFinite` + `min` / `max`                 |
| `bool()`                 | `"true"\|"1"\|"false"\|"0"` → `boolean` | 成员集合，其余 issue                              |
| `oneOf(values as const)` | `string` → 字面量联合                   | `values.includes(raw)`                            |
| `uuid()`                 | `string` → `string`                     | UUID v1–v5 正则                                   |

`opts` 示例：

```ts
int({ min: 1 }); // 正整数
str({ minLength: 1, maxLength: 64 }); // 非空、限长
oneOf(["asc", "desc"] as const); // 输出类型 "asc" | "desc"
```

#### 修饰器（包装函数，保持 codec 为纯数据）

```ts
optional<T>(codec: ParamSchema<T>): ParamSchema<T | undefined>;
//   输入缺失（undefined）→ { value: undefined }；否则委托内部 codec。

withDefault<T>(codec: ParamSchema<T>, fallback: T): ParamSchema<T>;
//   输入缺失 → { value: fallback }；否则委托内部 codec。
```

> 不采用链式 `.optional()`，以保持 codec 是可序列化的纯数据对象，且与外部 Standard Schema 统一。

### 3.3 路由定义扩展：`params`（path）与 `query` 分字段

`RouteDefinition` 拆出两个互补字段，`params` 的 key 受 `path` 字面量约束（决策 7），`query` 开放：

```ts
type QuerySchemaMap = Record<string, StandardSchemaV1<string, unknown>>;

interface RouteDefinition<
    Path extends string = string,
    P extends ParamsFor<Path> = ParamsFor<Path>,
    Q extends QuerySchemaMap = QuerySchemaMap,
> {
    path: Path;
    intentId: string;
    controller?: IntentController;
    /** path 参数 codec；key 必须是 path 中出现的 :param 名 */
    params?: P;
    /** query 参数 codec；key 自由开放 */
    query?: Q;
    renderMode?: RenderMode;
    beforeLoad?: BeforeLoadGuard[];
    afterLoad?: AfterLoadGuard[];
}
```

用法：

```ts
const productParams = { id: int({ min: 1 }) };
const productQuery = {
    page: withDefault(int({ min: 1 }), 1),
    sort: oneOf(["asc", "desc"] as const),
};

class ProductController extends BaseController<
    InferParams<typeof productParams> & InferQuery<typeof productQuery>, // { id: number } & { page: number; sort: "asc" | "desc" }
    ProductPage
> {
    readonly intentId = "product";
    execute(params, container) {
        // params.id: number, params.page: number, params.sort: "asc" | "desc"
    }
}

defineRoutes(framework, [
    {
        path: "/product/:id",
        intentId: "product",
        controller: new ProductController(),
        params: productParams,
        query: productQuery,
    },
]);
```

### 3.4 类型推断链

```ts
// 1. 从 path 字面量提取参数名（处理可选 :param?）
type StripOptional<S extends string> = S extends `${infer N}?` ? N : S;
type ExtractParamNames<Path extends string> = Path extends `${infer _Head}:${infer Rest}`
    ? Rest extends `${infer Name}/${infer Tail}`
        ? StripOptional<Name> | ExtractParamNames<`/${Tail}`>
        : StripOptional<Rest>
    : never;
// ExtractParamNames<"/product/:id">            → "id"
// ExtractParamNames<"/post/:slug/:page?">      → "slug" | "page"

// 2. params 字段的形状约束（6c 一致性的载体）；key 可选——允许只为部分参数声明 codec
type ParamsFor<Path extends string> = {
    [K in ExtractParamNames<Path>]?: ParamSchema;
};

// 3. 从 codec map 推导运行期类型
type InferParams<P extends Record<string, StandardSchemaV1>> = {
    [K in keyof P]: InferOutput<P[K]>;
};
type InferQuery<Q extends QuerySchemaMap> = {
    [K in keyof Q]: InferOutput<Q[K]>;
};
```

> **实现注记**：
>
> - `ExtractParamNames` 须与 `Router.add` 的分段正则 `/(\/:[\w]+\??)/` 对齐（参数名为 `\w+`，可带尾随 `?`）。类型测试用 `expectTypeOf` 锁定若干 path 形态。
> - `optional()` / `withDefault()` 让 `InferOutput` 含 `undefined` 时，是否进一步把该 key 渲染成可选属性（`page?: number`）由实现细化；v1 至少保证值类型为 `T | undefined`。
> - **locale 前缀参数**：`defineRoutes({ locales })` 自动生成的 `/:locale/...` 路由，其 `:locale` 由框架注入并保持 `string`，**不纳入用户 codec、不参与 `ParamsFor` 约束**——一致性校验只针对用户书写的原始 `path`。
> - **`defineRoutes` 数组形态下使 6c 生效**：要让数组中每条路由的 `params` 受其自身 `path` 字面量约束，`defineRoutes` 需用映射元组类型保留字面量，形如 `definitions: { [I in keyof Defs]: Defs[I] extends { path: infer P extends string } ? RouteDefinition<P> : RouteDefinition }`。若该形态在实践中难以稳定达成（异构元组 + 跨字段依赖是 TS 已知难点），**回退方案**：提供 `route(path, def)` 单数 helper 做单条强类型构造，再把结果数组传入 `defineRoutes`。实现阶段先验证数组形态，不通则切回退。

### 3.5 Router 集成：异步 resolve + 校验 + fall-through

`Router.add` 内部 `InternalRouteDefinition` 新增 `paramCodecs?: Record<string, ParamSchema>` 与 `queryCodecs?: QuerySchemaMap`。

`resolve` 改为异步，按路由顺序逐条尝试；任一参数校验失败则当前路由视为不匹配、`continue` 到下一条（实现 fall-through）：

```ts
async resolve(urlOrPath: string): Promise<RouteMatch | null> {
  const { path, queryParams } = this.parseUrl(urlOrPath);

  for (const route of this.routes) {
    const m = path.match(route.regex);
    if (!m) continue;

    const params = createNullPrototypeRecord(); // 维持防原型污染
    let ok = true;

    // —— path 参数 ——
    for (let i = 0; i < route.paramNames.length && ok; i++) {
      const name = route.paramNames[i];
      const raw = m[i + 1]; // 可选参数缺失时为 undefined
      const codec = route.paramCodecs?.[name];
      if (codec) {
        const r = await runStandard(codec, raw);
        if (!r.ok) { ok = false; break; }
        if (r.value !== undefined) params[name] = r.value;
      } else if (raw) {
        params[name] = raw; // 无 codec → 保持 string（向后兼容）
      }
    }
    if (!ok) continue;

    // —— query 参数：声明了 codec 的走校验 ——
    for (const [name, codec] of Object.entries(route.queryCodecs ?? {})) {
      const r = await runStandard(codec, queryParams[name]); // 缺失 → undefined
      if (!r.ok) { ok = false; break; }
      if (r.value !== undefined) params[name] = r.value;
    }
    if (!ok) continue;

    // —— 未声明 codec 的 query 参数：保持 string（向后兼容） ——
    for (const [k, v] of Object.entries(queryParams)) {
      if (!(k in params) && !(route.queryCodecs && k in route.queryCodecs)) {
        params[k] = v;
      }
    }

    return {
      intent: { id: route.intentId, params },
      action: makeFlowAction(urlOrPath),
      renderMode: route.renderMode,
      beforeGuards: route.beforeGuards,
      afterGuards: route.afterGuards,
    };
  }

  return null;
}
```

校验执行助手，吸收同步/异步差异，并把异步 Standard Schema 在 v1 的处理策略集中到一处：

```ts
async function runStandard(
    schema: StandardSchemaV1,
    raw: string | undefined,
): Promise<{ ok: true; value: unknown } | { ok: false; issues: readonly StandardIssue[] }> {
    const out = schema["~standard"].validate(raw);
    const result = out instanceof Promise ? await out : out;
    if (result.issues) return { ok: false, issues: result.issues };
    return { ok: true, value: result.value };
}
```

**失败可观测性**：fall-through 时由 `Router` 持有的 logger（或返回结构化原因）`debug` 记录「路由 `<pattern>` 因参数 `<name>` 校验失败被跳过：`<message>`」，避免「类型不符」被静默当成 404 难以排查。

### 3.6 失败语义：fall-through → 现有 404

校验失败 = 当前路由不匹配，继续尝试后续路由；全不中时 `resolve` 返回 `null`，**完全复用既有 404 路径**：

- SSR：`render.ts:220` → `getErrorPage(404, "Page not found")`
- 浏览器：`start-app.ts:173`、`flow-action.ts:215` → `Promise.reject(new Error("404"))`

允许重叠路由按注册顺序渐进匹配（如 `/item/:id` 用 `int()`，落空后由 `/item/:slug` 用 `str()` 接住）。零新增错误传播管线。

---

## 4. 关键决策记录

| #   | 决策       | 选择                                  | 理由                                                                   |
| --- | ---------- | ------------------------------------- | ---------------------------------------------------------------------- |
| 1   | 核心定位   | 验证 + 转换 + 编译期推断三位一体      | 用户明确要最完整形态                                                   |
| 2   | API 形态   | 混合：内置原语 + 任意 Standard Schema | 零依赖底座 + 生态可扩展，原语满足 80% 场景                             |
| 3   | 失败语义   | 不匹配 → fall-through → 现有 404      | 复用现有 `resolve()→null→404`，零新增错误通道，支持重叠路由            |
| 4   | 范围       | path + query 都类型化                 | 两者最终都在 `intent.params`，统一处理                                 |
| 5   | 同步约束   | **支持异步校验**（resolve 异步化）    | 5 个调用点已在 async 上下文，成本仅「2 签名 + 5 await」，server 零改动 |
| 6   | 一致性校验 | **v1 就做** path/params 类型级一致性  | 用户要求；模板字面量类型可达成                                         |
| 7   | 字段组织   | `params`(path) 与 `query` 分字段      | 让 6c 校验干净：`params` key 受 path 约束、query 开放                  |

---

## 5. 改动清单（按包）

### `@finesoft/core`

- **新增** `src/router/params/`：
    - `standard.ts`：`StandardSchemaV1` / `StandardResult` / `StandardIssue` / `InferOutput` 类型别名 + `runStandard` 助手。
    - `primitives.ts`：`str` / `int` / `num` / `bool` / `oneOf` / `uuid`。
    - `modifiers.ts`：`optional` / `withDefault`。
    - `infer.ts`：`ExtractParamNames` / `ParamsFor` / `InferParams` / `InferQuery` / `ParamSchema` / `QuerySchemaMap`。
- **改 `src/router/router.ts`**：
    - `add(pattern, intentId, opts)` 的 `opts` 增加 `paramCodecs` / `queryCodecs`；`InternalRouteDefinition` 同步增加字段。
    - `resolve` 改为 `async resolve(...): Promise<RouteMatch | null>`，加入 3.5 的校验流程。
- **改 `src/bootstrap/define-routes.ts`**：`RouteDefinition` 泛型化（`Path`/`P`/`Q`），透传 `params`/`query` 到 `router.add`；`defineRoutes` 保留每条路由的字面量类型以使一致性校验生效。
- **改 `src/framework.ts`**：`routeUrl` 改为 `async routeUrl(url): Promise<RouteMatch | null>`。
- **改 `src/intents/types.ts`**：`Intent.params` 由 `Record<string, string>` 放宽为 `Record<string, unknown>`。
- **改 `src/intents/base-controller.ts`**：`TParams` 约束由 `Record<string, string | undefined>` 放宽为 `Record<string, unknown>`。
- **改 `src/index.ts`**：导出原语、修饰器、类型（`ParamSchema`/`InferParams`/`InferQuery`/`StandardSchemaV1` 等）。

### `@finesoft/browser`

- `start-app.ts:147`、`flow-action.ts:68/184/210`：`framework.routeUrl(...)` 前加 `await`（均已在 async 函数内）。

### `@finesoft/ssr`

- `render.ts:149`：`framework.routeUrl(...)` 前加 `await`（已在 async 函数内）。

### `@finesoft/server`

- **零改动**（不直接调用 `router.resolve` / `routeUrl`，经 ssr 间接走）。

### `@finesoft/front`

- 重新导出 core 新增的原语 / 修饰器 / 类型，保证应用只从 `@finesoft/front` 导入即可使用。

---

## 6. 向后兼容性

- **未声明 `params`/`query` 的路由**：参数仍为 `string`，运行时行为完全不变。
- **`Intent.params` 类型放宽**（`string` → `unknown`）：属类型层 minor breaking——直接 `intent.params.x` 当 `string` 用的代码需断言；但经 `BaseController` 的 `TParams` 推断的用法不受影响。`core/browser/ssr` 均为私有包，仅 `front` 对外，影响面集中。
- **`resolve`/`routeUrl` 改异步**：对框架内部是机械加 `await`；若用户直接调用 `framework.routeUrl`（经 `front` 暴露），需改为 `await`——在 changeset/迁移说明中标注。
- **PrefetchedIntents（SSR→CSR hydration）**：缓存 key 为 `stableStringify(intent)`，而 `params` 值现在可能是 `number`/`boolean`。只要 SSR 与 CSR 执行同一份 `bootstrap`（codec 注册一致），两端 `resolve` 对同一 URL 产出相同的转换后值，key 仍一致、缓存正常命中——这是既有「同构 bootstrap」约束的自然延续，无需额外处理；实现时加一条 SSR↔CSR 命中回归测即可。

---

## 7. 安全考量

- 保留 `createNullPrototypeRecord` 写入 `params`，延续防原型污染。
- codec 校验本身即边界防御，符合「仅在系统边界校验用户输入」原则。
- `oneOf` / `uuid` 等收敛输入取值范围，降低下游注入面。

---

## 8. 测试策略

1. **原语单测**（`core/test/router/params/`）：每个原语的通过 / 失败 / 边界（空串、超限、非法格式、`oneOf` 非成员）。
2. **修饰器单测**：`optional` 缺失返回 `undefined`、`withDefault` 缺失返回默认值、存在时委托内部。
3. **`resolve` 集成测**（扩 `core/test/router/router.test.ts`，改 async）：
    - 校验通过 → `params` 为转换后强类型值；
    - 校验失败 → fall-through，最终 `null`；
    - 重叠路由按顺序匹配（`int` 落空被 `str` 接住）；
    - path + query 混合；未声明 codec 的 query 保持 string；
    - 防原型污染用例（`__proto__` 等）仍通过。
4. **异步 schema 适配测**：mock 一个返回 `Promise` 的 Standard Schema，验证 `resolve` 正确 `await`。
5. **类型测**（`expectTypeOf`）：`ExtractParamNames` 多形态、`InferParams`/`InferQuery` 推断、`ParamsFor` 对错误 key 报错（6c）。
6. **调用链回归**：`framework.test.ts`、`browser` flow-action / start-app 测试加 `await`，确保导航与 popstate 路径不回归。
7. **模板示范**（可选，最后）：把 `templates/*/src/lib/controllers/product-detail.ts` 的 `:id` 升级为 `int()`，作为可运行示例。

---

## 9. 实现顺序建议

1. `standard.ts` 类型别名 + `runStandard`（无依赖，先立地基）。
2. 原语 + 修饰器 + 单测（TDD）。
3. `infer.ts` 类型工具 + 类型测。
4. `Router.add`/`resolve` 异步化 + 校验 + 集成测。
5. `framework.routeUrl` 异步化 + browser/ssr 调用点加 `await` + 回归测。
6. `RouteDefinition` 泛型化 + `defineRoutes` 透传 + 一致性类型测。
7. 导出面（core → front）。
8. 模板示范 + 文档。

---

## 10. 开放问题 / 未来增强

- 多值 query（`?tag=a&tag=b` → `string[]`）的内置原语。
- `optional` 参数渲染为可选属性键（`page?: number`）的类型精细化。
- 可选：从 path 字面量为 controller **自动**关联参数类型（免去手写 `InferParams<typeof ...>`）的 helper（如 `defineRoute` 单数形态）。
- 可选：strict 模式开关，把校验失败升级为显式 `400`（决策 3 的反向选项），按需引入。
