# 工程：验证与发布

公开包是 `@finesoft/front` 和 `@finesoft/create-app`。Core、Web、Browser、SSR、Server 保持私有，由 front 构建合入明确的 ESM 入口和声明。各原生渲染器保留所选 UI 的外部依赖。

## 本地检查

```sh
vp install
vp run --filter '@finesoft/front...' build
vp check
vp test --coverage
vp run -r build
vp exec node scripts/verify-publish-transforms.mjs
vp exec node scripts/verify-runtime-boundaries.mjs
```

`vp pack` 构建库，`vp pm pack` 生成本地安装包。Front 的 prepack/postpack 成对改写并恢复原始发布清单；准备失败也会恢复。脚手架准备脚本复制六套当前模板，并生成可独立安装的依赖与 TypeScript 配置。

## 仓库自动化

Quality 的两个作业都会先构建 front 及其工作区依赖。根 Vite 配置加载的控制器类型生成器会导入 core 的构建产物，因此全新检出必须先完成这一步。

PR 运行 Quality（`vp check` 和 `vp test --coverage`）。推送到 `main` 时启动 Release，复用同一份 Quality 工作流，并等待两项检查通过。CodeQL 独立扫描 `packages/{core,web,browser,ssr,server,front}/src/**`。

Release 检出通过检查的提交，为两个公开包生成 patch changeset，应用 Changesets（保留手写 changeset 的 minor/major 意图），同步锁文件并构建。随后使用内置 `GITHUB_TOKEN` 把版本提交推回 `main`，成功后才发布 npm。如果 `main` 已被其他推送推进，发布会停止，由新提交重新验证和发布；不会把旧构建强行变基，也不会覆盖后续提交。npm 发布成功后再推送 Git 标签。

发布作业使用 GitHub 托管 runner、`id-token: write` 和 npm OIDC Trusted Publishing，不使用依赖缓存或 npm token。Changesets 经 Vite+ 调用仓库指定的 pnpm 11；它原生支持 npm OIDC 和自动 provenance。两个公开包声明了源码仓库与公开 registry。工作流不再使用 `RELEASE_PUSH_TOKEN`、`NPM_TOKEN`。

### npm 配置

在 `@finesoft/front` 和 `@finesoft/create-app` **各自**的 Settings 页面添加 GitHub Actions Trusted Publisher：

| 字段                 | 值                                 |
| -------------------- | ---------------------------------- |
| Organization or user | `GaKireiTsuki`                     |
| Repository           | `finesoft-front`                   |
| Workflow filename    | `release.yml`                      |
| Environment name     | 留空；工作流未使用 environment     |
| Allow npm publish    | 勾选，允许当前自动发布流程直接发布 |

保留 “Require two-factor authentication and disallow bypass 2fa tokens” 设置；它与 Trusted Publishing 兼容。当前流程直接发布，只有 stage 权限的连接无法授权。详见 [npm 官方文档](https://docs.npmjs.com/trusted-publishers/)。保存连接不等于发布成功，须检查首次 Release 运行和 npm 上的实际版本。

### 失败重试

修复原因后，在 **Release → Run workflow → main** 手动运行，或执行：

```sh
gh workflow run release.yml --ref main
```

手动运行会检查、构建并发布 `main` 已有的版本，**不会**再生成 changeset 或升版。Changesets 跳过 npm 已存在的版本，因此两个包只成功一个时可以补发另一个；标签步骤也会补齐缺失标签。如果失败发生在版本提交推回 `main` 之前，可在原始提交仍是分支头时重跑原推送任务，或推送修复提交来重新发版。

本地使用 `vp run changeset`、`vp run version` 管理版本。`vp run release` 构建并发布，`vp run release:publish` 仅发布已有构建。本地构建和安装包验证不等于推送、发布、部署或外部环境验收。

## 应用项目

使用生成项目自身的 `vp run build` 和部署配置。密钥放在所选主机的绑定中，只安装应用使用的渲染器与主机依赖。完整本地运行时和独立安装消费者证据见仓库 `docs/application-boundaries-acceptance.md`。
