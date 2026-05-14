# Engineering: CI & release flow

How the framework itself is released, and how to set up the same workflow for an app that depends on it.

## What ships

Only `@finesoft/front` is published to npm. The internal `core` / `browser` / `ssr` / `server` packages are bundled into `front` via `tsdown`'s `noExternal: [@finesoft/*]`.

This means:

- One npm package for users to install
- Internal refactors don't bump multiple versions
- Single CHANGELOG to read

`create-finesoft-app` is its own published package (a CLI), separate from the framework runtime.

## The release workflow

The repo ships a single `.github/workflows/release.yml` that handles everything inline. Trigger: push to `main`.

```
push to main
    │
    ▼
Checkout main (with PAT, not GITHUB_TOKEN)
    │
    ▼
Reconcile npm registry with main
    ├── npm == main? → continue
    ├── main > npm? → catch-up publish current main version
    └── npm > main? → error, manual investigation
    │
    ▼
Generate auto-changeset (one patch per push)
    │
    ▼
Apply version bump
    ├── changes? → continue
    └── no changes? → done, nothing to publish
    │
    ▼
Commit "chore(release): version packages"
    │
    ▼
Build all packages, publish @finesoft/front to npm
    │
    ▼
Push commit + tag back to main (with rebase retry)
```

### Why one inline workflow instead of changesets/action's PR mode

The standard changesets workflow opens a PR ("Version Packages") that, when merged, triggers a second workflow run that publishes. **But `GITHUB_TOKEN`-merged commits don't trigger subsequent workflows** (GitHub's anti-recursion safety) — the publish never fires. The inline workflow does everything in one run, no PR hop.

### Why a PAT instead of `GITHUB_TOKEN`

The repo has a ruleset enforcing signed commits, linear history, and required PRs on `main`. Bypass actors include `RepositoryRole=5 (admin)` but **not** `github-actions[bot]`. GitHub's UI does not allow adding the bot to the bypass list. Push from a PAT owned by an admin user matches the existing bypass entry.

The PAT is `Contents: Read & Write` only — the minimum needed for `git push`.

## Concurrency

```yaml
concurrency: release-${{ github.ref }}
```

Multiple pushes to `main` queue rather than cancel. This matters because:

- Cancellation mid-publish leaves npm in an inconsistent state
- Each push must wait for the previous to finish to avoid version-number races
- The next run's reconcile step picks up whatever the previous one published

## Idempotency

`changeset publish` skips versions already on npm. So if push to `main` fails after publish:

- npm: has version 0.1.75
- main: stuck at 0.1.74

The next release run's reconcile detects `main < npm`, refuses to "catch up backwards," and errors out. Manual remediation: open a PR that bumps `packages/front/package.json` to match npm and merges. Subsequent pushes resume normally.

## Setting up the same for an app

Most apps don't need a publish step — they have deploys instead. But the changeset + auto-bump shape still works:

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
              run: vp run deploy # your deploy command

            - name: Push tag and commit
              if: steps.bump.outputs.should_publish == 'true'
              run: git push --follow-tags origin HEAD:main
```

Replace `vp run deploy` with your platform's deploy command (Vercel, Cloudflare, your own infra).

## Conventional commits + auto-changeset

The `release:auto:changeset` script (in this repo, generates one patch changeset per push) is intentionally simple — every merged PR becomes one patch bump. For semver-driven versioning, replace it with a script that:

- Reads `git log` since the last tag
- Maps commit prefixes (`feat:`, `fix:`, `BREAKING:`) to changeset types
- Writes the right `.changeset/*.md`

The framework's repo uses patch-only because:

- Every push is a small change; large changes go through review and become small commits anyway
- Real breaking changes are rare and warrant manual changesets
- It avoids a class of "the prefix lies" bugs

Pick the policy that matches how your team commits.

## Per-PR validation (`quality.yml`)

The repo also has a `quality.yml` workflow on PRs:

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

The `check` job (format + lint + types) is gated off by `if: false` in this repo because Vite+ runs them all locally via pre-commit. Re-enable it if your team doesn't run pre-commit hooks consistently.

## CodeQL

The repo enables CodeQL on a schedule and PRs. Scan scope is restricted to `packages/{core,browser,ssr,server,front}/src/**` — tests, templates, scripts, and the scaffolder are excluded.

For application repos, enable the default CodeQL config — its noise is low and it catches real issues (open redirects, SQL injection, secret exposure).

## Required status checks

The repo ruleset requires:

- `Coverage` (from `quality.yml`)
- `CodeQL`

PRs cannot merge until both pass. The release workflow bypasses these via the admin PAT — release runs after merge, on `main`, so the checks already passed on the PR.

## Migration: from changesets PR mode to inline

If you're moving an existing repo from `changesets/action` (PR mode):

1. Delete the old release workflow
2. Create the inline workflow above
3. Generate a fine-grained PAT, store as `RELEASE_PUSH_TOKEN`
4. The first push to main after this change will:
    - Detect main == npm (no catch-up needed)
    - Generate one patch changeset
    - Bump + publish + push back to main

If there's a pending "Version Packages" PR from the old workflow, close it without merging. The auto-changeset will pick up everything from there.

## What can go wrong

| Symptom                                         | Cause                                                                             | Fix                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `[remote rejected] HEAD -> main`                | PAT actor not in ruleset bypass; PAT lacks `Contents: Write`                      | Verify PAT scope; confirm push actor is an admin user          |
| `npm ... is ahead of main`                      | Previous run published but failed to push                                         | Open a PR syncing `packages/front/package.json` to npm version |
| Workflow doesn't trigger after a release commit | `if: "!startsWith(github.event.head_commit.message, 'chore(release):'"` filtering | Working as intended — recursion prevention                     |
| Pre-commit hook (`vp check`) fails CI           | Local formatter not run                                                           | `vp check --fix` locally; commit; rerun                        |

## See also

- The actual release workflow: `.github/workflows/release.yml`
- The actual quality workflow: `.github/workflows/quality.yml`
- [Changesets docs](https://github.com/changesets/changesets) — for understanding `vp run version` and `vp run release`
