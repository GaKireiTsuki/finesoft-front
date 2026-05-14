# 工程实践：CI 与发布流程

框架自身的发布方式，以及给依赖它的应用设置同样 workflow 的方法。

## 发布什么

只有 `@finesoft/front` 发布到 npm。内部的 `core` / `browser` / `ssr` / `server` 包通过 `tsdown` 的 `noExternal: [@finesoft/*]` 打包进 `front`。

这意味着：

- 用户只装一个 npm 包
- 内部重构不会带动多个版本号
- 一份 CHANGELOG 可读

`create-finesoft-app` 是它自己发布的包（CLI），独立于框架运行时。

## 发布 workflow

仓库只有一个 `.github/workflows/release.yml`，内联处理一切。触发：push 到 `main`。

```
push to main
    │
    ▼
Checkout main（用 PAT 而非 GITHUB_TOKEN）
    │
    ▼
对账 npm 注册表与 main
    ├── npm == main? → 继续
    ├── main > npm? → catch-up publish 当前 main 版本
    └── npm > main? → 报错，需人工排查
    │
    ▼
生成自动 changeset（每次 push 一个 patch）
    │
    ▼
应用版本 bump
    ├── 有变更? → 继续
    └── 无变更? → 完成，不发布
    │
    ▼
Commit "chore(release): version packages"
    │
    ▼
构建所有包，publish @finesoft/front 到 npm
    │
    ▼
Push commit + tag 回 main（带 rebase 重试）
```

### 为什么用一个内联 workflow 而不是 changesets/action 的 PR 模式

标准 changesets workflow 开一个 PR（「Version Packages」），合并时触发第二次 workflow run 来发布。**但 `GITHUB_TOKEN` 合并的 commit 不触发后续 workflow**（GitHub 反递归安全策略）—— 发布永远不跑。内联 workflow 一次 run 里做完，没有 PR hop。

### 为什么用 PAT 而不是 `GITHUB_TOKEN`

仓库 ruleset 强制签名 commit、线性历史、`main` 上必须 PR。bypass actor 包括 `RepositoryRole=5 (admin)` 但**不**包括 `github-actions[bot]`。GitHub UI 不允许把这个 bot 加进 bypass list。用 admin 用户拥有的 PAT push 命中已有的 admin bypass 条目。

PAT 只授 `Contents: Read & Write` —— `git push` 需要的最小权限。

## 并发

```yaml
concurrency: release-${{ github.ref }}
```

多次 push 到 `main` 排队而不是取消。这点很重要：

- publish 中途取消会让 npm 处于不一致状态
- 每次 push 必须等前一次完成，避免版本号竞争
- 下一个 run 的对账步骤会捡起前一个已发布的版本

## 幂等

`changeset publish` 跳过 npm 上已有的版本。所以 push 到 `main` 在 publish 之后失败：

- npm：有 0.1.75
- main：还是 0.1.74

下一次 release run 的对账步骤检测到 `main < npm`，拒绝「往回 catch-up」并报错。人工补救：开一个 PR 把 `packages/front/package.json` bump 到 npm 版本并合并。之后 push 正常。

## 给应用设置同样的

大多数应用不需要 publish 步骤 —— 它们有部署。但 changeset + 自动 bump 形状仍然管用：

```yaml
name: Release

on:
    push:
        branches:
            - main

concurrency: release-${{ github.ref }}

jobs:
    release:
        runs-on: ubuntu-latest
        if: "!startsWith(github.event.head_commit.message, 'chore(release):')"
        permissions:
            contents: write
        steps:
            - uses: actions/checkout@v5
              with:
                  ref: main
                  fetch-depth: 0
                  token: ${{ secrets.RELEASE_PUSH_TOKEN }}

            - uses: voidzero-dev/setup-vp@v1
              with:
                  node-version: 24
                  cache: true

            - run: vp install --frozen-lockfile

            - name: Configure git
              run: |
                  git config user.name "github-actions[bot]"
                  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

            - name: Generate auto changeset
              run: vp run release:auto:changeset

            - name: Apply version bump
              id: bump
              run: |
                  vp run version
                  if git diff --quiet; then
                      echo "should_publish=false" >> "$GITHUB_OUTPUT"
                  else
                      NEW=$(node -p "require('./package.json').version")
                      echo "version=$NEW" >> "$GITHUB_OUTPUT"
                      echo "should_publish=true" >> "$GITHUB_OUTPUT"
                  fi

            - name: Commit version
              if: steps.bump.outputs.should_publish == 'true'
              run: |
                  git add -A
                  git commit -m "chore(release): version packages"

            - name: Build
              if: steps.bump.outputs.should_publish == 'true'
              run: vp run build

            - name: Deploy
              if: steps.bump.outputs.should_publish == 'true'
              run: vp run deploy # 你的部署命令

            - name: Push tag and commit
              if: steps.bump.outputs.should_publish == 'true'
              run: git push --follow-tags origin HEAD:main
```

