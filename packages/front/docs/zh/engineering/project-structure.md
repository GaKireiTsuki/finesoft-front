# 应用结构

React、Vue、Svelte 的六个模板保留 full、minimal 两档。同档位的页面、路由、数据、文案和交互一致；生成的每个项目都能独立使用，只依赖公开包入口。

## 选择档位

| 档位    | 页面与路由                                                          | 示例能力                                                                           |
| ------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Full    | 首页 `/`、商品 `/products/:id`、搜索 `/search?q=...`、关于 `/about` | SSR、关于页 CSR、URL 动作、类型化参数、DI、数据映射与 HTTP 客户端、认证和 SEO 守卫 |
| Minimal | Feed `/`、详情 `/item/:id`、Notes `/notes`                          | 标签与栈导航、页面草稿、全局资料、会话恢复、JSON 语言文件和 SSR 水合               |

两档模板都使用一个原生 App，布局包住 Outlet。这是两类业务示例，不代表框架能力的高低。

## 文件职责

```text
src/config.ts          # 应用标识，也是会话存储的命名空间
src/app-definition.ts  # 页面定义、路由、守卫及可选导航结构
src/views.ts           # 浏览器与 SSR 共用的原生视图注册表
src/main.ts            # 标准浏览器启动与 HMR 销毁
src/ssr.ts             # 所选框架的标准 SSR renderer
src/App.<native>       # full 布局，或 minimal 的导航栏与全局资料
src/pages/             # 原生页面组件（.tsx / .vue / .svelte）
src/components/        # full 的可复用展示组件
src/lib/controllers/   # BaseController 页面加载器及显式公开数据
src/lib/models/        # 页面与数据类型
src/styles.css         # 同档位一致的样式
src/locales/           # minimal：en-US 与 zh-Hans 语言文件
```

Full 的商品数据、mapper、HTTP 客户端和守卫继续放在 `src/lib/`。Minimal 通过原生 useSnapshot 绑定读取已提交快照。资料状态与组件根归原生应用所有，框架负责导航事务与持久化。

## 控制器与页面声明

六个模板都使用 `BaseController`：`lib/controllers/` 中的类实现业务加载，`app-definition.ts` 用 `definePage({ id, create: () => new HomeController() })` 注册工厂，并复用返回引用的 `route()`、`leaf()` 和 `bindView()`。`views.ts` 绑定原生组件，组件通过 `page` 接收结果。

控制器从 `@finesoft/front` 导入，Web 页面类型和 `markPublic` 从 `@finesoft/front/web` 导入。控制器在实际执行时创建，页面草稿和全局资料分别交给页面实例与应用 store。错误页由 `getErrorPage` 工厂生成。完整的参数、DI、`fallback` 和函数 `handler` 用法见[路由、控制器与类型化页面](../02-routing-and-controllers.md)。

## 状态与语言

Minimal 的详情输入框和 Notes 文本框标记 `data-restore-root`。切换标签保留草稿，刷新恢复草稿；返回并移除详情实例后，其草稿被销毁。姓名属于当前应用实例的全局资料，可跨标签、跨刷新恢复。嵌入第二个应用时，调用 `mountApplication(target, persistenceKey, "memory", "/notes")` 并使用独立的存储键。

三套 minimal 默认 `zh-Hans`。修改 `src/app-definition.ts` 中的 `configuration.locale` 为 `en-US` 或 `zh-Hans` 后重新启动或构建。该示例展示语言文件加载及水合后的翻译；导航标签和示例条目保持英文。

Full 的 `/admin` 在缺少认证时重定向至 `/login?from=...`；实际登录页和认证服务由应用补充。示例 `auth_token` cookie 用于演示守卫放行。

## 保持三框架一致

同档位的公共 TypeScript 和样式直接包含在各项目中，并保持文件内容一致。允许的差异为原生 UI 语法、renderer 导入、框架依赖与应用标识。项目无需导入相邻模板，也没有私有运行包路径别名。脚手架复制这些相同源码，并附带当前档位的 README。

仓库维护时运行 `vp test packages/create-app/test` 检查结构与文件差异；构建六套模板后，运行 `vp exec node scripts/verify-template-renderers.mjs` 验证同一组浏览器交互。使用 `vp exec node scripts/verify-created-consumers.mjs /absolute/path/to/front.tgz`，可以在仓库外对六个生成项目分别安装和构建。

独立数据操作、Node、Worker 宿主可分别放入 `src/data-app.ts`、`src/node.ts`、`src/worker.ts`，通过公开入口使用应用契约。
