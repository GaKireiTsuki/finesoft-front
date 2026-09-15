# 工程：验证与发布

公开包是 `@finesoft/front` 和 `@finesoft/create-app`。Core、Web、Browser、SSR、Server 保持私有，由 front 构建合入明确的 ESM 入口和声明。各原生渲染器保留所选 UI 的外部依赖。

## 本地检查

```sh
vp install
vp check
vp test --coverage
vp run -r build
vp exec node scripts/verify-publish-transforms.mjs
vp exec node scripts/verify-runtime-boundaries.mjs
```

`vp pack` 构建库，`vp pm pack` 生成本地安装包。Front 的 prepack/postpack 成对改写并恢复原始发布清单；准备失败也会恢复。脚手架准备脚本复制六套当前模板，并生成可独立安装的依赖与 TypeScript 配置。

## 仓库自动化

Quality 同时运行 `vp check` 和覆盖率测试。CodeQL 包含 `packages/{core,web,browser,ssr,server,front}/src/**`。触发条件与发布顺序以 `.github/workflows/` 中的文件为准；组织权限和分支规则单独管理。

Changesets 管理两个公开包的版本。本地构建和安装包验证不等于推送、发布、部署或外部环境验收。实际发布需遵循仓库发布流程和相应授权。本次架构迁移没有改动发布工作流。

## 应用项目

使用生成项目自身的 `vp run build` 和部署配置。密钥放在所选主机的绑定中，只安装应用使用的渲染器与主机依赖。完整本地运行时和独立安装消费者证据见仓库 `docs/application-boundaries-acceptance.md`。
