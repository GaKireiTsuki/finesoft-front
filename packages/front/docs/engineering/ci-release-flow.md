# Engineering: validation and release

`@finesoft/front` and `@finesoft/create-app` are the published packages. Core, Web, Browser, SSR and Server remain private. The front build bundles their implementation into explicit ESM entries and declarations. Each native renderer keeps its selected UI peer external.

## Local checks

```sh
vp install
vp check
vp test --coverage
vp run -r build
vp exec node scripts/verify-publish-transforms.mjs
vp exec node scripts/verify-runtime-boundaries.mjs
```

`vp pack` is the library build command. `vp pm pack` creates a local package tarball. Front's paired prepack/postpack scripts rewrite its publish manifest and restore the exact working manifest, including when preparation fails. Scaffolder preparation copies the current six templates and makes their package and TypeScript configuration standalone.

## Repository automation

Quality runs both `vp check` and coverage. CodeQL includes `packages/{core,web,browser,ssr,server,front}/src/**`. The checked-in workflows under `.github/workflows/` are authoritative for triggers and release sequencing; organization permissions and branch rules are managed separately.

Changesets version the two public packages. A local build or tarball test does not publish, deploy, push a commit or validate an external environment. Follow the repository's release workflow and obtain the appropriate release authorization before performing those operations. This architecture migration changes no release workflow.

## Application projects

Use the generated application's own `vp run build` and deployment configuration. Keep environment secrets in the chosen host's bindings. Install only the renderer and host peers that the application imports. The complete local runtime and installed-consumer evidence is described in the repository's `docs/application-boundaries-acceptance.md`.
