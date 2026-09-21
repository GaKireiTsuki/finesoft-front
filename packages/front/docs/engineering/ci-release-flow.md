# Engineering: validation and release

`@finesoft/front` and `@finesoft/create-app` are the published packages. Core, Web, Browser, SSR and Server remain private. The front build bundles their implementation into explicit ESM entries and declarations. Each native renderer keeps its selected UI peer external.

## Local checks

```sh
vp install
vp run --filter '@finesoft/front...' build
vp check
vp test --coverage
vp run -r build
vp exec node scripts/verify-publish-transforms.mjs
vp exec node scripts/verify-runtime-boundaries.mjs
```

`vp pack` is the library build command. `vp pm pack` creates a local package tarball. Front's paired prepack/postpack scripts rewrite its publish manifest and restore the exact working manifest, including when preparation fails. Scaffolder preparation copies the current six templates and makes their package and TypeScript configuration standalone.

## Repository automation

Both Quality jobs first build front and its workspace dependencies. The root Vite configuration loads the controller type generator, which imports the built core package; this preparation is required on a fresh checkout.

Pull requests run Quality (`vp check` and `vp test --coverage`). A push to `main` starts Release, which calls the same Quality workflow and waits for both checks to pass. CodeQL runs independently over `packages/{core,web,browser,ssr,server,front}/src/**`.

Release checks out the tested commit, generates a patch changeset for both public packages, applies Changesets (including any explicit minor/major changesets), updates the lockfile and builds. It then pushes the version commit to `main` with the built-in `GITHUB_TOKEN` before publishing to npm. If another push advances `main`, publication stops; the newer push gets its own validation and release. The workflow never rebases an already-built artifact or overwrites newer commits. Git tags are pushed after npm publication succeeds.

The publishing job uses a GitHub-hosted runner with `id-token: write`, no dependency cache and no npm token. Changesets invokes the repository's pnpm 11 through Vite+; pnpm supports npm OIDC and automatic provenance natively. Both public packages declare their source repository and public registry. `RELEASE_PUSH_TOKEN` and `NPM_TOKEN` are no longer used.

### npm configuration

In Settings for **each** of `@finesoft/front` and `@finesoft/create-app`, add a GitHub Actions trusted publisher:

| Field                | Value                                                 |
| -------------------- | ----------------------------------------------------- |
| Organization or user | `GaKireiTsuki`                                        |
| Repository           | `finesoft-front`                                      |
| Workflow filename    | `release.yml`                                         |
| Environment name     | Leave empty; the workflow does not use an environment |
| Allow npm publish    | Enabled for this automatic release workflow           |

Keep “Require two-factor authentication and disallow bypass 2fa tokens” selected; it is compatible with trusted publishing. This pipeline publishes directly, so a stage-only connection cannot authorize it. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/). Saving the connection alone does not prove publication works: verify the first Release run and the actual versions on npm.

### Retry a failed release

After fixing the cause, select **Release → Run workflow → main**, or run:

```sh
gh workflow run release.yml --ref main
```

Manual dispatch validates and builds the versions already in `main`; it does **not** create another changeset or bump versions. Changesets skips versions already present on npm, so partial publication can be retried. The tag step restores missing release tags. If failure occurred before the version commit reached `main`, retry the original push run while its commit is still the branch head, or push the correction to start a new release.

Local versioning uses `vp run changeset` and `vp run version`. `vp run release` builds and publishes; `vp run release:publish` only publishes an existing build. A local build or tarball test does not publish, deploy, push a commit or validate an external environment.

## Application projects

Use the generated application's own `vp run build` and deployment configuration. Keep environment secrets in the chosen host's bindings. Install only the renderer and host peers that the application imports. The complete local runtime and installed-consumer evidence is described in the repository's `docs/application-boundaries-acceptance.md`.