把 `vp run deploy` 换成你平台的部署命令（Vercel、Cloudflare、自家基建）。

## Conventional commits + 自动 changeset

`release:auto:changeset` 脚本（本仓库的，每次 push 生成一个 patch changeset）有意简单 —— 每个合并 PR 变成一次 patch bump。要语义化版本驱动，替换为这样的脚本：

- 读上一个 tag 之后的 `git log`
- 把 commit 前缀（`feat:`、`fix:`、`BREAKING:`）映射到 changeset 类型
- 写对应的 `.changeset/*.md`

框架仓库用纯 patch，因为：

- 每次 push 是小变更；大变更经过 review 后还是会变成小 commit
- 真正的破坏性变更很少，值得手写 changeset
- 避开「前缀撒谎」的一类 bug

按你团队的提交习惯挑策略。

## 按 PR 校验（`quality.yml`）

仓库还有 `quality.yml` workflow，PR 上跑：

```yaml
on:
    pull_request:
    push:
        branches:
            - main

jobs:
    coverage:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v5
            - uses: voidzero-dev/setup-vp@v1
              with: { node-version: 24, cache: true }
            - run: vp install --frozen-lockfile
            - run: vp test --coverage
            - uses: actions/upload-artifact@v7
              with:
                  name: coverage-report
                  path: reports/coverage
                  if-no-files-found: error
```

`check` job（fmt + lint + types）在本仓库被 `if: false` 关掉，因为 Vite+ 本地走 pre-commit 跑这些。如果你的团队 pre-commit hook 跑得不稳，重新打开。

## CodeQL

仓库定时和 PR 上跑 CodeQL。扫描范围限定 `packages/{core,browser,ssr,server,front}/src/**`。测试、模板、脚本、脚手架都排除。

应用仓库启用默认 CodeQL 配置即可 —— 噪声低，能抓真实问题（open redirect、SQL 注入、密钥暴露）。

## 必需状态检查

仓库 ruleset 要求：

- `Coverage`（来自 `quality.yml`）
- `CodeQL`

两个都过才能合 PR。release workflow 通过 admin PAT bypass —— release 在 PR 合并后跑在 `main` 上，那些 check 在 PR 上已经过了。

## 迁移：从 changesets PR 模式到内联

把现有仓库从 `changesets/action`（PR 模式）迁过来：

1. 删旧 release workflow
2. 创建上面的内联 workflow
3. 生成一个 fine-grained PAT，存为 `RELEASE_PUSH_TOKEN`
4. 这次改动后下一次 push 到 main 会：
    - 检测到 main == npm（不需要 catch-up）
    - 生成一个 patch changeset
    - bump + publish + push 回 main

如果有旧 workflow 留下的「Version Packages」PR pending，不要合直接关掉。自动 changeset 会从那里接着写。

## 可能出错的情况

| 症状                                   | 原因                                                                         | 修法                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `[remote rejected] HEAD -> main`       | PAT actor 不在 ruleset bypass；PAT 缺 `Contents: Write`                      | 验 PAT scope；确认 push actor 是 admin 用户            |
| `npm ... is ahead of main`             | 前一次 run publish 后 push 失败                                              | 开 PR 把 `packages/front/package.json` 同步到 npm 版本 |
| 一次 release commit 后 workflow 不触发 | `if: "!startsWith(github.event.head_commit.message, 'chore(release):'"` 过滤 | 按设计 —— 防递归                                       |
| Pre-commit hook（`vp check`）CI 失败   | 本地没跑 formatter                                                           | 本地 `vp check --fix`；commit；重跑                    |

## 参考

- 实际的 release workflow：`.github/workflows/release.yml`
- 实际的 quality workflow：`.github/workflows/quality.yml`
- [Changesets 文档](https://github.com/changesets/changesets) —— 理解 `vp run version` 和 `vp run release`
