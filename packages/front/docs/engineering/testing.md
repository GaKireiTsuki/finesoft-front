# Testing

Test operation contracts directly, then verify actual host responses and native UI lifetimes. Source exports alone do not prove packed consumer isolation.

## Direct operation / 直接操作

```ts
import { expect, test } from "vite-plus/test";
import { runtime, double } from "./data-app";
test("double", async () => {
    expect(await runtime.execute(double, 3)).toBe(6);
});
```

Run `vp check`, `vp test --coverage` and `vp run -r build`. Repository artifact runners cover Node/workerd, real browser Worker, native React/Vue/Svelte, wire protocol and installed local tarballs. Dispose runtimes, listeners and browser instances owned by each test. `scripts/verify-runtime-boundaries.mjs` exercises public packed entries without workspace aliases.
