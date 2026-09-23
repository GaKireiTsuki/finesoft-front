---
"@finesoft/front": patch
"@finesoft/create-app": patch
---

Require Hono 4.13.5 or newer in framework peers and generated applications. Update the locked Vitest family to 4.1.11, js-yaml to 3.15.2/4.3.2 and devalue to 5.9.2 while retaining the stable Vite+ 0.2.8 toolchain.

Generated applications now pin pnpm 11.20.0 and include a standalone workspace configuration carrying the framework's patched dependency overrides, so installing a scaffold does not restore vulnerable transitive tooling versions. A Vite+ metadata patch keeps its coverage version guard and migration checks aligned with the updated test runner in both ESM and CJS consumers.
