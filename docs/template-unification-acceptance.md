# 六模板统一验收

日期：2026-09-16。基线：`63be7599ab194cdc1b061a7b65922a57d19f89f3`。工作分支：`refactor/application-boundaries`。

## 交付结果

React、Vue、Svelte 保留 full/minimal 两档。同档位的目录、页面、路由、数据、文案、样式和交互已统一。

| 档位    | 统一内容                                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| Full    | 首页、商品详情、搜索、关于页、错误页；SSR/CSR、URL 动作、参数转换、DI、认证/SEO 守卫；商品数据和导航动作集中定义 |
| Minimal | Feed、详情、Notes、错误页；标签/栈导航、详情草稿与 Notes 文本框、姓名资料、刷新恢复、JSON 翻译、独立应用实例     |

- 六套统一使用 `config.ts`、`app-definition.ts`、`main.ts`、`ssr.ts`、`views.ts`、`pages/`、`lib/`、`styles.css`。原生组件保留对应框架的语法。
- Full 有 **14 个**文件、minimal 有 **13 个**文件在同档位的三个项目中内容完全一致；启动与视图注册文件只保留原生 adapter 的差异。应用标识独立放在 `config.ts`。
- 移除模板中的私有运行包路径别名、Svelte 动作 context 分支、Vue 的旧状态启动分支和 React 重复的导航订阅。所有生成项目独立安装。
- 错误页复用 `createNavigation` 恢复完整标签树；内嵌应用的起始 URL 直接传递给现有宿主 API。
- 脚手架的两档选项集中定义；六套模板附带 README，中英文应用结构文档同步更新。

## 验证结果

| 检查                 | 结果与证据                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 格式、lint、类型检查 | `vp check` 通过，零警告/错误；[日志](../reports/template-unification/check.log)                                                                            |
| 脚手架契约与辅助函数 | **17/17** 测试通过；公共文件、原生文件清单、adapter、README、独立配置与导入边界均有检查；[日志](../reports/template-unification/create-app-tests.log)      |
| 六模板生产浏览器     | **6/6** 通过；同档位页面文字、DOM 层级、class 与关键属性一致；[结果](../reports/template-unification/browser/results.json)                                 |
| Full 交互            | 商品 SSR、About CSR、SPA 与历史返回、搜索数据、正常/修饰键链接、认证守卫与错误恢复均通过                                                                   |
| Minimal 交互         | 深链、详情与 Notes 草稿跨标签/刷新恢复、详情弹出销毁、资料恢复、浏览器前进后退、404 返回后恢复标签均通过                                                   |
| 开发模式与多实例     | **3/3** 通过；中文水合、英文 JSON loader、独立姓名与导航、销毁、独立错误起始页及恢复；[日志](../reports/template-unification/browser.log)                  |
| 仓库外生成项目       | **6/6** 独立安装，并完成客户端/SSR 构建；使用明确指定的本地 front 安装包；[结果](../reports/template-unification/created-consumers/result.json)            |
| 静态输出             | React minimal 使用真实 staticAdapter 生成 `/`、`/notes`、`/item/2`，水合与草稿保留通过；[结果](../reports/template-unification/static-starter/result.json) |
| CLI 和文档构建       | 两者通过；[CLI](../reports/template-unification/create-app-build.log)、[文档](../reports/template-unification/site-build.log)                              |
| 独立代码复审         | 规格、质量及补丁复审通过，无遗留问题；[报告](../reports/template-unification/code-review.md)                                                               |

浏览器验证使用本机 Chrome 152。六套首页截图已检查；同档位的三个 1280×720 截图 SHA-256 完全一致。这里没有扩展声称其他浏览器或所有视口已验证。[文件、源码与截图清单](../reports/template-unification/inventory.json)。

本次验证还修正了 Vue full 导航回调未执行而整页跳转的问题，以及 minimal 从 404 返回后未恢复标签树的问题。静态验收夹具同步携带应用 Vite 配置，确保 SSR 子构建加载同一个语言插件。

## 维护成本与范围

采用独立项目内直接包含公共源码、配合一致性检查的方式。未增加共享运行包或模板生成语言。六套 `src` 中 TS/原生组件/CSS 合计由 **3,196 行增加至 3,831 行**，主要用于补齐同档位能力和一致的展示/事件处理；此次交付不以减少总行数作为结论。

运行包与 CI 未修改。新增 create-app patch changeset，尚未执行版本发布。原架构重构的验收产物保留，本次证据放在独立的 `reports/template-unification/`。

使用与维护说明见[模板约定](../packages/front/docs/zh/engineering/project-structure.md)。
